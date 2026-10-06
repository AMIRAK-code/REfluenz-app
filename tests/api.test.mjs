import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api.js';
import { SUPABASE_URL, SUPABASE_KEY } from '../src/config.js';

// The api layer is exercised against a hand-written fake of the parts of
// supabase-js it touches (query builder, storage, auth) and a fake XMLHttpRequest.
// Nothing here talks to a network.

const URL = 'https://proj.supabase.co';
const KEY = 'sb_publishable_test';
// Real uuids: the api only builds object names from ids that look like the ones the database stores.
const CREATOR = '3f6c2d1e-8a4b-4c5d-9e7f-0a1b2c3d4e5f';
const ENTRY = '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

function fakeClient({ tables = {}, session = { access_token: 'tok-123' } } = {}) {
  const state = { session };
  const events = [];        // ordered log across database and storage calls
  const queries = [];       // every query that was awaited
  const rpcCalls = [];
  const storageCalls = [];  // { bucket, op, paths, expiresIn }
  const handlers = {};      // 'table.op' | 'rpc' | 'sign' | 'remove' | 'signIn' -> override
  let listener = null;
  let signedCount = 0;

  const respond = q => {
    const handler = handlers[`${q.table}.${q.op}`];
    if (handler) return handler(q);
    if (q.op === 'select') {
      const rows = tables[q.table] ?? [];
      return { data: q.single ? rows[0] ?? null : rows, error: null };
    }
    if (q.op === 'insert' && q.single) return { data: { id: 'media-1', ...q.payload }, error: null };
    return { data: null, error: null };
  };
  const from = table => {
    const q = { table, op: 'select', columns: null, filters: [], orders: [], payload: null, single: false };
    const b = {
      select(columns) { q.columns = columns; return b; },
      insert(payload) { q.op = 'insert'; q.payload = payload; return b; },
      update(payload) { q.op = 'update'; q.payload = payload; return b; },
      delete() { q.op = 'delete'; return b; },
      eq(column, value) { q.filters.push(['eq', column, value]); return b; },
      in(column, value) { q.filters.push(['in', column, value]); return b; },
      match(values) { q.filters.push(['match', values]); return b; },
      order(column, options) { q.orders.push([column, options]); return b; },
      single() { q.single = true; return b; },
      then(resolve, reject) {
        queries.push(q);
        events.push(`db ${q.op} ${q.table}`);
        return Promise.resolve(respond(q)).then(resolve, reject);
      }
    };
    return b;
  };
  const storage = {
    from: bucket => ({
      getPublicUrl: path => ({ data: { publicUrl: `${URL}/storage/v1/object/public/${bucket}/${path}` } }),
      async createSignedUrls(paths, expiresIn) {
        storageCalls.push({ bucket, op: 'sign', paths: [...paths], expiresIn });
        events.push(`storage sign ${bucket}`);
        if (handlers.sign) return handlers.sign(paths);
        return { data: paths.map(path => ({ error: null, path, signedUrl: `${URL}/storage/v1/object/sign/${bucket}/${path}?token=t${++signedCount}` })), error: null };
      },
      async remove(paths) {
        storageCalls.push({ bucket, op: 'remove', paths: [...paths] });
        events.push(`storage remove ${bucket}`);
        if (handlers.remove) return handlers.remove(paths);
        return { data: paths.map(name => ({ name })), error: null };
      }
    })
  };
  const client = {
    from,
    storage,
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      events.push(`rpc ${name}`);
      return handlers.rpc ? handlers.rpc(name, args) : { data: 'entry-1', error: null };
    },
    auth: {
      async getSession() { return { data: { session: state.session }, error: null }; },
      onAuthStateChange(fn) { listener = fn; return { data: { subscription: {} } }; },
      async signInWithPassword() { return handlers.signIn ? handlers.signIn() : { data: {}, error: null }; },
      async signOut() { return { error: null }; }
    }
  };
  return { client, state, events, queries, rpcCalls, storageCalls, handlers, emitAuth: (event, session) => listener(event, session) };
}

// A fake XMLHttpRequest class. `plan(xhr, n)` decides how each request (1-based n) ends.
function fakeXHR(plan) {
  const requests = [];
  class XHR {
    constructor() { this.headers = {}; this.upload = {}; this.status = 0; this.responseText = ''; this.aborted = false; requests.push(this); }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(name, value) { this.headers[name.toLowerCase()] = value; }
    send(body) { this.body = body; Promise.resolve().then(() => plan(this, requests.length)); }
    abort() { this.aborted = true; this.onabort?.(); }
  }
  return { XHR, requests };
}
const succeed = xhr => {
  for (const loaded of [25, 50, 100]) xhr.upload.onprogress({ lengthComputable: true, loaded, total: 100 });
  xhr.status = 200;
  xhr.responseText = '{"Key":"ok"}';
  xhr.onload();
};
const respondWith = (status, body = '') => xhr => { xhr.status = status; xhr.responseText = body; xhr.onload(); };

const blob = (type, size = 16) => new Blob([new Uint8Array(size)], { type });
const imagePrepared = (over = {}) => ({ kind: 'image', blob: blob('image/webp', 2000), mime: 'image/webp', ext: 'webp', size: 2000, width: 1600, height: 900, duration: null, poster: null, preview: blob('image/webp', 300), name: 'look.png', ...over });
const videoPrepared = (over = {}) => ({ kind: 'video', blob: blob('video/mp4', 5000), mime: 'video/mp4', ext: 'mp4', size: 5000, width: 1280, height: 720, duration: 12.6, poster: blob('image/jpeg', 800), preview: blob('image/webp', 300), name: 'clip.mp4', ...over });

const make = (fake, extra = {}) => createApi(fake.client, { url: URL, key: KEY, uuid: () => 'file-uuid', ...extra });
const BASE = `${CREATOR}/${ENTRY}/file-uuid`;
const REFUSED = 'This upload was refused. Your storage may be full (500 MB per atelier, 60 files per entry): remove media you no longer use, or sign in again, then retry.';
// The object-name rule the database enforces (app_private.media_name_ok).
const CANONICAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

// ---------------------------------------------------------------------------
// load, saveEntry, previewUrl
// ---------------------------------------------------------------------------
test('load maps the new entry fields and selects them', async () => {
  const entry = (id, extra) => ({ id, creator_id: 'c1', title: `Title ${id}`, subtitle: 'sub', excerpt: 'ex', category: 'Style', format: 'Essay', image: 'atelier', minutes: 2, access: 'public', status: 'published', published_at: '2026-10-01T00:00:00Z', created_at: '2026-09-30T00:00:00Z', ...extra });
  const fake = fakeClient({ tables: {
    profiles: [{ display_name: 'Aria', bio: 'b', compact: false, welcome_dismissed: true }],
    entries: [
      entry('e-img', { format: 'Gallery', kind: 'image', media_count: 3, preview_path: `${CREATOR}/${ENTRY}/p.webp`, duration_seconds: null }),
      entry('e-vid', { format: 'Film', kind: 'video', media_count: 1, preview_path: `${CREATOR}/${ENTRY}/p.jpg`, duration_seconds: 75 }),
      entry('e-bad', { format: 'Gallery', kind: 'image', media_count: 1, preview_path: 'x/../../../auth/v1/logout?y' }),
      entry('e-old', {})   // a row from before the migration: none of the new columns
    ]
  } });
  const api = make(fake);
  api.onAuthChange(() => {});
  fake.emitAuth('SIGNED_IN', { user: { id: 'u1' } });
  const state = await api.load();

  const [img, vid, bad, old] = state.entries;
  assert.equal(img.kind, 'image');
  assert.equal(img.mediaCount, 3);
  assert.equal(img.previewUrl, `${URL}/storage/v1/object/public/previews/${CREATOR}/${ENTRY}/p.webp`);
  assert.equal(bad.previewUrl, null, 'a path that is not a canonical object name never becomes a URL');
  assert.equal(img.duration, null);
  assert.equal(vid.kind, 'video');
  assert.equal(vid.duration, 75);
  assert.equal(vid.previewUrl, `${URL}/storage/v1/object/public/previews/${CREATOR}/${ENTRY}/p.jpg`);
  assert.deepEqual(old, { id: 'e-old', creatorId: 'c1', title: 'Title e-old', subtitle: 'sub', excerpt: 'ex', category: 'Style', format: 'Essay', image: 'atelier', minutes: 2, access: 'public', status: 'published', date: '2026-10-01T00:00:00Z', kind: 'text', mediaCount: 0, previewUrl: null, duration: null });

  const columns = fake.queries.find(q => q.table === 'entries').columns.split(',');
  for (const c of ['kind', 'media_count', 'preview_path', 'duration_seconds', 'id', 'access', 'status']) assert.ok(columns.includes(c), c);
  assert.equal(state.profile.name, 'Aria');
});

test('saveEntry sends p_kind and defaults it to text', async () => {
  const fake = fakeClient();
  const api = make(fake);
  const values = { title: 'A study', subtitle: 's', body: 'b', category: 'Style', format: 'Film', image: 'atelier', access: 'premium', kind: 'video' };
  assert.equal(await api.saveEntry(null, values, 'draft'), 'entry-1');
  assert.deepEqual(fake.rpcCalls[0], { name: 'save_entry', args: { p_id: null, p_title: 'A study', p_subtitle: 's', p_body: 'b', p_category: 'Style', p_format: 'Film', p_image: 'atelier', p_access: 'premium', p_status: 'draft', p_kind: 'video' } });
  await api.saveEntry('entry-9', { ...values, kind: undefined }, 'published');
  assert.equal(fake.rpcCalls[1].args.p_kind, 'text');
  assert.equal(fake.rpcCalls[1].args.p_id, 'entry-9');
  assert.equal(Object.keys(fake.rpcCalls[1].args).length, 10);
});

test('database exceptions raised by save_entry reach the editor unchanged', async () => {
  const fake = fakeClient();
  fake.handlers.rpc = () => ({ data: null, error: { code: 'P0001', message: 'Add at least one image before publishing.' } });
  await assert.rejects(make(fake).saveEntry('e', { title: 'x' }, 'published'), { message: 'Add at least one image before publishing.' });
});

test('previewUrl builds public URLs in the previews bucket, for canonical object names only', () => {
  const api = make(fakeClient());
  assert.equal(api.previewUrl(`${CREATOR}/${ENTRY}/p.webp`), `${URL}/storage/v1/object/public/previews/${CREATOR}/${ENTRY}/p.webp`);
  assert.equal(api.previewUrl(`${CREATOR}/${ENTRY}/ab-12_x.9.jpg`), `${URL}/storage/v1/object/public/previews/${CREATOR}/${ENTRY}/ab-12_x.9.jpg`);
  assert.equal(api.previewUrl(null), null);
  assert.equal(api.previewUrl(''), null);
  // encodeURI keeps `..`, `?` and `#`, so anything the database rule would refuse is refused here too.
  for (const path of ['c/e/p.webp', 'x/../../../auth/v1/logout?y', `${CREATOR}/${ENTRY}/p.webp?x=1`, `${CREATOR}/${ENTRY}/p.webp#frag`, `${CREATOR}/${ENTRY}/../p.webp`, `${CREATOR}/${ENTRY}/.hidden`,
    `${CREATOR.toUpperCase()}/${ENTRY}/p.webp`, `${CREATOR}/${ENTRY}`, `/${CREATOR}/${ENTRY}/p.webp`, `${CREATOR}/${ENTRY}/p.webp/`, `${CREATOR}/${ENTRY}/${'a'.repeat(129)}`]) assert.equal(api.previewUrl(path), null, path);
});

// ---------------------------------------------------------------------------
// media
// ---------------------------------------------------------------------------
test('media groups rows by entry, sorts by position and maps to camelCase', async () => {
  const row = (id, entry_id, position, extra = {}) => ({ id, entry_id, kind: 'image', path: `c/${entry_id}/${id}.webp`, poster_path: null, preview_path: `c/${entry_id}/${id}.webp`, mime: 'image/webp', size_bytes: 2048, width: 800, height: 600, duration_seconds: null, alt: '', position, ...extra });
  const fake = fakeClient({ tables: { entry_media: [
    row('m3', 'e1', 2), row('m1', 'e1', 0, { alt: 'First' }), row('m4', 'e2', 0, { kind: 'video', mime: 'video/mp4', poster_path: 'c/e2/m4-poster.jpg', duration_seconds: 42, size_bytes: '5000' }), row('m2', 'e1', 1)
  ] } });
  const result = await make(fake).media(['e1', 'e2', 'e1', null]);

  assert.equal(fake.queries.length, 1, 'one request');
  const q = fake.queries[0];
  assert.equal(q.table, 'entry_media');
  assert.deepEqual(q.filters, [['in', 'entry_id', ['e1', 'e2']]]);
  assert.equal(q.orders[0][0], 'position');
  assert.deepEqual(Object.keys(result).sort(), ['e1', 'e2']);
  assert.deepEqual(result.e1.map(m => m.id), ['m1', 'm2', 'm3']);
  assert.deepEqual(result.e1[0], { id: 'm1', entryId: 'e1', kind: 'image', path: 'c/e1/m1.webp', posterPath: null, previewPath: 'c/e1/m1.webp', mime: 'image/webp', size: 2048, width: 800, height: 600, duration: null, alt: 'First', position: 0 });
  assert.deepEqual(result.e2[0], { id: 'm4', entryId: 'e2', kind: 'video', path: 'c/e2/m4.webp', posterPath: 'c/e2/m4-poster.jpg', previewPath: 'c/e2/m4.webp', mime: 'video/mp4', size: 5000, width: 800, height: 600, duration: 42, alt: '', position: 0 });
});

test('media with no ids makes no request, and entries without readable media are absent', async () => {
  const fake = fakeClient();
  const api = make(fake);
  assert.deepEqual(await api.media([]), {});
  assert.deepEqual(await api.media(undefined), {});
  assert.deepEqual(await api.media([null, '']), {});
  assert.equal(fake.queries.length, 0);
  assert.deepEqual(await api.media(['locked']), {});   // row level security returned nothing
  assert.equal(fake.queries.length, 1);
});

test('media splits very long id lists into several bounded queries', async () => {
  const fake = fakeClient();
  fake.handlers['entry_media.select'] = q => ({ data: q.filters[0][2].map(id => ({ id: `m-${id}`, entry_id: id, kind: 'image', path: `p/${id}`, mime: 'image/webp', size_bytes: 1, position: 0 })), error: null });
  const ids = Array.from({ length: 205 }, (_, i) => `e${i}`);
  const result = await make(fake).media(ids);
  assert.equal(fake.queries.length, 3);
  assert.ok(fake.queries.every(q => q.filters[0][2].length <= 100));
  assert.equal(Object.keys(result).length, 205);
});

test('media surfaces database errors', async () => {
  const fake = fakeClient();
  fake.handlers['entry_media.select'] = () => ({ data: null, error: { message: 'Failed to fetch' } });
  await assert.rejects(make(fake).media(['e1']), { message: 'We could not reach REFLUENZ. Check your connection and try again.' });
});

// ---------------------------------------------------------------------------
// signedUrls
// ---------------------------------------------------------------------------
test('signedUrls dedupes, makes one call and serves repeats from the cache until five minutes before expiry', async () => {
  const fake = fakeClient();
  const clock = { t: 1_000_000 };
  const api = make(fake, { now: () => clock.t });
  const A = 'c/e/a.webp', B = 'c/e/b.mp4';

  const first = await api.signedUrls([A, B, A]);
  assert.deepEqual(fake.storageCalls, [{ bucket: 'entry-media', op: 'sign', paths: [A, B], expiresIn: 3600 }]);
  assert.deepEqual(Object.keys(first).sort(), [A, B]);
  assert.match(first[A], /sign\/entry-media\/c\/e\/a\.webp\?token=/);

  assert.deepEqual(await api.signedUrls([B, A]), first, 'second call is served from memory');
  assert.equal(fake.storageCalls.length, 1);

  clock.t += 3_600_000 - 300_000 - 1000;              // one second before the five minute margin
  assert.deepEqual(await api.signedUrls([A, B]), first);
  assert.equal(fake.storageCalls.length, 1);

  clock.t += 2000;                                     // inside the margin: renew
  const renewed = await api.signedUrls([A, B]);
  assert.equal(fake.storageCalls.length, 2);
  assert.notEqual(renewed[A], first[A]);
  assert.deepEqual(fake.storageCalls[1].paths, [A, B]);
  assert.deepEqual(await api.signedUrls([A]), { [A]: renewed[A] }, 'and the renewed links are cached again');
  assert.equal(fake.storageCalls.length, 2);
});

test('signedUrls only requests what is missing and honours expiresIn', async () => {
  const fake = fakeClient();
  const clock = { t: 5_000 };
  const api = make(fake, { now: () => clock.t });
  await api.signedUrls(['a'], 600);
  assert.equal(fake.storageCalls[0].expiresIn, 600);
  const mixed = await api.signedUrls(['a', 'c'], 7200);
  assert.deepEqual(fake.storageCalls[1], { bucket: 'entry-media', op: 'sign', paths: ['c'], expiresIn: 7200 });
  assert.deepEqual(Object.keys(mixed).sort(), ['a', 'c']);
  // 600 seconds is within five minutes of expiring after 5+ minutes
  clock.t += 301_000;
  await api.signedUrls(['a']);
  assert.equal(fake.storageCalls.length, 3);
  assert.deepEqual(fake.storageCalls[2].paths, ['a']);
});

test('signedUrls ignores files that fail to sign and does not cache them', async () => {
  const fake = fakeClient();
  fake.handlers.sign = paths => ({ data: paths.map(path => path === 'locked' ? { error: 'Object not found', path, signedUrl: null } : { error: null, path, signedUrl: `https://signed/${path}` }), error: null });
  const api = make(fake);
  assert.deepEqual(await api.signedUrls(['ok', 'locked']), { ok: 'https://signed/ok' });
  assert.deepEqual(await api.signedUrls(['ok', 'locked']), { ok: 'https://signed/ok' });
  assert.deepEqual(fake.storageCalls.map(c => c.paths), [['ok', 'locked'], ['locked']]);
});

test('signedUrls with nothing to sign makes no request', async () => {
  const fake = fakeClient();
  const api = make(fake);
  assert.deepEqual(await api.signedUrls([]), {});
  assert.deepEqual(await api.signedUrls(undefined), {});
  assert.deepEqual(await api.signedUrls(['', null]), {});
  assert.equal(fake.storageCalls.length, 0);
});

test('overlapping signedUrls calls share one in-flight request per file', async () => {
  const fake = fakeClient();
  const api = make(fake);
  const [one, two] = await Promise.all([api.signedUrls(['p']), api.signedUrls(['p', 'q'])]);
  assert.deepEqual(fake.storageCalls.map(c => c.paths), [['p'], ['q']]);
  assert.equal(one.p, two.p);
  assert.ok(two.q);
});

test('signedUrls reports a failed storage call and recovers on the next one', async () => {
  const fake = fakeClient();
  fake.handlers.sign = () => ({ data: null, error: { message: 'Failed to fetch' } });
  const api = make(fake);
  await assert.rejects(api.signedUrls(['a']), { message: 'We could not reach REFLUENZ. Check your connection and try again.' });
  delete fake.handlers.sign;
  assert.ok((await api.signedUrls(['a'])).a);
});

test('the signed URL cache is dropped when a different user signs in or the file is removed', async () => {
  const fake = fakeClient();
  const api = make(fake);
  api.onAuthChange(() => {});
  fake.emitAuth('SIGNED_IN', { user: { id: 'u1' } });
  await api.signedUrls(['a']);
  fake.emitAuth('TOKEN_REFRESHED', { user: { id: 'u1' } });
  await api.signedUrls(['a']);
  assert.equal(fake.storageCalls.filter(c => c.op === 'sign').length, 1, 'a token refresh keeps the cache');
  fake.emitAuth('SIGNED_OUT', null);
  await api.signedUrls(['a']);
  assert.equal(fake.storageCalls.filter(c => c.op === 'sign').length, 2, 'signing out clears it');

  await api.removeMedia({ id: 'm', path: 'a', posterPath: null, previewPath: null });
  await api.signedUrls(['a']);
  assert.equal(fake.storageCalls.filter(c => c.op === 'sign').length, 3, 'a removed file is not served from the cache');
});

test('a signing request that finishes after the account changed is neither cached nor handed on', async () => {
  const fake = fakeClient();
  let release;
  fake.handlers.sign = paths => new Promise(resolve => { release = () => resolve({ data: paths.map(path => ({ error: null, path, signedUrl: `https://signed/${path}` })), error: null }); });
  const api = make(fake);
  api.onAuthChange(() => {});
  fake.emitAuth('SIGNED_IN', { user: { id: 'u1' } });
  const pending = api.signedUrls(['a']);
  fake.emitAuth('SIGNED_IN', { user: { id: 'u2' } });   // another account takes over while the call is in flight
  release();
  assert.deepEqual(await pending, {}, 'the previous account\'s links are not handed to anyone');
  delete fake.handlers.sign;
  assert.ok((await api.signedUrls(['a'])).a);
  assert.equal(fake.storageCalls.filter(c => c.op === 'sign').length, 2, 'the new account signs for itself instead of reading the old answer from the cache');
  // Signing out does the same.
  fake.handlers.sign = paths => new Promise(resolve => { release = () => resolve({ data: paths.map(path => ({ error: null, path, signedUrl: `https://signed/old/${path}` })), error: null }); });
  const late = api.signedUrls(['b']);
  fake.emitAuth('SIGNED_OUT', null);
  release();
  assert.deepEqual(await late, {});
  delete fake.handlers.sign;
  assert.match((await api.signedUrls(['b'])).b, /sign\/entry-media\/b\?token=/);
});

// ---------------------------------------------------------------------------
// uploadMedia
// ---------------------------------------------------------------------------
test('uploadMedia stores an image, its preview and the row, with monotonic progress ending at 1', async () => {
  const fake = fakeClient();
  const progress = [];
  let atPreview = null;
  const { XHR, requests } = fakeXHR(xhr => { if (xhr.url.includes('/previews/')) atPreview = progress.at(-1); succeed(xhr); });
  const api = make(fake, { XHR });
  const prepared = imagePrepared();
  const media = await api.uploadMedia(ENTRY, CREATOR, prepared, { position: 2, alt: 'A coat', onProgress: p => progress.push(p) });

  assert.equal(requests.length, 2);
  const [main, preview] = requests;
  assert.equal(main.method, 'POST');
  assert.equal(main.url, `${URL}/storage/v1/object/entry-media/${BASE}.webp`);
  assert.equal(preview.url, `${URL}/storage/v1/object/previews/${BASE}.webp`);
  assert.deepEqual(main.headers, { authorization: 'Bearer tok-123', apikey: KEY, 'x-upsert': 'false', 'content-type': 'image/webp', 'cache-control': 'private, max-age=3600' }, 'private files get a short lifetime, so a copied signed URL cannot outlive its expiry in caches');
  assert.equal(preview.headers['content-type'], 'image/webp');
  assert.equal(preview.headers['cache-control'], 'max-age=31536000', 'public previews never change and may be cached for a year');
  assert.equal(main.body, prepared.blob);
  assert.equal(preview.body, prepared.preview);

  const insert = fake.queries.find(q => q.table === 'entry_media' && q.op === 'insert');
  assert.deepEqual(insert.payload, { entry_id: ENTRY, kind: 'image', path: `${BASE}.webp`, poster_path: null, preview_path: `${BASE}.webp`, mime: 'image/webp', size_bytes: 2000, width: 1600, height: 900, duration_seconds: null, alt: 'A coat', position: 2 });
  assert.deepEqual(media, { id: 'media-1', entryId: ENTRY, kind: 'image', path: `${BASE}.webp`, posterPath: null, previewPath: `${BASE}.webp`, mime: 'image/webp', size: 2000, width: 1600, height: 900, duration: null, alt: 'A coat', position: 2 });
  assert.deepEqual(fake.storageCalls, [], 'nothing to clean up');

  assert.ok(progress.length >= 4);
  progress.forEach((p, i) => { assert.ok(p > 0 && p <= 1, `in range: ${p}`); if (i) assert.ok(p > progress[i - 1], 'strictly increasing'); });
  assert.equal(progress.at(-1), 1);
  assert.equal(progress.filter(p => p === 1).length, 1, '1 is only reported once the row is saved');
  near(progress[0], 0.225);
  near(atPreview, 0.9);   // the main file is 90% of the work
});

test('uploadMedia stores a video with a jpeg poster, rounds the duration and uploads main, poster, preview in order', async () => {
  const fake = fakeClient();
  const progress = [];
  const { XHR, requests } = fakeXHR(succeed);
  const api = make(fake, { XHR });
  const media = await api.uploadMedia(ENTRY, CREATOR, videoPrepared(), { onProgress: p => progress.push(p) });

  assert.deepEqual(requests.map(r => r.url), [
    `${URL}/storage/v1/object/entry-media/${BASE}.mp4`,
    `${URL}/storage/v1/object/entry-media/${BASE}-poster.jpg`,
    `${URL}/storage/v1/object/previews/${BASE}.webp`
  ]);
  assert.deepEqual(requests.map(r => r.headers['content-type']), ['video/mp4', 'image/jpeg', 'image/webp']);
  const insert = fake.queries.find(q => q.op === 'insert').payload;
  assert.equal(insert.kind, 'video');
  assert.equal(insert.poster_path, `${BASE}-poster.jpg`);
  assert.equal(insert.preview_path, `${BASE}.webp`);
  assert.equal(insert.mime, 'video/mp4');
  assert.equal(insert.duration_seconds, 13);
  assert.equal(insert.position, 0);
  assert.equal(insert.alt, '');
  assert.equal(media.posterPath, `${BASE}-poster.jpg`);
  assert.equal(media.duration, 13);
  progress.forEach((p, i) => { if (i) assert.ok(p > progress[i - 1]); });
  assert.equal(progress.at(-1), 1);
});

test('uploadMedia names every object canonically: lowercase uuids, a random file uuid, a poster suffix and a lowercase extension', async () => {
  const creator = crypto.randomUUID(), entry = crypto.randomUUID();
  const fake = fakeClient();
  const { XHR, requests } = fakeXHR(succeed);
  const api = createApi(fake.client, { url: URL, key: KEY, XHR });   // the real crypto.randomUUID
  await api.uploadMedia(entry, creator, videoPrepared({ ext: 'MP4' }), {});
  await api.uploadMedia(entry.toUpperCase(), creator.toUpperCase(), imagePrepared({ ext: 'WebP' }), {});
  const objects = requests.map(r => r.url.replace(`${URL}/storage/v1/object/`, ''));
  assert.equal(objects.length, 5);   // video, poster, preview, image, preview
  const names = objects.map(o => o.slice(o.indexOf('/') + 1));
  for (const name of names) assert.match(name, CANONICAL, name);
  for (const row of fake.queries.filter(q => q.op === 'insert').map(q => q.payload)) {
    for (const path of [row.path, row.poster_path, row.preview_path].filter(Boolean)) assert.match(path, CANONICAL, path);
    assert.ok(row.path.startsWith(`${creator}/${entry}/`), 'the row path starts with the entry prefix the insert policy checks');
  }
  const [video, poster, videoPreview, image] = objects;
  assert.match(video, /^entry-media\/.+\.mp4$/);
  assert.match(poster, /^entry-media\/.+-poster\.jpg$/, 'posters live in the private bucket');
  assert.match(videoPreview, /^previews\/.+\.webp$/, 'previews live in the public bucket');
  assert.match(image, /^entry-media\/.+\.webp$/);
  assert.equal(new Set(names.filter(n => !n.includes('-poster')).map(n => n.split('/')[2].split('.')[0])).size, 2, 'one file uuid per upload, shared by its main file and preview');
});

test('uploadMedia keeps an odd extension inside the file name rule', async () => {
  const entry = crypto.randomUUID(), creator = crypto.randomUUID();
  for (const [ext, expected] of [['../../x.JPG?#', 'xjpg'], ['a'.repeat(200), 'a'.repeat(10)], ['', 'bin'], [undefined, 'bin'], ['??', 'bin']]) {
    const fake = fakeClient();
    const { XHR, requests } = fakeXHR(succeed);
    await createApi(fake.client, { url: URL, key: KEY, XHR }).uploadMedia(entry, creator, imagePrepared({ ext, preview: null }), {});
    const name = requests[0].url.replace(`${URL}/storage/v1/object/entry-media/`, '');
    assert.match(name, CANONICAL, name);
    assert.ok(name.endsWith(`.${expected}`), `${ext} -> ${name}`);
  }
});

test('uploadMedia only sends previews the bucket accepts and otherwise uploads without one', async () => {
  const cases = [
    [blob('image/webp', 256 * 1024), true],    // exactly at the 256 KB limit
    [blob('image/jpeg', 300), true],
    [blob('image/webp', 256 * 1024 + 1), false],
    [blob('image/png', 300), false],
    [blob('image/webp', 0), false],
    [null, false]
  ];
  for (const [preview, kept] of cases) {
    const fake = fakeClient();
    const { XHR, requests } = fakeXHR(succeed);
    const media = await make(fake, { XHR }).uploadMedia(ENTRY, CREATOR, imagePrepared({ preview }), {});
    assert.equal(requests.length, kept ? 2 : 1, `${preview?.type} ${preview?.size}`);
    assert.equal(media.previewPath, kept ? `${BASE}.${preview.type === 'image/jpeg' ? 'jpg' : 'webp'}` : null);
    assert.equal(fake.queries.find(q => q.op === 'insert').payload.preview_path, media.previewPath);
  }
});

test('uploadMedia uses a webp poster extension for webp posters', async () => {
  const fake = fakeClient();
  const { XHR, requests } = fakeXHR(succeed);
  await make(fake, { XHR }).uploadMedia(ENTRY, CREATOR, videoPrepared({ poster: blob('image/webp') }), {});
  assert.equal(requests[0].url, `${URL}/storage/v1/object/entry-media/${BASE}.mp4`);
  assert.equal(requests[1].url, `${URL}/storage/v1/object/entry-media/${BASE}-poster.webp`);
  assert.equal(fake.queries.find(q => q.op === 'insert').payload.path, `${BASE}.mp4`);
});

test('an image uploads its card thumbnail as the poster, next to the file and the preview', async () => {
  const fake = fakeClient();
  const progress = [];
  const { XHR, requests } = fakeXHR(succeed);
  const media = await make(fake, { XHR }).uploadMedia(ENTRY, CREATOR, imagePrepared({ poster: blob('image/webp', 4000) }), { onProgress: p => progress.push(p) });
  assert.deepEqual(requests.map(r => r.url.replace(`${URL}/storage/v1/object/`, '')), [`entry-media/${BASE}.webp`, `entry-media/${BASE}-poster.webp`, `previews/${BASE}.webp`]);
  assert.deepEqual(requests.map(r => r.headers['cache-control']), ['private, max-age=3600', 'private, max-age=3600', 'max-age=31536000']);
  const insert = fake.queries.find(q => q.op === 'insert').payload;
  assert.deepEqual([insert.kind, insert.poster_path, insert.preview_path], ['image', `${BASE}-poster.webp`, `${BASE}.webp`]);
  assert.deepEqual([media.posterPath, media.previewPath], [`${BASE}-poster.webp`, `${BASE}.webp`]);
  progress.forEach((p, i) => { if (i) assert.ok(p > progress[i - 1]); });
  assert.equal(progress.at(-1), 1);
  // A JPEG thumbnail is named for what it is.
  const jpeg = fakeXHR(succeed);
  await make(fakeClient(), { XHR: jpeg.XHR }).uploadMedia(ENTRY, CREATOR, imagePrepared({ poster: blob('image/jpeg', 4000) }), {});
  assert.ok(jpeg.requests[1].url.endsWith('-poster.jpg'));
});

test('uploadMedia sends its files at the same time and fetches the session once', async () => {
  const fake = fakeClient();
  let sessions = 0;
  const getSession = fake.client.auth.getSession;
  fake.client.auth.getSession = async () => { sessions++; return getSession(); };
  const hold = fakeXHR(() => {});   // nothing answers until the test says so
  const api = make(fake, { XHR: hold.XHR });
  const upload = api.uploadMedia(ENTRY, CREATOR, videoPrepared(), {});
  await new Promise(r => setTimeout(r, 5));
  assert.equal(hold.requests.length, 3, 'main file, poster and preview are all in flight before any of them finishes');
  assert.equal(sessions, 1);
  for (const xhr of hold.requests) succeed(xhr);
  await upload;
});

test('uploadMedia refuses ids that are not uuids before anything reaches the network', async () => {
  for (const [entry, creator] of [[ENTRY, 'creator-1'], ['../../etc/passwd', CREATOR], [`${ENTRY}/x`, CREATOR], [`${ENTRY}?x=1`, CREATOR], [`${ENTRY}#x`, CREATOR], ['', CREATOR], [ENTRY, undefined], [null, CREATOR], ['entry 1', CREATOR]]) {
    const fake = fakeClient();
    const { XHR, requests } = fakeXHR(succeed);
    await assert.rejects(make(fake, { XHR }).uploadMedia(entry, creator, imagePrepared(), {}), { message: 'This entry cannot take uploads right now. Reload the page and try again.' }, `${entry} ${creator}`);
    assert.equal(requests.length, 0);
    assert.equal(fake.queries.length + fake.storageCalls.length, 0);
  }
  // A name that the database would refuse (a broken uuid source) is stopped as well.
  const fake = fakeClient();
  const { XHR, requests } = fakeXHR(succeed);
  await assert.rejects(createApi(fake.client, { url: URL, key: KEY, XHR, uuid: () => 'a/../b' }).uploadMedia(ENTRY, CREATOR, imagePrepared(), {}), { message: /cannot take uploads/ });
  assert.equal(requests.length, 0);
});

test('uploadMedia gives up on a connection that goes quiet', async () => {
  const fake = fakeClient();
  const { XHR, requests } = fakeXHR(xhr => xhr.upload.onprogress({ lengthComputable: true, loaded: 10, total: 100 }));   // one sign of life, then silence
  const started = Date.now();
  await assert.rejects(make(fake, { XHR, stallMs: 40 }).uploadMedia(ENTRY, CREATOR, imagePrepared(), {}), { message: 'We could not reach REFLUENZ. Check your connection and try again.' });
  assert.ok(Date.now() - started >= 30, 'it waited for the stall window');
  assert.ok(requests.every(r => r.aborted), 'the stuck requests are aborted');
  assert.deepEqual(fake.storageCalls.map(c => c.bucket), ['entry-media', 'previews'], 'and whatever may have been stored is cleaned up');
  assert.equal(fake.queries.filter(q => q.op === 'insert').length, 0);
});

test('every sign of progress restarts the stall clock, so a slow but moving upload finishes', async () => {
  const fake = fakeClient();
  const { XHR } = fakeXHR(xhr => {
    let n = 0;
    const tick = () => { if (++n <= 4) { xhr.upload.onprogress({ lengthComputable: true, loaded: n * 20, total: 100 }); setTimeout(tick, 25); } else { xhr.status = 200; xhr.onload(); } };
    tick();
  });
  const media = await make(fake, { XHR, stallMs: 80 }).uploadMedia(ENTRY, CREATOR, imagePrepared(), {});   // about 100 ms in all, longer than one stall window
  assert.equal(media.path, `${BASE}.webp`);
});

test('uploadMedia defaults to the configured project and works without callbacks', async () => {
  const fake = fakeClient();
  const { XHR, requests } = fakeXHR(succeed);
  const api = createApi(fake.client, { XHR, uuid: () => 'file-uuid' });
  await api.uploadMedia(ENTRY, CREATOR, imagePrepared());
  assert.ok(requests[0].url.startsWith(`${SUPABASE_URL}/storage/v1/object/entry-media/`));
  assert.equal(requests[0].headers.apikey, SUPABASE_KEY);
});

test('uploadMedia removes what it uploaded when a later file fails, then reports the failure', async () => {
  const fake = fakeClient();
  const { XHR, requests } = fakeXHR(xhr => xhr.url.includes('-poster') ? respondWith(413, '{"statusCode":"413","error":"Payload too large","message":"The object exceeded the maximum allowed size"}')(xhr) : succeed(xhr));
  const api = make(fake, { XHR });
  await assert.rejects(api.uploadMedia(ENTRY, CREATOR, videoPrepared(), {}), { message: 'This file is too large (50 MB max).' });

  assert.equal(requests.length, 3, 'everything was started together');
  assert.equal(fake.queries.filter(q => q.op === 'insert').length, 0, 'no row is written');
  assert.deepEqual(fake.storageCalls, [
    { bucket: 'entry-media', op: 'remove', paths: [`${BASE}.mp4`, `${BASE}-poster.jpg`] },
    { bucket: 'previews', op: 'remove', paths: [`${BASE}.webp`] }
  ]);
});

test('uploadMedia removes every file when the row insert is rejected and passes the database message through', async () => {
  const fake = fakeClient();
  fake.handlers['entry_media.insert'] = () => ({ data: null, error: { code: 'P0001', message: 'An image entry holds up to 10 images.' } });
  const { XHR } = fakeXHR(succeed);
  const progress = [];
  await assert.rejects(make(fake, { XHR }).uploadMedia(ENTRY, CREATOR, imagePrepared(), { onProgress: p => progress.push(p) }), { message: 'An image entry holds up to 10 images.' });
  assert.deepEqual(fake.storageCalls, [
    { bucket: 'entry-media', op: 'remove', paths: [`${BASE}.webp`] },
    { bucket: 'previews', op: 'remove', paths: [`${BASE}.webp`] }
  ]);
  assert.ok(!progress.includes(1), 'never reports completion for a failed upload');
});

test('uploadMedia still reports the original failure when cleanup itself fails', async () => {
  for (const mode of ['error', 'throw']) {
    const fake = fakeClient();
    fake.handlers.remove = () => { if (mode === 'throw') throw Error('storage down'); return { data: null, error: { message: 'storage down' } }; };
    const { XHR } = fakeXHR(respondWith(500, 'oops'));
    await assert.rejects(make(fake, { XHR }).uploadMedia(ENTRY, CREATOR, imagePrepared(), {}), { message: 'The upload service is having trouble. Try again in a moment.' }, mode);
    assert.equal(fake.storageCalls.length, 2, mode);   // the file and the preview were both started, so both are cleaned up
  }
});

test('uploadMedia turns storage failures into friendly messages', async () => {
  const cases = [
    [respondWith(413, ''), 'This file is too large (50 MB max).'],
    [respondWith(400, '{"statusCode":"413","error":"Payload too large","message":"The object exceeded the maximum allowed size"}'), 'This file is too large (50 MB max).'],
    [respondWith(415, ''), 'This file type is not supported.'],
    [respondWith(400, '{"statusCode":"415","error":"invalid_mime_type","message":"mime type video/x-flv is not supported"}'), 'This file type is not supported.'],
    [respondWith(401, ''), 'Your session has expired or you do not have permission. Sign in again and retry.'],
    [respondWith(400, '{"statusCode":"401","error":"Unauthorized","message":"Invalid JWT"}'), 'Your session has expired or you do not have permission. Sign in again and retry.'],
    [respondWith(403, '{"statusCode":"403","error":"InvalidJWT","message":"\\"exp\\" claim timestamp check failed"}'), 'Your session has expired or you do not have permission. Sign in again and retry.'],
    // The owner and quota policies (60 objects per entry, 500 MB per creator) also answer 403: say so instead of blaming the session.
    [respondWith(403, '{"statusCode":"403","error":"Unauthorized","message":"new row violates row-level security policy"}'), REFUSED],
    [respondWith(400, '{"statusCode":"403","error":"Unauthorized","message":"new row violates row-level security policy"}'), REFUSED],
    [respondWith(502, '<html>bad gateway</html>'), 'The upload service is having trouble. Try again in a moment.'],
    [respondWith(400, '{"statusCode":"400","error":"Bad Request","message":"Something specific happened"}'), 'Something specific happened'],
    [respondWith(409, 'not json'), 'The upload did not complete. Try again.'],
    [xhr => xhr.onerror(), 'We could not reach REFLUENZ. Check your connection and try again.'],
    [xhr => xhr.ontimeout(), 'We could not reach REFLUENZ. Check your connection and try again.']
  ];
  for (const [plan, message] of cases) {
    const fake = fakeClient();
    const { XHR } = fakeXHR(plan);
    await assert.rejects(make(fake, { XHR }).uploadMedia(ENTRY, CREATOR, imagePrepared(), {}), { message });
    assert.equal(fake.queries.filter(q => q.op === 'insert').length, 0);
  }
});

test('uploadMedia needs a session and a file', async () => {
  const fake = fakeClient({ session: null });
  const { XHR, requests } = fakeXHR(succeed);
  const api = make(fake, { XHR });
  await assert.rejects(api.uploadMedia(ENTRY, CREATOR, imagePrepared(), {}), { message: 'Sign in to upload.' });
  assert.equal(requests.length, 0);
  assert.deepEqual(fake.storageCalls, [], 'nothing was uploaded, so nothing is removed');
  fake.state.session = { access_token: 't' };
  await assert.rejects(api.uploadMedia(ENTRY, CREATOR, imagePrepared({ blob: null }), {}), { message: 'Choose a file to upload.' });
});

test('uploadMedia without XMLHttpRequest explains itself', async () => {
  const fake = fakeClient();
  await assert.rejects(createApi(fake.client, { url: URL, key: KEY, XHR: undefined }).uploadMedia(ENTRY, CREATOR, imagePrepared(), {}), { message: 'Uploads are not supported in this browser.' });
});

test('uploadMedia can be cancelled mid-upload and cleans up', async () => {
  const fake = fakeClient();
  const controller = new AbortController();
  const { XHR, requests } = fakeXHR(xhr => controller.abort());   // the creator presses cancel while the file is in flight
  const api = make(fake, { XHR });
  await assert.rejects(api.uploadMedia(ENTRY, CREATOR, videoPrepared(), { signal: controller.signal }), { message: 'Upload cancelled.' });
  assert.equal(requests.length, 3);
  assert.ok(requests.every(r => r.aborted), 'every file in flight is stopped');
  assert.deepEqual(fake.storageCalls, [
    { bucket: 'entry-media', op: 'remove', paths: [`${BASE}.mp4`, `${BASE}-poster.jpg`] },
    { bucket: 'previews', op: 'remove', paths: [`${BASE}.webp`] }
  ]);
  assert.equal(fake.queries.filter(q => q.op === 'insert').length, 0);
});

test('uploadMedia with an already aborted signal does nothing', async () => {
  const fake = fakeClient();
  const { XHR, requests } = fakeXHR(succeed);
  await assert.rejects(make(fake, { XHR }).uploadMedia(ENTRY, CREATOR, imagePrepared(), { signal: AbortSignal.abort() }), { message: 'Upload cancelled.' });
  assert.equal(requests.length, 0);
  assert.equal(fake.storageCalls.length, 0);
});

test('uploadMedia keeps row values inside the database limits', async () => {
  const fake = fakeClient();
  const { XHR } = fakeXHR(succeed);
  await make(fake, { XHR }).uploadMedia(ENTRY, CREATOR, videoPrepared({ duration: 999999, width: 0, height: 719.6 }), { position: 150, alt: 'x'.repeat(300) });
  const row = fake.queries.find(q => q.op === 'insert').payload;
  assert.equal(row.duration_seconds, 86400);
  assert.equal(row.width, null);
  assert.equal(row.height, 720);
  assert.equal(row.position, 99);
  assert.equal(row.alt.length, 200);
});

// ---------------------------------------------------------------------------
// updateMedia, removeMedia, deleteEntry
// ---------------------------------------------------------------------------
test('updateMedia only sends the fields it is given', async () => {
  const fake = fakeClient();
  const api = make(fake);
  await api.updateMedia('m1', { alt: 'New alt' });
  await api.updateMedia('m1', { position: 3 });
  await api.updateMedia('m1', { alt: '', position: 0 });
  await api.updateMedia('m1', {});
  await api.updateMedia('m1');
  const updates = fake.queries.filter(q => q.op === 'update');
  assert.deepEqual(updates.map(q => q.payload), [{ alt: 'New alt' }, { position: 3 }, { alt: '', position: 0 }]);
  assert.ok(updates.every(q => q.table === 'entry_media' && q.filters[0][1] === 'id' && q.filters[0][2] === 'm1'));
});

test('updateMedia reports permission errors', async () => {
  const fake = fakeClient();
  fake.handlers['entry_media.update'] = () => ({ data: null, error: { message: 'permission denied for table entry_media new row violates row-level security policy' } });
  await assert.rejects(make(fake).updateMedia('m1', { alt: 'x' }), { message: 'You do not have permission to do that.' });
});

const video = { id: 'm1', entryId: ENTRY, kind: 'video', path: `${CREATOR}/${ENTRY}/v.mp4`, posterPath: `${CREATOR}/${ENTRY}/v-poster.jpg`, previewPath: `${CREATOR}/${ENTRY}/v.webp`, mime: 'video/mp4' };

test('removeMedia deletes the row first, then the storage objects', async () => {
  const fake = fakeClient();
  await make(fake).removeMedia(video);
  assert.deepEqual(fake.events, ['db delete entry_media', 'storage remove entry-media', 'storage remove previews']);
  assert.deepEqual(fake.queries[0].filters, [['eq', 'id', 'm1']]);
  assert.deepEqual(fake.storageCalls, [
    { bucket: 'entry-media', op: 'remove', paths: [video.path, video.posterPath] },
    { bucket: 'previews', op: 'remove', paths: [video.previewPath] }
  ]);
});

test('removeMedia deletes a whole list with one request and one storage call per bucket', async () => {
  const fake = fakeClient();
  const a = { id: 'm1', path: 'c/e/a.webp', posterPath: 'c/e/a-poster.webp', previewPath: 'c/e/a.webp' }, b = { id: 'm2', path: 'c/e/b.webp', posterPath: null, previewPath: 'c/e/b.webp' };
  await make(fake).removeMedia([a, b]);
  assert.deepEqual(fake.events, ['db delete entry_media', 'storage remove entry-media', 'storage remove previews']);
  assert.deepEqual(fake.queries[0].filters, [['in', 'id', ['m1', 'm2']]]);
  assert.deepEqual(fake.storageCalls, [
    { bucket: 'entry-media', op: 'remove', paths: ['c/e/a.webp', 'c/e/a-poster.webp', 'c/e/b.webp'] },
    { bucket: 'previews', op: 'remove', paths: ['c/e/a.webp', 'c/e/b.webp'] }
  ]);
  const idle = fakeClient();
  await make(idle).removeMedia([]);
  assert.deepEqual(idle.events, [], 'an empty list does nothing');
  const failing = fakeClient();
  failing.handlers['entry_media.delete'] = () => ({ data: null, error: { message: 'Failed to fetch' } });
  await assert.rejects(make(failing).removeMedia([a, b]), { message: 'We could not reach REFLUENZ. Check your connection and try again.' });
  assert.equal(failing.storageCalls.length, 0, 'files stay when the rows could not be deleted');
});

test('removeMedia leaves out files an image does not have', async () => {
  const fake = fakeClient();
  await make(fake).removeMedia({ id: 'm2', path: 'c/e/a.webp', posterPath: null, previewPath: null });
  assert.deepEqual(fake.storageCalls, [{ bucket: 'entry-media', op: 'remove', paths: ['c/e/a.webp'] }]);
});

test('removeMedia never throws for storage failures, but does for a failed row delete', async () => {
  for (const mode of ['error', 'throw']) {
    const fake = fakeClient();
    fake.handlers.remove = () => { if (mode === 'throw') throw Error('storage down'); return { data: null, error: { message: 'storage down' } }; };
    await make(fake).removeMedia(video);
    assert.equal(fake.storageCalls.length, 2, mode);
  }
  const fake = fakeClient();
  fake.handlers['entry_media.delete'] = () => ({ data: null, error: { message: 'Failed to fetch' } });
  await assert.rejects(make(fake).removeMedia(video), { message: 'We could not reach REFLUENZ. Check your connection and try again.' });
  assert.equal(fake.storageCalls.length, 0, 'files stay when the row could not be deleted');
});

test('deleteEntry reads the media, deletes the entry, then removes the storage objects', async () => {
  const fake = fakeClient({ tables: { entry_media: [
    { path: 'c/e/a.webp', poster_path: null, preview_path: 'c/e/a.webp' },
    { path: 'c/e/b.webp', poster_path: null, preview_path: 'c/e/b.webp' }
  ] } });
  await make(fake).deleteEntry('e');
  assert.deepEqual(fake.events, ['db select entry_media', 'db delete entries', 'storage remove entry-media', 'storage remove previews']);
  assert.deepEqual(fake.queries[0].filters, [['eq', 'entry_id', 'e']]);
  assert.deepEqual(fake.queries[1].filters, [['eq', 'id', 'e']]);
  assert.deepEqual(fake.storageCalls, [
    { bucket: 'entry-media', op: 'remove', paths: ['c/e/a.webp', 'c/e/b.webp'] },
    { bucket: 'previews', op: 'remove', paths: ['c/e/a.webp', 'c/e/b.webp'] }
  ]);
});

test('deleteEntry on a text entry touches no storage, and swallows storage failures', async () => {
  const plain = fakeClient();
  await make(plain).deleteEntry('e');
  assert.deepEqual(plain.events, ['db select entry_media', 'db delete entries']);

  const fake = fakeClient({ tables: { entry_media: [{ path: 'c/e/a.mp4', poster_path: 'c/e/a-poster.jpg', preview_path: 'c/e/a.webp' }] } });
  fake.handlers.remove = () => { throw Error('storage down'); };
  await make(fake).deleteEntry('e');
  assert.deepEqual(fake.storageCalls.map(c => c.paths), [['c/e/a.mp4', 'c/e/a-poster.jpg'], ['c/e/a.webp']]);
});

test('deleteEntry keeps the entry when it cannot read its media or the delete is refused', async () => {
  const unreadable = fakeClient();
  unreadable.handlers['entry_media.select'] = () => ({ data: null, error: { message: 'Failed to fetch' } });
  await assert.rejects(make(unreadable).deleteEntry('e'), { message: 'We could not reach REFLUENZ. Check your connection and try again.' });
  assert.ok(!unreadable.events.includes('db delete entries'));

  const refused = fakeClient({ tables: { entry_media: [{ path: 'c/e/a.webp', poster_path: null, preview_path: null }] } });
  refused.handlers['entries.delete'] = () => ({ data: null, error: { message: 'new row violates row-level security policy' } });
  await assert.rejects(make(refused).deleteEntry('e'), { message: 'You do not have permission to do that.' });
  assert.equal(refused.storageCalls.length, 0, 'files stay when the entry was not deleted');
});

// ---------------------------------------------------------------------------
// error mapping
// ---------------------------------------------------------------------------
test('friendly errors keep their existing wording and cover storage failures', async () => {
  const fake = fakeClient();
  const api = make(fake);
  const cases = [
    [{ message: 'Invalid login credentials' }, 'That email and password do not match.'],
    [{ message: 'Email not confirmed' }, 'Confirm your email first. Check your inbox for the link.'],
    [{ message: 'User already registered' }, 'An account with this email already exists. Sign in instead.'],
    [{ message: 'new row violates row-level security policy for table "objects"' }, 'You do not have permission to do that.'],
    [{ message: 'TypeError: Failed to fetch' }, 'We could not reach REFLUENZ. Check your connection and try again.'],
    [{ message: 'The object exceeded the maximum allowed size' }, 'This file is too large (50 MB max).'],
    [{ message: 'mime type image/svg+xml is not supported' }, 'This file type is not supported.'],
    [{ message: 'new row for relation "entry_media" violates check constraint "entry_media_size_bytes_check"' }, 'This file is too large (50 MB max).'],
    [{ message: 'Bucket not found' }, 'Media storage is not available yet. Try again later.'],
    [{ message: 'Something unexpected' }, 'Something unexpected'],
    [{ code: 'P0001', message: 'Choose a post type.' }, 'Choose a post type.']
  ];
  for (const [error, message] of cases) {
    fake.handlers.signIn = () => ({ data: null, error });
    await assert.rejects(api.signIn('a@b.c', 'pw'), { message });
  }
});
