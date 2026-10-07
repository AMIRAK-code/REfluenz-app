// Shared pieces of the data layer: constants, error mapping, paging helpers, input
// validation, the row mappers that turn database rows into the camelCase shapes of
// docs/ARCHITECTURE.md section 6, and the context every module receives.
// Only createContext, fetchAll and putImage touch the client; the rest is pure, so the
// in-memory fake (tests/helpers/fake-api.mjs) reuses the validators and rules.

import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';

export const LEVELS = {public:0, essential:1, premium:2, signature:3};
export const TIER_IDS = ['essential', 'premium', 'signature'];
export const CATEGORIES = ['Style', 'Beauty', 'Design', 'Culture', 'Art', 'Music', 'Writing', 'Photography', 'Wellness', 'Food', 'Education', 'Technology'];
export const IMAGE_PRESETS = ['atelier', 'ritual', 'architecture'];
export const CURRENCIES = ['EUR', 'USD', 'GBP'];
export const ENTRY_KINDS = ['text', 'image', 'video'];
export const REPORT_TARGETS = ['entry', 'comment', 'creator', 'message'];
export const REPORT_REASONS = ['spam', 'harassment', 'nudity', 'violence', 'copyright', 'other'];

export const MEDIA_BUCKET = 'entry-media';
export const PREVIEW_BUCKET = 'previews';
export const AVATAR_BUCKET = 'avatars';
export const COVER_BUCKET = 'covers';
// What the covers bucket accepts (atelier avatar and banner, covers of text posts).
export const COVER_IMAGE = {types: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 10 * 1024 * 1024};

// Object-name rules of the database (app_private.media_name_ok and folder_name_ok): lowercase uuids and a simple file name.
const UUID_PART = '[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const FILE_PART = '[A-Za-z0-9][A-Za-z0-9._-]{0,127}';
export const UUID = new RegExp(`^${UUID_PART}$`);
export const OBJECT_NAME = new RegExp(`^${UUID_PART}/${UUID_PART}/${FILE_PART}$`);
export const FOLDER_OBJECT = new RegExp(`^${UUID_PART}/${FILE_PART}$`);
export const isUuid = value => typeof value === 'string' && UUID.test(value.toLowerCase());

const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/;

export const TOO_LARGE = 'This file is too large (50 MB max).';
export const BAD_TYPE = 'This file type is not supported.';
export const BAD_IDS = 'This entry cannot take uploads right now. Reload the page and try again.';
export const SESSION_LOST = 'Your session has expired or you do not have permission. Sign in again and retry.';
// Storage refuses an upload with 403 when the owner policy fails: the entry is not yours, or a quota is used up
// (60 objects per entry, 500 MB of originals per creator). The client cannot tell those apart, so the message covers both.
export const REFUSED = 'This upload was refused. Your storage may be full (500 MB per atelier, 60 files per entry): remove media you no longer use, or sign in again, then retry.';
export const NETWORK = 'We could not reach REFLUENZ. Check your connection and try again.';
export const CANCELLED = 'Upload cancelled.';
export const NOT_SIGNED_IN = 'Sign in to continue.';
const PERMISSION = 'You do not have permission to do that.';

export function friendly(error) {
  const text = error?.message || String(error);
  // Our own functions and triggers raise P0001 with text written for people.
  if (error?.code === 'P0001') return text;
  if (error?.code === 'PGRST116') return 'That could not be found, or you do not have permission to change it.';
  if (/Invalid login credentials/i.test(text)) return 'That email and password do not match.';
  if (/Email not confirmed/i.test(text)) return 'Confirm your email first. Check your inbox for the link.';
  if (/User already registered/i.test(text)) return 'An account with this email already exists. Sign in instead.';
  if (/rate limit|too many requests|over_email_send_rate_limit/i.test(text)) return 'Too many attempts. Wait a few minutes and try again.';
  if (/Auth session missing/i.test(text)) return SESSION_LOST;
  if (/duplicate key.*slug/i.test(text)) return 'That atelier address is taken. Try another name.';
  if (/duplicate key.*owner/i.test(text)) return 'You already have an atelier.';
  if (/duplicate key.*entry_media/i.test(text)) return 'That file was already added.';
  if (/row-level security|permission denied/i.test(text)) return PERMISSION;
  if (/Failed to fetch|NetworkError|Load failed/i.test(text)) return NETWORK;
  // Storage and media constraints.
  if (/exceeded the maximum allowed size|payload too large|entry_media_size_bytes_check/i.test(text)) return TOO_LARGE;
  if (/invalid_mime_type|mime type .*not supported|entry_media_mime_check/i.test(text)) return BAD_TYPE;
  if (/bucket not found/i.test(text)) return 'Media storage is not available yet. Try again later.';
  if (/object not found|resource was not found/i.test(text)) return 'That file could not be found.';
  if (/jwt (expired|invalid)|invalid jwt/i.test(text)) return SESSION_LOST;
  return text;
}

// The error views see: a friendly message, the database code kept for callers that branch on it, the original as `cause`.
export function fail(error) {
  const wrapped = new Error(friendly(error), {cause:error});
  if (error?.code) wrapped.code = error.code;
  return wrapped;
}
export const check = ({data, error}) => { if (error) throw fail(error); return data; };
export const checkCount = ({count, error}) => { if (error) throw fail(error); return count ?? 0; };
// Inserting something that already exists is the state the caller wanted (a double tap on Follow), so it is not an error.
export const checkInsert = result => { if (result?.error?.code !== '23505') check(result); };

export const unique = list => [...new Set((list || []).filter(Boolean))];
export const chunk = (list, size) => { const parts = []; for (let i = 0; i < list.length; i += size) parts.push(list.slice(i, i + size)); return parts; };
export const encodePath = path => path.split('/').map(encodeURIComponent).join('/');
export const initials = name => String(name || '').split(/\s+/).filter(Boolean).map(n => n[0]).slice(0, 2).join('').toUpperCase();
export const slugify = name => String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 40).replace(/-+$/, '');

// Pages and cursors ---------------------------------------------------------
export const clampLimit = (limit, fallback = 12, max = 50) => { const n = Math.trunc(Number(limit)); return n > 0 ? Math.min(n, max) : fallback; };
// Queries ask for one row more than the page; the extra row only says whether another page exists.
export function pageOf(rows, limit, cursorOf) {
  const more = rows.length > limit;
  const items = more ? rows.slice(0, limit) : rows;
  return {items, nextCursor: more && items.length ? cursorOf(items.at(-1)) : null};
}
// Cursors end up in filters, so anything that is not a plain timestamp is dropped instead of sent.
export const cursorTime = cursor => typeof cursor === 'string' && ISO.test(cursor) ? cursor : null;
export const popularCursor = row => `${row.like_count ?? 0}|${row.published_at}`;
export function parsePopularCursor(cursor) {
  const [count, time] = String(cursor ?? '').split('|');
  return /^\d{1,9}$/.test(count) && cursorTime(time) ? {count: Number(count), time} : null;
}

export const mapPage = (page, fn) => ({items: page.items.map(fn), nextCursor: page.nextCursor});
export const isoTime = ms => new Date(ms).toISOString();

// PostgREST answers at most 1000 rows per request, so lists that can outgrow that are read in ranges.
// `page(from, to)` returns a query for those rows, ordered so that ranges do not overlap.
export async function fetchAll(page, {size = 1000, maxPages = 50} = {}) {
  const rows = [];
  for (let n = 0; n < maxPages; n++) {
    const part = check(await page(n * size, (n + 1) * size - 1)) || [];
    rows.push(...part);
    if (part.length < size) break;
  }
  return rows;
}

// Input rules ---------------------------------------------------------------------
// These mirror the database's check constraints so people read a sentence instead of "violates check constraint".
// Every cleaner returns only the keys it was given, trimmed, and throws an Error with a message for the person.
function text(value, {label, min = 0, max}) {
  const clean = String(value ?? '').trim();
  if (clean.length < min) throw Error(min === 1 ? `${label} cannot be empty.` : `${label} needs at least ${min} characters.`);
  if (clean.length > max) throw Error(`${label} can be at most ${max} characters.`);
  return clean;
}
function oneOf(value, list, message) {
  if (!list.includes(value)) throw Error(message);
  return value;
}
// People type "example.com"; the database wants a full http(s) address.
function webAddress(value, {label, max}) {
  let clean = text(value, {label, max});
  if (clean && !/^[a-z][a-z0-9+.-]*:/i.test(clean)) clean = `https://${clean}`;
  if (clean && (!/^https?:\/\/[^\s<>"]+$/i.test(clean) || clean.length > max)) throw Error(`${label} must be a web address such as https://example.com.`);
  return clean;
}
const has = (values, key) => values && values[key] !== undefined;

export const MAX_LINKS = 5;
export function cleanLinks(links) {
  if (!Array.isArray(links)) throw Error('Links must be a list.');
  if (links.length > MAX_LINKS) throw Error(`Add up to ${MAX_LINKS} links.`);
  return links.map(link => ({label: text(link?.label, {label: 'A link label', max: 40}), url: webAddress(link?.url, {label: 'A link', max: 300})})).filter(link => link.url);
}

export function cleanProfile(values = {}) {
  const clean = {};
  if (has(values, 'name')) clean.name = text(values.name, {label: 'Your name', min: 1, max: 60});
  if (has(values, 'bio')) clean.bio = text(values.bio, {label: 'Your bio', max: 240});
  if (has(values, 'website')) clean.website = webAddress(values.website, {label: 'Your website', max: 200});
  return clean;
}

export const SLUG = /^[a-z0-9-]{2,40}$/;
export function cleanAtelier(values = {}) {
  const clean = {};
  if (has(values, 'name')) clean.name = text(values.name, {label: 'The atelier name', min: 2, max: 60});
  if (has(values, 'category')) clean.category = oneOf(values.category, CATEGORIES, 'Choose a category.');
  if (has(values, 'descriptor')) clean.descriptor = text(values.descriptor, {label: 'The tagline', max: 60});
  if (has(values, 'location')) clean.location = text(values.location, {label: 'The location', max: 60});
  if (has(values, 'bio')) clean.bio = text(values.bio, {label: 'The description', max: 400});
  if (has(values, 'image')) clean.image = oneOf(values.image, IMAGE_PRESETS, 'Choose one of the cover styles.');
  if (has(values, 'slug')) {
    const slug = String(values.slug).trim().toLowerCase();
    if (!SLUG.test(slug)) throw Error('Use 2 to 40 letters, numbers or hyphens for the address.');
    clean.slug = slug;
  }
  if (has(values, 'links')) clean.links = cleanLinks(values.links);
  return clean;
}

export function cleanTier(values = {}) {
  const clean = {};
  if (has(values, 'name')) clean.name = text(values.name, {label: 'The tier name', min: 2, max: 40});
  if (has(values, 'priceCents')) {
    const cents = Number(values.priceCents);
    if (!Number.isInteger(cents) || cents < 0 || cents > 100000) throw Error('Set a price between 0 and 1,000.');
    clean.priceCents = cents;
  }
  if (has(values, 'currency')) clean.currency = oneOf(values.currency, CURRENCIES, 'Choose EUR, USD or GBP.');
  if (has(values, 'description')) clean.description = text(values.description, {label: 'The description', max: 280});
  if (has(values, 'perks')) {
    if (!Array.isArray(values.perks)) throw Error('Perks must be a list.');
    const perks = values.perks.map(perk => String(perk ?? '').trim()).filter(Boolean);
    if (perks.length > 8) throw Error('List up to 8 perks.');
    if (perks.some(perk => perk.length > 80)) throw Error('Each perk can be at most 80 characters.');
    clean.perks = perks;
  }
  if (has(values, 'enabled')) clean.enabled = Boolean(values.enabled);
  return clean;
}

export const cleanComment = body => text(body, {label: 'Your comment', min: 1, max: 2000});
export const cleanMessage = body => text(body, {label: 'Your message', min: 1, max: 2000});
export const cleanNote = body => text(body, {label: 'The note', min: 1, max: 2000});

export function cleanReport({targetType, targetId, reason, details = ''} = {}) {
  oneOf(targetType, REPORT_TARGETS, 'Choose what you are reporting.');
  oneOf(reason, REPORT_REASONS, 'Choose a reason for the report.');
  if (!isUuid(targetId)) throw Error('That item cannot be reported.');
  return {targetType, targetId: String(targetId).toLowerCase(), reason, details: text(details, {label: 'The details', max: 1000})};
}

// Column lists ---------------------------------------------------------------
export const CREATOR_COLUMNS = 'id,slug,owner_id,name,category,descriptor,location,image,bio,avatar_path,cover_path,links,is_showcase,follower_count,member_count,entry_count,created_at';
export const TIER_COLUMNS = 'creator_id,tier_id,name,price_cents,currency,description,perks,enabled,tier:tiers(level)';
export const ENTRY_COLUMNS = 'id,creator_id,kind,title,subtitle,excerpt,category,format,image,access,status,minutes,media_count,preview_path,duration_seconds,cover_path,like_count,comment_count,read_count,published_at,created_at,updated_at';
export const ENTRY_WITH_CREATOR = `${ENTRY_COLUMNS},creator:creators(${CREATOR_COLUMNS})`;
export const MEDIA_COLUMNS = 'id,entry_id,kind,path,poster_path,preview_path,mime,size_bytes,width,height,duration_seconds,alt,position';
export const PERSON_COLUMNS = 'id,display_name,avatar_path';
export const PROFILE_COLUMNS = 'id,display_name,bio,website,avatar_path';
export const SETTINGS_COLUMNS = 'compact,welcome_dismissed,onboarded,notify_prefs';
export const COMMENT_COLUMNS = `id,entry_id,author_id,parent_id,body,created_at,edited_at,author:profiles!author_id(${PERSON_COLUMNS})`;
export const MESSAGE_COLUMNS = 'id,creator_id,member_id,sender,body,created_at,read_at';
export const NOTE_COLUMNS = 'id,creator_id,body,created_at';
// The tiers of a creator, embedded in a creator. The hint names the foreign key: memberships also reference creator_tiers (by creator and tier),
// and a hint keeps the embed unambiguous however PostgREST reads that relationship.
export const CREATOR_TIERS = `creator_tiers!creator_id(${TIER_COLUMNS})`;
// A membership with its creator, whose creator_tiers carry the name and price of the tier held.
export const MEMBERSHIP_COLUMNS = `creator_id,tier,created_at,creator:creators(${CREATOR_COLUMNS},${CREATOR_TIERS})`;

export const DEFAULT_NOTIFY_PREFS = {new_entry:true, comment:true, reply:true, like:true, follow:true, membership:true, message:true, note:true};

// Row mappers ------------------------------------------------------------------
export const toMedia = m => ({id:m.id, entryId:m.entry_id, kind:m.kind, path:m.path, posterPath:m.poster_path ?? null, previewPath:m.preview_path ?? null, mime:m.mime,
  size:Number(m.size_bytes), width:m.width ?? null, height:m.height ?? null, duration:m.duration_seconds ?? null, alt:m.alt || '', position:m.position ?? 0});

// Public file URLs. Only canonical names become URLs: encodeURI would pass `..`, `?` and `#` through, so anything else is "no image".
export function createUrls(client) {
  const publicUrl = (bucket, pattern) => path => pattern.test(path || '') ? client.storage.from(bucket).getPublicUrl(path)?.data?.publicUrl || null : null;
  return {preview:publicUrl(PREVIEW_BUCKET, OBJECT_NAME), avatar:publicUrl(AVATAR_BUCKET, FOLDER_OBJECT), cover:publicUrl(COVER_BUCKET, FOLDER_OBJECT)};
}

export function createMappers(client) {
  const urls = createUrls(client);

  const person = (row, fallbackId = null) => ({id:row?.id ?? fallbackId, name:row?.display_name || 'Member', avatarUrl:urls.avatar(row?.avatar_path)});
  const creator = c => ({id:c.id, slug:c.slug, ownerId:c.owner_id ?? null, name:c.name, initials:initials(c.name), category:c.category, descriptor:c.descriptor ?? '', location:c.location ?? '', image:c.image, bio:c.bio ?? '',
    avatarUrl:urls.cover(c.avatar_path), avatarPath:c.avatar_path ?? null, coverUrl:urls.cover(c.cover_path), coverPath:c.cover_path ?? null,
    links:Array.isArray(c.links) ? c.links.map(l => ({label:l.label ?? '', url:l.url})) : [], isShowcase:Boolean(c.is_showcase),
    followerCount:c.follower_count ?? 0, memberCount:c.member_count ?? 0, entryCount:c.entry_count ?? 0, createdAt:c.created_at});
  const entry = e => ({id:e.id, creatorId:e.creator_id, ...(e.creator ? {creator:creator(e.creator)} : {}), kind:e.kind || 'text', title:e.title, subtitle:e.subtitle ?? '', excerpt:e.excerpt ?? '',
    category:e.category, format:e.format, image:e.image, access:e.access, status:e.status, minutes:e.minutes ?? 1, mediaCount:e.media_count ?? 0,
    previewUrl:urls.preview(e.preview_path), duration:e.duration_seconds ?? null, coverUrl:urls.cover(e.cover_path), coverPath:e.cover_path ?? null,
    likeCount:e.like_count ?? 0, commentCount:e.comment_count ?? 0, readCount:e.read_count ?? 0,
    date:e.published_at || e.created_at, publishedAt:e.published_at ?? null, createdAt:e.created_at, updatedAt:e.updated_at ?? e.created_at});
  // A row of creator_tiers; the level of the shared ladder comes from the embedded `tier`, or from the ladder itself.
  const tier = t => ({id:t.tier_id, level:t.tier?.level ?? LEVELS[t.tier_id] ?? 0, creatorId:t.creator_id, name:t.name, priceCents:t.price_cents, currency:t.currency || 'EUR',
    description:t.description ?? '', perks:Array.isArray(t.perks) ? [...t.perks] : [], enabled:t.enabled !== false});
  const tiers = rows => (rows || []).map(tier).sort((a, b) => a.level - b.level);
  // A membership row joined with its creator, whose embedded creator_tiers supply the tier the member holds.
  const membership = row => {
    const c = row.creator;
    const own = (c?.creator_tiers || []).find(t => t.tier_id === row.tier);
    const held = tier(own || {tier_id:row.tier, creator_id:row.creator_id, name:row.tier, price_cents:0});
    return {creatorId:row.creator_id, tierId:row.tier, level:held.level, tier:held, creator:creator(c), createdAt:row.created_at};
  };
  const profile = p => ({id:p.id, name:p.display_name, bio:p.bio ?? '', website:p.website ?? '', avatarUrl:urls.avatar(p.avatar_path), avatarPath:p.avatar_path ?? null});
  const settings = s => ({compact:Boolean(s?.compact), welcomeDismissed:Boolean(s?.welcome_dismissed), onboarded:Boolean(s?.onboarded), notifyPrefs:{...DEFAULT_NOTIFY_PREFS, ...(s?.notify_prefs || {})}});
  const comment = c => ({id:c.id, entryId:c.entry_id, parentId:c.parent_id ?? null, body:c.body, createdAt:c.created_at, editedAt:c.edited_at ?? null, author:person(c.author, c.author_id)});
  const message = m => ({id:m.id, creatorId:m.creator_id, memberId:m.member_id, from:m.sender, text:m.body, date:m.created_at, readAt:m.read_at ?? null});
  const note = n => ({id:n.id, creatorId:n.creator_id, text:n.body, date:n.created_at});
  const notification = n => ({id:n.id, type:n.type, actor:n.actor ? person(n.actor, n.actor_id) : null,
    creator:n.creator ? {id:n.creator.id, slug:n.creator.slug, name:n.creator.name} : null, entry:n.entry ? {id:n.entry.id, title:n.entry.title} : null,
    commentId:n.comment_id ?? null, readAt:n.read_at ?? null, createdAt:n.created_at});
  const stats = s => ({followers:s.followers ?? 0, members:s.members ?? 0, entries:s.entries ?? 0, drafts:s.drafts ?? 0, likes:s.likes ?? 0, comments:s.comments ?? 0, reads:s.reads ?? 0,
    monthlyValueCents:s.monthly_value_cents ?? 0, newMembers30d:s.new_members_30d ?? 0, newFollowers30d:s.new_followers_30d ?? 0,
    byTier:(s.by_tier || []).map(t => ({tierId:t.tier_id, name:t.name, level:t.level, enabled:t.enabled, priceCents:t.price_cents, members:t.members})),
    topEntries:(s.top_entries || []).map(e => ({id:e.id, title:e.title, kind:e.kind, likeCount:e.like_count ?? 0, commentCount:e.comment_count ?? 0, readCount:e.read_count ?? 0}))});

  return {urls, person, creator, entry, tier, tiers, membership, profile, settings, comment, message, note, notification, stats, media:toMedia};
}

// Image blobs for avatars and covers ---------------------------------------------
const IMAGE_EXT = {'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp', 'image/gif':'gif'};

// Checks a picked image against the bucket's rules before anything is sent, so people read a sentence instead of a storage error.
export function validateImage(blob, {types, maxBytes}) {
  if (!blob || !blob.size) throw Error('Choose an image to upload.');
  if (!types.includes(blob.type)) throw Error(`Use a ${types.map(t => IMAGE_EXT[t].toUpperCase()).join(', ').replace(/, ([^,]*)$/, ' or $1')} image.`);
  if (blob.size > maxBytes) throw Error(`This image is too large (${Math.round(maxBytes / 1048576)} MB max).`);
}

// Uploads an image to `<folder>/<uuid>.<ext>` in a public bucket and returns the path. The caller removes it again if a later step fails.
export async function putImage(client, bucket, folder, blob, {uuid, types, maxBytes}) {
  validateImage(blob, {types, maxBytes});
  const path = `${folder}/${String(uuid()).toLowerCase()}.${IMAGE_EXT[blob.type]}`;
  const {error} = await client.storage.from(bucket).upload(path, blob, {contentType:blob.type, upsert:false, cacheControl:'31536000'});
  if (error) throw fail(error);
  return path;
}

// The context every module receives -------------------------------------------------
// `userId` is only known from events (sign in, sign out, the auth callback); until then it is read from the stored session
// on every call, so a page that never subscribed still sees the right account.
export function createContext(client, {url = SUPABASE_URL, key = SUPABASE_KEY, XHR = globalThis.XMLHttpRequest, now = () => Date.now(),
  uuid = () => globalThis.crypto.randomUUID(), stallMs = 60 * 1000, fetch = globalThis.fetch?.bind(globalThis)} = {}) {
  const resets = new Set();
  let userId;   // undefined: not known from an event yet

  const ctx = {
    client, key, XHR, now, uuid, stallMs, fetch,
    url: String(url).replace(/\/+$/, ''),
    map: createMappers(client),

    async getUserId() {
      if (userId !== undefined) return userId;
      try { return (await client.auth.getSession())?.data?.session?.user?.id ?? null; } catch { return null; }
    },
    async requireUserId() {
      const id = await ctx.getUserId();
      if (!id) throw Error(NOT_SIGNED_IN);
      return id;
    },
    // Called with the account the client now belongs to (null: signed out). Caches tied to the previous account are dropped when the
    // account changed, or always with {force: true} (signing out).
    setUserId(next, {force = false} = {}) {
      const changed = next !== userId;
      userId = next;
      if (changed || force) for (const reset of resets) reset();
    },
    // Registers a function that forgets everything tied to the signed-in account.
    onAccountChange(reset) { resets.add(reset); return () => resets.delete(reset); },
    // Where auth emails send people back to. The path must stay in the Supabase redirect allow-list.
    redirectUrl() { return globalThis.location ? new URL('/app.html', globalThis.location.origin).href : undefined; }
  };
  return ctx;
}
