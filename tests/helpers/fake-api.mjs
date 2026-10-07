// An in-memory implementation of the complete data-layer contract (docs/ARCHITECTURE.md section 6) for view tests.
//
//   import { createFakeApi, IDS } from './helpers/fake-api.mjs';
//   const fake = createFakeApi();               // signed in as the seeded member
//   const feed = await fake.feed({scope: 'all'});
//
// `fake` has every method of the real api (same names, argument order, result shapes, error messages and `err.code`) plus helpers:
//
//   fake.signInAs(userId, event)   become that user (listeners of onAuthChange hear 'SIGNED_IN', or `event`, e.g. 'PASSWORD_RECOVERY'); null signs out
//   fake.signOut()           become a guest. (The api's own signOut() does the same and is what the app calls.)
//   fake.session             { access_token, user: {id, email} } or null
//   fake.db                  the state, as plain tables named and shaped like the Postgres tables (snake_case rows):
//                            users, profiles, user_settings, creators, tiers, creator_tiers, entries, entry_bodies, entry_media, follows,
//                            bookmarks, likes, memberships, comments, messages, circle_notes, notifications, reports, entry_reads, storage.
//                            Tests may read and edit it freely; counters (follower_count, like_count, ...) are recomputed after every write.
//   fake.calls               log of every api call: [{method, args}] (helpers are not logged). `fake.calls.length = 0` clears it.
//   fake.fail(method, error) make every call of `method` reject with `error` (an Error or a message) until fake.fail(method, null) clears it.
//   fake.confirmEmail(email) confirms a pending sign-up (createFakeApi({confirmEmail: true}), the default, makes signUp wait for the email link;
//                            with false, signUp signs the new user in at once and resolves {confirmed: true}).
//   fake.emit(userId, 'notification'|'message', row)   push a realtime event (a table row) to the subscribe() listeners it concerns.
//   fake.refresh()           recompute counters and media metadata after editing fake.db by hand.
//   IDS                      the ids of the seed (users, ateliers, entries, ...), all real, lowercase uuids.
//
// The seed (`buildSeed()`), a small world that has every case a view cares about:
//   users     IDS.member  (Sofia Marchetti, signed in by default; follows Casa Verano; essential member of Atelier Solene)
//             IDS.owner   (Marco Verne, owns "Verne & Co", the only atelier with an owner)   IDS.fan1..fan3  (readers; password 'secret12')
//   ateliers  Atelier Solene and Casa Verano are showcase ateliers (no owner, not messageable); Verne & Co is owned by IDS.owner.
//   entries   text, image and video posts at public / essential / premium / signature levels (see IDS.entries); Verne & Co also has a draft.
//             The access ladder is public < essential < premium < signature: a member reads posts at or below their tier.
//   Sign-in: member@example.test / owner@example.test / fan1..3@example.test, all with the password 'secret12'.
//
// Server rules mirrored (so views can rely on them): the access ladder for bodies, media rows, signed links and comments; drafts are
// visible to their owner only; writes are owner-only (a non-owner's update or delete is silently a no-op, as with row level security);
// showcase ateliers cannot be messaged, creators reply only in threads a member started; comments are one level deep (a reply to a reply
// attaches to the top comment); counters (followers, members, entries, likes, comments, reads); notifications are produced as the
// database triggers do (new post to followers and members, comment, reply, like, follow, membership, message, note) and honour
// notifyPrefs; list cursors are ISO timestamps (popular feed: "<likes>|<timestamp>"); save_entry's validation and publish rules.
// Not simulated: rate limits, the 500 MB quota, realtime delivery delay. Media files are never stored, only their rows and paths.
//
// Every result is a deep copy, so a view can never change the fake's state by mutating what it received.

import { LEVELS, TIER_IDS, NOT_SIGNED_IN, BAD_IDS, CANCELLED, REFUSED, COVER_IMAGE, DEFAULT_NOTIFY_PREFS, UUID, SLUG, createMappers, clampLimit, cursorTime, pageOf, mapPage, popularCursor, parsePopularCursor,
  isUuid, unique, slugify, validateImage, cleanProfile, cleanAtelier, cleanTier, cleanComment, cleanMessage, cleanNote, cleanReport } from '../../src/api/util.js';

export const PUBLIC_BASE = 'https://fake.supabase.test/storage/v1/object/public';
const PERMISSION = 'You do not have permission to do that.';
const NOT_FOUND = 'That could not be found, or you do not have permission to change it.';
const ALREADY_REGISTERED = 'An account with this email already exists. Sign in instead.';
const PASSWORD = 'secret12';
const FEED_CREATOR_LIMIT = 200;
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Ids ---------------------------------------------------------------------------------
// Real uuid shapes (the api validates them): the first digit says what the row is.
const uid = (kind, n) => `${kind}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const IDS = {
  member: uid(1, 1), owner: uid(1, 2), fan1: uid(1, 3), fan2: uid(1, 4), fan3: uid(1, 5),
  solene: uid(2, 1), verano: uid(2, 2), verne: uid(2, 3),
  entries: {
    linenWardrobe: uid(3, 1), fittingDay: uid(3, 2), tailorsLedger: uid(3, 3), cuttingRoom: uid(3, 4), patternArchive: uid(3, 5),
    tilesOfAlfama: uid(3, 6), sketchbook: uid(3, 7), workshopTour: uid(3, 8), joineryNotes: uid(3, 9),
    firstDraftHabits: uid(3, 10), unfinishedEssay: uid(3, 11)
  },
  comments: {first: uid(5, 1), reply: uid(5, 2), onVerne: uid(5, 3)},
  messages: {hello: uid(6, 1), answer: uid(6, 2)},
  notes: {welcome: uid(7, 1)}
};
const E = IDS.entries;

// Seed ----------------------------------------------------------------------------------
const LADDER = [
  {id: 'essential', name: 'Essential', price: 9, level: 1, description: 'A closer look at the work.', features: ['All circle entries', 'The complete entry archive', 'Members’ conversation']},
  {id: 'premium', name: 'Premium', price: 19, level: 2, description: 'More context. More connection.', features: ['Everything in Essential', 'In-depth studio notes', 'Priority conversation prompts']},
  {id: 'signature', name: 'Signature', price: 39, level: 3, description: 'Inside the creative process.', features: ['Everything in Premium', 'Signature reference collections', 'Private workshop notes']}
];

const body = (...paragraphs) => paragraphs.join('\n\n');
const LONG_TEXT = body('A longer paragraph that stands in for the opening of the piece, long enough to read like writing.', 'A second paragraph with a little more detail, so excerpts and reading time have something to work with.');

// [key, creator, title, subtitle, kind, format, access, status, publishedAt, category, minutes]
const ENTRY_ROWS = [
  [E.linenWardrobe, IDS.solene, 'Notes on a linen wardrobe', 'What lasts a summer, and what lasts ten.', 'text', 'Essay', 'public', 'published', '2026-09-28T08:00:00+00:00', 'Style'],
  [E.fittingDay, IDS.solene, 'Fitting day', 'Three coats, one afternoon.', 'image', 'Gallery', 'public', 'published', '2026-09-26T10:30:00+00:00', 'Style'],
  [E.tailorsLedger, IDS.solene, 'The tailor’s ledger', 'Measurements, margins and a few corrections.', 'text', 'Essay', 'essential', 'published', '2026-09-24T09:15:00+00:00', 'Style'],
  [E.cuttingRoom, IDS.solene, 'Inside the cutting room', 'A film from the table where patterns begin.', 'video', 'Film', 'premium', 'published', '2026-09-22T14:00:00+00:00', 'Style'],
  [E.patternArchive, IDS.solene, 'The pattern archive', 'Forty years of paper, catalogued.', 'text', 'Collection', 'signature', 'published', '2026-09-20T11:45:00+00:00', 'Style'],
  [E.tilesOfAlfama, IDS.verano, 'Tiles of Alfama', 'Reading a neighbourhood from its walls.', 'text', 'Field note', 'public', 'published', '2026-09-27T07:30:00+00:00', 'Design'],
  [E.sketchbook, IDS.verano, 'Sketchbook, September', 'Quick studies of rooms in good light.', 'image', 'Gallery', 'essential', 'published', '2026-09-25T16:20:00+00:00', 'Design'],
  [E.workshopTour, IDS.verano, 'A tour of the workshop', 'Where the joinery gets done.', 'video', 'Film', 'public', 'published', '2026-09-23T12:10:00+00:00', 'Design'],
  [E.joineryNotes, IDS.verano, 'Notes on joinery', 'The joints we hide and the ones we show.', 'text', 'Studio note', 'premium', 'published', '2026-09-21T08:40:00+00:00', 'Design'],
  [E.firstDraftHabits, IDS.verne, 'First draft habits', 'Small rules for getting a page started.', 'text', 'Essay', 'public', 'published', '2026-09-29T09:00:00+00:00', 'Writing'],
  [E.unfinishedEssay, IDS.verne, 'An essay still unfinished', 'Kept as a draft until it earns its ending.', 'text', 'Essay', 'essential', 'draft', null, 'Writing']
];
// [entry, kind, count, duration]
const MEDIA_ROWS = [[E.fittingDay, 'image', 2, null], [E.cuttingRoom, 'video', 1, 94], [E.sketchbook, 'image', 3, null], [E.workshopTour, 'video', 1, 215]];

export function buildSeed() {
  const creatorOf = id => ENTRY_ROWS.find(row => row[0] === id)[1];
  const profile = (id, name, bio = '') => ({id, display_name: name, bio, website: '', avatar_path: null, created_at: '2026-06-01T09:00:00+00:00', updated_at: '2026-06-01T09:00:00+00:00'});
  const user = (id, email, confirmed = true) => ({id, email, password: PASSWORD, confirmed});
  const settings = (userId, onboarded = true) => ({user_id: userId, compact: false, welcome_dismissed: false, onboarded, notify_prefs: {...DEFAULT_NOTIFY_PREFS}});
  const creator = (id, slug, name, category, descriptor, location, image, bio, owner, showcase, created) => ({id, owner_id: owner, slug, name, category, descriptor, location, image, bio, avatar_path: null, cover_path: null,
    links: owner ? [{label: 'Newsletter', url: 'https://example.test/verne'}] : [], is_showcase: showcase, follower_count: 0, member_count: 0, entry_count: 0, created_at: created, updated_at: created});
  const tiers = (creatorId, names) => LADDER.map((t, i) => ({creator_id: creatorId, tier_id: t.id, name: names[i], price_cents: t.price * 100, currency: 'EUR', description: t.description, perks: [...t.features], enabled: true, updated_at: '2026-06-01T09:00:00+00:00'}));

  const entries = ENTRY_ROWS.map(([id, creator_id, title, subtitle, kind, format, access, status, publishedAt, category]) => ({
    id, creator_id, kind, title, subtitle, excerpt: kind === 'text' ? LONG_TEXT.split('\n\n')[0] : '', category, format, image: 'atelier', access, status, minutes: 2,
    media_count: 0, preview_path: null, duration_seconds: null, cover_path: null, like_count: 0, comment_count: 0, read_count: 0,
    published_at: publishedAt, created_at: publishedAt ?? '2026-10-01T09:00:00+00:00', updated_at: publishedAt ?? '2026-10-01T09:00:00+00:00'}));
  const bodies = ENTRY_ROWS.map(([id, , , , kind]) => ({entry_id: id, body: kind === 'text' ? LONG_TEXT : 'A short caption for this post.'}));

  const media = [];
  let n = 0;
  for (const [entry, kind, count, duration] of MEDIA_ROWS) {
    for (let position = 0; position < count; position++) {
      const base = `${creatorOf(entry)}/${entry}/${uid(4, ++n)}`;
      const ext = kind === 'video' ? 'mp4' : 'webp';
      media.push({id: uid(4, n), entry_id: entry, kind, path: `${base}.${ext}`, poster_path: `${base}-poster.${kind === 'video' ? 'jpg' : 'webp'}`, preview_path: `${base}.webp`,
        mime: kind === 'video' ? 'video/mp4' : 'image/webp', size_bytes: kind === 'video' ? 4_000_000 : 180_000, width: 1600, height: 1000, duration_seconds: duration, alt: kind === 'image' ? `Photograph ${position + 1}` : '',
        position, created_at: `2026-09-01T10:0${position}:00+00:00`});
    }
  }

  const db = {
    users: [user(IDS.member, 'member@example.test'), user(IDS.owner, 'owner@example.test'), user(IDS.fan1, 'fan1@example.test'), user(IDS.fan2, 'fan2@example.test'), user(IDS.fan3, 'fan3@example.test')],
    profiles: [profile(IDS.member, 'Sofia Marchetti', 'Reads slowly.'), profile(IDS.owner, 'Marco Verne', 'Writes about starting.'), profile(IDS.fan1, 'Ada Lindgren'), profile(IDS.fan2, 'Tomas Reyes'), profile(IDS.fan3, 'Noor Haddad')],
    user_settings: [settings(IDS.member), settings(IDS.owner), settings(IDS.fan1), settings(IDS.fan2), settings(IDS.fan3)],
    tiers: LADDER.map(({id, name, price, level, description, features}) => ({id, name, price, level, description, features})),
    creators: [
      creator(IDS.solene, 'atelier-solene', 'Atelier Solene', 'Style', 'Tailoring & wardrobe', 'Lyon, France', 'atelier', 'Considered clothes, patiently made. A showcase atelier of REFLUENZ.', null, true, '2026-06-02T09:00:00+00:00'),
      creator(IDS.verano, 'casa-verano', 'Casa Verano', 'Design', 'Interiors & joinery', 'Lisbon, Portugal', 'architecture', 'Rooms, light and the joints between things. A showcase atelier of REFLUENZ.', null, true, '2026-06-03T09:00:00+00:00'),
      creator(IDS.verne, 'verne-and-co', 'Verne & Co', 'Writing', 'Essays on getting started', 'Turin, Italy', 'ritual', 'Short essays and small rules for writers.', IDS.owner, false, '2026-07-10T09:00:00+00:00')
    ],
    creator_tiers: [...tiers(IDS.solene, ['Friend', 'Patron', 'Atelier']), ...tiers(IDS.verano, ['Visitor', 'Regular', 'Resident']), ...tiers(IDS.verne, ['Reader', 'Supporter', 'Inner circle'])],
    entries, entry_bodies: bodies, entry_media: media,
    follows: [{user_id: IDS.member, creator_id: IDS.verano, created_at: '2026-08-01T09:00:00+00:00'}, {user_id: IDS.fan2, creator_id: IDS.solene, created_at: '2026-08-02T09:00:00+00:00'}, {user_id: IDS.fan1, creator_id: IDS.verne, created_at: '2026-08-03T09:00:00+00:00'}],
    bookmarks: [{user_id: IDS.member, entry_id: E.linenWardrobe, created_at: '2026-09-29T09:00:00+00:00'}],
    likes: [[IDS.member, E.fittingDay], [IDS.fan1, E.fittingDay], [IDS.fan2, E.fittingDay], [IDS.fan3, E.fittingDay], [IDS.fan1, E.linenWardrobe], [IDS.fan2, E.workshopTour], [IDS.fan3, E.workshopTour]]
      .map(([user_id, entry_id]) => ({user_id, entry_id, created_at: '2026-09-30T09:00:00+00:00'})),
    memberships: [{user_id: IDS.member, creator_id: IDS.solene, tier: 'essential', created_at: '2026-08-05T09:00:00+00:00', updated_at: '2026-08-05T09:00:00+00:00'},
      {user_id: IDS.fan1, creator_id: IDS.solene, tier: 'premium', created_at: '2026-08-06T09:00:00+00:00', updated_at: '2026-08-06T09:00:00+00:00'}],
    comments: [
      {id: IDS.comments.first, entry_id: E.linenWardrobe, author_id: IDS.fan1, parent_id: null, body: 'The part about washing linen twice has changed how I buy it.', created_at: '2026-09-28T12:00:00+00:00', edited_at: null},
      {id: IDS.comments.reply, entry_id: E.linenWardrobe, author_id: IDS.member, parent_id: IDS.comments.first, body: 'Same here. The second wash is the one that matters.', created_at: '2026-09-28T13:00:00+00:00', edited_at: null},
      {id: IDS.comments.onVerne, entry_id: E.firstDraftHabits, author_id: IDS.member, parent_id: null, body: 'Rule three is the one I keep forgetting.', created_at: '2026-09-29T11:00:00+00:00', edited_at: null}
    ],
    messages: [
      {id: IDS.messages.hello, creator_id: IDS.verne, member_id: IDS.member, sender: 'member', body: 'Hello, is the next essay about endings?', created_at: '2026-09-30T08:00:00+00:00', read_at: '2026-09-30T08:30:00+00:00'},
      {id: IDS.messages.answer, creator_id: IDS.verne, member_id: IDS.member, sender: 'creator', body: 'Yes, and about leaving them open.', created_at: '2026-09-30T09:00:00+00:00', read_at: null}
    ],
    circle_notes: [{id: IDS.notes.welcome, creator_id: IDS.verne, body: 'Welcome to the circle. New essays arrive on Mondays.', created_at: '2026-08-10T09:00:00+00:00'}],
    notifications: [
      {id: uid(8, 1), user_id: IDS.member, type: 'new_entry', actor_id: null, creator_id: IDS.solene, entry_id: E.linenWardrobe, comment_id: null, read_at: '2026-09-28T10:00:00+00:00', created_at: '2026-09-28T08:00:00+00:00'},
      {id: uid(8, 2), user_id: IDS.member, type: 'message', actor_id: IDS.owner, creator_id: IDS.verne, entry_id: null, comment_id: null, read_at: null, created_at: '2026-09-30T09:00:00+00:00'},
      {id: uid(8, 3), user_id: IDS.owner, type: 'comment', actor_id: IDS.member, creator_id: IDS.verne, entry_id: E.firstDraftHabits, comment_id: IDS.comments.onVerne, read_at: null, created_at: '2026-09-29T11:00:00+00:00'},
      {id: uid(8, 4), user_id: IDS.owner, type: 'follow', actor_id: IDS.fan1, creator_id: IDS.verne, entry_id: null, comment_id: null, read_at: '2026-08-04T09:00:00+00:00', created_at: '2026-08-03T09:00:00+00:00'}
    ],
    reports: [], entry_reads: [],
    storage: {'entry-media': [], previews: [], covers: [], avatars: []}
  };
  for (const m of media) { db.storage['entry-media'].push(m.path, m.poster_path); db.storage.previews.push(m.preview_path); }
  syncAll(db);
  return db;
}

// Triggers: media metadata on entries, and the counters. Run over the whole state, so it is also safe after a test edits `fake.db`.
function syncEntry(db, entry) {
  const rows = db.entry_media.filter(m => m.entry_id === entry.id).sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
  entry.media_count = rows.length;
  entry.preview_path = entry.kind === 'text' ? null : rows[0]?.preview_path ?? null;
  entry.duration_seconds = entry.kind === 'video' ? [...rows].reverse().find(m => m.kind === 'video')?.duration_seconds ?? null : null;
}
function syncAll(db) {
  for (const e of db.entries) syncEntry(db, e);
  for (const c of db.creators) {
    c.follower_count = db.follows.filter(f => f.creator_id === c.id).length;
    c.member_count = db.memberships.filter(m => m.creator_id === c.id).length;
    c.entry_count = db.entries.filter(e => e.creator_id === c.id && e.status === 'published').length;
  }
  for (const e of db.entries) {
    e.like_count = db.likes.filter(l => l.entry_id === e.id).length;
    e.comment_count = db.comments.filter(x => x.entry_id === e.id).length;
  }
}

// The api ---------------------------------------------------------------------------------
export function createFakeApi({signedIn = IDS.member, confirmEmail = true, db: overrides} = {}) {
  const db = Object.assign(buildSeed(), overrides);
  syncAll(db);
  const calls = [];
  const failures = new Map();
  const authListeners = new Set();
  const live = new Set();
  let userId = signedIn;
  let clock = Date.parse('2026-10-07T09:00:00.000Z');
  let counter = 1000;
  let signed = 0;

  const stamp = () => new Date(clock += 60_000).toISOString();
  const newId = kind => uid(kind, ++counter);
  const map = createMappers({storage: {from: bucket => ({getPublicUrl: path => ({data: {publicUrl: `${PUBLIC_BASE}/${bucket}/${path}`}})})}});
  const rule = message => Object.assign(Error(message), {code: 'P0001'});   // what database triggers raise: shown as written
  const time = value => Date.parse(value);

  // Lookups ---------------------------------------------------------------------------
  const me = () => userId;
  const needUser = () => { if (!userId) throw Error(NOT_SIGNED_IN); return userId; };
  const creatorRow = id => db.creators.find(c => c.id === id) ?? null;
  const ownedCreator = user => (user ? db.creators.find(c => c.owner_id === user) ?? null : null);
  const entryRow = id => db.entries.find(e => e.id === id) ?? null;
  const profileRow = id => db.profiles.find(p => p.id === id) ?? null;
  const level = tier => LEVELS[tier] ?? 0;
  const membershipOf = (user, creatorId) => db.memberships.find(m => m.user_id === user && m.creator_id === creatorId) ?? null;
  const owns = (user, creatorId) => Boolean(user) && creatorRow(creatorId)?.owner_id === user;
  const ownsEntry = (user, entry) => Boolean(entry) && owns(user, entry.creator_id);
  // can_read_entry: the owner always; everyone else only published posts at or below their tier.
  const canRead = (entry, user = me()) => {
    if (!entry) return false;
    if (ownsEntry(user, entry)) return true;
    if (entry.status !== 'published') return false;
    return entry.access === 'public' || (Boolean(user) && level(membershipOf(user, entry.creator_id)?.tier) >= level(entry.access));
  };
  const visible = entry => entry.status === 'published' || ownsEntry(me(), entry);   // the select policy of entries
  const circleIds = () => unique([...db.follows.filter(f => f.user_id === me()).map(f => f.creator_id), ...db.memberships.filter(m => m.user_id === me()).map(m => m.creator_id)]);
  const tierRows = creatorId => db.creator_tiers.filter(t => t.creator_id === creatorId).map(t => ({...t, tier: {level: level(t.tier_id)}}));
  const creatorWithTiers = creatorId => ({...creatorRow(creatorId), creator_tiers: tierRows(creatorId)});
  const personRow = id => { const p = profileRow(id); return p ? {id: p.id, display_name: p.display_name, avatar_path: p.avatar_path} : {id, display_name: 'Member', avatar_path: null}; };

  const toEntry = row => map.entry({...row, creator: creatorRow(row.creator_id)});
  const toTier = row => map.tier({...row, tier: {level: level(row.tier_id)}});
  const toMembership = row => map.membership({...row, creator: creatorWithTiers(row.creator_id)});
  const toComment = row => map.comment({...row, author: personRow(row.author_id)});
  const toNotification = row => map.notification({...row, actor: row.actor_id ? personRow(row.actor_id) : null,
    creator: creatorRow(row.creator_id) && (({id, slug, name}) => ({id, slug, name}))(creatorRow(row.creator_id)),
    entry: row.entry_id && entryRow(row.entry_id) ? {id: row.entry_id, title: entryRow(row.entry_id).title} : null});
  const toThreadMessage = row => map.message(row);

  // A page of rows, newest first by `column`, with the same cursor rules as the real queries.
  function paginate(rows, {column, cursor, limit}, toItem) {
    const size = clampLimit(limit, 12);
    const at = cursorTime(cursor);
    const sorted = rows.filter(r => !at || time(r[column]) < time(at)).sort((a, b) => time(b[column]) - time(a[column])).slice(0, size + 1);
    return mapPage(pageOf(sorted, size, r => r[column]), toItem);
  }

  // Triggers ----------------------------------------------------------------------------------
  const refresh = () => syncAll(db);
  function notify(user, type, actor, creatorId, entryId, commentId) {
    if (!user || user === actor) return;
    const prefs = db.user_settings.find(s => s.user_id === user)?.notify_prefs;
    if (prefs && prefs[type] === false) return;
    const row = {id: newId(8), user_id: user, type, actor_id: actor ?? null, creator_id: creatorId ?? null, entry_id: entryId ?? null, comment_id: commentId ?? null, read_at: null, created_at: stamp()};
    db.notifications.push(row);
    emit(user, 'notification', row);
  }
  function notifyCircle(creatorId, type, entryId) {
    const owner = creatorRow(creatorId)?.owner_id ?? null;
    const readers = unique([...db.follows.filter(f => f.creator_id === creatorId).map(f => f.user_id), ...db.memberships.filter(m => m.creator_id === creatorId).map(m => m.user_id)]);
    for (const user of readers) if (user !== owner) notify(user, type, owner, creatorId, entryId, null);
  }
  function emit(user, kind, row) {
    for (const listener of live) {
      if (listener.userId !== user && kind === 'notification') continue;
      if (kind === 'message' && listener.userId !== row.member_id && listener.userId !== creatorRow(row.creator_id)?.owner_id) continue;
      if (kind === 'notification') listener.onNotification?.(toNotification(row));
      else listener.onMessage?.(toThreadMessage(row));
    }
  }
  // Removes an entry's rows the way the cascades do.
  function cascadeEntry(entryId) {
    const commentIds = new Set(db.comments.filter(c => c.entry_id === entryId).map(c => c.id));
    for (const media of db.entry_media.filter(m => m.entry_id === entryId)) forgetFiles(media);
    db.entries = db.entries.filter(e => e.id !== entryId);
    for (const table of ['entry_bodies', 'entry_media', 'comments', 'likes', 'bookmarks', 'entry_reads']) db[table] = db[table].filter(r => r.entry_id !== entryId);
    db.notifications = db.notifications.filter(n => n.entry_id !== entryId && !commentIds.has(n.comment_id));
  }
  function forgetFiles(media) {
    db.storage['entry-media'] = db.storage['entry-media'].filter(p => p !== media.path && p !== media.poster_path);
    db.storage.previews = db.storage.previews.filter(p => p !== media.preview_path);
  }
  function removeCreator(creatorId) {
    for (const entry of db.entries.filter(e => e.creator_id === creatorId)) cascadeEntry(entry.id);
    db.creators = db.creators.filter(c => c.id !== creatorId);
    for (const table of ['creator_tiers', 'follows', 'memberships', 'messages', 'circle_notes', 'notifications']) db[table] = db[table].filter(r => r.creator_id !== creatorId);
  }

  // Auth ---------------------------------------------------------------------------------------
  const currentSession = () => {
    const user = userId && db.users.find(u => u.id === userId);
    return user ? {access_token: 'fake-access-token', user: {id: user.id, email: user.email}} : null;
  };
  function setUser(next, event) {
    userId = next;
    const session = currentSession();   // the session of this moment, not of whenever the callback runs
    for (const listener of [...authListeners]) setTimeout(() => { if (authListeners.has(listener)) listener(event, session); }, 0);   // like supabase-js, nothing arrives after unsubscribing
  }

  // The api -------------------------------------------------------------------------------------
  const api = {
    // auth
    async getSession() { return currentSession(); },
    onAuthChange(fn) {
      authListeners.add(fn);
      setTimeout(() => { if (authListeners.has(fn)) fn('INITIAL_SESSION', currentSession()); }, 0);
      return () => authListeners.delete(fn);
    },
    async signIn(email, password) {
      const user = db.users.find(u => u.email === String(email).trim().toLowerCase());
      if (!user || user.password !== password) throw Error('That email and password do not match.');
      if (!user.confirmed) throw Error('Confirm your email first. Check your inbox for the link.');
      setUser(user.id, 'SIGNED_IN');
    },
    async signUp(email, password, name) {
      const address = String(email).trim().toLowerCase();
      if (db.users.some(u => u.email === address)) throw Error(ALREADY_REGISTERED);
      if (String(password).length < 6) throw Error('Password should be at least 6 characters.');
      const id = newId(1);
      db.users.push({id, email: address, password, confirmed: !confirmEmail});
      db.profiles.push({id, display_name: String(name || address.split('@')[0]).trim().slice(0, 60) || 'Member', bio: '', website: '', avatar_path: null, created_at: stamp(), updated_at: stamp()});
      db.user_settings.push({user_id: id, compact: false, welcome_dismissed: false, onboarded: false, notify_prefs: {...DEFAULT_NOTIFY_PREFS}});
      if (!confirmEmail) setUser(id, 'SIGNED_IN');
      return {confirmed: !confirmEmail};
    },
    async resendConfirmation(email) { if (!db.users.some(u => u.email === String(email).trim().toLowerCase())) return; },
    async resetPassword() {},
    async updatePassword(password) {
      const user = db.users.find(u => u.id === needUser());
      if (String(password).length < 6) throw Error('Password should be at least 6 characters.');
      user.password = password;
    },
    async updateEmail(email) { db.users.find(u => u.id === needUser()).email = String(email).trim().toLowerCase(); },
    async signOut() { setUser(null, 'SIGNED_OUT'); },

    // viewer
    async loadViewer() {
      const user = needUser();
      const settings = db.user_settings.find(s => s.user_id === user);
      const own = ownedCreator(user);
      return {
        profile: map.profile(profileRow(user)), settings: map.settings(settings), myCreator: own ? map.creator(own) : null,
        tiers: db.tiers.map(t => ({id: t.id, level: t.level, name: t.name})),
        following: db.follows.filter(f => f.user_id === user).map(f => f.creator_id),
        saved: db.bookmarks.filter(b => b.user_id === user).map(b => b.entry_id),
        liked: db.likes.filter(l => l.user_id === user).map(l => l.entry_id),
        memberships: db.memberships.filter(m => m.user_id === user).sort((a, b) => time(b.created_at) - time(a.created_at)).map(toMembership)
      };
    },
    async saveProfile(values) {
      const clean = cleanProfile(values), row = profileRow(needUser());
      if (clean.name !== undefined) row.display_name = clean.name;
      if (clean.bio !== undefined) row.bio = clean.bio;
      if (clean.website !== undefined) row.website = clean.website;
      row.updated_at = stamp();
      return map.profile(row);
    },
    async saveSettings(partial = {}) {
      const row = db.user_settings.find(s => s.user_id === needUser());
      if (partial.compact !== undefined) row.compact = Boolean(partial.compact);
      if (partial.welcomeDismissed !== undefined) row.welcome_dismissed = Boolean(partial.welcomeDismissed);
      if (partial.onboarded !== undefined) row.onboarded = Boolean(partial.onboarded);
      if (partial.notifyPrefs !== undefined) row.notify_prefs = {...row.notify_prefs, ...partial.notifyPrefs};
      return map.settings(row);
    },
    async uploadAvatar(blob) {
      const user = needUser(), row = profileRow(user);
      validateImage(blob, {types: AVATAR_TYPES, maxBytes: 5 * 1024 * 1024});
      const path = `${user}/${newId('a')}.${blob.type.split('/')[1]}`;
      db.storage.avatars = db.storage.avatars.filter(p => p !== row.avatar_path).concat(path);
      row.avatar_path = path;
      return map.profile(row);
    },
    async removeAvatar() {
      const row = profileRow(needUser());
      db.storage.avatars = db.storage.avatars.filter(p => p !== row.avatar_path);
      row.avatar_path = null;
      return map.profile(row);
    },

    // creators
    async listCreators({category, sort = 'popular', limit, offset = 0} = {}) {
      let rows = db.creators.filter(c => !category || c.category === category);
      rows = sort === 'new' ? rows.sort((a, b) => time(b.created_at) - time(a.created_at)) : rows.sort((a, b) => b.follower_count - a.follower_count || time(b.created_at) - time(a.created_at));
      const from = Math.max(0, Math.trunc(Number(offset)) || 0);
      return rows.slice(from, from + clampLimit(limit)).map(map.creator);
    },
    async suggestedCreators(limit = 6) {
      const known = new Set(me() ? circleIds() : []);
      return db.creators.filter(c => !known.has(c.id) && !(me() && c.owner_id === me())).sort((a, b) => b.follower_count - a.follower_count || time(b.created_at) - time(a.created_at))
        .slice(0, clampLimit(limit, 6)).map(map.creator);
    },
    async getCreatorBySlug(slug) {
      const clean = String(slug ?? '').trim().toLowerCase();
      const row = SLUG.test(clean) ? db.creators.find(c => c.slug === clean) : null;
      return row ? {creator: map.creator(row), tiers: map.tiers(tierRows(row.id))} : null;
    },
    async getCreator(id) { return isUuid(id) && creatorRow(String(id).toLowerCase()) ? map.creator(creatorRow(String(id).toLowerCase())) : null; },
    async createAtelier(values = {}) {
      const user = needUser();
      const clean = cleanAtelier(values);
      if (clean.name === undefined) throw Error('Give your atelier a name.');
      if (clean.category === undefined) throw Error('Choose a category.');
      if (ownedCreator(user)) throw Error('You already have an atelier.');
      const base = clean.slug ?? (slugify(clean.name).length >= 2 ? slugify(clean.name) : 'atelier');
      let slug = base;
      for (let n = 2; db.creators.some(c => c.slug === slug); n++) {
        if (clean.slug !== undefined) throw Error('That atelier address is taken. Try another name.');
        slug = `${base.slice(0, 35)}-${n}`;
      }
      const at = stamp();
      const row = {id: newId(2), owner_id: user, slug, name: clean.name, category: clean.category, descriptor: clean.descriptor ?? '', location: clean.location ?? '', image: clean.image ?? 'atelier', bio: clean.bio ?? '',
        avatar_path: null, cover_path: null, links: clean.links ?? [], is_showcase: false, follower_count: 0, member_count: 0, entry_count: 0, created_at: at, updated_at: at};
      db.creators.push(row);
      for (const t of db.tiers) db.creator_tiers.push({creator_id: row.id, tier_id: t.id, name: t.name, price_cents: t.price * 100, currency: 'EUR', description: t.description, perks: [...t.features], enabled: true, updated_at: at});
      return map.creator(row);
    },
    async updateAtelier(id, values = {}) {
      const clean = cleanAtelier(values), row = creatorRow(id);
      if (!row || row.owner_id !== needUser()) throw Error(NOT_FOUND);
      if (clean.slug !== undefined && db.creators.some(c => c.slug === clean.slug && c.id !== id)) throw Error('That atelier address is taken. Try another name.');
      Object.assign(row, clean, {updated_at: stamp()});
      return map.creator(row);
    },
    async slugAvailable(slug) {
      const clean = String(slug ?? '').trim().toLowerCase();
      return SLUG.test(clean) && !db.creators.some(c => c.slug === clean);
    },
    async uploadCreatorImage(creatorId, kind, blob) {
      const column = {avatar: 'avatar_path', cover: 'cover_path'}[kind];
      if (!column) throw Error('Choose the avatar or the cover.');
      validateImage(blob, COVER_IMAGE);
      const row = creatorRow(creatorId);
      if (!row || row.owner_id !== needUser()) throw Error(PERMISSION);
      const path = `${creatorId}/${newId('a')}.${blob.type.split('/')[1]}`;
      db.storage.covers = db.storage.covers.filter(p => p !== row[column]).concat(path);
      row[column] = path;
      return map.creator(row);
    },
    async removeCreatorImage(creatorId, kind) {
      const column = {avatar: 'avatar_path', cover: 'cover_path'}[kind];
      if (!column) throw Error('Choose the avatar or the cover.');
      const row = creatorRow(creatorId);
      if (!row || row.owner_id !== needUser()) throw Error(NOT_FOUND);
      db.storage.covers = db.storage.covers.filter(p => p !== row[column]);
      row[column] = null;
      return map.creator(row);
    },

    // tiers
    async listTiers(creatorId) { return map.tiers(tierRows(creatorId)); },
    async updateTier(creatorId, tierId, values = {}) {
      if (!TIER_IDS.includes(tierId)) throw Error('Choose Essential, Premium or Signature.');
      const clean = cleanTier(values);
      const row = db.creator_tiers.find(t => t.creator_id === creatorId && t.tier_id === tierId);
      if (!row || !owns(needUser(), creatorId)) throw Error(NOT_FOUND);
      if (clean.enabled === false && !db.creator_tiers.some(t => t.creator_id === creatorId && t.tier_id !== tierId && t.enabled)) throw rule('Keep at least one membership tier open.');
      const {priceCents, ...rest} = clean;
      Object.assign(row, rest, priceCents !== undefined ? {price_cents: priceCents} : {}, {updated_at: stamp()});
      return toTier(row);
    },

    // entries
    async feed({scope = 'all', category, kind, sort = 'new', cursor, limit, creatorIds} = {}) {
      const size = clampLimit(limit);
      let rows = db.entries.filter(e => e.status === 'published');
      if (scope === 'following') {
        const ids = unique(creatorIds ?? (me() ? circleIds() : [])).slice(0, FEED_CREATOR_LIMIT);
        rows = rows.filter(e => ids.includes(e.creator_id));
      }
      if (category) rows = rows.filter(e => e.category === category);
      if (['text', 'image', 'video'].includes(kind)) rows = rows.filter(e => e.kind === kind);
      if (sort !== 'popular') return paginate(rows, {column: 'published_at', cursor, limit: size}, toEntry);
      const at = parsePopularCursor(cursor);
      const sorted = rows.filter(r => !at || r.like_count < at.count || (r.like_count === at.count && time(r.published_at) < time(at.time)))
        .sort((a, b) => b.like_count - a.like_count || time(b.published_at) - time(a.published_at)).slice(0, size + 1);
      return mapPage(pageOf(sorted, size, popularCursor), toEntry);
    },
    async creatorEntries(creatorId, {status = 'published', kind, cursor, limit} = {}) {
      const draft = status === 'draft';
      const rows = db.entries.filter(e => e.creator_id === creatorId && e.status === (draft ? 'draft' : 'published') && visible(e) && (!kind || e.kind === kind));
      return paginate(rows, {column: draft ? 'updated_at' : 'published_at', cursor, limit}, map.entry);
    },
    async getEntry(id) { const row = entryRow(id); return row && visible(row) ? toEntry(row) : null; },
    async getBody(id) {
      const row = entryRow(id);
      return row && canRead(row) ? db.entry_bodies.find(b => b.entry_id === id)?.body ?? null : null;
    },
    async saveEntry(id, values, status) {
      const user = me();
      if (!user) throw Error(PERMISSION);
      const creator = ownedCreator(user);
      if (!creator) throw rule('Open your atelier before writing an entry.');
      const kind = values.kind || 'text';
      const text = String(values.body ?? '').trim();
      if (!['text', 'image', 'video'].includes(kind)) throw rule('Choose a post type.');
      if (String(values.title ?? '').trim().length < 3 || String(values.title).trim().length > 100) throw rule('Use a title between 3 and 100 characters.');
      if (String(values.subtitle ?? '').length > 180) throw rule('Keep the introduction under 180 characters.');
      if (kind === 'text' && (text.length < 30 || text.length > 20000)) throw rule('Write between 30 and 20,000 characters for your entry.');
      if (text.length > 20000) throw rule('Keep the caption under 20,000 characters.');
      if (!['draft', 'published'].includes(status)) throw rule('Invalid status.');
      const existing = id ? entryRow(id) : null;
      if (id && (!existing || existing.creator_id !== creator.id)) throw rule('You can only edit your own entries.');
      const files = id ? db.entry_media.filter(m => m.entry_id === id) : [];
      const images = files.filter(m => m.kind === 'image').length, videos = files.filter(m => m.kind === 'video').length;
      if (status === 'published') {
        if (kind === 'image' && (images < 1 || videos > 0)) throw rule('Add at least one image before publishing.');
        if (kind === 'image' && images > 10) throw rule('An image entry holds up to 10 images. Remove some before publishing.');
        if (kind === 'video' && (videos === 0 || images > 0)) throw rule('Add a video before publishing.');
        if (kind === 'video' && videos > 1) throw rule('Remove the extra video before publishing.');
        if (kind === 'text' && images + videos > 0) throw rule('Remove the attached media or switch the post type.');
      }
      const words = text ? text.split(/\s+/).length : 0;
      const duration = [...files].reverse().find(m => m.kind === 'video')?.duration_seconds ?? 0;
      const minutes = kind === 'video' ? Math.max(1, Math.ceil(duration / 60)) : Math.max(1, Math.ceil(words / 200));
      const at = stamp();
      const fields = {title: values.title.trim(), subtitle: String(values.subtitle ?? '').trim(), category: values.category, format: values.format || 'Essay', image: values.image, access: values.access, status, kind,
        excerpt: text.split('\n\n')[0].slice(0, 600), minutes, updated_at: at};
      for (const [column, allowed, name] of [['category', ['Style', 'Beauty', 'Design', 'Culture', 'Art', 'Music', 'Writing', 'Photography', 'Wellness', 'Food', 'Education', 'Technology'], 'entries_category_check'],
        ['format', ['Essay', 'Guide', 'Studio note', 'Field note', 'Collection', 'Gallery', 'Film', 'Update'], 'entries_format_check'], ['image', ['atelier', 'ritual', 'architecture'], 'entries_image_check'],
        ['access', ['public', ...TIER_IDS], 'entries_access_check']]) {
        if (!allowed.includes(fields[column])) throw Error(`new row for relation "entries" violates check constraint "${name}"`);
      }
      let entry = existing;
      if (entry) {
        Object.assign(entry, fields, {published_at: status === 'published' ? entry.published_at ?? at : entry.published_at});
        db.entry_bodies.find(b => b.entry_id === id).body = text;
      } else {
        entry = {id: newId(3), creator_id: creator.id, ...fields, media_count: 0, preview_path: null, duration_seconds: null, cover_path: null, like_count: 0, comment_count: 0, read_count: 0,
          published_at: status === 'published' ? at : null, created_at: at};
        db.entries.push(entry);
        db.entry_bodies.push({entry_id: entry.id, body: text});
      }
      if (status === 'published' && !db.notifications.some(n => n.type === 'new_entry' && n.entry_id === entry.id)) notifyCircle(creator.id, 'new_entry', entry.id);
      refresh();
      return entry.id;
    },
    async deleteEntry(id) { const row = entryRow(id); if (ownsEntry(needUser(), row)) { cascadeEntry(id); refresh(); } },
    async uploadEntryCover(creatorId, blob) {
      validateImage(blob, COVER_IMAGE);
      if (!owns(needUser(), creatorId)) throw Error(PERMISSION);
      const path = `${creatorId}/${newId('a')}.${blob.type.split('/')[1]}`;
      db.storage.covers.push(path);
      return path;
    },
    async setEntryCover(entryId, path) {
      const row = entryRow(entryId);
      if (!me()) throw Error(PERMISSION);
      if (!ownsEntry(me(), row)) throw rule('You can only change your own entries.');
      if (path !== null && path !== undefined && !(path.startsWith(`${row.creator_id}/`) && /^[0-9a-f-]{36}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(path))) throw rule('Invalid cover image.');
      db.storage.covers = db.storage.covers.filter(p => p !== row.cover_path || p === path);
      row.cover_path = path ?? null;
      row.updated_at = stamp();
    },
    async recordRead(id) {
      const user = me(), row = entryRow(id);
      if (!user || !row || row.status !== 'published' || !canRead(row, user) || db.entry_reads.some(r => r.user_id === user && r.entry_id === id)) return;
      db.entry_reads.push({user_id: user, entry_id: id, created_at: stamp()});
      row.read_count += 1;
    },

    // media
    async media(entryIds) {
      const grouped = {};
      for (const id of unique(entryIds)) {
        const entry = entryRow(id);
        if (!canRead(entry)) continue;
        const rows = db.entry_media.filter(m => m.entry_id === id).sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
        if (rows.length) grouped[id] = rows.map(map.media);
      }
      return grouped;
    },
    async signedUrls(paths) {
      const urls = {};
      for (const path of unique(paths)) {
        const media = db.entry_media.find(m => m.path === path || m.poster_path === path);
        const owned = !media && db.storage['entry-media'].includes(path) && owns(me(), path.split('/')[0]);
        if ((media && canRead(entryRow(media.entry_id))) || owned) urls[path] = `https://fake.supabase.test/storage/v1/object/sign/entry-media/${path}?token=t${++signed}`;
      }
      return urls;
    },
    async uploadMedia(entryId, creatorId, prepared, {position = 0, alt = '', onProgress, signal} = {}) {
      const file = prepared?.blob;
      if (!file) throw Error('Choose a file to upload.');
      const creatorFolder = String(creatorId).toLowerCase(), entryFolder = String(entryId).toLowerCase();
      if (!UUID.test(creatorFolder) || !UUID.test(entryFolder)) throw Error(BAD_IDS);
      if (signal?.aborted) throw Error(CANCELLED);
      const user = me();
      if (!user) throw Error('Sign in to upload.');
      const entry = entryRow(entryFolder);
      if (!ownsEntry(user, entry) || entry.creator_id !== creatorFolder) throw Error(REFUSED);
      const base = `${creatorFolder}/${entryFolder}/${newId('a')}`;
      const ext = String(prepared.ext || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'bin';
      const files = db.entry_media.filter(m => m.entry_id === entryFolder);
      if (prepared.kind === 'video' && files.filter(m => m.kind === 'video').length >= 2) throw rule('Remove the previous video before adding another.');
      if (prepared.kind === 'image' && files.filter(m => m.kind === 'image').length >= 20) throw rule('Remove some images before adding more.');
      onProgress?.(0.5);
      const preview = prepared.preview && /^image\/(webp|jpeg)$/.test(prepared.preview.type) && prepared.preview.size > 0 && prepared.preview.size <= 256 * 1024 ? prepared.preview : null;
      const row = {id: newId(4), entry_id: entryFolder, kind: prepared.kind, path: `${base}.${ext}`,
        poster_path: prepared.poster ? `${base}-poster.${/jpe?g/i.test(prepared.poster.type) ? 'jpg' : 'webp'}` : null,
        preview_path: preview ? `${base}.${/jpe?g/i.test(preview.type) ? 'jpg' : 'webp'}` : null,
        mime: prepared.mime || file.type, size_bytes: prepared.size || file.size, width: prepared.width > 0 ? Math.round(prepared.width) : null, height: prepared.height > 0 ? Math.round(prepared.height) : null,
        duration_seconds: Number.isFinite(prepared.duration) ? Math.min(86400, Math.max(0, Math.round(prepared.duration))) : null, alt: String(alt ?? '').slice(0, 200),
        position: Math.max(0, Math.min(99, Math.trunc(position) || 0)), created_at: stamp()};
      db.entry_media.push(row);
      db.storage['entry-media'].push(row.path, ...(row.poster_path ? [row.poster_path] : []));
      if (row.preview_path) db.storage.previews.push(row.preview_path);
      syncAfterMedia(entry);
      onProgress?.(1);
      return map.media(row);
    },
    async updateMedia(mediaId, {alt, position} = {}) {
      const row = db.entry_media.find(m => m.id === mediaId);
      if (!row || !ownsEntry(needUser(), entryRow(row.entry_id))) return;
      if (alt !== undefined) row.alt = String(alt ?? '').slice(0, 200);
      if (position !== undefined) row.position = position;
      syncAfterMedia(entryRow(row.entry_id));
    },
    async removeMedia(media) {
      const list = (Array.isArray(media) ? media : [media]).filter(Boolean);
      const user = needUser();
      for (const item of list) {
        const row = db.entry_media.find(m => m.id === item.id);
        if (!row || !ownsEntry(user, entryRow(row.entry_id))) continue;
        db.entry_media = db.entry_media.filter(m => m !== row);
        forgetFiles(row);
        syncAfterMedia(entryRow(row.entry_id));
      }
    },
    previewUrl(path) { return map.urls.preview(path); },

    // social
    async setFollow(creatorId, on) {
      const user = needUser(), existing = db.follows.find(f => f.user_id === user && f.creator_id === creatorId);
      if (on && !existing) {
        if (!creatorRow(creatorId)) throw Error('That could not be found.');
        db.follows.push({user_id: user, creator_id: creatorId, created_at: stamp()});
        notify(creatorRow(creatorId).owner_id, 'follow', user, creatorId, null, null);
      }
      if (!on) db.follows = db.follows.filter(f => f !== existing);
      refresh();
    },
    async setLike(entryId, on) {
      const user = needUser(), entry = entryRow(entryId), existing = db.likes.find(l => l.user_id === user && l.entry_id === entryId);
      if (on && !existing) {
        if (!canRead(entry) || entry.status !== 'published') throw Error(PERMISSION);
        db.likes.push({user_id: user, entry_id: entryId, created_at: stamp()});
        const owner = creatorRow(entry.creator_id).owner_id;
        if (owner && !db.notifications.some(n => n.user_id === owner && n.type === 'like' && n.actor_id === user && n.entry_id === entryId)) notify(owner, 'like', user, entry.creator_id, entryId, null);
      }
      if (!on) db.likes = db.likes.filter(l => l !== existing);
      refresh();
    },
    async setBookmark(entryId, on) {
      const user = needUser(), entry = entryRow(entryId), existing = db.bookmarks.find(b => b.user_id === user && b.entry_id === entryId);
      if (on && !existing) {
        if (!entry || entry.status !== 'published') throw Error(PERMISSION);
        db.bookmarks.push({user_id: user, entry_id: entryId, created_at: stamp()});
      }
      if (!on) db.bookmarks = db.bookmarks.filter(b => b !== existing);
    },
    async savedEntries({cursor, limit} = {}) {
      const user = needUser();
      const rows = db.bookmarks.filter(b => b.user_id === user && entryRow(b.entry_id) && visible(entryRow(b.entry_id)));
      const page = paginate(rows, {column: 'created_at', cursor, limit}, row => row);
      return {items: page.items.map(b => toEntry(entryRow(b.entry_id))), nextCursor: page.nextCursor};
    },
    async listComments(entryId) {
      if (!canRead(entryRow(entryId))) return [];
      return db.comments.filter(c => c.entry_id === entryId).sort((a, b) => time(a.created_at) - time(b.created_at)).slice(-500).map(toComment);
    },
    async addComment(entryId, text, parentId = null) {
      const user = needUser(), entry = entryRow(entryId), clean = cleanComment(text);
      if (!entry || entry.status !== 'published' || !canRead(entry)) throw Error(PERMISSION);
      let parent = null;
      if (parentId) {
        parent = db.comments.find(c => c.id === parentId);
        if (!parent || parent.entry_id !== entryId) throw rule('Invalid reply.');
        if (parent.parent_id) parent = db.comments.find(c => c.id === parent.parent_id);   // threads stay one level deep
      }
      const row = {id: newId(5), entry_id: entryId, author_id: user, parent_id: parent?.id ?? null, body: clean, created_at: stamp(), edited_at: null};
      db.comments.push(row);
      const creator = creatorRow(entry.creator_id), owner = creator.owner_id;
      if (parent) notify(parent.author_id, 'reply', user, creator.id, entryId, row.id);
      if (owner !== parent?.author_id) notify(owner, 'comment', user, creator.id, entryId, row.id);
      refresh();
      return toComment(row);
    },
    async editComment(id, text) {
      const clean = cleanComment(text), row = db.comments.find(c => c.id === id);
      if (!row || row.author_id !== needUser()) throw Error(NOT_FOUND);
      Object.assign(row, {body: clean, edited_at: stamp()});
      return toComment(row);
    },
    async deleteComment(id) {
      const user = needUser(), row = db.comments.find(c => c.id === id);
      if (!row || (row.author_id !== user && !ownsEntry(user, entryRow(row.entry_id)))) return;
      const gone = new Set([id, ...db.comments.filter(c => c.parent_id === id).map(c => c.id)]);
      db.comments = db.comments.filter(c => !gone.has(c.id));
      db.notifications = db.notifications.filter(n => !gone.has(n.comment_id));
      refresh();
    },

    // memberships
    async join(creatorId, tierId) {
      const user = needUser(), creator = creatorRow(creatorId);
      if (!TIER_IDS.includes(tierId)) throw Error('Choose Essential, Premium or Signature.');
      if (!creator || creator.owner_id === user) throw Error(PERMISSION);
      if (!db.creator_tiers.some(t => t.creator_id === creatorId && t.tier_id === tierId && t.enabled)) throw rule('That membership tier is not open right now.');
      const existing = membershipOf(user, creatorId), at = stamp();
      if (existing) Object.assign(existing, {tier: tierId, updated_at: at});
      else db.memberships.push({user_id: user, creator_id: creatorId, tier: tierId, created_at: at, updated_at: at});
      if (!existing || existing.tier !== tierId) notify(creator.owner_id, 'membership', user, creatorId, null, null);
      refresh();
      return toMembership(membershipOf(user, creatorId));
    },
    async leave(creatorId) {
      const user = needUser();
      db.memberships = db.memberships.filter(m => !(m.user_id === user && m.creator_id === creatorId));
      refresh();
    },
    async myMemberships() { return db.memberships.filter(m => m.user_id === needUser()).sort((a, b) => time(b.created_at) - time(a.created_at)).map(toMembership); },
    // Row level security: the owner sees the whole circle, everyone else only their own row.
    async circleMembers(creatorId) {
      const user = needUser(), owner = owns(user, creatorId);
      return db.memberships.filter(m => m.creator_id === creatorId && (owner || m.user_id === user)).sort((a, b) => time(b.created_at) - time(a.created_at))
        .map(m => ({member: map.person(personRow(m.user_id), m.user_id), tier: toTier(db.creator_tiers.find(t => t.creator_id === creatorId && t.tier_id === m.tier)), joinedAt: m.created_at}));
    },
    async creatorStats(creatorId) {
      const creator = creatorRow(creatorId);
      if (!creator || !owns(me(), creatorId)) throw rule('Not your atelier.');
      const entries = db.entries.filter(e => e.creator_id === creatorId), published = entries.filter(e => e.status === 'published');
      const since = clock - 30 * 86_400_000;
      const members = db.memberships.filter(m => m.creator_id === creatorId);
      const price = tier => db.creator_tiers.find(t => t.creator_id === creatorId && t.tier_id === tier)?.price_cents ?? 0;
      return map.stats({
        followers: creator.follower_count, members: creator.member_count, entries: creator.entry_count, drafts: entries.filter(e => e.status === 'draft').length,
        likes: entries.reduce((n, e) => n + e.like_count, 0), comments: entries.reduce((n, e) => n + e.comment_count, 0), reads: entries.reduce((n, e) => n + e.read_count, 0),
        monthly_value_cents: members.reduce((n, m) => n + price(m.tier), 0),
        new_members_30d: members.filter(m => time(m.created_at) > since).length, new_followers_30d: db.follows.filter(f => f.creator_id === creatorId && time(f.created_at) > since).length,
        by_tier: db.creator_tiers.filter(t => t.creator_id === creatorId).sort((a, b) => level(a.tier_id) - level(b.tier_id))
          .map(t => ({tier_id: t.tier_id, name: t.name, level: level(t.tier_id), enabled: t.enabled, price_cents: t.price_cents, members: members.filter(m => m.tier === t.tier_id).length})),
        top_entries: [...published].sort((a, b) => (b.read_count + b.like_count * 3 + b.comment_count * 5) - (a.read_count + a.like_count * 3 + a.comment_count * 5) || time(b.published_at) - time(a.published_at)).slice(0, 5)
          .map(e => ({id: e.id, title: e.title, kind: e.kind, like_count: e.like_count, comment_count: e.comment_count, read_count: e.read_count}))
      });
    },

    // messages
    async inbox() {
      const user = needUser();
      const mine = db.messages.filter(m => m.member_id === user || owns(user, m.creator_id));
      const threads = new Map();
      for (const m of mine) { const key = `${m.creator_id}|${m.member_id}`; (threads.get(key) ?? threads.set(key, []).get(key)).push(m); }
      return [...threads.values()].map(list => {
        list.sort((a, b) => time(a.created_at) - time(b.created_at));
        const last = list.at(-1);
        const unread = list.filter(m => !m.read_at && ((m.sender === 'creator' && m.member_id === user) || (m.sender === 'member' && m.member_id !== user))).length;
        return {creatorId: last.creator_id, memberId: last.member_id, creator: map.creator(creatorRow(last.creator_id)), member: map.person(personRow(last.member_id), last.member_id),
          lastBody: last.body, lastSender: last.sender, lastAt: last.created_at, unread};
      }).sort((a, b) => time(b.lastAt) - time(a.lastAt));
    },
    async thread(creatorId, memberId) {
      const user = needUser();
      if (user !== memberId && !owns(user, creatorId)) return [];
      return db.messages.filter(m => m.creator_id === creatorId && m.member_id === memberId).sort((a, b) => time(a.created_at) - time(b.created_at)).slice(-200).map(map.message);
    },
    async sendMessage(creatorId, memberId, from, text) {
      const user = needUser(), clean = cleanMessage(text), creator = creatorRow(creatorId);
      if (!['member', 'creator'].includes(from)) throw Error('Choose who is sending the message.');
      const allowed = creator && (from === 'member'
        ? memberId === user && creator.owner_id !== user && creator.owner_id !== null
        : creator.owner_id === user && db.messages.some(m => m.creator_id === creatorId && m.member_id === memberId && m.sender === 'member'));
      if (!allowed) throw Error(PERMISSION);
      const row = {id: newId(6), creator_id: creatorId, member_id: memberId, sender: from, body: clean, created_at: stamp(), read_at: null};
      db.messages.push(row);
      if (from === 'member') notify(creator.owner_id, 'message', memberId, creatorId, null, null);
      else notify(memberId, 'message', creator.owner_id, creatorId, null, null);
      emit(null, 'message', row);
      return map.message(row);
    },
    async markThreadRead(creatorId, memberId) {
      const user = needUser(), at = stamp();
      const thread = db.messages.filter(m => m.creator_id === creatorId && m.member_id === memberId && !m.read_at);
      if (user === memberId) for (const m of thread) if (m.sender === 'creator') m.read_at = at;
      if (owns(user, creatorId)) for (const m of thread) if (m.sender === 'member') m.read_at = at;
      for (const n of db.notifications) if (n.user_id === user && n.type === 'message' && n.creator_id === creatorId && !n.read_at && (n.actor_id === memberId || user === memberId)) n.read_at = at;
    },
    async listNotes(creatorId) {
      needUser();   // notes are readable by signed-in people only
      return db.circle_notes.filter(n => n.creator_id === creatorId).sort((a, b) => time(b.created_at) - time(a.created_at)).slice(0, 100).map(map.note);
    },
    async postNote(creatorId, text) {
      const clean = cleanNote(text);
      if (!owns(needUser(), creatorId)) throw Error(PERMISSION);
      const row = {id: newId(7), creator_id: creatorId, body: clean, created_at: stamp()};
      db.circle_notes.push(row);
      notifyCircle(creatorId, 'note', null);
      return map.note(row);
    },
    async deleteNote(id) {
      const row = db.circle_notes.find(n => n.id === id);
      if (row && owns(needUser(), row.creator_id)) db.circle_notes = db.circle_notes.filter(n => n !== row);
    },

    // notifications
    async listNotifications({cursor, limit} = {}) {
      return paginate(db.notifications.filter(n => n.user_id === needUser()), {column: 'created_at', cursor, limit: limit ?? 20}, toNotification);
    },
    async unreadCounts() {
      const user = me();
      if (!user) return {notifications: 0, messages: 0};
      return {
        notifications: db.notifications.filter(n => n.user_id === user && !n.read_at && n.type !== 'message').length,
        messages: db.messages.filter(m => !m.read_at && ((m.sender === 'creator' && m.member_id === user) || (m.sender === 'member' && m.member_id !== user && owns(user, m.creator_id)))).length
      };
    },
    async markNotificationsRead(ids) {
      const user = needUser(), at = stamp();
      for (const n of db.notifications) if (n.user_id === user && !n.read_at && (ids === 'all' || (Array.isArray(ids) && ids.includes(n.id)))) n.read_at = at;
    },
    async deleteNotification(id) { db.notifications = db.notifications.filter(n => !(n.id === id && n.user_id === needUser())); },

    // search, reports
    async search(query) {
      const q = String(query ?? '').trim().slice(0, 100).toLowerCase();
      if (!q) return {creators: [], entries: []};
      const words = q.split(/\s+/).map(w => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
      const hits = fields => words.length > 0 && words.every(w => fields.join(' ').toLowerCase().split(/[^\p{L}\p{N}]+/u).some(token => token.startsWith(w)));
      const creators = db.creators.filter(c => hits([c.name, c.descriptor, c.location, c.category, c.bio]) || c.name.toLowerCase().includes(q))
        .sort((a, b) => b.follower_count - a.follower_count).slice(0, 6).map(map.creator);
      const entries = db.entries.filter(e => e.status === 'published' && (hits([e.title, e.subtitle, e.excerpt, e.category, e.format]) || e.title.toLowerCase().includes(q)))
        .sort((a, b) => time(b.published_at) - time(a.published_at)).slice(0, 8).map(toEntry);
      return {creators, entries};
    },
    async report(values) {
      const clean = cleanReport(values), user = needUser();
      db.reports.push({id: newId(9), reporter_id: user, target_type: clean.targetType, target_id: clean.targetId, reason: clean.reason, details: clean.details, status: 'open', created_at: stamp()});
    },

    // account, realtime
    async exportData() {
      const user = needUser(), own = ownedCreator(user), mineEntries = own ? db.entries.filter(e => e.creator_id === own.id) : [];
      const by = (rows, key = 'created_at') => [...rows].sort((a, b) => time(a[key]) - time(b[key]));
      return {
        exportedAt: stamp(), account: {id: user, email: db.users.find(u => u.id === user).email},
        profile: map.profile(profileRow(user)), settings: map.settings(db.user_settings.find(s => s.user_id === user)), atelier: own ? map.creator(own) : null,
        entries: by(mineEntries).map(e => ({...toEntry(e), body: db.entry_bodies.find(b => b.entry_id === e.id)?.body ?? '', media: db.entry_media.filter(m => m.entry_id === e.id).map(map.media)})),
        notes: own ? by(db.circle_notes.filter(n => n.creator_id === own.id)).map(map.note) : [],
        follows: by(db.follows.filter(f => f.user_id === user)).map(f => ({creatorId: f.creator_id, createdAt: f.created_at})),
        bookmarks: by(db.bookmarks.filter(b => b.user_id === user)).map(b => ({entryId: b.entry_id, createdAt: b.created_at})),
        likes: by(db.likes.filter(l => l.user_id === user)).map(l => ({entryId: l.entry_id, createdAt: l.created_at})),
        memberships: by(db.memberships.filter(m => m.user_id === user)).map(toMembership),
        comments: by(db.comments.filter(c => c.author_id === user)).map(toComment),
        messages: by(db.messages.filter(m => m.member_id === user || owns(user, m.creator_id))).map(map.message)
      };
    },
    async deleteAccount() {
      const user = needUser(), own = ownedCreator(user);
      if (own) removeCreator(own.id);
      db.storage.avatars = db.storage.avatars.filter(p => !p.startsWith(`${user}/`));
      for (const table of ['follows', 'bookmarks', 'likes', 'memberships', 'entry_reads', 'reports']) db[table] = db[table].filter(r => (r.user_id ?? r.reporter_id) !== user);
      db.comments = db.comments.filter(c => c.author_id !== user);
      db.messages = db.messages.filter(m => m.member_id !== user);
      db.notifications = db.notifications.filter(n => n.user_id !== user && n.actor_id !== user);
      for (const table of ['profiles', 'users', 'user_settings']) db[table] = db[table].filter(r => (r.id ?? r.user_id) !== user);
      refresh();
      setUser(null, 'SIGNED_OUT');
    },
    subscribe(user, {onNotification, onMessage} = {}) {
      if (!isUuid(user)) throw Error('Sign in to receive updates.');
      const listener = {userId: user, onNotification, onMessage};
      live.add(listener);
      return () => live.delete(listener);
    }
  };

  // After media rows change: card metadata follows the rows, and a published image or video post that lost its last file goes back to draft.
  function syncAfterMedia(entry) {
    syncEntry(db, entry);
    if (entry.media_count === 0 && entry.kind !== 'text' && entry.status === 'published') entry.status = 'draft';
    refresh();
  }

  // Wrapping: call log, injected failures, deep copies of every result.
  const fake = {};
  for (const [method, fn] of Object.entries(api)) {
    fake[method] = (...args) => {
      calls.push({method, args});
      const injected = failures.get(method);
      if (injected) return Promise.reject(typeof injected === 'string' ? Error(injected) : injected);
      const result = fn(...args);
      if (!(result instanceof Promise)) return result;   // previewUrl, onAuthChange and subscribe are synchronous
      return result.then(value => (value === undefined || typeof value === 'function' ? value : structuredClone(value)));
    };
  }

  // The session is a getter: Object.assign would copy its value once instead.
  Object.defineProperty(fake, 'session', {get: currentSession, enumerable: true});
  return Object.assign(fake, {
    db, calls,
    signInAs(id, event = 'SIGNED_IN') {
      if (id !== null && !db.users.some(u => u.id === id)) throw Error(`Unknown user ${id}`);
      setUser(id, id ? event : 'SIGNED_OUT');
    },
    confirmEmail(email) { const user = db.users.find(u => u.email === String(email).trim().toLowerCase()); if (user) user.confirmed = true; },
    fail(method, error) { if (error) failures.set(method, error); else failures.delete(method); },
    emit,
    refresh
  });
}
