# REFLUENZ web app — production architecture (v2)

This document is the contract every module is built against. If code and this
document disagree, fix the code or update this document in the same change.

## 1. Product

REFLUENZ is a creator-membership platform (Patreon-like) with an editorial visual
identity. Anyone can browse; a free account lets you follow creators, save and like
posts, comment, message creators and join a creator's circle at one of the
creator's own tiers. Any member can open **one atelier** (creator page), publish
posts — **text, photo or video** — public or tier-gated, manage tiers, see members
and stats.

Post kinds (`entries.kind`):
- `text` — an essay/article. Body 30–20,000 characters, optional uploaded cover.
- `image` — a photo post: 1–10 photos (gallery/carousel) + optional caption.
- `video` — one uploaded video (mp4/webm/mov, ≤ 50 MB) + poster frame + optional caption.
Image and video files live in the private `entry-media` bucket and are only served
(signed URLs) to readers who can read the post. A post's optional public cover lives
in the public `covers` bucket and is what locked readers see as a teaser.

Payments are **not live** yet: joining a tier is free during early access. The UI
shows real prices and says plainly that nothing is charged yet. Do not use the
word "demo" anywhere in the product.

Showcase ateliers (`creators.is_showcase = true`, no owner) are REFLUENZ sample
content. They show a "Showcase" badge; you can follow/join/read them but not
message them.

## 2. Stack

- Static site, no bundler. Native ES modules served from `/src/**`.
- Supabase (project `bwezbxwdmnmfbibpusaf`, eu-central-1): Auth, Postgres + RLS,
  Storage, Realtime, one Edge Function (`delete-account`).
- supabase-js v2 from jsDelivr, pinned: `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm`.
- Hosting: Vercel builds `npm run build` → `dist/`. `/app` and `/app/*` rewrite to `/app.html`.
- Tests: `node --test`. View tests use `happy-dom` (devDependency) and the in-memory
  fake API in `tests/helpers/fake-api.mjs`.
- Schema source of truth: `supabase/migrations/*.sql` (v2 = `20261005150000_production_v2.sql`).

## 3. Routes (History API, path based)

| Path | View module | Auth |
| --- | --- | --- |
| `/app` | `views/feed.js` | optional (guests see the latest from everyone) |
| `/app/discover` (`?q=&category=&kind=&sort=`) | `views/discover.js` | optional |
| `/app/c/:slug` (`?join=1` opens the join dialog) | `views/creator.js` | optional |
| `/app/p/:id` | `views/entry.js` | optional |
| `/app/library` | `views/library.js` | required |
| `/app/memberships` | `views/memberships.js` | required |
| `/app/messages` and `/app/messages/:creatorId/:memberId` | `views/messages.js` | required |
| `/app/notifications` | `views/notifications.js` | required |
| `/app/studio` | `views/studio.js` (no atelier → "open your atelier" flow) | required |
| `/app/studio/new` (`?kind=text\|image\|video`), `/app/studio/edit/:id` | `views/editor.js` | creator |
| `/app/studio/settings` (`?tab=atelier\|tiers`) | `views/studio-settings.js` | creator |
| `/app/settings` (`?tab=profile\|account\|notifications\|privacy`) | `views/settings.js` | required |
| `/app/login`, `/app/signup`, `/app/forgot` | `views/auth.js` | guest only |
| `/app/reset` | `views/auth.js` (set new password after recovery link) | recovery session |
| `/app/welcome` | `views/onboarding.js` | required |
| anything else under `/app` | `views/not-found.js` | — |

Legacy URLs: `/app.html` and `/app.html#<view>` redirect (replaceState) to the new
paths; `#entry/<id>` → `/app/p/<id>`. Auth email links land on `/app.html`
(that exact URL is in the Supabase redirect allow-list); after supabase-js consumes
the session from the URL, the router replaces the URL with `/app` (or `/app/reset`
on `PASSWORD_RECOVERY`). The landing page (`/`) forwards any URL carrying auth
parameters (`#access_token`, `#error`, `?code=`) to `/app.html` unchanged.

Guards: `required` and no session → `/app/login?next=<path>` (only same-origin
paths starting with `/app` are accepted for `next`). `guest` with a session → `/app`.
`creator` = required + an atelier (else → `/app/studio`). Signed-in users with
`settings.onboarded === false` are sent to `/app/welcome` once (not from `/app/reset`,
`/app/settings`, `/app/welcome`).

## 4. Frontend layout and ownership

```
app.html                      shell document (core)
src/main.js                   boot: client → api → store → router (core)
src/config.js                 Supabase URL + publishable key
src/api/                      data layer (api agent)
  index.js                    createApi(client) – composes the modules below
  util.js                     check(), friendly(), mappers, publicUrl(), uploadWithProgress()
  auth.js viewer.js creators.js tiers.js entries.js media.js social.js
  memberships.js messages.js notifications.js search.js reports.js account.js realtime.js
src/core/                     (core agent)
  router.js routes.js store.js ui.js shell.js format.js media.js
src/views/<name>.js           one module per row of §3 (feature agents)
src/styles/base.css           generic components (core)
src/styles/shell.css          sidebar, topbar, mobile bar, dialogs, toasts (core)
src/styles/<feature>.css      per feature (feature agents); all linked from app.html
src/design.css                design tokens (shared, keep)
src/icons.js                  icon set (core owns; feature agents may only append icons)
supabase/functions/delete-account/index.ts   (api agent)
tests/helpers/dom.mjs         happy-dom globals for view tests (core)
tests/helpers/fake-api.mjs    in-memory implementation of §6 (api agent)
```

Old modules `src/platform.js`, `src/store.js`, `src/api.js`, `src/platform.css`
are replaced; delete them once nothing imports them.

## 5. Core contracts

### 5.1 Safe HTML (`core/ui.js`)

All markup is produced with the `html` tagged template. Interpolated values are
**escaped by default**; arrays are joined; `null/undefined/false` render nothing.
`raw(string)` marks trusted markup (icons, already-built `html` results). Never put
user data in `raw`. Never build markup with plain string concatenation of user data.

```js
import { html, raw } from '../core/ui.js';
html`<p>${user.bio}</p>${items.map(i => html`<li>${i.name}</li>`)}`
```
`html` returns a `Safe` object (`String(safe)` gives the markup). Attribute values
are escaped too (`"`, `'`, `<`, `>`, `&`). URLs placed in `href`/`src` from user data
must pass `safeUrl(u)` (allows `https:`, `http:`, `mailto:`, `blob:` and same-origin paths).

### 5.2 View modules

```js
export default {
  title: 'Discover',                     // string or (ctx, data) => string
  auth: 'optional',                      // 'optional' | 'required' | 'guest' | 'creator'
  async load(ctx) { return data; },      // optional; thrown errors → error state with retry
  render(ctx, data) { return html`...`; },
  mount(el, ctx, data) { return () => {/* cleanup */}; }   // optional
};
```
`ctx = { api, store, router, params, query, path, ui, rerender, navigate }`.
The router renders a skeleton while `load` runs, then `render` → `el.innerHTML`, then
`mount`. Views attach listeners only inside `el` (use `ui.delegate`). `ctx.rerender()`
re-runs `load` + `render` + `mount` for the current route. Cleanup runs on route change.

### 5.3 Router (`core/router.js`)

`createRouter({ routes, outlet, store, api })`, `router.navigate(path, {replace})`,
`router.current` (`{ path, params, query, route }`), `router.start()`. Intercepts clicks
on `a[href^="/app"]` (not `target`, not modifier keys, not `[data-native]`), restores
scroll on back/forward, scrolls to top on push, focuses `#main`, sets `document.title`
to `"<title> — REFLUENZ"`. A view whose `mount` sets `ctx.router.block = () => message`
gets a confirm prompt before navigating away (editor with unsaved changes).

### 5.4 Store (`core/store.js`)

```js
store.state = {
  ready, session, user,            // user: { id, email }
  profile,                         // { id, name, bio, website, avatarUrl, avatarPath }
  settings,                        // { compact, welcomeDismissed, onboarded, notifyPrefs }
  myCreator,                       // Creator | null
  following: Set<creatorId>, saved: Set<entryId>, liked: Set<entryId>,
  memberships: Map<creatorId, Membership>,
  unread: { notifications: 0, messages: 0 }
}
store.subscribe(fn) → unsubscribe        // fn(state) after every change
store.init(api)                           // session + onAuthChange + realtime
store.reloadViewer()                      // api.loadViewer() → state
store.requireAuth(message?) → boolean     // false + opens "sign in to continue" dialog for guests
store.canRead(entry) → boolean            // UI hint only: own atelier, minRank 0, or member rank ≥ minRank
store.toggleFollow(creatorId)             // optimistic, rolls back + toasts on error, resolves new bool
store.toggleSave(entryId)  store.toggleLike(entry)   // toggleLike also adjusts entry.likeCount
store.join(creatorId, tierId)  store.leave(creatorId)
store.refreshUnread()
```

### 5.5 UI kit (`core/ui.js`, `core/format.js`, `core/media.js`)

`html, raw, esc, safeUrl, icon(name, size)` ·
`avatar(person, {size:'xs'|'sm'|'md'|'lg'|'xl'})` (image if `avatarUrl`, else initials) ·
`entryCard(entry, {compact, showCreator=true})` (shows a kind marker for photo/video
posts and a lock for gated posts) · `creatorCard(creator)` ·
`followButton(creatorId)` · `saveButton(entry)` · `tierCard(tier, {selected, current, action})` ·
`badge(text, tone)` · `button(label, {variant, size, type, attrs})` ·
`skeleton(kind, count)` (`'card'|'feature'|'list'|'text'|'profile'`) ·
`emptyState({icon, title, text, action:{href|action, label}})` · `errorState(error, {retry})` ·
`toast(message, {tone:'info'|'success'|'error'})` ·
`modal.open({title, body, className, onMount(el, close), onClose}) → {el, close}` ·
`confirmDialog({title, text, confirmLabel, tone}) → Promise<boolean>` ·
`delegate(root, type, selector, handler)` · `setBusy(button, busy)` · `debounce(fn, ms)` ·
`infiniteScroll(sentinel, loadMore) → disconnect` · `coverSrc(entryOrCreator)`
(uploaded `coverUrl` or `/editorial/<image>.png`) · `kindLabel(kind)` (Text / Photos / Video).
`format.js`: `timeAgo(date)`, `formatDate(date)`, `money(cents, currency)`,
`plural(n, one, many)`, `compactNumber(n)`, `initials(name)`, `duration(seconds)` (`m:ss`), `fileSize(bytes)`.
`media.js`: `pickFiles({accept, multiple, maxMB}) → Promise<File[]>`,
`resizeImage(file, {maxSize=2000, type='image/webp', quality=0.85}) → {blob, width, height}`,
`videoInfo(file) → {width, height, duration, posterBlob}` (poster = frame at ~1s, webp),
`ACCEPT = { image: 'image/jpeg,image/png,image/webp,image/gif', video: 'video/mp4,video/webm,video/quicktime' }`,
`LIMITS = { imageMB: 15, videoMB: 50, photosPerPost: 10 }`.
Icons available: arrow back down grid compass bookmark message studio search close
plus check heart lock play user members settings export send menu clock logout trash
(core adds: bell image video text edit more flag link upload eye chart grip).

### 5.6 Shell (`core/shell.js`)

Desktop sidebar: Home, Discover, Library, Messages (badge), Notifications (badge),
Memberships, Studio (or "Open your atelier"), Settings, and a primary **New post**
button for creators (opens a chooser: Text / Photos / Video → `/app/studio/new?kind=`).
Topbar: search (submits to `/app/discover?q=`), notification bell with count, avatar menu
(Profile & settings, My atelier, Sign out). Guests: "Sign in" and "Join free".
Mobile bottom bar: Home, Discover, Create (creators) / Library, Messages, You.
Owns `#modal`, `#toast`, the `#view` outlet and the `#main` landmark.

## 6. API contract (`src/api`)

Every method is `async`, returns plain camelCase objects, and throws
`Error(friendlyMessage)` on failure (`err.code` keeps the Postgres/Auth code).
Image URLs are resolved: `avatarUrl`/`coverUrl` are public URLs or `null`.
Lists are newest first unless stated. `limit` defaults to 12.

**Shapes**
- `Creator { id, slug, ownerId, name, initials, category, descriptor, location, image, bio, avatarUrl, avatarPath, coverUrl, coverPath, links:[{label,url}], isShowcase, followerCount, memberCount, entryCount, createdAt }`
- `Tier { id, creatorId, name, priceCents, currency, description, perks:[], rank, archived }`
- `Entry { id, creatorId, creator?: Creator, kind:'text'|'image'|'video', title, subtitle, excerpt, category, format, image, coverUrl, coverPath, minRank, tags:[], status, likeCount, commentCount, readCount, minutes, date, publishedAt, createdAt, updatedAt }` (`date` = publishedAt ?? createdAt)
- `Person { id, name, avatarUrl }`
- `Comment { id, entryId, parentId, body, createdAt, editedAt, author: Person }`
- `Media { id, entryId, kind:'image'|'video', mime, path, url, posterPath, posterUrl, durationSeconds, alt, width, height, position }` (`url`/`posterUrl` are signed URLs valid 1h)
- `Membership { creatorId, tierId, rank, tier: Tier, creator: Creator, createdAt }`
- `Thread { creatorId, memberId, creator: Creator, member: Person, lastBody, lastSender, lastAt, unread }`
- `Message { id, creatorId, memberId, from:'member'|'creator', text, date, readAt }`
- `Note { id, creatorId, text, date }`
- `Notification { id, type, actor: Person|null, creator: {id, slug, name}|null, entry: {id, title}|null, commentId, readAt, createdAt }`
- `Stats { followers, members, entries, drafts, likes, comments, reads, monthlyValueCents, newMembers30d, newFollowers30d, byTier:[{tierId,name,rank,members}], topEntries:[{id,title,kind,likeCount,commentCount,readCount}] }`

**Methods** (grouped by module; `createApi(client)` returns one flat object)
- auth: `getSession()`, `onAuthChange(fn(event, session))` (fn deferred with setTimeout 0),
  `signIn(email, password)`, `signUp(email, password, name) → {confirmed}`,
  `resendConfirmation(email)`, `resetPassword(email)`, `updatePassword(password)`,
  `updateEmail(email)`, `signOut()`
- viewer: `loadViewer() → {profile, settings, myCreator, following:[id], saved:[id], liked:[id], memberships:[Membership]}`,
  `saveProfile({name, bio, website}) → profile`, `saveSettings(partial) → settings`,
  `uploadAvatar(blob) → profile`, `removeAvatar() → profile`
- creators: `listCreators({category, sort:'popular'|'new', limit, offset}) → Creator[]`,
  `suggestedCreators(limit) → Creator[]` (popular, excluding followed and own),
  `getCreatorBySlug(slug) → {creator, tiers} | null`, `getCreator(id) → Creator|null`,
  `createAtelier(values) → Creator`, `updateAtelier(id, values) → Creator`,
  `slugAvailable(slug) → boolean`, `uploadCreatorImage(creatorId, 'avatar'|'cover', blob) → Creator`
- tiers: `listTiers(creatorId, {includeArchived}) → Tier[]` (by rank), `createTier(creatorId, values) → Tier`,
  `updateTier(id, values) → Tier`, `archiveTier(id, archived) → Tier`, `deleteTier(id)`
- entries: `feed({scope:'following'|'all', category, kind, sort:'new'|'popular', cursor, limit}) → {items, nextCursor}`,
  `creatorEntries(creatorId, {status:'published'|'draft', kind, cursor, limit}) → {items, nextCursor}`,
  `getEntry(id) → Entry|null` (with creator), `getBody(id) → string|null` (null = locked),
  `saveEntry(id|null, values, status) → id`
  (values: `{kind, title, subtitle, body, category, format, image, coverPath, minRank, tags}`;
  image/video posts must be saved as a draft first, then get media, then publish),
  `deleteEntry(id)` (also removes its storage files, best effort),
  `uploadEntryCover(creatorId, blob) → path`, `recordRead(id)`
- media: `getMedia(entryId) → Media[]` (by position; [] when locked),
  `addEntryMedia(creatorId, entryId, file, {kind, mime, alt, width, height, durationSeconds, posterBlob, position, onProgress(fraction)}) → Media`
  (uploads with progress via XHR to Storage, uploads the poster for videos, then inserts the row),
  `updateEntryMedia(id, {alt, position})`, `reorderEntryMedia(entryId, ids)`, `removeEntryMedia(media)`
- social: `setFollow(creatorId, on)`, `setLike(entryId, on)`, `setBookmark(entryId, on)`,
  `savedEntries({cursor, limit}) → {items, nextCursor}`, `listComments(entryId) → Comment[]` (oldest first),
  `addComment(entryId, body, parentId) → Comment`, `editComment(id, body) → Comment`, `deleteComment(id)`
- memberships: `join(creatorId, tierId) → Membership` (upsert), `leave(creatorId)`,
  `myMemberships() → Membership[]`, `circleMembers(creatorId) → [{member: Person, tier: Tier, joinedAt}]`,
  `creatorStats(creatorId) → Stats`
- messages: `inbox() → Thread[]`, `thread(creatorId, memberId) → Message[]` (oldest first),
  `sendMessage(creatorId, memberId, from, text) → Message`, `markThreadRead(creatorId, memberId)`,
  `listNotes(creatorId) → Note[]`, `postNote(creatorId, text) → Note`, `deleteNote(id)`
- notifications: `listNotifications({cursor, limit}) → {items, nextCursor}`,
  `unreadCounts() → {notifications, messages}`, `markNotificationsRead(ids | 'all')`, `deleteNotification(id)`
- search: `search(q) → {creators: Creator[], entries: Entry[]}`
- reports: `report({targetType, targetId, reason, details})`
- account: `exportData() → object`, `deleteAccount()` (calls the `delete-account` edge function)
- realtime: `subscribe(userId, {onNotification, onMessage}) → unsubscribe`

Cursors are opaque strings (ISO timestamp of the last item). Pass `nextCursor` back
as `cursor`; `nextCursor` is `null` at the end.

## 7. Conventions

- Visual language: reuse `design.css` tokens (`--paper --ink --muted --rule --wash --bronze --sand`),
  square geometry, fine rules, eyebrow labels, large tight headings. No rounded pill buttons,
  no gradients, no emoji. Monochrome imagery for editorial presets; uploaded photos and
  video keep their colour.
- Every async action: disable the control while pending (`setBusy`), toast success/failure
  with a human sentence, never leave a spinner forever, never lose typed text on error.
  Uploads show a progress bar and can be cancelled or retried.
- Every list: loading skeleton, empty state with a next step, error state with retry,
  pagination via `infiniteScroll` or a "Load more" button.
- Accessibility: semantic landmarks, labelled controls, visible focus, `aria-pressed` on
  toggles, `aria-live` toasts, dialogs via `<dialog>`, images have `alt`, video has
  controls and `playsinline`, 44px touch targets on mobile, works at 375px wide with no
  horizontal scroll, respects reduced motion (no autoplay).
- Guests: actions that need an account call `store.requireAuth('…')`.
- Copy: calm, editorial, specific. Never "demo", "mock", "fake", "lorem".
- Security: no `innerHTML` with unescaped user data, no `eval`, no inline event handlers
  or inline scripts (CSP forbids them), `rel="noopener noreferrer"` on external links,
  validate on the client and rely on RLS on the server.
