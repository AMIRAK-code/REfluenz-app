// Supabase data layer. Every call returns plain objects shaped for the views,
// and every write is authorised by row level security on the server.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const initials = name => String(name || '').split(/\s+/).filter(Boolean).map(n => n[0]).slice(0, 2).join('').toUpperCase();
const toCreator = c => ({id:c.id, slug:c.slug, ownerId:c.owner_id, name:c.name, initials:initials(c.name), category:c.category, descriptor:c.descriptor, location:c.location, image:c.image, bio:c.bio});
const toEntry = (e, previewUrl) => ({id:e.id, creatorId:e.creator_id, title:e.title, subtitle:e.subtitle, excerpt:e.excerpt, category:e.category, format:e.format, image:e.image, minutes:e.minutes, access:e.access, status:e.status, date:e.published_at || e.created_at,
  kind:e.kind || 'text', mediaCount:e.media_count ?? 0, previewUrl:previewUrl(e.preview_path), duration:e.duration_seconds ?? null});

const MEDIA_COLUMNS = 'id,entry_id,kind,path,poster_path,preview_path,mime,size_bytes,width,height,duration_seconds,alt,position';
const toMedia = m => ({id:m.id, entryId:m.entry_id, kind:m.kind, path:m.path, posterPath:m.poster_path ?? null, previewPath:m.preview_path ?? null, mime:m.mime,
  size:Number(m.size_bytes), width:m.width ?? null, height:m.height ?? null, duration:m.duration_seconds ?? null, alt:m.alt || '', position:m.position ?? 0});

const MEDIA_BUCKET = 'entry-media';
const PREVIEW_BUCKET = 'previews';
const MEDIA_QUERY_CHUNK = 100;       // keeps the .in() filter well inside URL length limits
const SIGNED_URL_MARGIN_MS = 5 * 60 * 1000;
const MAX_ALT = 200;
const PREVIEW_MAX_BYTES = 256 * 1024;   // the limit of the previews bucket
const STALL_MS = 60 * 1000;             // an upload that makes no progress for this long is given up
// The object-name rule of the database (app_private.media_name_ok): <creator uuid>/<entry uuid>/<file>, lowercase.
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const OBJECT_NAME = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
// Private files are fetched through signed URLs that expire after an hour, so they get a short browser lifetime: a long one would let a copied
// URL keep working from caches after it expires. Previews are public and never change, so they may be cached for a year.
const PRIVATE_CACHE = 'private, max-age=3600';
const PUBLIC_CACHE = 'max-age=31536000';

const TOO_LARGE = 'This file is too large (50 MB max).';
const BAD_TYPE = 'This file type is not supported.';
const BAD_IDS = 'This entry cannot take uploads right now. Reload the page and try again.';
const SESSION_LOST = 'Your session has expired or you do not have permission. Sign in again and retry.';
// Storage refuses an upload with 403 when the owner policy fails: the entry is not yours, or a quota is used up
// (60 objects per entry, 500 MB of originals per creator). The client cannot tell those apart, so the message covers both.
const REFUSED = 'This upload was refused. Your storage may be full (500 MB per atelier, 60 files per entry): remove media you no longer use, or sign in again, then retry.';
const NETWORK = 'We could not reach REFLUENZ. Check your connection and try again.';
const CANCELLED = 'Upload cancelled.';

const friendly = error => {
  const text = error?.message || String(error);
  // Our own functions and triggers raise P0001 with text written for people.
  if (error?.code === 'P0001') return text;
  if (/Invalid login credentials/i.test(text)) return 'That email and password do not match.';
  if (/Email not confirmed/i.test(text)) return 'Confirm your email first. Check your inbox for the link.';
  if (/User already registered/i.test(text)) return 'An account with this email already exists. Sign in instead.';
  if (/duplicate key.*slug/i.test(text)) return 'That atelier address is taken. Try another name.';
  if (/duplicate key.*entry_media/i.test(text)) return 'That file was already added.';
  if (/row-level security/i.test(text)) return 'You do not have permission to do that.';
  if (/Failed to fetch|NetworkError/i.test(text)) return NETWORK;
  // Storage and media constraints.
  if (/exceeded the maximum allowed size|payload too large|entry_media_size_bytes_check/i.test(text)) return TOO_LARGE;
  if (/invalid_mime_type|mime type .*not supported|entry_media_mime_check/i.test(text)) return BAD_TYPE;
  if (/bucket not found/i.test(text)) return 'Media storage is not available yet. Try again later.';
  if (/object not found|resource was not found/i.test(text)) return 'That file could not be found.';
  if (/jwt (expired|invalid)|invalid jwt/i.test(text)) return SESSION_LOST;
  return text;
};
const check = ({data, error}) => { if (error) throw Error(friendly(error)); return data; };

// Maps a failed storage upload (HTTP status plus the JSON body storage returns) to a message.
// Storage reports some failures as HTTP 400 with the real code in the body, so read both.
const uploadError = (status, body) => {
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
  return Error(detail.message ? friendly({message:detail.message}) : 'The upload did not complete. Try again.');
};

const encodePath = path => path.split('/').map(encodeURIComponent).join('/');
const imageExt = blob => /jpe?g/i.test(blob?.type || '') ? 'jpg' : 'webp';
const unique = list => [...new Set((list || []).filter(Boolean))];
// Previews are public teasers: only a small webp or jpeg fits the bucket. Anything else is skipped rather than failing the upload.
const usablePreview = blob => Boolean(blob) && /^image\/(webp|jpeg)$/.test(blob.type) && blob.size > 0 && blob.size <= PREVIEW_MAX_BYTES;

export function createApi(client, {url = SUPABASE_URL, key = SUPABASE_KEY, XHR = globalThis.XMLHttpRequest, now = () => Date.now(), uuid = () => globalThis.crypto.randomUUID(), stallMs = STALL_MS} = {}) {
  let userId = null;
  const origin = String(url).replace(/\/+$/, '');
  const redirect = () => new URL('/app.html', location.origin).href;

  // Signed URLs are cached until five minutes before they expire. `signing`
  // shares one in-flight request between overlapping callers.
  const signed = new Map();
  const signing = new Map();
  // Bumped whenever the account changes. A signing request that was started under an older number never reaches the cache, so the
  // previous user's URLs cannot be served to the next one.
  let generation = 0;
  const forgetSigned = () => { generation++; signed.clear(); signing.clear(); };

  // Only canonical object names become URLs: encodeURI would pass `..`, `?` and `#` through, so anything else is treated as no preview.
  const previewUrl = path => OBJECT_NAME.test(path || '') ? client.storage.from(PREVIEW_BUCKET).getPublicUrl(path)?.data?.publicUrl || null : null;

  // Removing storage objects is always best effort: the database is the source of truth.
  const discard = async (bucket, paths) => {
    const list = unique(paths);
    if (!list.length) return;
    for (const path of list) signed.delete(path);
    try { await client.storage.from(bucket).remove(list); } catch { /* orphaned files are harmless */ }
  };
  const purge = rows => Promise.all([
    discard(MEDIA_BUCKET, rows.flatMap(r => [r.path, r.posterPath])),
    discard(PREVIEW_BUCKET, rows.map(r => r.previewPath))
  ]);

  const accessToken = async () => {
    let token = null;
    try { token = (await client.auth.getSession())?.data?.session?.access_token; } catch { /* treated as signed out */ }
    if (!token) throw Error('Sign in to upload.');
    return token;
  };

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
    xhr.open('POST', `${origin}/storage/v1/object/${bucket}/${encodePath(path)}`);
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
    signal?.addEventListener('abort', cancel, {once:true});
    watch();
    xhr.send(blob);
  });

  return {
    // Deferred: calling Supabase from inside the auth callback can deadlock its lock.
    onAuthChange(fn) {
      client.auth.onAuthStateChange((event, session) => {
        const next = session?.user.id || null;
        if (next !== userId) forgetSigned();
        userId = next;
        setTimeout(() => fn(event, session), 0);
      });
    },
    async signIn(email, password) { check(await client.auth.signInWithPassword({email, password})); },
    async signUp(email, password, displayName) {
      const data = check(await client.auth.signUp({email, password, options:{data:{display_name:displayName}, emailRedirectTo:redirect()}}));
      return {confirmed:Boolean(data.session)};
    },
    async resetPassword(email) { check(await client.auth.resetPasswordForEmail(email, {redirectTo:redirect()})); },
    async updatePassword(password) { check(await client.auth.updateUser({password})); },
    async signOut() { check(await client.auth.signOut()); forgetSigned(); },

    async load() {
      const [profile, tiers, creators, entries, follows, bookmarks, likes, memberships, messages, notes] = await Promise.all([
        client.from('profiles').select('*').eq('id', userId).single(),
        client.from('tiers').select('*').order('level'),
        client.from('creators').select('*').order('created_at'),
        client.from('entries').select('id,creator_id,title,subtitle,excerpt,category,format,image,minutes,access,status,published_at,created_at,kind,media_count,preview_path,duration_seconds').order('published_at', {ascending:false, nullsFirst:true}),
        client.from('follows').select('creator_id').eq('user_id', userId),
        client.from('bookmarks').select('entry_id').eq('user_id', userId),
        client.from('likes').select('entry_id').eq('user_id', userId),
        client.from('memberships').select('creator_id,tier').eq('user_id', userId),
        client.from('messages').select('id,creator_id,member_id,sender,body,created_at,member:profiles(display_name)').order('created_at'),
        client.from('circle_notes').select('id,creator_id,body,created_at').order('created_at')
      ].map(p => p.then(check)));
      const allCreators = creators.map(toCreator);
      return {
        profile:{name:profile.display_name, bio:profile.bio},
        preferences:{compact:profile.compact},
        welcomeDismissed:profile.welcome_dismissed,
        tiers,
        creators:allCreators,
        myCreator:allCreators.find(c => c.ownerId === userId) || null,
        entries:entries.map(e => toEntry(e, previewUrl)),
        following:follows.map(f => f.creator_id),
        saved:bookmarks.map(b => b.entry_id),
        liked:likes.map(l => l.entry_id),
        memberships:Object.fromEntries(memberships.map(m => [m.creator_id, m.tier])),
        messages:messages.map(m => ({id:m.id, creatorId:m.creator_id, memberId:m.member_id, memberName:m.member?.display_name || 'Member', from:m.sender, text:m.body, date:m.created_at})),
        notes:notes.map(n => ({id:n.id, creatorId:n.creator_id, text:n.body, date:n.created_at}))
      };
    },
    // Returns the full text, or null when the reader's membership does not cover it.
    async body(entryId) { const rows = check(await client.from('entry_bodies').select('body').eq('entry_id', entryId)); return rows[0]?.body ?? null; },

    async setFollow(creatorId, on) { check(on ? await client.from('follows').insert({user_id:userId, creator_id:creatorId}) : await client.from('follows').delete().match({user_id:userId, creator_id:creatorId})); },
    async setBookmark(entryId, on) { check(on ? await client.from('bookmarks').insert({user_id:userId, entry_id:entryId}) : await client.from('bookmarks').delete().match({user_id:userId, entry_id:entryId})); },
    async setLike(entryId, on) { check(on ? await client.from('likes').insert({user_id:userId, entry_id:entryId}) : await client.from('likes').delete().match({user_id:userId, entry_id:entryId})); },
    async joinCircle(creatorId, tier) { check(await client.from('memberships').upsert({user_id:userId, creator_id:creatorId, tier, updated_at:new Date().toISOString()})); },
    async leaveCircle(creatorId) { check(await client.from('memberships').delete().match({user_id:userId, creator_id:creatorId})); },
    async sendMessage(creatorId, memberId, from, text) { check(await client.from('messages').insert({creator_id:creatorId, member_id:memberId, sender:from, body:text})); },
    async saveProfile({name, bio, compact}) { check(await client.from('profiles').update({display_name:name, bio, compact}).eq('id', userId)); },
    async dismissWelcome() { check(await client.from('profiles').update({welcome_dismissed:true}).eq('id', userId)); },

    async saveAtelier(values, id) {
      const row = {name:values.name, category:values.category, descriptor:values.descriptor, location:values.location, bio:values.bio, image:values.image};
      if (id) return check(await client.from('creators').update(row).eq('id', id));
      const slug = values.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) + '-' + Math.random().toString(36).slice(2, 6);
      check(await client.from('creators').insert({...row, slug, owner_id:userId}));
    },
    async saveEntry(id, values, status) {
      return check(await client.rpc('save_entry', {p_id:id || null, p_title:values.title, p_subtitle:values.subtitle, p_body:values.body, p_category:values.category, p_format:values.format, p_image:values.image, p_access:values.access, p_status:status, p_kind:values.kind || 'text'}));
    },
    // Reads the media first (the owner can) so the files can be removed once the
    // rows cascade away. A failed read stops the delete: it is safe to retry,
    // and nothing is left orphaned in storage.
    async deleteEntry(id) {
      const rows = check(await client.from('entry_media').select('path,poster_path,preview_path').eq('entry_id', id));
      check(await client.from('entries').delete().eq('id', id));
      await purge((rows || []).map(r => ({path:r.path, posterPath:r.poster_path, previewPath:r.preview_path})));
    },
    async postNote(creatorId, text) { check(await client.from('circle_notes').insert({creator_id:creatorId, body:text})); },
    async circleMembers(creatorId) {
      const rows = check(await client.from('memberships').select('tier,created_at,member:profiles(display_name)').eq('creator_id', creatorId).order('created_at', {ascending:false}));
      return rows.map(r => ({name:r.member?.display_name || 'Member', tier:r.tier, joined:r.created_at}));
    },

    // Media for entries, grouped by entry id and sorted by position. Row level
    // security leaves out entries the reader cannot open, so those ids are absent.
    async media(entryIds) {
      const ids = unique(entryIds);
      const grouped = {};
      if (!ids.length) return grouped;
      const chunks = [];
      for (let i = 0; i < ids.length; i += MEDIA_QUERY_CHUNK) chunks.push(ids.slice(i, i + MEDIA_QUERY_CHUNK));
      const pages = await Promise.all(chunks.map(async chunk => check(await client.from('entry_media').select(MEDIA_COLUMNS).in('entry_id', chunk).order('position').order('created_at'))));
      for (const row of pages.flat()) (grouped[row.entry_id] ||= []).push(toMedia(row));
      for (const list of Object.values(grouped)) list.sort((a, b) => a.position - b.position);
      return grouped;
    },
    // Temporary links for private files. One storage call covers everything not
    // cached yet; files that fail to sign (no access, deleted) are left out.
    async signedUrls(paths, expiresIn = 3600) {
      const urls = {};
      const missing = [];
      const waiting = [];
      const t = now(), mine = generation;
      for (const path of unique(paths)) {
        const hit = signed.get(path);
        if (hit && hit.expires - SIGNED_URL_MARGIN_MS > t) urls[path] = hit.url;
        else if (signing.has(path)) waiting.push(signing.get(path).then(url => { if (url) urls[path] = url; }));
        else missing.push(path);
      }
      if (missing.length) {
        const request = (async () => {
          const found = {};
          const rows = check(await client.storage.from(MEDIA_BUCKET).createSignedUrls(missing, expiresIn));
          if (mine !== generation) return found;   // the account changed while this was in flight: none of it is kept or handed on
          for (const row of rows || []) if (row && !row.error && row.path && row.signedUrl) found[row.path] = row.signedUrl;
          for (const [path, url] of Object.entries(found)) signed.set(path, {url, expires:t + expiresIn * 1000});
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
      // Object names must be canonical: <creator uuid>/<entry uuid>/<file>, all lowercase (the storage policies compare them as text).
      // Nothing reaches the network with an id that is not a uuid, so a bad value can never steer the request URL.
      const creatorFolder = String(creatorId).toLowerCase(), entryFolder = String(entryId).toLowerCase();
      if (!UUID.test(creatorFolder) || !UUID.test(entryFolder)) throw Error(BAD_IDS);
      const base = `${creatorFolder}/${entryFolder}/${String(uuid()).toLowerCase()}`;
      const ext = String(prepared.ext || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'bin';
      const poster = prepared.poster || null;
      const preview = usablePreview(prepared.preview) ? prepared.preview : null;
      const path = `${base}.${ext}`;
      const posterPath = poster ? `${base}-poster.${imageExt(poster)}` : null;
      const previewPath = preview ? `${base}.${imageExt(preview)}` : null;
      if (![path, posterPath, previewPath].every(name => !name || OBJECT_NAME.test(name))) throw Error(BAD_IDS);

      // The main file counts for 90% of the progress, the small files share the rest.
      const small = [poster && {bucket:MEDIA_BUCKET, path:posterPath, blob:poster}, preview && {bucket:PREVIEW_BUCKET, path:previewPath, blob:preview}].filter(Boolean);
      const queue = [{bucket:MEDIA_BUCKET, path, blob:file, weight:0.9}, ...small.map(f => ({...f, weight:0.1 / small.length}))];
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
      if (signal?.aborted) stop.abort(); else signal?.addEventListener('abort', forward, {once:true});
      try {
        if (signal?.aborted) throw Error(CANCELLED);
        const token = await accessToken();
        let failure = null;
        await Promise.allSettled(queue.map(item => {
          attempted.push(item);   // even a failed upload is cleaned up: the server may have kept it
          return send(item.bucket, item.path, item.blob, item.blob.type || prepared.mime, token, {signal:stop.signal, onProgress:p => report(item, p)})
            .then(() => report(item, 1), error => { failure ??= error; stop.abort(); });
        }));
        if (failure) throw failure;
        const row = check(await client.from('entry_media').insert({
          entry_id:entryId, kind:prepared.kind, path, poster_path:posterPath, preview_path:previewPath,
          mime:prepared.mime || file.type, size_bytes:prepared.size || file.size,
          width:prepared.width > 0 ? Math.round(prepared.width) : null, height:prepared.height > 0 ? Math.round(prepared.height) : null,
          duration_seconds:Number.isFinite(prepared.duration) ? Math.min(86400, Math.max(0, Math.round(prepared.duration))) : null,
          alt:String(alt ?? '').slice(0, MAX_ALT), position:Math.max(0, Math.min(99, Math.trunc(position) || 0))
        }).select(MEDIA_COLUMNS).single());
        last = 1;
        onProgress?.(1);
        return toMedia(row);
      } catch (error) {
        await Promise.all([MEDIA_BUCKET, PREVIEW_BUCKET].map(bucket => discard(bucket, attempted.filter(f => f.bucket === bucket).map(f => f.path))));
        throw new Error(friendly(error), {cause:error});
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
    },
    previewUrl,

    subscribe(fn) {
      return client.channel('atelier-live')
        .on('postgres_changes', {event:'INSERT', schema:'public', table:'messages'}, fn)
        .on('postgres_changes', {event:'INSERT', schema:'public', table:'circle_notes'}, fn)
        .subscribe();
    }
  };
}
