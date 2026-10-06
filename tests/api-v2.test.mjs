import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api/index.js';
import { friendly, fail, createMappers } from '../src/api/util.js';
import { SUPABASE_URL, SUPABASE_KEY } from '../src/config.js';
import { createFakeApi, IDS } from './helpers/fake-api.mjs';

// Tests of the data layer (src/api/*) against a hand-written fake of the parts of supabase-js it touches (the builder records every
// query; see fakeClient below) and a fake XMLHttpRequest, plus tests of the in-memory fake api that the view tests are built on.
// Nothing here talks to a network.

// ---------------------------------------------------------------------------
// A stand-in for the parts of supabase-js the data layer touches: a chainable query builder that records every query, storage, auth and
// realtime channels. It does not evaluate filters: tests give each query its answer (`tables` for plain selects, `handlers` for anything
// else) and assert on what was asked.
//   fake.handlers['entries.select'] = q => ({data: [], error: null});   // 'table.op' (select|insert|update|upsert|delete), 'rpc.<name>', 'sign', 'remove', 'signIn', 'auth.<method>'
//   fake.queries   every awaited query: {table, op, columns, filters:[[kind, column, value]], orders, limit, range, payload, options, single, maybe, head, returning}
//   fake.events    ordered log across database and storage calls; fake.storageCalls, fake.rpcCalls, fake.authCalls, fake.channels, fake.emitAuth(event, session)
// ---------------------------------------------------------------------------
const URL = 'https://proj.supabase.co';

function fakeClient({tables = {}, session = {access_token: 'tok-123', user: {id: 'u1', email: 'u1@example.test'}}} = {}) {
  const state = {session};
  const events = [];
  const queries = [];
  const rpcCalls = [];
  const storageCalls = [];
  const authCalls = [];
  const channels = [];
  const handlers = {};
  const listeners = new Set();
  let signedCount = 0;

  const rowsOf = q => tables[q.table] ?? [];
  const defaultAnswer = q => {
    if (q.op === 'select') {
      const rows = rowsOf(q);
      if (q.head) return {data: null, count: rows.length, error: null};
      if (q.single) return {data: rows[0] ?? null, error: rows[0] ? null : {code: 'PGRST116', message: 'The result contains 0 rows'}};
      if (q.maybe) return {data: rows[0] ?? null, error: null};
      return {data: rows, error: null};
    }
    if (q.returning) {
      const payload = Array.isArray(q.payload) ? q.payload : {id: 'new-1', ...q.payload};
      return {data: q.single || q.maybe ? payload : [payload], error: null};
    }
    return {data: null, error: null};
  };
  const respond = q => {
    if (q.op === 'rpc') {
      if (handlers[`rpc.${q.name}`]) return handlers[`rpc.${q.name}`](q);
      if (handlers.rpc) return handlers.rpc(q.name, q.args);
      return {data: q.name === 'save_entry' ? 'entry-1' : [], error: null};
    }
    return handlers[`${q.table}.${q.op}`] ? handlers[`${q.table}.${q.op}`](q) : defaultAnswer(q);
  };

  const builder = q => {
    const add = (kind, column, value) => { q.filters.push([kind, column, value]); return b; };
    const b = {
      select(columns, options) { if (q.op === 'select' || q.op === 'rpc') { q.columns = columns; q.options = options; q.head = Boolean(options?.head); } else { q.returning = true; q.columns = columns; } return b; },
      insert(payload, options) { q.op = 'insert'; q.payload = payload; q.options = options; return b; },
      update(payload) { q.op = 'update'; q.payload = payload; return b; },
      upsert(payload, options) { q.op = 'upsert'; q.payload = payload; q.options = options; return b; },
      delete() { q.op = 'delete'; return b; },
      eq: (c, v) => add('eq', c, v), neq: (c, v) => add('neq', c, v), in: (c, v) => add('in', c, v), is: (c, v) => add('is', c, v),
      lt: (c, v) => add('lt', c, v), lte: (c, v) => add('lte', c, v), gt: (c, v) => add('gt', c, v), gte: (c, v) => add('gte', c, v),
      not: (c, op, v) => add(`not.${op}`, c, v), or: expr => add('or', null, expr), ilike: (c, v) => add('ilike', c, v),
      match(values) { q.filters.push(['match', values]); return b; },
      order(column, options) { q.orders.push([column, options]); return b; },
      limit(n) { q.limit = n; return b; },
      range(from, to) { q.range = [from, to]; return b; },
      single() { q.single = true; return b; },
      maybeSingle() { q.maybe = true; return b; },
      then(resolve, reject) {
        queries.push(q);
        events.push(q.op === 'rpc' ? `rpc ${q.name}` : `db ${q.op} ${q.table}`);
        if (q.op === 'rpc') rpcCalls.push({name: q.name, args: q.args});
        return Promise.resolve(respond(q)).then(resolve, reject);
      }
    };
    return b;
  };
  const newQuery = (table, op = 'select') => ({table, op, columns: null, filters: [], orders: [], payload: null, single: false, maybe: false, head: false, returning: false, limit: null, range: null, options: null});

  const storage = {
    from: bucket => ({
      getPublicUrl: path => ({data: {publicUrl: `${URL}/storage/v1/object/public/${bucket}/${path}`}}),
      async createSignedUrls(paths, expiresIn) {
        storageCalls.push({bucket, op: 'sign', paths: [...paths], expiresIn});
        events.push(`storage sign ${bucket}`);
        if (handlers.sign) return handlers.sign(paths);
        return {data: paths.map(path => ({error: null, path, signedUrl: `${URL}/storage/v1/object/sign/${bucket}/${path}?token=t${++signedCount}`})), error: null};
      },
      async remove(paths) {
        storageCalls.push({bucket, op: 'remove', paths: [...paths]});
        events.push(`storage remove ${bucket}`);
        if (handlers.remove) return handlers.remove(paths);
        return {data: paths.map(name => ({name})), error: null};
      },
      async upload(path, blob, options) {
        storageCalls.push({bucket, op: 'upload', path, blob, options});
        events.push(`storage upload ${bucket}`);
        if (handlers.upload) return handlers.upload(path, blob, options);
        return {data: {path}, error: null};
      }
    })
  };

  const authAnswer = (name, args) => { authCalls.push({name, args}); return handlers[`auth.${name}`] ? handlers[`auth.${name}`](...args) : {data: {}, error: null}; };
  const client = {
    from: table => builder(newQuery(table)),
    storage,
    rpc(name, args) { const q = newQuery(null, 'rpc'); q.name = name; q.args = args; return builder(q); },
    channel(name) {
      const channel = {name, subscriptions: [], subscribed: false, removed: false};
      channels.push(channel);
      const chain = {on(type, filter, callback) { channel.subscriptions.push({type, filter, callback}); return chain; }, subscribe() { channel.subscribed = true; return channel; }};
      return chain;
    },
    removeChannel(channel) { channel.removed = true; return Promise.resolve('ok'); },
    auth: {
      async getSession() { return {data: {session: state.session}, error: null}; },
      onAuthStateChange(fn) { listeners.add(fn); return {data: {subscription: {unsubscribe: () => listeners.delete(fn)}}}; },
      async signInWithPassword(...args) { return handlers.signIn ? handlers.signIn() : authAnswer('signInWithPassword', args); },
      async signUp(...args) { return authAnswer('signUp', args); },
      async resend(...args) { return authAnswer('resend', args); },
      async resetPasswordForEmail(...args) { return authAnswer('resetPasswordForEmail', args); },
      async updateUser(...args) { return authAnswer('updateUser', args); },
      async signOut(...args) { return handlers.signOut ? handlers.signOut() : {...authAnswer('signOut', args), error: null}; }
    }
  };
  return {client, state, events, queries, rpcCalls, storageCalls, authCalls, channels, handlers, listeners,
    emitAuth: (event, next) => { for (const fn of [...listeners]) fn(event, next); }};
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
  return {XHR, requests};
}
const succeed = xhr => {
  for (const loaded of [25, 50, 100]) xhr.upload.onprogress({lengthComputable: true, loaded, total: 100});
  xhr.status = 200;
  xhr.responseText = '{"Key":"ok"}';
  xhr.onload();
};
const respondWith = (status, body = '') => xhr => { xhr.status = status; xhr.responseText = body; xhr.onload(); };


// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const KEY = 'sb_publishable_test';
// Real uuids: the api only builds object names and filters from ids that look like the ones the database stores.
const CREATOR = '3f6c2d1e-8a4b-4c5d-9e7f-0a1b2c3d4e5f';
const ENTRY = '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const USER = '7d1e9a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b';
const OTHER = '5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d';
const NOW = Date.parse('2026-10-07T09:00:00.000Z');
const SESSION = {access_token: 'tok-123', user: {id: USER, email: 'sofia@example.test'}};

const make = (fake, extra = {}) => createApi(fake.client, {url: URL, key: KEY, uuid: () => 'file-uuid', now: () => NOW, ...extra});
const signedIn = (options = {}) => { const fake = fakeClient({session: SESSION, ...options}); const api = make(fake); return {fake, api}; };
const guest = (options = {}) => { const fake = fakeClient({session: null, ...options}); const api = make(fake); return {fake, api}; };
const ok = data => ({data, error: null});
const failing = (message, code) => () => ({data: null, error: {message, ...(code ? {code} : {})}});
const lastQuery = fake => fake.queries.at(-1);
const filterOf = (q, kind, column) => q.filters.find(f => f[0] === kind && f[1] === column);
const minute = n => `2026-09-${String(28 - Math.floor(n / 60)).padStart(2, '0')}T${String(23 - (n % 24)).padStart(2, '0')}:00:00+00:00`;
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function withLocation(origin, fn) {
  const before = globalThis.location;
  globalThis.location = origin ? {origin} : undefined;
  try { return await fn(); } finally { if (before === undefined) delete globalThis.location; else globalThis.location = before; }
}

const creatorRow = (over = {}) => ({id: CREATOR, slug: 'atelier-solene', owner_id: null, name: 'Atelier Solene', category: 'Style', descriptor: 'Tailoring', location: 'Lyon', image: 'atelier', bio: 'Bio',
  avatar_path: `${CREATOR}/a.png`, cover_path: `${CREATOR}/c.webp`, links: [{label: 'Site', url: 'https://example.test'}], is_showcase: true,
  follower_count: 12, member_count: 3, entry_count: 5, created_at: '2026-06-02T09:00:00+00:00', ...over});
const entryRow = (over = {}) => ({id: ENTRY, creator_id: CREATOR, kind: 'text', title: 'A title', subtitle: 'sub', excerpt: 'ex', category: 'Style', format: 'Essay', image: 'atelier', access: 'public', status: 'published',
  minutes: 2, media_count: 0, preview_path: null, duration_seconds: null, cover_path: null, like_count: 4, comment_count: 1, read_count: 9,
  published_at: '2026-09-28T08:00:00+00:00', created_at: '2026-09-27T08:00:00+00:00', updated_at: '2026-09-28T08:00:00+00:00', ...over});
const tierRow = (tier_id, over = {}) => ({creator_id: CREATOR, tier_id, name: tier_id.toUpperCase(), price_cents: 900, currency: 'EUR', description: 'd', perks: ['a'], enabled: true, tier: {level: {essential: 1, premium: 2, signature: 3}[tier_id]}, ...over});
const personRow = (id = OTHER, name = 'Ada') => ({id, display_name: name, avatar_path: `${id}/me.png`});

// ---------------------------------------------------------------------------
// The shape of the api
// ---------------------------------------------------------------------------
const CONTRACT = ['getSession', 'onAuthChange', 'signIn', 'signUp', 'resendConfirmation', 'resetPassword', 'updatePassword', 'updateEmail', 'signOut',
  'loadViewer', 'saveProfile', 'saveSettings', 'uploadAvatar', 'removeAvatar',
  'listCreators', 'suggestedCreators', 'getCreatorBySlug', 'getCreator', 'createAtelier', 'updateAtelier', 'slugAvailable', 'uploadCreatorImage', 'removeCreatorImage',
  'listTiers', 'updateTier', 'feed', 'creatorEntries', 'getEntry', 'getBody', 'saveEntry', 'deleteEntry', 'uploadEntryCover', 'setEntryCover', 'recordRead',
  'media', 'signedUrls', 'uploadMedia', 'updateMedia', 'removeMedia', 'previewUrl',
  'setFollow', 'setLike', 'setBookmark', 'savedEntries', 'listComments', 'addComment', 'editComment', 'deleteComment',
  'join', 'leave', 'myMemberships', 'circleMembers', 'creatorStats', 'inbox', 'thread', 'sendMessage', 'markThreadRead', 'listNotes', 'postNote', 'deleteNote',
  'listNotifications', 'unreadCounts', 'markNotificationsRead', 'deleteNotification', 'search', 'report', 'exportData', 'deleteAccount', 'subscribe'];

test('createApi returns one flat object with every method of the contract', () => {
  const api = make(fakeClient());
  assert.deepEqual(Object.keys(api).sort(), [...CONTRACT].sort());
  for (const name of CONTRACT) assert.equal(typeof api[name], 'function', name);
  assert.ok(!('purge' in api), 'internal helpers are not part of the api');
});

test('the in-memory fake implements exactly the same methods', () => {
  const fake = createFakeApi();
  const helpers = ['db', 'calls', 'session', 'signInAs', 'confirmEmail', 'fail', 'emit', 'refresh'];
  assert.deepEqual(Object.keys(fake).filter(k => !helpers.includes(k)).sort(), [...CONTRACT].sort());
});

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------
test('creators map to the contract shape with public image urls from the covers bucket', async () => {
  const {fake, api} = guest({tables: {creators: [creatorRow(), creatorRow({id: OTHER, name: 'élodie  dupont', avatar_path: null, cover_path: 'x/../y', links: null, owner_id: USER, is_showcase: false})]}});
  const [a, b] = await api.listCreators();
  assert.deepEqual(a, {id: CREATOR, slug: 'atelier-solene', ownerId: null, name: 'Atelier Solene', initials: 'AS', category: 'Style', descriptor: 'Tailoring', location: 'Lyon', image: 'atelier', bio: 'Bio',
    avatarUrl: `${URL}/storage/v1/object/public/covers/${CREATOR}/a.png`, avatarPath: `${CREATOR}/a.png`, coverUrl: `${URL}/storage/v1/object/public/covers/${CREATOR}/c.webp`, coverPath: `${CREATOR}/c.webp`,
    links: [{label: 'Site', url: 'https://example.test'}], isShowcase: true, followerCount: 12, memberCount: 3, entryCount: 5, createdAt: '2026-06-02T09:00:00+00:00'});
  assert.equal(b.avatarUrl, null);
  assert.equal(b.coverUrl, null, 'a path that is not a canonical object name never becomes a url');
  assert.deepEqual([b.links, b.isShowcase, b.ownerId, b.initials], [[], false, USER, 'ÉD']);
  assert.equal(fake.queries[0].columns.includes('follower_count'), true);
});

test('entries map to the contract shape; the cover comes from covers, the blurred preview from previews', async () => {
  const preview = `${CREATOR}/${ENTRY}/p.webp`;
  const row = entryRow({kind: 'video', media_count: 1, preview_path: preview, duration_seconds: 75, cover_path: `${CREATOR}/cover.webp`, creator: creatorRow()});
  const {api} = guest({tables: {entries: [row]}});
  const entry = await api.getEntry(ENTRY);
  assert.deepEqual({...entry, creator: entry.creator.id}, {id: ENTRY, creatorId: CREATOR, creator: CREATOR, kind: 'video', title: 'A title', subtitle: 'sub', excerpt: 'ex', category: 'Style', format: 'Essay', image: 'atelier',
    access: 'public', status: 'published', minutes: 2, mediaCount: 1, previewUrl: `${URL}/storage/v1/object/public/previews/${preview}`, duration: 75, coverUrl: `${URL}/storage/v1/object/public/covers/${CREATOR}/cover.webp`,
    coverPath: `${CREATOR}/cover.webp`, likeCount: 4, commentCount: 1, readCount: 9, date: '2026-09-28T08:00:00+00:00', publishedAt: '2026-09-28T08:00:00+00:00', createdAt: '2026-09-27T08:00:00+00:00', updatedAt: '2026-09-28T08:00:00+00:00'});
});

test('an entry from before the media migration still maps, and a draft has no publication date', () => {
  const map = createMappers({storage: {from: () => ({getPublicUrl: () => ({data: {publicUrl: 'x'}})})}});
  const old = map.entry({id: 'e', creator_id: 'c', title: 't', category: 'Style', format: 'Essay', image: 'atelier', access: 'public', status: 'draft', created_at: '2026-01-01T00:00:00Z'});
  assert.deepEqual([old.kind, old.mediaCount, old.previewUrl, old.duration, old.coverUrl, old.likeCount, old.publishedAt, old.date, old.updatedAt, old.minutes], ['text', 0, null, null, null, 0, null, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 1]);
  assert.ok(!('creator' in old));
});

test('tiers merge the shared ladder level with the creator\'s own name, price and perks', async () => {
  const {fake, api} = guest({tables: {creators: [{...creatorRow(), creator_tiers: [
    tierRow('signature', {name: 'Atelier', price_cents: 3900, perks: ['One', 'Two'], description: 'Inside'}),
    tierRow('essential', {name: 'Friend', price_cents: 500, currency: null, enabled: false}),
    tierRow('premium', {tier: undefined, perks: null, description: null})
  ]}]}});
  const result = await api.getCreatorBySlug('Atelier-Solene');
  assert.equal(result.creator.id, CREATOR);
  assert.deepEqual(result.tiers.map(t => t.id), ['essential', 'premium', 'signature'], 'sorted by level');
  assert.deepEqual(result.tiers[0], {id: 'essential', level: 1, creatorId: CREATOR, name: 'Friend', priceCents: 500, currency: 'EUR', description: 'd', perks: ['a'], enabled: false});
  assert.deepEqual(result.tiers[1], {id: 'premium', level: 2, creatorId: CREATOR, name: 'PREMIUM', priceCents: 900, currency: 'EUR', description: '', perks: [], enabled: true}, 'the level falls back to the ladder');
  assert.deepEqual([result.tiers[2].name, result.tiers[2].priceCents, result.tiers[2].perks], ['Atelier', 3900, ['One', 'Two']]);
  const q = lastQuery(fake);
  assert.deepEqual([filterOf(q, 'eq', 'slug')[2], q.maybe], ['atelier-solene', true]);
  assert.ok(q.columns.includes('creator_tiers!creator_id(creator_id,tier_id,name,price_cents'));
});

test('a membership joins its creator and the tier the member holds', async () => {
  const creator = {...creatorRow(), creator_tiers: [tierRow('essential', {name: 'Friend'}), tierRow('premium', {name: 'Patron', price_cents: 1900})]};
  const {fake, api} = signedIn({tables: {memberships: [{creator_id: CREATOR, tier: 'premium', created_at: '2026-08-05T09:00:00+00:00', creator}]}});
  const [m] = await api.myMemberships();
  assert.deepEqual([m.creatorId, m.tierId, m.level, m.tier.name, m.tier.priceCents, m.creator.slug, m.createdAt], [CREATOR, 'premium', 2, 'Patron', 1900, 'atelier-solene', '2026-08-05T09:00:00+00:00']);
  assert.deepEqual(filterOf(lastQuery(fake), 'eq', 'user_id'), ['eq', 'user_id', USER]);
  const orphan = {...creator, creator_tiers: []};
  const {api: other} = signedIn({tables: {memberships: [{creator_id: CREATOR, tier: 'signature', created_at: 'x', creator: orphan}]}});
  const [held] = await other.myMemberships();
  assert.deepEqual([held.level, held.tier.name], [3, 'signature'], 'a tier row that is missing still yields a usable membership');
});

// ---------------------------------------------------------------------------
// Feeds, lists and cursors
// ---------------------------------------------------------------------------
const feedRows = n => Array.from({length: n}, (_, i) => entryRow({id: `e${i}`, like_count: 20 - i, published_at: minute(i), creator: creatorRow()}));

test('feed asks for one row more than the page, and returns a cursor only when there is more', async () => {
  const rows = feedRows(13);
  const {fake, api} = guest();
  fake.handlers['entries.select'] = q => ok(rows.slice(0, q.limit));
  const first = await api.feed({limit: 12});
  const q = fake.queries[0];
  assert.equal(q.limit, 13);
  assert.deepEqual(filterOf(q, 'eq', 'status'), ['eq', 'status', 'published']);
  assert.deepEqual(q.orders, [['published_at', {ascending: false}]]);
  assert.ok(q.columns.includes('creator:creators('), 'creators are embedded in the same request');
  assert.equal(first.items.length, 12);
  assert.equal(first.items[0].creator.slug, 'atelier-solene');
  assert.equal(first.nextCursor, rows[11].published_at);

  fake.handlers['entries.select'] = () => ok(rows.slice(12));
  const last = await api.feed({limit: 12, cursor: first.nextCursor});
  assert.deepEqual(filterOf(lastQuery(fake), 'lt', 'published_at'), ['lt', 'published_at', first.nextCursor]);
  assert.deepEqual([last.items.length, last.nextCursor], [1, null]);
  fake.handlers['entries.select'] = () => ok(rows.slice(0, 12));
  assert.equal((await api.feed({limit: 12})).nextCursor, null, 'exactly one full page and nothing after it');
});

test('feed limits are clamped, and filters and unknown values are applied safely', async () => {
  const {fake, api} = guest();
  await api.feed();
  await api.feed({limit: 500});
  await api.feed({limit: 0});
  await api.feed({limit: 'abc'});
  assert.deepEqual(fake.queries.map(q => q.limit), [13, 51, 13, 13]);
  await api.feed({category: 'Design', kind: 'video'});
  const q = lastQuery(fake);
  assert.deepEqual([filterOf(q, 'eq', 'category')[2], filterOf(q, 'eq', 'kind')[2]], ['Design', 'video']);
  await api.feed({kind: 'podcast'});
  assert.equal(filterOf(lastQuery(fake), 'eq', 'kind'), undefined);
});

test('feed ignores a cursor that is not a plain timestamp', async () => {
  const {fake, api} = guest();
  for (const cursor of ["x'),or(1=1", '2026-09-28', '', null, {}, '9|2026-09-28T08:00:00+00:00;drop']) {
    await api.feed({cursor});
    assert.equal(lastQuery(fake).filters.some(f => f[0] === 'lt' || f[0] === 'or'), false, String(cursor));
  }
  await api.feed({cursor: '2026-09-28T08:00:00.123456+00:00'});
  assert.equal(filterOf(lastQuery(fake), 'lt', 'published_at')[2], '2026-09-28T08:00:00.123456+00:00');
});

test('the popular feed pages by likes then date with a compound cursor', async () => {
  const rows = feedRows(4);
  const {fake, api} = guest();
  fake.handlers['entries.select'] = q => ok(rows.slice(0, q.limit));
  const page = await api.feed({sort: 'popular', limit: 3});
  assert.deepEqual(lastQuery(fake).orders, [['like_count', {ascending: false}], ['published_at', {ascending: false}]]);
  assert.equal(page.nextCursor, `${rows[2].like_count}|${rows[2].published_at}`);
  await api.feed({sort: 'popular', cursor: '7|2026-09-28T08:00:00+00:00'});
  assert.deepEqual(filterOf(lastQuery(fake), 'or', null)[2], 'like_count.lt.7,and(like_count.eq.7,published_at.lt.2026-09-28T08:00:00+00:00)');
  await api.feed({sort: 'popular', cursor: '2026-09-28T08:00:00+00:00'});
  assert.equal(filterOf(lastQuery(fake), 'or', null), undefined, 'a plain timestamp is not a popular cursor');
});

test('following = followed creators plus creators the person belongs to, read once and cached until something changes', async () => {
  const A = '1a000000-0000-4000-8000-000000000001', B = '1a000000-0000-4000-8000-000000000002', C = '1a000000-0000-4000-8000-000000000003';
  const {fake, api} = signedIn({tables: {follows: [{creator_id: A}, {creator_id: B}], memberships: [{creator_id: B}, {creator_id: C}]}});
  api.onAuthChange(() => {});
  await api.feed({scope: 'following'});
  assert.deepEqual(fake.queries.map(q => q.table), ['follows', 'memberships', 'entries']);
  assert.deepEqual(filterOf(lastQuery(fake), 'in', 'creator_id')[2], [A, B, C], 'the union, without duplicates');
  assert.deepEqual(filterOf(fake.queries[0], 'eq', 'user_id'), ['eq', 'user_id', USER]);

  await api.feed({scope: 'following', sort: 'popular'});
  assert.equal(fake.queries.filter(q => q.table === 'follows').length, 1, 'the circle is fetched once');
  await api.setFollow(A, false);
  await api.feed({scope: 'following'});
  assert.equal(fake.queries.filter(q => q.table === 'follows' && q.op === 'select').length, 2, 'a follow change refreshes it');
  fake.handlers['memberships.upsert'] = q => ok({creator_id: A, tier: 'essential', created_at: 'x', creator: {...creatorRow({id: A}), creator_tiers: []}});
  await api.join(A, 'essential');
  await api.feed({scope: 'following'});
  assert.equal(fake.queries.filter(q => q.table === 'follows' && q.op === 'select').length, 3, 'so does a membership change');
  fake.emitAuth('SIGNED_IN', {user: {id: OTHER}});
  await api.feed({scope: 'following'});
  assert.equal(fake.queries.filter(q => q.table === 'follows' && q.op === 'select').length, 4, 'and another account');
});

test('following uses the ids the store passes in, is empty without a circle, and never loads more than 200 creators', async () => {
  const {fake, api} = signedIn();
  const ids = Array.from({length: 250}, (_, i) => `1b000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  await api.feed({scope: 'following', creatorIds: [...ids, ids[0]]});
  assert.equal(fake.queries.some(q => q.table === 'follows'), false, 'no lookup when the ids are given');
  assert.equal(filterOf(lastQuery(fake), 'in', 'creator_id')[2].length, 200);

  fake.queries.length = 0;
  assert.deepEqual(await api.feed({scope: 'following'}), {items: [], nextCursor: null});
  assert.deepEqual(fake.queries.map(q => q.table), ['follows', 'memberships'], 'an empty circle asks for no entries');
  assert.deepEqual(await api.feed({scope: 'following', creatorIds: []}), {items: [], nextCursor: null});
});

test('guests can browse without a session: feed, discover, creator, entry, search and comments', async () => {
  const {fake, api} = guest({tables: {creators: [creatorRow()], entries: [entryRow()], comments: []}});
  assert.equal((await api.feed()).items.length, 1);
  assert.deepEqual(await api.feed({scope: 'following'}), {items: [], nextCursor: null});
  assert.equal((await api.listCreators()).length, 1);
  assert.equal((await api.suggestedCreators()).length, 1);
  assert.equal(Boolean(await api.getCreatorBySlug('atelier-solene')), true);
  assert.equal((await api.getEntry(ENTRY)).id, ENTRY);
  assert.deepEqual(await api.listComments(ENTRY), []);
  assert.deepEqual(await api.unreadCounts(), {notifications: 0, messages: 0});
  await api.recordRead(ENTRY);
  assert.equal(fake.rpcCalls.some(c => c.name === 'record_read'), false, 'a guest read is not recorded');
  await assert.rejects(api.setFollow(CREATOR, true), {message: 'Sign in to continue.'});
});

test('creatorEntries lists published posts newest first and drafts by last edit', async () => {
  const {fake, api} = signedIn();
  fake.handlers['entries.select'] = q => ok([entryRow({id: 'a', updated_at: '2026-10-02T00:00:00+00:00'}), entryRow({id: 'b', updated_at: '2026-10-01T00:00:00+00:00'}), entryRow({id: 'c'})].slice(0, q.limit));
  const drafts = await api.creatorEntries(CREATOR, {status: 'draft', limit: 2, kind: 'text', cursor: '2026-10-05T00:00:00+00:00'});
  const q = lastQuery(fake);
  assert.deepEqual([filterOf(q, 'eq', 'status')[2], filterOf(q, 'eq', 'creator_id')[2], filterOf(q, 'eq', 'kind')[2], filterOf(q, 'lt', 'updated_at')[2]], ['draft', CREATOR, 'text', '2026-10-05T00:00:00+00:00']);
  assert.deepEqual(q.orders, [['updated_at', {ascending: false}]]);
  assert.deepEqual([drafts.items.length, drafts.nextCursor], [2, '2026-10-01T00:00:00+00:00']);
  assert.ok(!('creator' in drafts.items[0]));
  await api.creatorEntries(CREATOR);
  assert.deepEqual([filterOf(lastQuery(fake), 'eq', 'status')[2], lastQuery(fake).orders[0][0]], ['published', 'published_at']);
  fake.queries.length = 0;
  assert.deepEqual(await api.creatorEntries('nope'), {items: [], nextCursor: null});
  assert.equal(fake.queries.length, 0);
});

test('getEntry and getBody ask for one row and tell "locked" (null) from an empty caption', async () => {
  const {fake, api} = signedIn({tables: {entries: [entryRow()]}});
  assert.equal(await api.getEntry('not-a-uuid'), null);
  assert.equal(fake.queries.length, 0);
  fake.handlers['entries.select'] = () => ok(null);
  assert.equal(await api.getEntry(ENTRY), null, 'unknown or hidden');
  fake.handlers['entry_bodies.select'] = () => ok([]);
  assert.equal(await api.getBody(ENTRY), null, 'row level security returned nothing: locked');
  fake.handlers['entry_bodies.select'] = () => ok([{body: ''}]);
  assert.equal(await api.getBody(ENTRY), '', 'an empty caption is readable');
  fake.handlers['entry_bodies.select'] = () => ok([{body: 'Full text'}]);
  assert.equal(await api.getBody(ENTRY.toUpperCase()), 'Full text');
  assert.deepEqual(filterOf(lastQuery(fake), 'eq', 'entry_id'), ['eq', 'entry_id', ENTRY]);
  assert.equal(await api.getBody(undefined), null);
});

test('savedEntries pages by the time of saving and leaves out posts that are gone', async () => {
  const {fake, api} = signedIn();
  const rows = [{created_at: '2026-09-30T00:00:00+00:00', entry: entryRow({id: 'a', creator: creatorRow()})}, {created_at: '2026-09-29T00:00:00+00:00', entry: null}, {created_at: '2026-09-28T00:00:00+00:00', entry: entryRow({id: 'c'})}];
  fake.handlers['bookmarks.select'] = q => ok(rows.slice(0, q.limit));
  const page = await api.savedEntries({limit: 2, cursor: '2026-10-01T00:00:00+00:00'});
  const q = lastQuery(fake);
  assert.deepEqual([q.limit, filterOf(q, 'lt', 'created_at')[2], filterOf(q, 'eq', 'user_id')[2]], [3, '2026-10-01T00:00:00+00:00', USER]);
  assert.deepEqual(page.items.map(e => e.id), ['a']);
  assert.equal(page.nextCursor, '2026-09-29T00:00:00+00:00', 'the cursor still moves past the removed row');
});

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------
test('friendly() turns database, auth and storage errors into sentences', () => {
  const cases = [
    [{code: 'P0001', message: 'Keep at least one membership tier open.'}, 'Keep at least one membership tier open.'],
    [{code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned'}, 'That could not be found, or you do not have permission to change it.'],
    [{message: 'Invalid login credentials'}, 'That email and password do not match.'],
    [{message: 'Email not confirmed'}, 'Confirm your email first. Check your inbox for the link.'],
    [{message: 'User already registered'}, 'An account with this email already exists. Sign in instead.'],
    [{message: 'email rate limit exceeded'}, 'Too many attempts. Wait a few minutes and try again.'],
    [{message: 'over_email_send_rate_limit'}, 'Too many attempts. Wait a few minutes and try again.'],
    [{message: 'Auth session missing!'}, 'Your session has expired or you do not have permission. Sign in again and retry.'],
    [{message: 'JWT expired'}, 'Your session has expired or you do not have permission. Sign in again and retry.'],
    [{message: 'duplicate key value violates unique constraint "creators_slug_key"'}, 'That atelier address is taken. Try another name.'],
    [{message: 'duplicate key value violates unique constraint "creators_owner_id_key"'}, 'You already have an atelier.'],
    [{message: 'duplicate key value violates unique constraint "entry_media_path_key"'}, 'That file was already added.'],
    [{message: 'new row violates row-level security policy for table "comments"'}, 'You do not have permission to do that.'],
    [{message: 'permission denied for table circle_notes'}, 'You do not have permission to do that.'],
    [{message: 'TypeError: Failed to fetch'}, 'We could not reach REFLUENZ. Check your connection and try again.'],
    [{message: 'Load failed'}, 'We could not reach REFLUENZ. Check your connection and try again.'],
    [{message: 'Something unexpected'}, 'Something unexpected'],
    ['plain string', 'plain string']
  ];
  for (const [error, message] of cases) assert.equal(friendly(error), message, JSON.stringify(error));
});

test('failed queries throw an Error with a friendly message, the database code and the original as cause', async () => {
  const {fake, api} = guest();
  const original = {code: '42501', message: 'permission denied for table creators'};
  fake.handlers['creators.select'] = () => ({data: null, error: original});
  await assert.rejects(api.listCreators(), error => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, 'You do not have permission to do that.');
    assert.equal(error.code, '42501');
    assert.equal(error.cause, original);
    return true;
  });
  assert.equal(fail({message: 'x'}).code, undefined);
});

test('rule messages raised by database functions reach the caller unchanged, with their code', async () => {
  const {fake, api} = signedIn();
  fake.handlers['rpc.save_entry'] = () => ({data: null, error: {code: 'P0001', message: 'Add at least one image before publishing.'}});
  await assert.rejects(api.saveEntry('e', {title: 'x'}, 'published'), error => error.message === 'Add at least one image before publishing.' && error.code === 'P0001');
  fake.handlers['creator_tiers.update'] = failing('Keep at least one membership tier open.', 'P0001');
  await assert.rejects(api.updateTier(CREATOR, 'essential', {enabled: false}), {message: 'Keep at least one membership tier open.'});
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
test('auth emails send people back to /app.html on the current origin', async () => {
  await withLocation('https://refluenz.com', async () => {
    const {fake, api} = signedIn();
    const redirect = 'https://refluenz.com/app.html';
    await api.signUp('a@b.c', 'secret12', 'Ines');
    await api.resendConfirmation('a@b.c');
    await api.resetPassword('a@b.c');
    await api.updateEmail('new@b.c');
    await api.updatePassword('newsecret');
    assert.deepEqual(fake.authCalls.map(c => c.name), ['signUp', 'resend', 'resetPasswordForEmail', 'updateUser', 'updateUser']);
    assert.deepEqual(fake.authCalls[0].args, [{email: 'a@b.c', password: 'secret12', options: {data: {display_name: 'Ines'}, emailRedirectTo: redirect}}]);
    assert.deepEqual(fake.authCalls[1].args, [{type: 'signup', email: 'a@b.c', options: {emailRedirectTo: redirect}}]);
    assert.deepEqual(fake.authCalls[2].args, ['a@b.c', {redirectTo: redirect}]);
    assert.deepEqual(fake.authCalls[3].args, [{email: 'new@b.c'}, {emailRedirectTo: redirect}]);
    assert.deepEqual(fake.authCalls[4].args, [{password: 'newsecret'}]);
  });
  await withLocation('http://localhost:3000', async () => {
    const {fake, api} = signedIn();
    await api.resetPassword('a@b.c');
    assert.equal(fake.authCalls[0].args[1].redirectTo, 'http://localhost:3000/app.html');
  });
  await withLocation(null, async () => {
    const {fake, api} = signedIn();
    await api.resetPassword('a@b.c');
    assert.equal(fake.authCalls[0].args[1].redirectTo, undefined, 'outside a browser the project default applies');
  });
});

test('signUp reports whether the account is usable at once, and refuses an address that is already registered', async () => {
  const {fake, api} = guest();
  fake.handlers['auth.signUp'] = () => ok({user: {identities: [{}]}, session: null});
  assert.deepEqual(await api.signUp('a@b.c', 'secret12', 'Ines'), {confirmed: false});
  fake.handlers['auth.signUp'] = () => ok({user: {identities: [{}]}, session: {access_token: 't'}});
  assert.deepEqual(await api.signUp('a@b.c', 'secret12', 'Ines'), {confirmed: true});
  fake.handlers['auth.signUp'] = () => ok({user: {identities: []}, session: null});
  await assert.rejects(api.signUp('a@b.c', 'secret12', 'Ines'), {message: 'An account with this email already exists. Sign in instead.'});
  fake.handlers['auth.signUp'] = () => ({data: null, error: {message: 'Password should be at least 6 characters.'}});
  await assert.rejects(api.signUp('a@b.c', '1', 'Ines'), {message: 'Password should be at least 6 characters.'});
});

test('getSession returns the stored session or null', async () => {
  assert.equal((await signedIn().api.getSession()).access_token, 'tok-123');
  assert.equal(await guest().api.getSession(), null);
});

test('onAuthChange defers its callback so Supabase is never called from inside its own lock, and can be stopped', async () => {
  const {fake, api} = signedIn();
  const heard = [];
  const stop = api.onAuthChange((event, session) => heard.push([event, session?.user.id ?? null]));
  fake.emitAuth('SIGNED_IN', {user: {id: USER}});
  assert.deepEqual(heard, [], 'not called synchronously');
  await tick();
  assert.deepEqual(heard, [['SIGNED_IN', USER]]);
  stop();
  assert.equal(fake.listeners.size, 0);
  fake.emitAuth('SIGNED_OUT', null);
  await tick();
  assert.equal(heard.length, 1);
});

test('signOut clears every cache, even when the server call fails', async () => {
  const {fake, api} = signedIn();
  await api.signedUrls(['a']);
  await api.signedUrls(['a']);
  assert.equal(fake.storageCalls.filter(c => c.op === 'sign').length, 1);
  await api.signOut();
  await api.signedUrls(['a']);
  assert.equal(fake.storageCalls.filter(c => c.op === 'sign').length, 2, 'signed links do not survive a sign-out');

  fake.handlers.signOut = () => ({error: {message: 'Failed to fetch'}});
  await assert.rejects(api.signOut(), {message: 'We could not reach REFLUENZ. Check your connection and try again.'});
  await api.signedUrls(['a']);
  assert.equal(fake.storageCalls.filter(c => c.op === 'sign').length, 3, 'the caches went anyway');
});

test('signing in as another account drops the circle cache and the signed links of the previous one', async () => {
  const {fake, api} = signedIn({tables: {follows: [{creator_id: CREATOR}], memberships: []}});
  api.onAuthChange(() => {});
  fake.emitAuth('SIGNED_IN', {user: {id: USER}});
  await api.feed({scope: 'following'});
  await api.signedUrls(['a']);
  fake.emitAuth('TOKEN_REFRESHED', {user: {id: USER}});
  await api.feed({scope: 'following'});
  await api.signedUrls(['a']);
  assert.equal(fake.queries.filter(q => q.table === 'follows').length, 1);
  assert.equal(fake.storageCalls.filter(c => c.op === 'sign').length, 1);
  fake.emitAuth('SIGNED_IN', {user: {id: OTHER}});
  await api.feed({scope: 'following'});
  await api.signedUrls(['a']);
  assert.equal(fake.queries.filter(q => q.table === 'follows').length, 2);
  assert.equal(fake.storageCalls.filter(c => c.op === 'sign').length, 2);
});

// ---------------------------------------------------------------------------
// Viewer
// ---------------------------------------------------------------------------
test('loadViewer returns everything the store needs in one go', async () => {
  const creator = {...creatorRow({owner_id: USER, is_showcase: false}), creator_tiers: [tierRow('essential', {name: 'Friend'})]};
  const {fake, api} = signedIn({tables: {
    profiles: [{id: USER, display_name: 'Sofia', bio: 'Reads slowly.', website: 'https://sofia.test', avatar_path: `${USER}/me.png`}],
    user_settings: [{compact: true, welcome_dismissed: true, onboarded: true, notify_prefs: {like: false}}],
    creators: [creatorRow({owner_id: USER, is_showcase: false})],
    tiers: [{id: 'essential', level: 1, name: 'Essential', price: 9}, {id: 'premium', level: 2, name: 'Premium'}],
    follows: [{creator_id: 'c1'}, {creator_id: 'c2'}], bookmarks: [{entry_id: 'e1'}], likes: [{entry_id: 'e2'}, {entry_id: 'e3'}],
    memberships: [{creator_id: CREATOR, tier: 'essential', created_at: '2026-08-05T09:00:00+00:00', creator}]
  }});
  const viewer = await api.loadViewer();
  assert.deepEqual(Object.keys(viewer).sort(), ['following', 'liked', 'memberships', 'myCreator', 'profile', 'saved', 'settings', 'tiers']);
  assert.deepEqual(viewer.profile, {id: USER, name: 'Sofia', bio: 'Reads slowly.', website: 'https://sofia.test', avatarUrl: `${URL}/storage/v1/object/public/avatars/${USER}/me.png`, avatarPath: `${USER}/me.png`});
  assert.deepEqual(viewer.settings, {compact: true, welcomeDismissed: true, onboarded: true, notifyPrefs: {new_entry: true, comment: true, reply: true, like: false, follow: true, membership: true, message: true, note: true}});
  assert.equal(viewer.myCreator.ownerId, USER);
  assert.deepEqual(viewer.tiers, [{id: 'essential', level: 1, name: 'Essential'}, {id: 'premium', level: 2, name: 'Premium'}]);
  assert.deepEqual([viewer.following, viewer.saved, viewer.liked], [['c1', 'c2'], ['e1'], ['e2', 'e3']]);
  assert.deepEqual([viewer.memberships[0].tier.name, viewer.memberships[0].level], ['Friend', 1]);
  assert.deepEqual(fake.queries.map(q => q.table).sort(), ['bookmarks', 'creators', 'follows', 'likes', 'memberships', 'profiles', 'tiers', 'user_settings']);
  assert.deepEqual(filterOf(fake.queries.find(q => q.table === 'creators'), 'eq', 'owner_id'), ['eq', 'owner_id', USER]);
});

test('loadViewer without an atelier or settings row still yields complete defaults, and needs a session', async () => {
  const {api} = signedIn({tables: {profiles: [{id: USER, display_name: 'Sofia'}], tiers: []}});
  const viewer = await api.loadViewer();
  assert.equal(viewer.myCreator, null);
  assert.deepEqual([viewer.settings.onboarded, viewer.settings.notifyPrefs.like, viewer.profile.bio, viewer.profile.avatarUrl], [false, true, '', null]);
  await assert.rejects(guest().api.loadViewer(), {message: 'Sign in to continue.'});
});

test('lists that can outgrow a request are read in ranges of 1000', async () => {
  const {fake, api} = signedIn({tables: {profiles: [{id: USER, display_name: 'S'}], tiers: []}});
  fake.handlers['follows.select'] = q => ok(Array.from({length: q.range[0] === 0 ? 1000 : 3}, (_, i) => ({creator_id: `c${q.range[0] + i}`})));
  const viewer = await api.loadViewer();
  assert.equal(viewer.following.length, 1003);
  assert.deepEqual(fake.queries.filter(q => q.table === 'follows').map(q => q.range), [[0, 999], [1000, 1999]]);
});

test('saveProfile validates, normalises the website and writes only what was given', async () => {
  const {fake, api} = signedIn();
  fake.handlers['profiles.update'] = q => ok({id: USER, display_name: q.payload.display_name ?? 'Old', bio: q.payload.bio ?? '', website: q.payload.website ?? '', avatar_path: null});
  const profile = await api.saveProfile({name: '  Sofia M.  ', website: 'sofia.test'});
  const q = lastQuery(fake);
  assert.deepEqual(q.payload, {display_name: 'Sofia M.', website: 'https://sofia.test', updated_at: '2026-10-07T09:00:00.000Z'});
  assert.deepEqual(filterOf(q, 'eq', 'id'), ['eq', 'id', USER]);
  assert.deepEqual([profile.name, profile.website], ['Sofia M.', 'https://sofia.test']);
  await api.saveProfile({bio: ''});
  assert.deepEqual(Object.keys(lastQuery(fake).payload).sort(), ['bio', 'updated_at']);
  const before = fake.queries.length;
  await assert.rejects(api.saveProfile({name: '  '}), {message: 'Your name cannot be empty.'});
  await assert.rejects(api.saveProfile({name: 'x'.repeat(61)}), {message: 'Your name can be at most 60 characters.'});
  await assert.rejects(api.saveProfile({bio: 'x'.repeat(241)}), {message: 'Your bio can be at most 240 characters.'});
  await assert.rejects(api.saveProfile({website: 'not a url'}), {message: 'Your website must be a web address such as https://example.com.'});
  assert.equal(fake.queries.length, before, 'invalid input never reaches the database');
});

test('saveSettings merges notification preferences into the stored ones', async () => {
  const {fake, api} = signedIn();
  fake.handlers['user_settings.select'] = () => ok({notify_prefs: {like: false}});
  fake.handlers['user_settings.update'] = q => ok({compact: false, welcome_dismissed: false, onboarded: false, notify_prefs: q.payload.notify_prefs});
  const settings = await api.saveSettings({notifyPrefs: {comment: false}});
  const update = fake.queries.find(q => q.op === 'update');
  assert.deepEqual(update.payload.notify_prefs, {new_entry: true, comment: false, reply: true, like: false, follow: true, membership: true, message: true, note: true});
  assert.equal(settings.notifyPrefs.comment, false);
  assert.deepEqual(filterOf(update, 'eq', 'user_id'), ['eq', 'user_id', USER]);
  fake.queries.length = 0;
  await api.saveSettings({compact: 1, onboarded: true, welcomeDismissed: false});
  assert.deepEqual(fake.queries.map(q => q.op), ['update'], 'no read when preferences are not involved');
  assert.deepEqual(fake.queries[0].payload, {compact: true, onboarded: true, welcome_dismissed: false, updated_at: '2026-10-07T09:00:00.000Z'});
});

test('uploadAvatar stores the picture under the user folder, saves the path and removes the old file', async () => {
  const {fake, api} = signedIn();
  fake.handlers['profiles.select'] = () => ok({avatar_path: `${USER}/old.png`});
  fake.handlers['profiles.update'] = q => ok({id: USER, display_name: 'S', bio: '', website: '', avatar_path: q.payload.avatar_path});
  const profile = await api.uploadAvatar(new Blob(['x'], {type: 'image/png'}));
  assert.deepEqual(fake.storageCalls.map(c => [c.bucket, c.op, c.path ?? c.paths]), [['avatars', 'upload', `${USER}/file-uuid.png`], ['avatars', 'remove', [`${USER}/old.png`]]]);
  assert.deepEqual(fake.storageCalls[0].options, {contentType: 'image/png', upsert: false, cacheControl: '31536000'});
  assert.equal(profile.avatarUrl, `${URL}/storage/v1/object/public/avatars/${USER}/file-uuid.png`);
});

test('uploadAvatar refuses a wrong type or size before uploading, and removes the new file when saving fails', async () => {
  const {fake, api} = signedIn();
  fake.handlers['profiles.select'] = () => ok({avatar_path: null});
  await assert.rejects(api.uploadAvatar(new Blob(['x'], {type: 'image/svg+xml'})), {message: 'Use a JPG, PNG, WEBP or GIF image.'});
  await assert.rejects(api.uploadAvatar(new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], {type: 'image/png'})), {message: 'This image is too large (5 MB max).'});
  await assert.rejects(api.uploadAvatar(new Blob([], {type: 'image/png'})), {message: 'Choose an image to upload.'});
  await assert.rejects(api.uploadAvatar(null), {message: 'Choose an image to upload.'});
  assert.equal(fake.storageCalls.length, 0);
  fake.handlers['profiles.update'] = failing('Failed to fetch');
  await assert.rejects(api.uploadAvatar(new Blob(['x'], {type: 'image/webp'})), {message: 'We could not reach REFLUENZ. Check your connection and try again.'});
  assert.deepEqual(fake.storageCalls.map(c => [c.op, c.path ?? c.paths]), [['upload', `${USER}/file-uuid.webp`], ['remove', [`${USER}/file-uuid.webp`]]]);
});

test('removeAvatar clears the path and removes the file', async () => {
  const {fake, api} = signedIn();
  fake.handlers['profiles.select'] = () => ok({avatar_path: `${USER}/old.png`});
  fake.handlers['profiles.update'] = q => ok({id: USER, display_name: 'S', avatar_path: q.payload.avatar_path});
  const profile = await api.removeAvatar();
  assert.equal(lastQuery(fake).payload.avatar_path, null);
  assert.equal(profile.avatarUrl, null);
  assert.deepEqual(fake.storageCalls, [{bucket: 'avatars', op: 'remove', paths: [`${USER}/old.png`]}]);
});

// ---------------------------------------------------------------------------
// Creators and tiers
// ---------------------------------------------------------------------------
test('listCreators sorts, filters and pages by offset', async () => {
  const {fake, api} = guest();
  await api.listCreators();
  assert.deepEqual([lastQuery(fake).orders, lastQuery(fake).range], [[['follower_count', {ascending: false}], ['created_at', {ascending: false}]], [0, 11]]);
  await api.listCreators({category: 'Design', sort: 'new', limit: 5, offset: 10});
  const q = lastQuery(fake);
  assert.deepEqual([filterOf(q, 'eq', 'category')[2], q.orders, q.range], ['Design', [['created_at', {ascending: false}]], [10, 14]]);
  await api.listCreators({offset: -4, limit: 1000});
  assert.deepEqual(lastQuery(fake).range, [0, 49]);
});

test('suggestedCreators leaves out ateliers the person already follows, belongs to or owns', async () => {
  const A = '1a000000-0000-4000-8000-000000000001', B = '1a000000-0000-4000-8000-000000000002';
  const {fake, api} = signedIn({tables: {follows: [{creator_id: A}], memberships: [{creator_id: B}]}});
  await api.suggestedCreators(3);
  const q = lastQuery(fake);
  assert.equal(q.limit, 3);
  assert.deepEqual(q.filters.find(f => f[0] === 'not.in'), ['not.in', 'id', `(${A},${B})`]);
  assert.equal(filterOf(q, 'or', null)[2], `owner_id.is.null,owner_id.neq.${USER}`);
  const open = guest();
  await open.api.suggestedCreators();
  assert.equal(lastQuery(open.fake).filters.length, 0);
});

test('getCreator and getCreatorBySlug refuse malformed input without a query and return null for unknown ones', async () => {
  const {fake, api} = guest();
  for (const slug of ['', 'a', "x'; --", 'UPPER CASE', null, undefined, 'a'.repeat(41)]) assert.equal(await api.getCreatorBySlug(slug), null, String(slug));
  assert.equal(await api.getCreator('nope'), null);
  assert.equal(fake.queries.length, 0);
  assert.equal(await api.getCreatorBySlug('does-not-exist'), null);
  assert.equal(await api.getCreator(CREATOR), null);
  assert.deepEqual(filterOf(lastQuery(fake), 'eq', 'id'), ['eq', 'id', CREATOR]);
});

test('slugAvailable checks the format, then counts rows', async () => {
  const {fake, api} = guest();
  fake.handlers['creators.select'] = q => ({data: null, count: q.filters[0][2] === 'taken' ? 1 : 0, error: null});
  assert.equal(await api.slugAvailable('free-slug'), true);
  assert.equal(await api.slugAvailable('taken'), false);
  assert.equal(lastQuery(fake).head, true);
  fake.queries.length = 0;
  for (const slug of ['', 'a', 'No Spaces', '../x']) assert.equal(await api.slugAvailable(slug), false);
  assert.equal(fake.queries.length, 0);
});

test('createAtelier derives the slug from the name and inserts with the owner', async () => {
  const {fake, api} = signedIn();
  const creator = await api.createAtelier({name: '  Atelier Verne ', category: 'Writing', descriptor: 'Essays', links: [{label: 'Site', url: 'verne.test'}]});
  const q = lastQuery(fake);
  assert.deepEqual(q.payload, {name: 'Atelier Verne', category: 'Writing', descriptor: 'Essays', links: [{label: 'Site', url: 'https://verne.test'}], slug: 'atelier-verne', owner_id: USER});
  assert.equal(creator.slug, 'atelier-verne');
  await api.createAtelier({name: 'Ünïcode & Co.', category: 'Art'});
  assert.equal(lastQuery(fake).payload.slug, 'unicode-co');
  await api.createAtelier({name: '日本', category: 'Art'});
  assert.equal(lastQuery(fake).payload.slug, 'atelier', 'a name with no usable letters falls back to a plain slug');
});

test('createAtelier retries a taken generated slug with a short suffix, but reports a chosen slug as taken', async () => {
  const taken = {code: '23505', message: 'duplicate key value violates unique constraint "creators_slug_key"'};
  const {fake, api} = signedIn();
  let attempts = 0;
  fake.handlers['creators.insert'] = q => attempts++ === 0 ? {data: null, error: taken} : ok({...creatorRow(), slug: q.payload.slug});
  const creator = await make(fake, {uuid: () => 'abcd1234-0000'}).createAtelier({name: 'Atelier Verne', category: 'Writing'});
  assert.equal(creator.slug, 'atelier-verne-abcd');
  assert.deepEqual(fake.queries.filter(q => q.op === 'insert').map(q => q.payload.slug), ['atelier-verne', 'atelier-verne-abcd']);

  fake.handlers['creators.insert'] = () => ({data: null, error: taken});
  await assert.rejects(api.createAtelier({name: 'Atelier Verne', category: 'Writing', slug: 'verne'}), {message: 'That atelier address is taken. Try another name.'});
  assert.equal(fake.queries.filter(q => q.op === 'insert' && q.payload.slug === 'verne').length, 1, 'a chosen address is not changed behind the person\'s back');
  fake.handlers['creators.insert'] = failing('duplicate key value violates unique constraint "creators_owner_id_key"', '23505');
  await assert.rejects(api.createAtelier({name: 'Second', category: 'Writing'}), {message: 'You already have an atelier.'});
});

test('createAtelier and updateAtelier validate their input', async () => {
  const {fake, api} = signedIn();
  const before = fake.queries.length;
  await assert.rejects(api.createAtelier({category: 'Writing'}), {message: 'Give your atelier a name.'});
  await assert.rejects(api.createAtelier({name: 'Verne'}), {message: 'Choose a category.'});
  await assert.rejects(api.createAtelier({name: 'V', category: 'Writing'}), {message: 'The atelier name needs at least 2 characters.'});
  await assert.rejects(api.createAtelier({name: 'Verne', category: 'Sport'}), {message: 'Choose a category.'});
  await assert.rejects(api.createAtelier({name: 'Verne', category: 'Writing', image: 'neon'}), {message: 'Choose one of the cover styles.'});
  await assert.rejects(api.createAtelier({name: 'Verne', category: 'Writing', bio: 'x'.repeat(401)}), {message: 'The description can be at most 400 characters.'});
  await assert.rejects(api.createAtelier({name: 'Verne', category: 'Writing', slug: 'No Good'}), {message: 'Use 2 to 40 letters, numbers or hyphens for the address.'});
  await assert.rejects(api.createAtelier({name: 'Verne', category: 'Writing', links: Array.from({length: 6}, () => ({label: 'a', url: 'https://a.test'}))}), {message: 'Add up to 5 links.'});
  await assert.rejects(api.updateAtelier(CREATOR, {links: [{label: 'a', url: 'javascript:alert(1)'}]}), {message: 'A link must be a web address such as https://example.com.'});
  await assert.rejects(api.updateAtelier('nope', {name: 'Verne'}), {message: 'That atelier could not be found.'});
  assert.equal(fake.queries.length, before);
  await assert.rejects(guest().api.createAtelier({name: 'Verne', category: 'Writing'}), {message: 'Sign in to continue.'});
});

test('updateAtelier writes only the given fields; a stranger\'s atelier reads as not found', async () => {
  const {fake, api} = signedIn();
  fake.handlers['creators.update'] = q => ok(creatorRow(q.payload.name ? {name: q.payload.name} : {}));
  const creator = await api.updateAtelier(CREATOR, {name: 'Renamed', bio: 'New bio', image: 'ritual'});
  assert.deepEqual(lastQuery(fake).payload, {name: 'Renamed', bio: 'New bio', image: 'ritual', updated_at: '2026-10-07T09:00:00.000Z'});
  assert.equal(creator.name, 'Renamed');
  fake.handlers['creators.update'] = () => ({data: null, error: {code: 'PGRST116', message: '0 rows'}});
  await assert.rejects(api.updateAtelier(CREATOR, {name: 'Mine now'}), {message: 'That could not be found, or you do not have permission to change it.'});
});

test('atelier images live in the covers bucket under the atelier folder, and the replaced file is removed', async () => {
  const {fake, api} = signedIn();
  fake.handlers['creators.select'] = () => ok({avatar_path: `${CREATOR}/old.png`, cover_path: null});
  fake.handlers['creators.update'] = q => ok(creatorRow({avatar_path: q.payload.avatar_path ?? `${CREATOR}/old.png`, cover_path: q.payload.cover_path ?? null}));
  const creator = await api.uploadCreatorImage(CREATOR, 'avatar', new Blob(['x'], {type: 'image/webp'}));
  assert.equal(lastQuery(fake).payload.avatar_path, `${CREATOR}/file-uuid.webp`);
  assert.deepEqual(fake.storageCalls.map(c => [c.bucket, c.op, c.path ?? c.paths]), [['covers', 'upload', `${CREATOR}/file-uuid.webp`], ['covers', 'remove', [`${CREATOR}/old.png`]]]);
  assert.equal(creator.avatarUrl, `${URL}/storage/v1/object/public/covers/${CREATOR}/file-uuid.webp`);
  await api.uploadCreatorImage(CREATOR.toUpperCase(), 'cover', new Blob(['x'], {type: 'image/jpeg'}));
  assert.equal(lastQuery(fake).payload.cover_path, `${CREATOR}/file-uuid.jpg`);

  fake.storageCalls.length = 0;
  await api.removeCreatorImage(CREATOR, 'avatar');
  assert.equal(lastQuery(fake).payload.avatar_path, null);
  assert.deepEqual(fake.storageCalls, [{bucket: 'covers', op: 'remove', paths: [`${CREATOR}/old.png`]}]);
});

test('atelier images are validated first, and a failed save removes the new file', async () => {
  const {fake, api} = signedIn();
  fake.handlers['creators.select'] = () => ok({avatar_path: null, cover_path: null});
  await assert.rejects(api.uploadCreatorImage(CREATOR, 'banner', new Blob(['x'], {type: 'image/png'})), {message: 'Choose the avatar or the cover.'});
  await assert.rejects(api.uploadCreatorImage(CREATOR, 'cover', new Blob(['x'], {type: 'image/gif'})), {message: 'Use a JPG, PNG or WEBP image.'});
  await assert.rejects(api.uploadCreatorImage('nope', 'cover', new Blob(['x'], {type: 'image/png'})), {message: 'That atelier could not be found.'});
  assert.equal(fake.storageCalls.length, 0);
  fake.handlers['creators.update'] = failing('new row violates row-level security policy');
  await assert.rejects(api.uploadCreatorImage(CREATOR, 'cover', new Blob(['x'], {type: 'image/png'})), {message: 'You do not have permission to do that.'});
  assert.deepEqual(fake.storageCalls.map(c => c.op), ['upload', 'remove']);
});

test('listTiers and updateTier map the creator\'s tiers and write the right columns', async () => {
  const {fake, api} = signedIn({tables: {creator_tiers: [tierRow('premium'), tierRow('essential')]}});
  assert.deepEqual((await api.listTiers(CREATOR)).map(t => t.id), ['essential', 'premium']);
  assert.deepEqual(filterOf(lastQuery(fake), 'eq', 'creator_id'), ['eq', 'creator_id', CREATOR]);
  assert.deepEqual(await api.listTiers('nope'), []);

  fake.handlers['creator_tiers.update'] = q => ok(tierRow('premium', {name: q.payload.name, price_cents: q.payload.price_cents, perks: q.payload.perks, enabled: q.payload.enabled}));
  const tier = await api.updateTier(CREATOR, 'premium', {name: ' Patron ', priceCents: 1500, currency: 'USD', description: 'More', perks: [' One ', '', 'Two'], enabled: false});
  const q = lastQuery(fake);
  assert.deepEqual(q.payload, {name: 'Patron', price_cents: 1500, currency: 'USD', description: 'More', perks: ['One', 'Two'], enabled: false, updated_at: '2026-10-07T09:00:00.000Z'});
  assert.deepEqual([filterOf(q, 'eq', 'creator_id')[2], filterOf(q, 'eq', 'tier_id')[2]], [CREATOR, 'premium']);
  assert.deepEqual([tier.name, tier.priceCents, tier.perks, tier.enabled, tier.level], ['Patron', 1500, ['One', 'Two'], false, 2]);
});

test('updateTier validates before writing', async () => {
  const {fake, api} = signedIn();
  const before = fake.queries.length;
  await assert.rejects(api.updateTier(CREATOR, 'gold', {}), {message: 'Choose Essential, Premium or Signature.'});
  await assert.rejects(api.updateTier(CREATOR, 'premium', {name: 'x'}), {message: 'The tier name needs at least 2 characters.'});
  await assert.rejects(api.updateTier(CREATOR, 'premium', {priceCents: -1}), {message: 'Set a price between 0 and 1,000.'});
  await assert.rejects(api.updateTier(CREATOR, 'premium', {priceCents: 12.5}), {message: 'Set a price between 0 and 1,000.'});
  await assert.rejects(api.updateTier(CREATOR, 'premium', {priceCents: 100001}), {message: 'Set a price between 0 and 1,000.'});
  await assert.rejects(api.updateTier(CREATOR, 'premium', {currency: 'JPY'}), {message: 'Choose EUR, USD or GBP.'});
  await assert.rejects(api.updateTier(CREATOR, 'premium', {description: 'x'.repeat(281)}), {message: 'The description can be at most 280 characters.'});
  await assert.rejects(api.updateTier(CREATOR, 'premium', {perks: Array.from({length: 9}, (_, i) => `p${i}`)}), {message: 'List up to 8 perks.'});
  await assert.rejects(api.updateTier(CREATOR, 'premium', {perks: ['x'.repeat(81)]}), {message: 'Each perk can be at most 80 characters.'});
  await assert.rejects(api.updateTier('nope', 'premium', {}), {message: 'That atelier could not be found.'});
  assert.equal(fake.queries.length, before);
});

// ---------------------------------------------------------------------------
// Entry covers, reads
// ---------------------------------------------------------------------------
test('entry covers: upload to the covers bucket, attach with set_entry_cover, and remove the file that was replaced', async () => {
  const {fake, api} = signedIn();
  const path = await api.uploadEntryCover(CREATOR, new Blob(['x'], {type: 'image/jpeg'}));
  assert.equal(path, `${CREATOR}/file-uuid.jpg`);
  assert.deepEqual(fake.storageCalls.map(c => [c.bucket, c.op, c.path]), [['covers', 'upload', path]]);
  await assert.rejects(api.uploadEntryCover(CREATOR, new Blob(['x'], {type: 'image/gif'})), {message: 'Use a JPG, PNG or WEBP image.'});
  await assert.rejects(api.uploadEntryCover('nope', new Blob(['x'], {type: 'image/png'})), {message: 'That atelier could not be found.'});

  fake.storageCalls.length = 0;
  fake.handlers['entries.select'] = () => ok({cover_path: `${CREATOR}/old.png`});
  await api.setEntryCover(ENTRY, path);
  assert.deepEqual(fake.rpcCalls.at(-1), {name: 'set_entry_cover', args: {p_entry: ENTRY, p_path: path}});
  assert.deepEqual(fake.storageCalls, [{bucket: 'covers', op: 'remove', paths: [`${CREATOR}/old.png`]}]);
  fake.storageCalls.length = 0;
  await api.setEntryCover(ENTRY, null);
  assert.equal(fake.rpcCalls.at(-1).args.p_path, null);
  assert.equal(fake.storageCalls.length, 1);
  fake.storageCalls.length = 0;
  fake.handlers['entries.select'] = () => ok({cover_path: path});
  await api.setEntryCover(ENTRY, path);
  assert.equal(fake.storageCalls.length, 0, 'the file that stays is never removed');
  fake.handlers['rpc.set_entry_cover'] = failing('Invalid cover image.', 'P0001');
  await assert.rejects(api.setEntryCover(ENTRY, 'x'), {message: 'Invalid cover image.'});
});

test('recordRead counts a signed-in read and never fails the page', async () => {
  const {fake, api} = signedIn();
  await api.recordRead(ENTRY);
  assert.deepEqual(fake.rpcCalls, [{name: 'record_read', args: {p_entry: ENTRY}}]);
  fake.handlers['rpc.record_read'] = failing('boom');
  assert.equal(await api.recordRead(ENTRY), undefined);
});

// ---------------------------------------------------------------------------
// Social
// ---------------------------------------------------------------------------
test('follow, like and bookmark insert or delete the person\'s own row; repeating one is fine', async () => {
  const {fake, api} = signedIn();
  await api.setFollow(CREATOR, true);
  await api.setLike(ENTRY, true);
  await api.setBookmark(ENTRY, true);
  assert.deepEqual(fake.queries.map(q => [q.table, q.op, q.payload]), [['follows', 'insert', {user_id: USER, creator_id: CREATOR}], ['likes', 'insert', {user_id: USER, entry_id: ENTRY}], ['bookmarks', 'insert', {user_id: USER, entry_id: ENTRY}]]);
  await api.setFollow(CREATOR, false);
  await api.setLike(ENTRY, false);
  await api.setBookmark(ENTRY, false);
  assert.deepEqual(fake.queries.slice(3).map(q => [q.table, q.op, q.filters[0]]), [['follows', 'delete', ['match', {user_id: USER, creator_id: CREATOR}]], ['likes', 'delete', ['match', {user_id: USER, entry_id: ENTRY}]], ['bookmarks', 'delete', ['match', {user_id: USER, entry_id: ENTRY}]]]);
  fake.handlers['likes.insert'] = failing('duplicate key value violates unique constraint "likes_pkey"', '23505');
  await api.setLike(ENTRY, true);
  fake.handlers['likes.insert'] = failing('new row violates row-level security policy for table "likes"');
  await assert.rejects(api.setLike(ENTRY, true), {message: 'You do not have permission to do that.'});
  fake.handlers['follows.delete'] = failing('Failed to fetch');
  await assert.rejects(api.setFollow(CREATOR, false), {message: 'We could not reach REFLUENZ. Check your connection and try again.'});
});

test('account actions need a session and make no request without one', async () => {
  const {fake, api} = guest();
  const calls = [() => api.setFollow(CREATOR, true), () => api.setLike(ENTRY, true), () => api.setBookmark(ENTRY, true), () => api.savedEntries(), () => api.addComment(ENTRY, 'hi'), () => api.join(CREATOR, 'essential'),
    () => api.leave(CREATOR), () => api.myMemberships(), () => api.sendMessage(CREATOR, USER, 'member', 'hi'), () => api.listNotifications(), () => api.markNotificationsRead('all'), () => api.report({targetType: 'entry', targetId: ENTRY, reason: 'spam'}),
    () => api.exportData(), () => api.saveProfile({name: 'x'}), () => api.saveSettings({compact: true}), () => api.uploadAvatar(new Blob(['x'], {type: 'image/png'})), () => api.createAtelier({name: 'Verne', category: 'Writing'})];
  for (const call of calls) await assert.rejects(call(), {message: 'Sign in to continue.'}, String(call));
  assert.equal(fake.queries.length + fake.storageCalls.length + fake.rpcCalls.length, 0);
});

test('comments: list oldest first, add with a parent, edit, delete', async () => {
  const row = (id, parent_id = null, body = 'Hello', edited_at = null) => ({id, entry_id: ENTRY, author_id: OTHER, parent_id, body, created_at: `2026-09-28T1${id}:00:00+00:00`, edited_at, author: personRow()});
  const {fake, api} = signedIn();
  fake.handlers['comments.select'] = q => ok([row('3', '1'), row('2'), row('1')].slice(0, q.limit));
  const comments = await api.listComments(ENTRY);
  assert.deepEqual(comments.map(c => c.id), ['1', '2', '3'], 'oldest first');
  assert.deepEqual(lastQuery(fake).orders, [['created_at', {ascending: false}]]);
  assert.equal(lastQuery(fake).limit, 500);
  assert.deepEqual(comments[0], {id: '1', entryId: ENTRY, parentId: null, body: 'Hello', createdAt: '2026-09-28T11:00:00+00:00', editedAt: null, author: {id: OTHER, name: 'Ada', avatarUrl: `${URL}/storage/v1/object/public/avatars/${OTHER}/me.png`}});
  assert.equal(comments[2].parentId, '1');

  fake.handlers['comments.insert'] = q => ok(row('9', q.payload.parent_id, q.payload.body));
  const added = await api.addComment(ENTRY, '  A thought  ', 'p1');
  assert.deepEqual(lastQuery(fake).payload, {entry_id: ENTRY, author_id: USER, parent_id: 'p1', body: 'A thought'});
  assert.deepEqual([added.body, added.parentId], ['A thought', 'p1']);
  await api.addComment(ENTRY, 'top level');
  assert.equal(lastQuery(fake).payload.parent_id, null);
  await assert.rejects(api.addComment(ENTRY, '   '), {message: 'Your comment cannot be empty.'});
  await assert.rejects(api.addComment(ENTRY, 'x'.repeat(2001)), {message: 'Your comment can be at most 2000 characters.'});

  fake.handlers['comments.update'] = q => ok(row('9', null, q.payload.body, '2026-09-29T00:00:00+00:00'));
  const edited = await api.editComment('9', 'Better');
  assert.deepEqual([lastQuery(fake).payload, edited.editedAt], [{body: 'Better'}, '2026-09-29T00:00:00+00:00']);
  await api.deleteComment('9');
  assert.deepEqual([lastQuery(fake).op, filterOf(lastQuery(fake), 'eq', 'id')[2]], ['delete', '9']);
  fake.handlers['comments.update'] = () => ({data: null, error: {code: 'PGRST116', message: '0 rows'}});
  await assert.rejects(api.editComment('1', 'Not mine'), {message: 'That could not be found, or you do not have permission to change it.'});
});

// ---------------------------------------------------------------------------
// Memberships
// ---------------------------------------------------------------------------
test('join upserts the membership and maps it with the creator\'s tier', async () => {
  const creator = {...creatorRow(), creator_tiers: [tierRow('premium', {name: 'Patron', price_cents: 1900})]};
  const {fake, api} = signedIn();
  fake.handlers['memberships.upsert'] = q => ok({creator_id: q.payload.creator_id, tier: q.payload.tier, created_at: '2026-10-07T09:00:00+00:00', creator});
  const membership = await api.join(CREATOR, 'premium');
  const q = lastQuery(fake);
  assert.deepEqual([q.payload, q.options], [{user_id: USER, creator_id: CREATOR, tier: 'premium'}, {onConflict: 'user_id,creator_id'}]);
  assert.ok(q.columns.includes('creator_tiers!creator_id('));
  assert.deepEqual([membership.tierId, membership.level, membership.tier.name, membership.tier.priceCents, membership.creator.id], ['premium', 2, 'Patron', 1900, CREATOR]);
  await assert.rejects(api.join(CREATOR, 'gold'), {message: 'Choose Essential, Premium or Signature.'});
  fake.handlers['memberships.upsert'] = failing('That membership tier is not open right now.', 'P0001');
  await assert.rejects(api.join(CREATOR, 'premium'), {message: 'That membership tier is not open right now.'});
  fake.handlers['memberships.upsert'] = failing('new row violates row-level security policy for table "memberships"');
  await assert.rejects(api.join(CREATOR, 'premium'), {message: 'You do not have permission to do that.'});
  await api.leave(CREATOR);
  assert.deepEqual([lastQuery(fake).op, lastQuery(fake).filters[0]], ['delete', ['match', {user_id: USER, creator_id: CREATOR}]]);
});

test('circleMembers maps people with the tier they hold; creatorStats maps the analytics', async () => {
  const {fake, api} = signedIn({tables: {creator_tiers: [tierRow('essential', {name: 'Friend'}), tierRow('premium', {name: 'Patron'})]}});
  fake.handlers['memberships.select'] = () => ok([
    {user_id: OTHER, tier: 'premium', created_at: '2026-10-01T00:00:00+00:00', member: personRow()},
    {user_id: USER, tier: 'signature', created_at: '2026-09-01T00:00:00+00:00', member: null}
  ]);
  const members = await api.circleMembers(CREATOR);
  assert.deepEqual(members.map(m => [m.member.name, m.tier.name, m.tier.level, m.joinedAt]), [['Ada', 'Patron', 2, '2026-10-01T00:00:00+00:00'], ['Member', 'signature', 3, '2026-09-01T00:00:00+00:00']]);
  assert.equal(members[1].member.id, USER, 'a member whose profile cannot be read still has an id');
  const q = fake.queries.find(x => x.table === 'memberships');
  assert.deepEqual([filterOf(q, 'eq', 'creator_id')[2], q.orders[0], q.limit], [CREATOR, ['created_at', {ascending: false}], 500]);

  fake.handlers['rpc.creator_stats'] = () => ok({followers: 5, members: 2, entries: 4, drafts: 1, likes: 9, comments: 3, reads: 40, monthly_value_cents: 2800, new_members_30d: 1, new_followers_30d: 2,
    by_tier: [{tier_id: 'essential', name: 'Friend', level: 1, enabled: true, price_cents: 900, members: 1}], top_entries: [{id: 'e1', title: 'T', kind: 'text', like_count: 3, comment_count: 1, read_count: 7}]});
  assert.deepEqual(await api.creatorStats(CREATOR), {followers: 5, members: 2, entries: 4, drafts: 1, likes: 9, comments: 3, reads: 40, monthlyValueCents: 2800, newMembers30d: 1, newFollowers30d: 2,
    byTier: [{tierId: 'essential', name: 'Friend', level: 1, enabled: true, priceCents: 900, members: 1}], topEntries: [{id: 'e1', title: 'T', kind: 'text', likeCount: 3, commentCount: 1, readCount: 7}]});
  assert.deepEqual(fake.rpcCalls.at(-1), {name: 'creator_stats', args: {p_creator: CREATOR}});
  fake.handlers['rpc.creator_stats'] = failing('Not your atelier.', 'P0001');
  await assert.rejects(api.creatorStats(CREATOR), {message: 'Not your atelier.'});
});

// ---------------------------------------------------------------------------
// Messages and notes
// ---------------------------------------------------------------------------
test('inbox maps every thread with its atelier and member, newest first', async () => {
  const {fake, api} = signedIn();
  fake.handlers['rpc.inbox'] = () => ok([
    {creator_id: CREATOR, member_id: USER, last_body: 'Yes, and about endings.', last_sender: 'creator', last_at: '2026-09-30T09:00:00+00:00', unread: 2},
    {creator_id: 'gone', member_id: USER, last_body: 'x', last_sender: 'member', last_at: '2026-09-29T09:00:00+00:00', unread: 0}
  ]);
  fake.handlers['creators.select'] = () => ok([creatorRow()]);
  fake.handlers['profiles.select'] = () => ok([personRow(USER, 'Sofia')]);
  const threads = await api.inbox();
  assert.equal(threads.length, 1, 'a thread whose atelier cannot be read is left out');
  assert.deepEqual([threads[0].creatorId, threads[0].memberId, threads[0].creator.slug, threads[0].member.name, threads[0].lastBody, threads[0].lastSender, threads[0].lastAt, threads[0].unread],
    [CREATOR, USER, 'atelier-solene', 'Sofia', 'Yes, and about endings.', 'creator', '2026-09-30T09:00:00+00:00', 2]);
  assert.deepEqual(filterOf(fake.queries.find(q => q.table === 'creators'), 'in', 'id')[2], [CREATOR, 'gone']);
  assert.equal(fake.queries.find(q => q.name === 'inbox').limit, 200);
});

test('thread reads the latest messages oldest first; sendMessage validates and maps', async () => {
  const msg = (id, sender, body, at) => ({id, creator_id: CREATOR, member_id: USER, sender, body, created_at: at, read_at: null});
  const {fake, api} = signedIn();
  fake.handlers['messages.select'] = () => ok([msg('2', 'creator', 'Reply', '2026-09-30T09:00:00+00:00'), msg('1', 'member', 'Hello', '2026-09-30T08:00:00+00:00')]);
  const thread = await api.thread(CREATOR, USER);
  assert.deepEqual(thread.map(m => [m.id, m.from, m.text]), [['1', 'member', 'Hello'], ['2', 'creator', 'Reply']]);
  assert.deepEqual(thread[0], {id: '1', creatorId: CREATOR, memberId: USER, from: 'member', text: 'Hello', date: '2026-09-30T08:00:00+00:00', readAt: null});
  assert.deepEqual([lastQuery(fake).orders[0], lastQuery(fake).limit], [['created_at', {ascending: false}], 200]);

  fake.handlers['messages.insert'] = q => ok(msg('3', q.payload.sender, q.payload.body, '2026-10-01T00:00:00+00:00'));
  const sent = await api.sendMessage(CREATOR, USER, 'member', '  Thanks!  ');
  assert.deepEqual(lastQuery(fake).payload, {creator_id: CREATOR, member_id: USER, sender: 'member', body: 'Thanks!'});
  assert.equal(sent.text, 'Thanks!');
  await assert.rejects(api.sendMessage(CREATOR, USER, 'member', ' '), {message: 'Your message cannot be empty.'});
  await assert.rejects(api.sendMessage(CREATOR, USER, 'robot', 'x'), {message: 'Choose who is sending the message.'});
  await assert.rejects(api.sendMessage(CREATOR, USER, 'member', 'x'.repeat(2001)), {message: 'Your message can be at most 2000 characters.'});
  fake.handlers['messages.insert'] = failing('new row violates row-level security policy for table "messages"');
  await assert.rejects(api.sendMessage(CREATOR, USER, 'member', 'x'), {message: 'You do not have permission to do that.'});
  fake.handlers['messages.insert'] = failing('You are sending messages too quickly. Please wait a moment.', 'P0001');
  await assert.rejects(api.sendMessage(CREATOR, USER, 'member', 'x'), {message: 'You are sending messages too quickly. Please wait a moment.'});
  await api.markThreadRead(CREATOR, USER);
  assert.deepEqual(fake.rpcCalls.at(-1), {name: 'mark_thread_read', args: {p_creator: CREATOR, p_member: USER}});
});

test('circle notes: list newest first, post, delete', async () => {
  const note = (id, at) => ({id, creator_id: CREATOR, body: `Note ${id}`, created_at: at});
  const {fake, api} = signedIn({tables: {circle_notes: [note('2', '2026-09-02T00:00:00+00:00'), note('1', '2026-09-01T00:00:00+00:00')]}});
  assert.deepEqual(await api.listNotes(CREATOR), [{id: '2', creatorId: CREATOR, text: 'Note 2', date: '2026-09-02T00:00:00+00:00'}, {id: '1', creatorId: CREATOR, text: 'Note 1', date: '2026-09-01T00:00:00+00:00'}]);
  assert.deepEqual([filterOf(lastQuery(fake), 'eq', 'creator_id')[2], lastQuery(fake).limit], [CREATOR, 100]);
  fake.handlers['circle_notes.insert'] = q => ok(note('3', '2026-10-01T00:00:00+00:00'));
  assert.equal((await api.postNote(CREATOR, ' Hello circle ')).id, '3');
  assert.deepEqual(lastQuery(fake).payload, {creator_id: CREATOR, body: 'Hello circle'});
  await assert.rejects(api.postNote(CREATOR, ''), {message: 'The note cannot be empty.'});
  await api.deleteNote('3');
  assert.deepEqual([lastQuery(fake).op, filterOf(lastQuery(fake), 'eq', 'id')[2]], ['delete', '3']);
  fake.handlers['circle_notes.insert'] = failing('You have shared a lot of notes this hour. Please wait a little.', 'P0001');
  await assert.rejects(api.postNote(CREATOR, 'again'), {message: 'You have shared a lot of notes this hour. Please wait a little.'});
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
test('listNotifications maps actor, atelier and post, newest first, with cursors', async () => {
  const row = (id, at, over = {}) => ({id, type: 'comment', actor_id: OTHER, comment_id: 'c1', read_at: null, created_at: at, actor: personRow(), creator: {id: CREATOR, slug: 'atelier-solene', name: 'Atelier Solene'}, entry: {id: ENTRY, title: 'A title'}, ...over});
  const rows = [row('1', '2026-10-03T00:00:00+00:00'), row('2', '2026-10-02T00:00:00+00:00', {type: 'follow', actor: null, actor_id: null, entry: null, comment_id: null, read_at: '2026-10-02T01:00:00+00:00'}), row('3', '2026-10-01T00:00:00+00:00')];
  const {fake, api} = signedIn();
  fake.handlers['notifications.select'] = q => ok(rows.slice(0, q.limit));
  const page = await api.listNotifications({limit: 2});
  assert.equal(page.items.length, 2);
  assert.equal(page.nextCursor, '2026-10-02T00:00:00+00:00');
  assert.deepEqual(page.items[0], {id: '1', type: 'comment', actor: {id: OTHER, name: 'Ada', avatarUrl: `${URL}/storage/v1/object/public/avatars/${OTHER}/me.png`}, creator: {id: CREATOR, slug: 'atelier-solene', name: 'Atelier Solene'},
    entry: {id: ENTRY, title: 'A title'}, commentId: 'c1', readAt: null, createdAt: '2026-10-03T00:00:00+00:00'});
  assert.deepEqual([page.items[1].actor, page.items[1].entry, page.items[1].readAt], [null, null, '2026-10-02T01:00:00+00:00']);
  const q = lastQuery(fake);
  assert.ok(q.columns.includes('actor:profiles!actor_id('), 'the embed names its foreign key: notifications also point at profiles through user_id');
  assert.deepEqual([q.limit, filterOf(q, 'eq', 'user_id')[2]], [3, USER]);
  await api.listNotifications({cursor: page.nextCursor});
  assert.deepEqual([lastQuery(fake).limit, filterOf(lastQuery(fake), 'lt', 'created_at')[2]], [21, page.nextCursor]);
});

test('unreadCounts counts unread notifications and unread messages in the person\'s threads', async () => {
  const {fake, api} = signedIn();
  fake.handlers['notifications.select'] = () => ({data: null, count: 4, error: null});
  fake.handlers['messages.select'] = () => ({data: null, count: 2, error: null});
  assert.deepEqual(await api.unreadCounts(), {notifications: 4, messages: 2});
  const [n, m] = fake.queries;
  assert.deepEqual([n.head, filterOf(n, 'eq', 'user_id')[2], filterOf(n, 'is', 'read_at')[2]], [true, USER, null]);
  assert.deepEqual(filterOf(n, 'neq', 'type')[2], 'message', 'message notifications are counted by the messages badge');
  assert.equal(filterOf(m, 'or', null)[2], `and(sender.eq.creator,member_id.eq.${USER}),and(sender.eq.member,member_id.neq.${USER})`);
  fake.handlers['messages.select'] = failing('Failed to fetch');
  await assert.rejects(api.unreadCounts(), {message: 'We could not reach REFLUENZ. Check your connection and try again.'});
});

test('markNotificationsRead stamps unread rows of the person, by id (in chunks) or all', async () => {
  const {fake, api} = signedIn();
  await api.markNotificationsRead('all');
  let q = lastQuery(fake);
  assert.deepEqual([q.op, q.payload, filterOf(q, 'eq', 'user_id')[2], filterOf(q, 'is', 'read_at')[2]], ['update', {read_at: '2026-10-07T09:00:00.000Z'}, USER, null]);
  assert.equal(filterOf(q, 'in', 'id'), undefined);
  fake.queries.length = 0;
  await api.markNotificationsRead(Array.from({length: 150}, (_, i) => `n${i}`));
  assert.deepEqual(fake.queries.map(x => filterOf(x, 'in', 'id')[2].length), [100, 50]);
  fake.queries.length = 0;
  await api.markNotificationsRead([]);
  await api.markNotificationsRead(undefined);
  assert.equal(fake.queries.length, 0);
  await api.deleteNotification('n1');
  q = lastQuery(fake);
  assert.deepEqual([q.table, q.op, filterOf(q, 'eq', 'id')[2]], ['notifications', 'delete', 'n1']);
});

// ---------------------------------------------------------------------------
// Search, reports
// ---------------------------------------------------------------------------
test('search asks the database functions, then fetches the authors of the posts it found', async () => {
  const other = creatorRow({id: OTHER, slug: 'casa-verano', name: 'Casa Verano'});
  const {fake, api} = guest();
  fake.handlers['rpc.search_creators'] = () => ok([creatorRow()]);
  fake.handlers['rpc.search_entries'] = () => ok([entryRow({id: 'e1'}), entryRow({id: 'e2', creator_id: OTHER})]);
  fake.handlers['creators.select'] = () => ok([other]);
  const result = await api.search('  solène  ');
  assert.deepEqual(fake.rpcCalls, [{name: 'search_creators', args: {q: 'solène', lim: 6}}, {name: 'search_entries', args: {q: 'solène', lim: 8, off: 0}}]);
  assert.deepEqual(result.creators.map(c => c.slug), ['atelier-solene']);
  assert.deepEqual(result.entries.map(e => [e.id, e.creator.slug]), [['e1', 'atelier-solene'], ['e2', 'casa-verano']]);
  const lookup = fake.queries.find(q => q.table === 'creators');
  assert.deepEqual(filterOf(lookup, 'in', 'id')[2], [OTHER], 'only authors that were not already found');
  assert.ok(!fake.queries.find(q => q.name === 'search_entries').columns.includes('search'), 'the tsvector column is not downloaded');
});

test('an empty search makes no request, and a long one is cut', async () => {
  const {fake, api} = guest();
  for (const q of ['', '   ', null, undefined]) assert.deepEqual(await api.search(q), {creators: [], entries: []});
  assert.equal(fake.queries.length, 0);
  await api.search('x'.repeat(300));
  assert.equal(fake.rpcCalls[0].args.q.length, 100);
});

test('report validates and inserts one row for the signed-in person', async () => {
  const {fake, api} = signedIn();
  await api.report({targetType: 'comment', targetId: ENTRY.toUpperCase(), reason: 'spam', details: '  Looks automated.  '});
  assert.deepEqual([lastQuery(fake).table, lastQuery(fake).payload], ['reports', {target_type: 'comment', target_id: ENTRY, reason: 'spam', details: 'Looks automated.'}]);
  await api.report({targetType: 'entry', targetId: ENTRY, reason: 'other'});
  assert.equal(lastQuery(fake).payload.details, '');
  const before = fake.queries.length;
  await assert.rejects(api.report({targetType: 'user', targetId: ENTRY, reason: 'spam'}), {message: 'Choose what you are reporting.'});
  await assert.rejects(api.report({targetType: 'entry', targetId: ENTRY, reason: 'dislike'}), {message: 'Choose a reason for the report.'});
  await assert.rejects(api.report({targetType: 'entry', targetId: 'abc', reason: 'spam'}), {message: 'That item cannot be reported.'});
  await assert.rejects(api.report({targetType: 'entry', targetId: ENTRY, reason: 'spam', details: 'x'.repeat(1001)}), {message: 'The details can be at most 1000 characters.'});
  assert.equal(fake.queries.length, before);
  fake.handlers['reports.insert'] = failing('You are doing that too often. Please wait a moment and try again.', 'P0001');
  await assert.rejects(api.report({targetType: 'entry', targetId: ENTRY, reason: 'spam'}), {message: 'You are doing that too often. Please wait a moment and try again.'});
});

// ---------------------------------------------------------------------------
// Account and realtime
// ---------------------------------------------------------------------------
test('exportData gathers everything the person owns into one object', async () => {
  const own = creatorRow({owner_id: USER, is_showcase: false});
  const {fake, api} = signedIn({tables: {
    profiles: [{id: USER, display_name: 'Sofia', bio: '', website: '', avatar_path: null}], user_settings: [{compact: false, welcome_dismissed: false, onboarded: true, notify_prefs: {}}], creators: [own],
    follows: [{creator_id: CREATOR, created_at: '2026-08-01T00:00:00+00:00'}], bookmarks: [{entry_id: ENTRY, created_at: '2026-08-02T00:00:00+00:00'}], likes: [{entry_id: ENTRY, created_at: '2026-08-03T00:00:00+00:00'}],
    memberships: [{creator_id: CREATOR, tier: 'essential', created_at: '2026-08-04T00:00:00+00:00', creator: {...creatorRow(), creator_tiers: [tierRow('essential')]}}],
    comments: [{id: 'c1', entry_id: ENTRY, author_id: USER, parent_id: null, body: 'Hi', created_at: '2026-08-05T00:00:00+00:00', edited_at: null, author: personRow(USER, 'Sofia')}],
    messages: [{id: 'm1', creator_id: CREATOR, member_id: USER, sender: 'member', body: 'Hello', created_at: '2026-08-06T00:00:00+00:00', read_at: null}],
    circle_notes: [{id: 'n1', creator_id: own.id, body: 'Note', created_at: '2026-08-07T00:00:00+00:00'}],
    entries: [{...entryRow({creator_id: own.id}), body: {body: 'The text'}, media: [{id: 'm', entry_id: ENTRY, kind: 'image', path: 'p', mime: 'image/webp', size_bytes: 10, position: 0}]}]
  }});
  const data = await api.exportData();
  assert.deepEqual(Object.keys(data).sort(), ['account', 'atelier', 'bookmarks', 'comments', 'entries', 'exportedAt', 'follows', 'likes', 'memberships', 'messages', 'notes', 'profile', 'settings']);
  assert.deepEqual(data.account, {id: USER, email: 'sofia@example.test'});
  assert.equal(data.exportedAt, '2026-10-07T09:00:00.000Z');
  assert.deepEqual([data.profile.name, data.atelier.id, data.settings.onboarded], ['Sofia', CREATOR, true]);
  assert.deepEqual(data.follows, [{creatorId: CREATOR, createdAt: '2026-08-01T00:00:00+00:00'}]);
  assert.deepEqual([data.bookmarks[0].entryId, data.likes[0].entryId, data.memberships[0].tierId, data.comments[0].body, data.messages[0].text, data.notes[0].text], [ENTRY, ENTRY, 'essential', 'Hi', 'Hello', 'Note']);
  assert.deepEqual([data.entries[0].body, data.entries[0].media[0].path], ['The text', 'p']);
  assert.ok(fake.queries.filter(q => q.range).every(q => q.range[0] === 0 && q.range[1] === 999));
  const withoutAtelier = signedIn({tables: {profiles: [{id: USER, display_name: 'S'}]}});
  const bare = await withoutAtelier.api.exportData();
  assert.deepEqual([bare.atelier, bare.entries, bare.notes], [null, [], []]);
  assert.equal(withoutAtelier.fake.queries.some(q => q.table === 'entries' || q.table === 'circle_notes'), false);
});

test('deleteAccount calls the edge function with the session token, then drops the local session', async () => {
  const requests = [];
  const respond = (status, body) => async (url, init) => { requests.push({url, init}); return {ok: status < 300, status, json: async () => body}; };
  const {fake, api} = signedIn();
  const withFetch = fetch => make(fake, {fetch});
  await withFetch(respond(200, {ok: true})).deleteAccount();
  assert.equal(requests[0].url, `${URL}/functions/v1/delete-account`);
  assert.equal(requests[0].init.method, 'POST');
  assert.deepEqual(requests[0].init.headers, {authorization: 'Bearer tok-123', apikey: KEY, 'content-type': 'application/json'});
  assert.deepEqual(fake.authCalls.map(c => [c.name, c.args]), [['signOut', [{scope: 'local'}]]]);

  await assert.rejects(withFetch(respond(401, {error: 'Sign in again'})).deleteAccount(), {message: 'Your session has expired or you do not have permission. Sign in again and retry.'});
  await assert.rejects(withFetch(respond(500, {error: 'Your account could not be deleted. Try again in a moment.'})).deleteAccount(), {message: 'Your account could not be deleted. Try again in a moment.'});
  await assert.rejects(withFetch(async () => ({ok: false, status: 502, json: async () => { throw Error('not json'); }})).deleteAccount(), {message: 'Your account could not be deleted. Try again in a moment.'});
  await assert.rejects(withFetch(async () => { throw TypeError('Failed to fetch'); }).deleteAccount(), {message: 'We could not reach REFLUENZ. Check your connection and try again.'});
  await assert.rejects(guest().api.deleteAccount(), {message: 'Sign in to continue.'});
});

test('subscribe listens for new notifications and messages on one channel and returns an unsubscribe', async () => {
  const {fake, api} = signedIn();
  const heard = {notifications: [], messages: []};
  const stop = api.subscribe(USER, {onNotification: n => heard.notifications.push(n), onMessage: m => heard.messages.push(m)});
  assert.equal(fake.channels.length, 1);
  const [channel] = fake.channels;
  assert.equal(channel.subscribed, true);
  assert.deepEqual(channel.subscriptions.map(s => [s.type, s.filter]), [
    ['postgres_changes', {event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${USER}`}],
    ['postgres_changes', {event: 'INSERT', schema: 'public', table: 'messages'}]
  ]);

  fake.handlers['notifications.select'] = () => ok({id: 'n1', type: 'comment', actor_id: OTHER, comment_id: 'c1', read_at: null, created_at: '2026-10-07T09:00:00+00:00', actor: personRow(), creator: {id: CREATOR, slug: 's', name: 'N'}, entry: {id: ENTRY, title: 'T'}});
  await channel.subscriptions[0].callback({new: {id: 'n1', type: 'comment', actor_id: OTHER, created_at: '2026-10-07T09:00:00+00:00'}});
  assert.deepEqual([heard.notifications[0].actor.name, heard.notifications[0].entry.title], ['Ada', 'T'], 'delivered with the same shape as the list');

  fake.handlers['notifications.select'] = failing('Failed to fetch');
  await channel.subscriptions[0].callback({new: {id: 'n2', type: 'like', actor_id: OTHER, created_at: '2026-10-07T09:01:00+00:00'}});
  assert.deepEqual([heard.notifications[1].id, heard.notifications[1].type, heard.notifications[1].actor], ['n2', 'like', null], 'the bare row still arrives when the lookup fails');

  channel.subscriptions[1].callback({new: {id: 'm1', creator_id: CREATOR, member_id: USER, sender: 'creator', body: 'Hi', created_at: '2026-10-07T09:02:00+00:00', read_at: null}});
  assert.deepEqual(heard.messages[0], {id: 'm1', creatorId: CREATOR, memberId: USER, from: 'creator', text: 'Hi', date: '2026-10-07T09:02:00+00:00', readAt: null});
  stop();
  assert.equal(channel.removed, true);
  assert.throws(() => api.subscribe('x" OR 1=1'), {message: 'Sign in to receive updates.'});
});

// ---------------------------------------------------------------------------
// Media (ported from the previous api: every rule of docs/POST_FORMATS.md still holds)
// ---------------------------------------------------------------------------
const blob = (type, size = 16) => new Blob([new Uint8Array(size)], { type });
const imagePrepared = (over = {}) => ({ kind: 'image', blob: blob('image/webp', 2000), mime: 'image/webp', ext: 'webp', size: 2000, width: 1600, height: 900, duration: null, poster: null, preview: blob('image/webp', 300), name: 'look.png', ...over });
const BASE = `${CREATOR}/${ENTRY}/file-uuid`;
const videoPrepared = (over = {}) => ({ kind: 'video', blob: blob('video/mp4', 5000), mime: 'video/mp4', ext: 'mp4', size: 5000, width: 1280, height: 720, duration: 12.6, poster: blob('image/jpeg', 800), preview: blob('image/webp', 300), name: 'clip.mp4', ...over });


const REFUSED = 'This upload was refused. Your storage may be full (500 MB per atelier, 60 files per entry): remove media you no longer use, or sign in again, then retry.';
// The object-name rule the database enforces (app_private.media_name_ok).
const CANONICAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

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
  assert.deepEqual(media, { id: 'new-1', entryId: ENTRY, kind: 'image', path: `${BASE}.webp`, posterPath: null, previewPath: `${BASE}.webp`, mime: 'image/webp', size: 2000, width: 1600, height: 900, duration: null, alt: 'A coat', position: 2 });
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
  assert.deepEqual(fake.events, ['db select entry_media', 'db select entries', 'db delete entries', 'storage remove entry-media', 'storage remove previews']);
  assert.deepEqual(fake.queries[0].filters, [['eq', 'entry_id', 'e']]);
  assert.deepEqual(fake.queries[2].filters, [['eq', 'id', 'e']]);
  assert.deepEqual(fake.storageCalls, [
    { bucket: 'entry-media', op: 'remove', paths: ['c/e/a.webp', 'c/e/b.webp'] },
    { bucket: 'previews', op: 'remove', paths: ['c/e/a.webp', 'c/e/b.webp'] }
  ]);
});

test('deleteEntry on a text entry touches no storage, and swallows storage failures', async () => {
  const plain = fakeClient();
  await make(plain).deleteEntry('e');
  assert.deepEqual(plain.events, ['db select entry_media', 'db select entries', 'db delete entries']);

  const fake = fakeClient({ tables: { entry_media: [{ path: 'c/e/a.mp4', poster_path: 'c/e/a-poster.jpg', preview_path: 'c/e/a.webp' }] } });
  fake.handlers.remove = () => { throw Error('storage down'); };
  await make(fake).deleteEntry('e');
  assert.deepEqual(fake.storageCalls.map(c => c.paths), [['c/e/a.mp4', 'c/e/a-poster.jpg'], ['c/e/a.webp']]);
});

test('deleteEntry also removes the uploaded cover of the entry', async () => {
  const fake = fakeClient({ tables: { entries: [{ cover_path: `${CREATOR}/cover.webp` }], entry_media: [] } });
  await make(fake).deleteEntry('e');
  assert.deepEqual(fake.events, ['db select entry_media', 'db select entries', 'db delete entries', 'storage remove covers']);
  assert.deepEqual(fake.storageCalls, [{ bucket: 'covers', op: 'remove', paths: [`${CREATOR}/cover.webp`] }]);
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

// ---------------------------------------------------------------------------
// The in-memory fake api (tests/helpers/fake-api.mjs) that the view tests are built on
// ---------------------------------------------------------------------------
const E = IDS.entries;
const idsOf = items => items.map(item => item.id);
const textValues = (over = {}) => ({kind: 'text', title: 'A fresh essay', subtitle: '', body: 'x'.repeat(40), category: 'Writing', format: 'Essay', image: 'atelier', access: 'public', ...over});
const videoFile = (over = {}) => ({kind: 'video', blob: blob('video/mp4', 20), mime: 'video/mp4', ext: 'mp4', size: 20, width: 640, height: 360, duration: 61, poster: null, preview: null, ...over});

test('fake: the seed is a small world with showcase and owned ateliers and posts at every access level', async () => {
  const fake = createFakeApi();
  const creators = await fake.listCreators();
  assert.deepEqual(creators.map(c => [c.slug, c.isShowcase, c.ownerId]).sort(), [['atelier-solene', true, null], ['casa-verano', true, null], ['verne-and-co', false, IDS.owner]]);
  const all = (await fake.feed({limit: 50})).items;
  assert.equal(all.length, 10, 'drafts are not in the feed');
  assert.deepEqual([...new Set(all.map(e => e.kind))].sort(), ['image', 'text', 'video']);
  assert.deepEqual([...new Set(all.map(e => e.access))].sort(), ['essential', 'premium', 'public', 'signature']);
  assert.equal((await fake.getCreatorBySlug('atelier-solene')).tiers.length, 3);
  const viewer = await fake.loadViewer();
  assert.deepEqual([viewer.profile.name, viewer.following, viewer.memberships.map(m => m.tierId), viewer.saved, viewer.liked], ['Sofia Marchetti', [IDS.verano], ['essential'], [E.linenWardrobe], [E.fittingDay]]);
  assert.deepEqual((await fake.getCreator(IDS.solene)).followerCount, 1);
  assert.equal((await fake.getEntry(E.cuttingRoom)).duration, 94);
  assert.equal((await fake.getEntry(E.fittingDay)).mediaCount, 2);
  assert.match((await fake.getEntry(E.fittingDay)).previewUrl, /previews\//);
});

test('fake: bodies, media, signed links and comments follow the access ladder', async () => {
  const fake = createFakeApi();   // the member holds essential at Atelier Solene
  assert.notEqual(await fake.getBody(E.linenWardrobe), null, 'public');
  assert.notEqual(await fake.getBody(E.tailorsLedger), null, 'essential, held');
  assert.equal(await fake.getBody(E.cuttingRoom), null, 'premium, not held');
  assert.equal(await fake.getBody(E.patternArchive), null, 'signature, not held');
  assert.equal(await fake.getBody(E.sketchbook), null, 'another atelier, essential');
  assert.deepEqual(Object.keys(await fake.media([E.fittingDay, E.cuttingRoom, E.sketchbook, E.workshopTour])).sort(), [E.fittingDay, E.workshopTour].sort());
  const [open] = (await fake.media([E.fittingDay]))[E.fittingDay];
  const [locked] = fake.db.entry_media.filter(m => m.entry_id === E.cuttingRoom);
  const signed = await fake.signedUrls([open.path, open.posterPath, locked.path]);
  assert.deepEqual(Object.keys(signed).sort(), [open.path, open.posterPath].sort(), 'only what the reader may open is signed');
  assert.match(signed[open.path], /\/sign\/entry-media\//);
  assert.deepEqual(await fake.listComments(E.cuttingRoom), []);
  assert.equal((await fake.listComments(E.linenWardrobe)).length, 2);
  await assert.rejects(fake.addComment(E.cuttingRoom, 'Hello'), {message: 'You do not have permission to do that.'});
  await assert.rejects(fake.setLike(E.cuttingRoom, true), {message: 'You do not have permission to do that.'});

  fake.signInAs(IDS.fan1);   // premium at Solene
  assert.notEqual(await fake.getBody(E.cuttingRoom), null);
  assert.equal(await fake.getBody(E.patternArchive), null);
  fake.signInAs(IDS.owner);  // the owner of Verne & Co reads his own draft, nobody else's
  assert.notEqual(await fake.getBody(E.unfinishedEssay), null);
  assert.equal(await fake.getBody(E.patternArchive), null);

  await fake.signOut();
  assert.notEqual(await fake.getBody(E.linenWardrobe), null, 'guests read public posts');
  assert.equal(await fake.getBody(E.tailorsLedger), null);
  assert.equal(Object.keys(await fake.media([E.fittingDay, E.sketchbook])).length, 1);
  assert.deepEqual(idsOf(await fake.listComments(E.linenWardrobe)), [IDS.comments.first, IDS.comments.reply]);
  await assert.rejects(fake.addComment(E.linenWardrobe, 'Hi'), {message: 'Sign in to continue.'});
});

test('fake: drafts are private to their owner', async () => {
  const fake = createFakeApi();
  assert.equal(await fake.getEntry(E.unfinishedEssay), null);
  assert.deepEqual((await fake.creatorEntries(IDS.verne, {status: 'draft'})).items, []);
  assert.deepEqual(idsOf((await fake.creatorEntries(IDS.verne)).items), [E.firstDraftHabits]);
  assert.equal((await fake.search('unfinished')).entries.length, 0);
  fake.signInAs(IDS.owner);
  assert.equal((await fake.getEntry(E.unfinishedEssay)).status, 'draft');
  assert.deepEqual(idsOf((await fake.creatorEntries(IDS.verne, {status: 'draft'})).items), [E.unfinishedEssay]);
  assert.equal((await fake.creatorStats(IDS.verne)).drafts, 1);
});

test('fake: writes are owner-only and saveEntry applies the server\'s rules', async () => {
  const fake = createFakeApi();
  await assert.rejects(fake.saveEntry(null, textValues(), 'draft'), error => error.message === 'Open your atelier before writing an entry.' && error.code === 'P0001');
  await assert.rejects(fake.updateAtelier(IDS.verne, {name: 'Mine'}), {message: 'That could not be found, or you do not have permission to change it.'});
  await assert.rejects(fake.updateTier(IDS.verne, 'essential', {name: 'Mine'}), {message: 'That could not be found, or you do not have permission to change it.'});
  await assert.rejects(fake.postNote(IDS.verne, 'Hi'), {message: 'You do not have permission to do that.'});
  await assert.rejects(fake.creatorStats(IDS.verne), {message: 'Not your atelier.'});
  await fake.deleteEntry(E.firstDraftHabits);
  assert.notEqual(await fake.getEntry(E.firstDraftHabits), null, 'a non-owner delete does nothing');

  fake.signInAs(IDS.owner);
  for (const [values, message] of [[{title: 'ab'}, 'Use a title between 3 and 100 characters.'], [{body: 'short'}, 'Write between 30 and 20,000 characters for your entry.'], [{subtitle: 'x'.repeat(181)}, 'Keep the introduction under 180 characters.'],
    [{kind: 'audio'}, 'Choose a post type.']]) await assert.rejects(fake.saveEntry(null, textValues(values), 'draft'), error => error.message === message && error.code === 'P0001', message);
  await assert.rejects(fake.saveEntry(null, textValues({category: 'Sport'}), 'draft'), {message: /entries_category_check/});
  await assert.rejects(fake.saveEntry(E.linenWardrobe, textValues(), 'draft'), {message: 'You can only edit your own entries.'});
  const id = await fake.saveEntry(null, textValues({title: '  Padded title  '}), 'published');
  const entry = await fake.getEntry(id);
  assert.deepEqual([entry.title, entry.status, entry.minutes, entry.creatorId, entry.publishedAt !== null], ['Padded title', 'published', 1, IDS.verne, true]);
  assert.equal((await fake.getCreator(IDS.verne)).entryCount, 2);
  assert.equal((await fake.feed()).items[0].id, id, 'new posts lead the feed');
  await fake.saveEntry(id, textValues({title: 'Back to draft'}), 'draft');
  assert.equal((await fake.getEntry(id)).status, 'draft');
  assert.equal((await fake.getCreator(IDS.verne)).entryCount, 1);
  await fake.deleteEntry(id);
  assert.equal(await fake.getEntry(id), null);
});

test('fake: media rules (headroom, final shape on publish, back to draft when the last file goes)', async () => {
  const fake = createFakeApi();
  fake.signInAs(IDS.owner);
  const id = await fake.saveEntry(null, textValues({kind: 'video', format: 'Film', body: ''}), 'draft');
  await assert.rejects(fake.saveEntry(id, textValues({kind: 'video', format: 'Film', body: ''}), 'published'), {message: 'Add a video before publishing.'});
  await assert.rejects(fake.uploadMedia(id, IDS.solene, videoFile()), {message: /upload was refused/}, 'only into the owner\'s own folder');
  const progress = [];
  const first = await fake.uploadMedia(id, IDS.verne, videoFile(), {onProgress: p => progress.push(p), alt: 'A tour'});
  assert.equal(progress.at(-1), 1);
  assert.match(first.path, new RegExp(`^${IDS.verne}/${id}/[0-9a-f-]{36}\\.mp4$`));
  assert.equal(first.alt, 'A tour');
  assert.deepEqual([(await fake.getEntry(id)).mediaCount, (await fake.getEntry(id)).duration], [1, 61]);
  await fake.uploadMedia(id, IDS.verne, videoFile());
  await assert.rejects(fake.uploadMedia(id, IDS.verne, videoFile()), {message: 'Remove the previous video before adding another.'});
  await assert.rejects(fake.saveEntry(id, textValues({kind: 'video', format: 'Film', body: ''}), 'published'), {message: 'Remove the extra video before publishing.'});
  const [, second] = (await fake.media([id]))[id];
  await fake.removeMedia(second);
  await fake.saveEntry(id, textValues({kind: 'video', format: 'Film', body: ''}), 'published');
  assert.equal((await fake.getEntry(id)).status, 'published');
  await fake.removeMedia(first);
  assert.equal((await fake.getEntry(id)).status, 'draft', 'a published media post that loses its last file goes back to draft');
  await assert.rejects(fake.uploadMedia(id, IDS.verne, videoFile({blob: null})), {message: 'Choose a file to upload.'});
  await assert.rejects(fake.uploadMedia('nope', IDS.verne, videoFile()), {message: 'This entry cannot take uploads right now. Reload the page and try again.'});
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fake.uploadMedia(id, IDS.verne, videoFile(), {signal: controller.signal}), {message: 'Upload cancelled.'});
  await fake.updateMedia(first.id, {alt: 'ignored: the row is gone'});
  fake.signInAs(IDS.member);
  await fake.updateMedia((await fake.media([E.fittingDay]))[E.fittingDay][0].id, {alt: 'Not mine'});
  assert.equal((await fake.media([E.fittingDay]))[E.fittingDay][0].alt, 'Photograph 1', 'a non-owner cannot edit media');
});

test('fake: showcase ateliers cannot be messaged and creators reply only in threads a member started', async () => {
  const fake = createFakeApi();
  await assert.rejects(fake.sendMessage(IDS.solene, IDS.member, 'member', 'Hello?'), {message: 'You do not have permission to do that.'});
  await assert.rejects(fake.sendMessage(IDS.verne, IDS.fan1, 'member', 'Not me'), {message: 'You do not have permission to do that.'});
  await assert.rejects(fake.sendMessage(IDS.verne, IDS.member, 'creator', 'Impersonation'), {message: 'You do not have permission to do that.'});
  const sent = await fake.sendMessage(IDS.verne, IDS.member, 'member', ' A second question ');
  assert.deepEqual([sent.from, sent.text, sent.readAt], ['member', 'A second question', null]);
  assert.equal((await fake.thread(IDS.verne, IDS.member)).length, 3);
  assert.deepEqual(await fake.thread(IDS.verne, IDS.fan1), [], 'not a participant');
  const mine = await fake.inbox();
  assert.deepEqual([mine.length, mine[0].creator.slug, mine[0].member.name, mine[0].lastBody, mine[0].unread], [1, 'verne-and-co', 'Sofia Marchetti', 'A second question', 1]);

  fake.signInAs(IDS.owner);
  await assert.rejects(fake.sendMessage(IDS.verne, IDS.fan1, 'creator', 'Unprompted'), {message: 'You do not have permission to do that.'}, 'fan1 never wrote to Verne');
  await assert.rejects(fake.sendMessage(IDS.verne, IDS.owner, 'member', 'To myself'), {message: 'You do not have permission to do that.'});
  assert.equal((await fake.sendMessage(IDS.verne, IDS.member, 'creator', 'Thanks for asking')).from, 'creator');
  assert.deepEqual(await fake.unreadCounts(), {notifications: 1, messages: 1}, 'a notification for the comment, and one unread member message (its notification is not counted twice)');
  await fake.markThreadRead(IDS.verne, IDS.member);
  assert.equal((await fake.unreadCounts()).messages, 0);
  await assert.rejects(fake.sendMessage(IDS.verne, IDS.member, 'creator', ' '), {message: 'Your message cannot be empty.'});
});

test('fake: comments are one level deep and counters, notifications and preferences behave like the triggers', async () => {
  const fake = createFakeApi();
  fake.signInAs(IDS.fan2);
  const nested = await fake.addComment(E.linenWardrobe, 'Replying to a reply', IDS.comments.reply);
  assert.equal(nested.parentId, IDS.comments.first, 'a reply to a reply attaches to the top comment');
  await assert.rejects(fake.addComment(E.linenWardrobe, 'Orphan', 'no-such-comment'), error => error.message === 'Invalid reply.' && error.code === 'P0001');
  await assert.rejects(fake.addComment(E.linenWardrobe, ' '), {message: 'Your comment cannot be empty.'});
  assert.equal((await fake.getEntry(E.linenWardrobe)).commentCount, 3);
  fake.signInAs(IDS.fan1);
  assert.deepEqual((await fake.listNotifications()).items.map(n => [n.type, n.actor.name]), [['reply', 'Tomas Reyes']], 'the author of the top comment is told about the reply');
  await assert.rejects(fake.editComment(nested.id, 'Not mine'), {message: 'That could not be found, or you do not have permission to change it.'});
  fake.signInAs(IDS.fan2);
  const edited = await fake.editComment(nested.id, 'Edited');
  assert.deepEqual([edited.body, edited.editedAt !== null], ['Edited', true]);

  fake.signInAs(IDS.member);
  const onVerne = await fake.addComment(E.firstDraftHabits, 'Another thought');
  fake.signInAs(IDS.owner);
  assert.deepEqual((await fake.listNotifications()).items.map(n => n.type), ['comment', 'comment', 'follow'], 'the owner hears about both comments');
  await fake.saveSettings({notifyPrefs: {comment: false}});
  fake.signInAs(IDS.member);
  await fake.addComment(E.firstDraftHabits, 'A third thought');
  fake.signInAs(IDS.owner);
  assert.equal((await fake.listNotifications()).items.length, 3, 'a switched-off type produces no notification');
  assert.deepEqual((await fake.loadViewer()).settings.notifyPrefs.comment, false);

  await fake.deleteComment(onVerne.id);   // the owner of the post may remove any comment on it
  assert.equal((await fake.getEntry(E.firstDraftHabits)).commentCount, 2);
  fake.signInAs(IDS.fan3);
  await fake.deleteComment(IDS.comments.first);
  assert.equal((await fake.listComments(E.linenWardrobe)).some(c => c.id === IDS.comments.first), true, 'only the author or the post owner can delete');
  fake.signInAs(IDS.fan1);
  await fake.deleteComment(IDS.comments.first);
  assert.deepEqual(await fake.listComments(E.linenWardrobe), [], 'deleting a comment deletes its replies');
});

test('fake: follows, likes, bookmarks and memberships keep the counters, and the tier rules hold', async () => {
  const fake = createFakeApi();
  const before = await fake.getCreator(IDS.verano);
  await fake.setFollow(IDS.verano, true);
  assert.equal((await fake.getCreator(IDS.verano)).followerCount, before.followerCount, 'following twice counts once');
  await fake.setFollow(IDS.solene, true);
  await fake.setFollow(IDS.verano, false);
  assert.deepEqual([(await fake.getCreator(IDS.solene)).followerCount, (await fake.getCreator(IDS.verano)).followerCount], [2, 0]);
  await fake.setLike(E.fittingDay, false);
  assert.equal((await fake.getEntry(E.fittingDay)).likeCount, 3);
  await fake.setLike(E.tilesOfAlfama, true);
  await fake.setLike(E.tilesOfAlfama, true);
  assert.equal((await fake.getEntry(E.tilesOfAlfama)).likeCount, 1);
  await fake.setBookmark(E.tilesOfAlfama, true);
  assert.deepEqual(idsOf((await fake.savedEntries()).items), [E.tilesOfAlfama, E.linenWardrobe], 'most recently saved first');
  await assert.rejects(fake.setBookmark(E.unfinishedEssay, true), {message: 'You do not have permission to do that.'});

  const joined = await fake.join(IDS.verano, 'premium');
  assert.deepEqual([joined.tier.name, joined.level, (await fake.getCreator(IDS.verano)).memberCount], ['Regular', 2, 1]);
  assert.notEqual(await fake.getBody(E.joineryNotes), null, 'joining opens the posts of that tier');
  const upgraded = await fake.join(IDS.solene, 'signature');
  assert.deepEqual([upgraded.tierId, (await fake.getCreator(IDS.solene)).memberCount], ['signature', 2], 'joining again changes the tier');
  await assert.rejects(fake.join(IDS.verano, 'gold'), {message: 'Choose Essential, Premium or Signature.'});
  await fake.leave(IDS.verano);
  assert.deepEqual([(await fake.myMemberships()).length, (await fake.getCreator(IDS.verano)).memberCount], [1, 0]);
  await assert.rejects(fake.join(IDS.verne, 'essential').then(() => fake.signInAs(IDS.owner)).then(() => fake.join(IDS.verne, 'essential')), {message: 'You do not have permission to do that.'}, 'owners cannot join their own atelier');

  await fake.updateTier(IDS.verne, 'essential', {enabled: false});
  await fake.updateTier(IDS.verne, 'premium', {enabled: false});
  await assert.rejects(fake.updateTier(IDS.verne, 'signature', {enabled: false}), error => error.message === 'Keep at least one membership tier open.' && error.code === 'P0001');
  fake.signInAs(IDS.member);
  await assert.rejects(fake.join(IDS.verne, 'essential'), {message: 'That membership tier is not open right now.'});
  fake.signInAs(IDS.owner);
  const tier = await fake.updateTier(IDS.verne, 'signature', {name: 'Patron', priceCents: 2500});
  assert.deepEqual([tier.name, tier.priceCents], ['Patron', 2500]);
});

test('fake: the owner sees the circle, members see only themselves, and stats add up', async () => {
  const fake = createFakeApi();
  const own = await fake.circleMembers(IDS.solene);
  assert.deepEqual(own.map(m => m.member.name), ['Sofia Marchetti'], 'row level security: a member sees only their own membership');
  fake.signInAs(IDS.owner);
  await fake.setFollow(IDS.verne, true);   // owners may follow themselves; the follow is not announced to them
  const circle = await fake.circleMembers(IDS.verne);
  assert.deepEqual(circle, []);
  const stats = await fake.creatorStats(IDS.verne);
  assert.deepEqual([stats.followers, stats.entries, stats.drafts, stats.comments, stats.byTier.map(t => t.level), stats.topEntries[0].id], [2, 1, 1, 1, [1, 2, 3], E.firstDraftHabits]);
  fake.signInAs(IDS.member);
  await fake.join(IDS.verne, 'premium');
  fake.signInAs(IDS.owner);
  assert.deepEqual((await fake.circleMembers(IDS.verne)).map(m => [m.member.name, m.tier.name]), [['Sofia Marchetti', 'Supporter']]);
  const after = await fake.creatorStats(IDS.verne);
  assert.deepEqual([after.members, after.monthlyValueCents, after.newMembers30d, after.byTier[1].members], [1, 1900, 1, 1]);
  assert.equal((await fake.listNotifications()).items[0].type, 'membership');
});

test('fake: feeds page without gaps or repeats and honour scope, kind, category and sort', async () => {
  const fake = createFakeApi();
  const everything = idsOf((await fake.feed({limit: 50})).items);
  const paged = [];
  let cursor;
  do {
    const page = await fake.feed({limit: 3, cursor});
    assert.ok(page.items.length <= 3);
    paged.push(...idsOf(page.items));
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(paged, everything);
  assert.equal(new Set(paged).size, 10);
  assert.deepEqual(idsOf((await fake.feed({kind: 'video'})).items), [E.workshopTour, E.cuttingRoom]);
  assert.deepEqual(idsOf((await fake.feed({category: 'Design'})).items), [E.tilesOfAlfama, E.sketchbook, E.workshopTour, E.joineryNotes]);
  assert.deepEqual(idsOf((await fake.feed({scope: 'following'})).items).sort(), everything.filter(id => ![E.firstDraftHabits].includes(id)).sort(), 'followed Casa Verano plus the Solene circle');
  assert.deepEqual(idsOf((await fake.feed({scope: 'following', creatorIds: [IDS.verne]})).items), [E.firstDraftHabits]);

  const popular = [];
  cursor = undefined;
  do {
    const page = await fake.feed({sort: 'popular', limit: 4, cursor});
    popular.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(popular.slice(0, 3).map(e => [e.id, e.likeCount]), [[E.fittingDay, 4], [E.workshopTour, 2], [E.linenWardrobe, 1]]);
  assert.equal(popular.length, 10);
  assert.ok(popular.every((e, i) => i === 0 || popular[i - 1].likeCount >= e.likeCount));
  await fake.signOut();
  assert.deepEqual((await fake.feed({scope: 'following'})).items, [], 'a guest has no circle');
  assert.equal((await fake.feed()).items.length, 10, 'but sees the latest from everyone');
});

test('fake: notifications are produced for followers and members when a post is published, and read state is per person', async () => {
  const fake = createFakeApi();
  fake.signInAs(IDS.owner);
  await fake.postNote(IDS.verne, 'A note for the circle');
  const id = await fake.saveEntry(null, textValues(), 'published');
  fake.signInAs(IDS.fan1);   // follows Verne & Co
  const items = (await fake.listNotifications()).items;
  assert.deepEqual(items.map(n => [n.type, n.creator.slug, n.entry?.id ?? null, n.actor.name]), [['new_entry', 'verne-and-co', id, 'Marco Verne'], ['note', 'verne-and-co', null, 'Marco Verne']]);
  assert.equal((await fake.unreadCounts()).notifications, 2);
  await fake.markNotificationsRead([items[0].id]);
  assert.equal((await fake.unreadCounts()).notifications, 1);
  await fake.markNotificationsRead('all');
  assert.equal((await fake.unreadCounts()).notifications, 0);
  await fake.deleteNotification(items[1].id);
  assert.equal((await fake.listNotifications()).items.length, 1);
  fake.signInAs(IDS.member);
  assert.equal((await fake.listNotifications()).items.every(n => n.creator?.slug !== 'verne-and-co' || n.type === 'message'), true, 'a reader who does not follow or belong is not notified');
  const page = await fake.listNotifications({limit: 1});
  assert.deepEqual([page.items.length, page.nextCursor !== null], [1, true]);
  assert.equal((await fake.listNotifications({limit: 1, cursor: page.nextCursor})).items.length, 1);
});

test('fake: search matches prefixes of names and titles, published posts only', async () => {
  const fake = createFakeApi();
  assert.deepEqual((await fake.search('vera')).creators.map(c => c.slug), ['casa-verano']);
  assert.deepEqual((await fake.search('linen war')).entries.map(e => e.id), [E.linenWardrobe]);
  assert.equal((await fake.search('linen')).entries[0].creator.slug, 'atelier-solene');
  assert.deepEqual(await fake.search('zzzz'), {creators: [], entries: []});
  assert.deepEqual(await fake.search('   '), {creators: [], entries: []});
  assert.deepEqual((await fake.search('design')).creators.map(c => c.slug), ['casa-verano'], 'the category counts as text');
});

test('fake: sessions, sign-in, sign-up and auth events', async () => {
  const fake = createFakeApi({signedIn: null});
  const events = [];
  const stop = fake.onAuthChange((event, session) => events.push([event, session?.user.email ?? null]));
  await tick();
  assert.equal(await fake.getSession(), null);
  await assert.rejects(fake.loadViewer(), {message: 'Sign in to continue.'});
  await assert.rejects(fake.signIn('member@example.test', 'wrong'), {message: 'That email and password do not match.'});
  await fake.signIn(' Member@Example.test ', 'secret12');
  await tick();
  assert.equal((await fake.getSession()).user.id, IDS.member);
  assert.equal(fake.session.user.email, 'member@example.test');
  assert.equal((await fake.loadViewer()).profile.name, 'Sofia Marchetti');
  await fake.signOut();
  fake.signInAs(IDS.owner);
  await tick();
  assert.deepEqual(events, [['INITIAL_SESSION', null], ['SIGNED_IN', 'member@example.test'], ['SIGNED_OUT', null], ['SIGNED_IN', 'owner@example.test']]);
  stop();
  fake.signInAs(null);
  await tick();
  assert.equal(events.length, 4);
  assert.throws(() => fake.signInAs('nobody'), {message: 'Unknown user nobody'});

  assert.deepEqual(await fake.signUp('New@Example.test', 'secret12', 'Nina Novak'), {confirmed: false});
  await assert.rejects(fake.signUp('new@example.test', 'secret12', 'Again'), {message: 'An account with this email already exists. Sign in instead.'});
  await assert.rejects(fake.signUp('short@example.test', '123', 'Short'), {message: 'Password should be at least 6 characters.'});
  await assert.rejects(fake.signIn('new@example.test', 'secret12'), {message: 'Confirm your email first. Check your inbox for the link.'});
  fake.confirmEmail('new@example.test');
  await fake.signIn('new@example.test', 'secret12');
  const viewer = await fake.loadViewer();
  assert.deepEqual([viewer.profile.name, viewer.settings.onboarded, viewer.following, viewer.myCreator], ['Nina Novak', false, [], null]);
  assert.deepEqual(await createFakeApi({signedIn: null, confirmEmail: false}).signUp('a@b.test', 'secret12', 'A'), {confirmed: true});
});

test('fake: profile, settings, avatar and atelier creation', async () => {
  const fake = createFakeApi({signedIn: IDS.fan3});
  assert.deepEqual((await fake.saveProfile({name: 'Noor H.', website: 'noor.test'})).website, 'https://noor.test');
  assert.deepEqual((await fake.saveSettings({compact: true, notifyPrefs: {like: false}})).notifyPrefs.like, false);
  const profile = await fake.uploadAvatar(new Blob(['x'], {type: 'image/png'}));
  assert.match(profile.avatarUrl, new RegExp(`/avatars/${IDS.fan3}/`));
  assert.equal((await fake.removeAvatar()).avatarUrl, null);
  await assert.rejects(fake.uploadAvatar(new Blob(['x'], {type: 'text/plain'})), {message: 'Use a JPG, PNG, WEBP or GIF image.'});

  assert.equal(await fake.slugAvailable('verne-and-co'), false);
  assert.equal(await fake.slugAvailable('noor-notes'), true);
  const creator = await fake.createAtelier({name: 'Noor Notes', category: 'Writing'});
  assert.deepEqual([creator.slug, creator.ownerId, creator.isShowcase], ['noor-notes', IDS.fan3, false]);
  assert.deepEqual((await fake.listTiers(creator.id)).map(t => [t.id, t.name, t.priceCents]), [['essential', 'Essential', 900], ['premium', 'Premium', 1900], ['signature', 'Signature', 3900]]);
  assert.equal((await fake.createAtelier({name: 'Noor Notes', category: 'Writing'}).catch(e => e.message)), 'You already have an atelier.');
  assert.equal((await fake.loadViewer()).myCreator.id, creator.id);
  const withCover = await fake.uploadCreatorImage(creator.id, 'cover', new Blob(['x'], {type: 'image/webp'}));
  assert.match(withCover.coverUrl, new RegExp(`/covers/${creator.id}/`));
  assert.equal((await fake.removeCreatorImage(creator.id, 'cover')).coverUrl, null);
  const cover = await fake.uploadEntryCover(creator.id, new Blob(['x'], {type: 'image/jpeg'}));
  const id = await fake.saveEntry(null, textValues(), 'draft');
  await fake.setEntryCover(id, cover);
  assert.match((await fake.getEntry(id)).coverUrl, /\/covers\//);
  await fake.setEntryCover(id, null);
  assert.equal((await fake.getEntry(id)).coverUrl, null);
  await assert.rejects(fake.setEntryCover(id, `${IDS.verne}/other.jpg`), {message: 'Invalid cover image.'});
  await fake.recordRead(E.linenWardrobe);
  await fake.recordRead(E.linenWardrobe);
  assert.equal((await fake.getEntry(E.linenWardrobe)).readCount, 1, 'a person is counted once per post');
});

test('fake: reports, exportData and deleteAccount', async () => {
  const fake = createFakeApi();
  await fake.report({targetType: 'comment', targetId: IDS.comments.first, reason: 'spam', details: 'Looks automated'});
  assert.deepEqual([fake.db.reports.length, fake.db.reports[0].reporter_id, fake.db.reports[0].status], [1, IDS.member, 'open']);
  await assert.rejects(fake.report({targetType: 'comment', targetId: 'x', reason: 'spam'}), {message: 'That item cannot be reported.'});

  const data = await fake.exportData();
  assert.deepEqual([data.profile.name, data.follows.length, data.bookmarks.length, data.likes.length, data.memberships.length, data.comments.length, data.messages.length, data.atelier, data.account.email],
    ['Sofia Marchetti', 1, 1, 1, 1, 2, 2, null, 'member@example.test']);

  fake.signInAs(IDS.owner);
  const owner = await fake.exportData();
  assert.deepEqual([owner.atelier.slug, owner.entries.map(e => e.title), owner.notes.length], ['verne-and-co', ['First draft habits', 'An essay still unfinished'], 1]);
  assert.equal(owner.entries[0].body.length > 0, true);
  await fake.deleteAccount();
  assert.equal(fake.session, null);
  assert.equal(await fake.getCreatorBySlug('verne-and-co'), null, 'the atelier goes with the account');
  assert.equal(fake.db.entries.some(e => e.creator_id === IDS.verne), false);
  assert.equal(fake.db.users.some(u => u.id === IDS.owner), false);
  fake.signInAs(IDS.member);
  assert.equal((await fake.inbox()).length, 0, 'threads with the deleted atelier are gone');
});

test('fake: realtime events reach subscribers of the person they concern', async () => {
  const fake = createFakeApi();
  const owner = {notifications: [], messages: []}, member = {notifications: [], messages: []};
  const stopOwner = fake.subscribe(IDS.owner, {onNotification: n => owner.notifications.push(n), onMessage: m => owner.messages.push(m)});
  fake.subscribe(IDS.member, {onNotification: n => member.notifications.push(n), onMessage: m => member.messages.push(m)});
  await fake.sendMessage(IDS.verne, IDS.member, 'member', 'Is there a reading list?');
  assert.deepEqual([owner.messages.length, owner.notifications.map(n => [n.type, n.actor.name])], [1, [['message', 'Sofia Marchetti']]]);
  assert.equal(member.notifications.length, 0);
  assert.equal(member.messages.length, 1, 'the sender\'s own thread also hears the message');
  stopOwner();
  await fake.sendMessage(IDS.verne, IDS.member, 'member', 'Another one');
  assert.equal(owner.messages.length, 1, 'unsubscribed');
  fake.emit(IDS.member, 'notification', {id: 'n-x', user_id: IDS.member, type: 'like', actor_id: IDS.fan1, creator_id: null, entry_id: null, comment_id: null, read_at: null, created_at: '2026-10-07T10:00:00+00:00'});
  assert.deepEqual(member.notifications.map(n => n.type), ['like']);
  assert.throws(() => fake.subscribe('not-an-id'), {message: 'Sign in to receive updates.'});
});

test('fake: calls are logged, failures can be injected, and results are copies', async () => {
  const fake = createFakeApi();
  await fake.feed({limit: 2});
  await fake.getCreator(IDS.solene);
  assert.deepEqual(fake.calls.map(c => c.method), ['feed', 'getCreator']);
  assert.deepEqual(fake.calls[0].args, [{limit: 2}]);
  fake.calls.length = 0;
  fake.fail('feed', 'The feed is down.');
  await assert.rejects(fake.feed(), {message: 'The feed is down.'});
  fake.fail('getCreator', Object.assign(Error('Custom'), {code: 'X1'}));
  await assert.rejects(fake.getCreator(IDS.solene), {code: 'X1'});
  assert.deepEqual(fake.calls.map(c => c.method), ['feed', 'getCreator'], 'failed calls are logged too');
  fake.fail('feed', null);
  fake.fail('getCreator', null);
  assert.equal((await fake.feed()).items.length > 0, true);

  const creator = await fake.getCreator(IDS.solene);
  creator.name = 'Changed by the view';
  assert.equal((await fake.getCreator(IDS.solene)).name, 'Atelier Solene');
  const page = await fake.feed();
  page.items.length = 0;
  assert.equal((await fake.feed()).items.length > 0, true);

  fake.db.likes.push({user_id: IDS.fan1, entry_id: E.tilesOfAlfama, created_at: '2026-10-01T00:00:00+00:00'});
  fake.refresh();
  assert.equal((await fake.getEntry(E.tilesOfAlfama)).likeCount, 1, 'counters follow hand-made edits after refresh()');
  const custom = createFakeApi({db: {follows: []}, signedIn: IDS.fan2});
  assert.deepEqual((await custom.loadViewer()).following, []);
  assert.equal((await custom.getCreator(IDS.solene)).followerCount, 0);
  const guestFake = createFakeApi({signedIn: null});
  assert.equal(guestFake.session, null);
  assert.equal((await guestFake.feed()).items.length, 10);
});

test('fake: public urls and canonical paths look like the real ones', async () => {
  const fake = createFakeApi();
  const [media] = (await fake.media([E.fittingDay]))[E.fittingDay];
  const entry = await fake.getEntry(E.fittingDay);
  assert.match(media.path, CANONICAL);
  assert.match(entry.previewUrl, /^https:\/\/fake\.supabase\.test\/storage\/v1\/object\/public\/previews\//);
  assert.equal(fake.previewUrl(media.previewPath), entry.previewUrl);
  assert.equal(fake.previewUrl('../etc'), null);
});
