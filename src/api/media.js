// Post media: file lists, signed links, uploads with progress, and the cleanup of storage objects.
// Behaviour is specified by docs/POST_FORMATS.md; every rule there is kept here.
import { MEDIA_BUCKET, PREVIEW_BUCKET, MEDIA_COLUMNS, OBJECT_NAME, UUID, TOO_LARGE, BAD_TYPE, BAD_IDS, SESSION_LOST, REFUSED, NETWORK, CANCELLED,
  check, friendly, toMedia, unique, chunk, encodePath } from './util.js';

const MEDIA_QUERY_CHUNK = 100;       // keeps the .in() filter well inside URL length limits
const SIGNED_URL_MARGIN_MS = 5 * 60 * 1000;
const MAX_ALT = 200;
const PREVIEW_MAX_BYTES = 256 * 1024;   // the limit of the previews bucket
// Private files are fetched through signed URLs that expire after an hour, so they get a short browser lifetime: a long one would let a copied
// URL keep working from caches after it expires. Previews are public and never change, so they may be cached for a year.
const PRIVATE_CACHE = 'private, max-age=3600';
const PUBLIC_CACHE = 'max-age=31536000';

// Maps a failed storage upload (HTTP status plus the JSON body storage returns) to a message.
// Storage reports some failures as HTTP 400 with the real code in the body, so read both.
function uploadError(status, body) {
  let detail = {};
  try { detail = JSON.parse(body) || {}; } catch { /* not JSON */ }
  const code = Number(detail.statusCode) || status;
  const text = [detail.message, detail.error, detail.message ? '' : body].filter(Boolean).join(' ');
  if (status === 413 || code === 413 || /exceeded the maximum allowed size|payload too large|too large/i.test(text)) return Error(TOO_LARGE);
  if (status === 415 || code === 415 || /mime|not supported/i.test(text)) return Error(BAD_TYPE);
  // An expired token comes back as 401 or as a 403 whose error is InvalidJWT; the other 403s are the owner and quota policies.
  if (status === 401 || code === 401 || /jwt/i.test(text)) return Error(SESSION_LOST);
  if (status === 403 || code === 403 || /row-level security|unauthorized/i.test(text)) return Error(REFUSED);
  if (status >= 500) return Error('The upload service is having trouble. Try again in a moment.');
  return Error(detail.message ? friendly({message: detail.message}) : 'The upload did not complete. Try again.');
}

const imageExt = blob => /jpe?g/i.test(blob?.type || '') ? 'jpg' : 'webp';
// Previews are public teasers: only a small webp or jpeg fits the bucket. Anything else is skipped rather than failing the upload.
const usablePreview = blob => Boolean(blob) && /^image\/(webp|jpeg)$/.test(blob.type) && blob.size > 0 && blob.size <= PREVIEW_MAX_BYTES;

// Returns the public media methods plus `purge`, which other modules use to remove a deleted entry's files.
export function createMedia(ctx) {
  const {client, url, key, XHR, now, uuid, stallMs} = ctx;
  const previewUrl = ctx.map.urls.preview;

  // Signed URLs are cached until five minutes before they expire. `signing` shares one in-flight request between overlapping callers.
  const signed = new Map();
  const signing = new Map();
  // Bumped whenever the account changes. A signing request that was started under an older number never reaches the cache, so the
  // previous user's URLs cannot be served to the next one.
  let generation = 0;
  ctx.onAccountChange(() => { generation++; signed.clear(); signing.clear(); });

  // Removing storage objects is always best effort: the database is the source of truth.
  async function discard(bucket, paths) {
    const list = unique(paths);
    if (!list.length) return;
    for (const path of list) signed.delete(path);
    try { await client.storage.from(bucket).remove(list); } catch { /* orphaned files are harmless */ }
  }
  const purge = rows => Promise.all([
    discard(MEDIA_BUCKET, rows.flatMap(r => [r.path, r.posterPath])),
    discard(PREVIEW_BUCKET, rows.map(r => r.previewPath))
  ]);

  async function accessToken() {
    let token = null;
    try { token = (await client.auth.getSession())?.data?.session?.access_token; } catch { /* treated as signed out */ }
    if (!token) throw Error('Sign in to upload.');
    return token;
  }

  // One object upload over XMLHttpRequest so the editor can show progress. A connection that goes quiet (the request neither progresses
  // nor fails) is given up after `stallMs` without any progress, so a half-open connection cannot freeze the editor.
  const send = (bucket, path, blob, contentType, token, {onProgress, signal} = {}) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Error(CANCELLED));
    if (!XHR) return reject(Error('Uploads are not supported in this browser.'));
    const xhr = new XHR();
    let timer = 0, over = false;
    const settle = (fn, value) => { over = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); fn(value); };
    const cancel = () => { settle(reject, Error(CANCELLED)); xhr.abort(); };
    const watch = () => { if (over) return; clearTimeout(timer); timer = setTimeout(() => { settle(reject, Error(NETWORK)); try { xhr.abort(); } catch { /* already finished */ } }, stallMs); };
    xhr.open('POST', `${url}/storage/v1/object/${bucket}/${encodePath(path)}`);
    xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', key);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.setRequestHeader('content-type', contentType);
    xhr.setRequestHeader('cache-control', bucket === PREVIEW_BUCKET ? PUBLIC_CACHE : PRIVATE_CACHE);
    xhr.upload.onprogress = e => { watch(); if (e.lengthComputable && e.total) onProgress?.(Math.min(1, e.loaded / e.total)); };
    xhr.upload.onload = watch;   // the body is out; now the server has to answer
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? settle(resolve) : settle(reject, uploadError(xhr.status, xhr.responseText));
    xhr.onerror = () => settle(reject, Error(NETWORK));
    xhr.ontimeout = () => settle(reject, Error(NETWORK));
    xhr.onabort = () => settle(reject, Error(CANCELLED));
    signal?.addEventListener('abort', cancel, {once: true});
    watch();
    xhr.send(blob);
  });

  // The object names of one upload. Names must be canonical: <creator uuid>/<entry uuid>/<file>, all lowercase (the storage policies compare
  // them as text), and nothing reaches the network with an id that is not a uuid, so a bad value can never steer the request URL.
  function objectNames(entryId, creatorId, prepared) {
    const creatorFolder = String(creatorId).toLowerCase(), entryFolder = String(entryId).toLowerCase();
    if (!UUID.test(creatorFolder) || !UUID.test(entryFolder)) throw Error(BAD_IDS);
    const base = `${creatorFolder}/${entryFolder}/${String(uuid()).toLowerCase()}`;
    const ext = String(prepared.ext || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'bin';
    const poster = prepared.poster || null;
    const preview = usablePreview(prepared.preview) ? prepared.preview : null;
    const names = {
      path: `${base}.${ext}`,
      posterPath: poster ? `${base}-poster.${imageExt(poster)}` : null,
      previewPath: preview ? `${base}.${imageExt(preview)}` : null,
      poster, preview
    };
    if (![names.path, names.posterPath, names.previewPath].every(name => !name || OBJECT_NAME.test(name))) throw Error(BAD_IDS);
    return names;
  }

  return {
    purge,
    previewUrl,

    // Media for entries, grouped by entry id and sorted by position. Row level
    // security leaves out entries the reader cannot open, so those ids are absent.
    async media(entryIds) {
      const ids = unique(entryIds);
      const grouped = {};
      if (!ids.length) return grouped;
      const pages = await Promise.all(chunk(ids, MEDIA_QUERY_CHUNK).map(async part =>
        check(await client.from('entry_media').select(MEDIA_COLUMNS).in('entry_id', part).order('position').order('created_at'))));
      for (const row of pages.flat()) (grouped[row.entry_id] ||= []).push(toMedia(row));
      for (const list of Object.values(grouped)) list.sort((a, b) => a.position - b.position);
      return grouped;
    },

    // Temporary links for private files. One storage call covers everything not cached yet; files that fail to sign (no access, deleted)
    // are left out. Throws when the call as a whole fails; callers degrade (cards keep the blurred preview).
    async signedUrls(paths, expiresIn = 3600) {
      const urls = {};
      const missing = [];
      const waiting = [];
      const t = now(), mine = generation;
      for (const path of unique(paths)) {
        const hit = signed.get(path);
        if (hit && hit.expires - SIGNED_URL_MARGIN_MS > t) urls[path] = hit.url;
        else if (signing.has(path)) waiting.push(signing.get(path).then(link => { if (link) urls[path] = link; }));
        else missing.push(path);
      }
      if (missing.length) {
        const request = (async () => {
          const found = {};
          const rows = check(await client.storage.from(MEDIA_BUCKET).createSignedUrls(missing, expiresIn));
          if (mine !== generation) return found;   // the account changed while this was in flight: none of it is kept or handed on
          for (const row of rows || []) if (row && !row.error && row.path && row.signedUrl) found[row.path] = row.signedUrl;
          for (const [path, link] of Object.entries(found)) signed.set(path, {url: link, expires: t + expiresIn * 1000});
          for (const [path, entry] of signed) if (entry.expires <= t) signed.delete(path);
          return found;
        })();
        const shared = request.then(found => found, () => ({}));
        for (const path of missing) signing.set(path, shared.then(found => found[path] || null));
        try { Object.assign(urls, await request); }
        finally { if (mine === generation) for (const path of missing) signing.delete(path); }
      }
      await Promise.all(waiting);
      return urls;
    },

    // Uploads the file, its poster (video frame or image card thumbnail) and its small public preview at the same time, then records
    // the entry_media row. Anything already uploaded is removed on failure.
    async uploadMedia(entryId, creatorId, prepared, {position = 0, alt = '', onProgress, signal} = {}) {
      const file = prepared?.blob;
      if (!file) throw Error('Choose a file to upload.');
      const {path, posterPath, previewPath, poster, preview} = objectNames(entryId, creatorId, prepared);

      // The main file counts for 90% of the progress, the small files share the rest.
      const small = [poster && {bucket: MEDIA_BUCKET, path: posterPath, blob: poster}, preview && {bucket: PREVIEW_BUCKET, path: previewPath, blob: preview}].filter(Boolean);
      const queue = [{bucket: MEDIA_BUCKET, path, blob: file, weight: 0.9}, ...small.map(f => ({...f, weight: 0.1 / small.length}))];
      const attempted = [];
      const share = new Map(queue.map(item => [item, 0]));
      let last = 0;
      const report = (item, fraction) => {
        share.set(item, fraction);
        const total = queue.reduce((sum, f) => sum + f.weight * share.get(f), 0);
        const next = Math.min(0.99, Math.max(last, total));   // 1 is reserved for "saved"; the bar never moves backwards
        if (next > last) { last = next; onProgress?.(next); }
      };
      // The files go out together over one token. When one fails the others are stopped, and every one that was started is cleaned up.
      const stop = new AbortController(), forward = () => stop.abort();
      if (signal?.aborted) stop.abort(); else signal?.addEventListener('abort', forward, {once: true});
      try {
        if (signal?.aborted) throw Error(CANCELLED);
        const token = await accessToken();
        let failure = null;
        await Promise.allSettled(queue.map(item => {
          attempted.push(item);   // even a failed upload is cleaned up: the server may have kept it
          return send(item.bucket, item.path, item.blob, item.blob.type || prepared.mime, token, {signal: stop.signal, onProgress: p => report(item, p)})
            .then(() => report(item, 1), error => { failure ??= error; stop.abort(); });
        }));
        if (failure) throw failure;
        const row = check(await client.from('entry_media').insert({
          entry_id: entryId, kind: prepared.kind, path, poster_path: posterPath, preview_path: previewPath,
          mime: prepared.mime || file.type, size_bytes: prepared.size || file.size,
          width: prepared.width > 0 ? Math.round(prepared.width) : null, height: prepared.height > 0 ? Math.round(prepared.height) : null,
          duration_seconds: Number.isFinite(prepared.duration) ? Math.min(86400, Math.max(0, Math.round(prepared.duration))) : null,
          alt: String(alt ?? '').slice(0, MAX_ALT), position: Math.max(0, Math.min(99, Math.trunc(position) || 0))
        }).select(MEDIA_COLUMNS).single());
        last = 1;
        onProgress?.(1);
        return toMedia(row);
      } catch (error) {
        await Promise.all([MEDIA_BUCKET, PREVIEW_BUCKET].map(bucket => discard(bucket, attempted.filter(f => f.bucket === bucket).map(f => f.path))));
        throw new Error(friendly(error), {cause: error});
      } finally { signal?.removeEventListener('abort', forward); }
    },

    async updateMedia(mediaId, {alt, position} = {}) {
      const patch = {};
      if (alt !== undefined) patch.alt = String(alt ?? '').slice(0, MAX_ALT);
      if (position !== undefined) patch.position = position;
      if (!Object.keys(patch).length) return;
      check(await client.from('entry_media').update(patch).eq('id', mediaId));
    },

    // One media item or a list. The rows go first (one request for the whole list) so a failed delete never leaves a row pointing at a
    // missing file; deleting a row that is already gone is a no-op, so a retry is safe.
    async removeMedia(media) {
      const list = (Array.isArray(media) ? media : [media]).filter(Boolean);
      if (!list.length) return;
      check(list.length === 1 ? await client.from('entry_media').delete().eq('id', list[0].id) : await client.from('entry_media').delete().in('id', list.map(m => m.id)));
      await purge(list);
    }
  };
}
