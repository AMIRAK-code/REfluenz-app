# REFLUENZ web app — production architecture (platform v2)

This is the contract every module is built against. If code and this document
disagree, fix the code or update this document in the same change.
Post media (text / image / video) follows **`docs/POST_FORMATS.md`**, which stays
authoritative for the media pipeline, upload ordering and failure handling.

## 1. Product

REFLUENZ is a creator-membership platform (Patreon-like) with an editorial visual
identity. Anyone can browse public work without an account. A free account lets you
follow creators, save and like posts, comment, message creators, and join a creator's
circle at one of their tiers. Any member can open **one atelier** (creator page),
publish **text, image or video** posts (public or for a tier and above), customise their
three tiers (name, price, perks, open/closed), see members and stats, and post circle notes.

Access ladder (shared, from `public.tiers`): `public` < `essential` (1) < `premium` (2) <
`signature` (3). `entries.access` is `public` or one of those ids; a member of a creator
at level ≥ the entry's level can read it. Each creator overrides the display name,
price, currency, description, perks and `enabled` of each level in `creator_tiers`.

Payments are **not live**: joining is free during early access; the UI shows the
creator's prices and says nothing is charged yet. Never use the word "demo".

Showcase ateliers (`creators.is_showcase`, no owner) are REFLUENZ sample content:
"Showcase" badge, followable/joinable/readable, not messageable.

## 2. Stack

- Static site, no bundler, native ES modules under `/src/**`. No runtime npm deps.
- Supabase project `bwezbxwdmnmfbibpusaf` (eu-central-1): Auth, Postgres + RLS, Storage,
  Realtime, Edge Function `delete-account`.
- supabase-js `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm` (pinned).
- Vercel: `npm run build` → `dist/`; `/app` and `/app/*` rewrite to `/app.html`.
- Tests: `node --test`; view tests use `happy-dom` (devDependency) + `tests/helpers/fake-api.mjs`.
- Schema: `supabase/migrations/` (latest: `20261006090000_platform_v2.sql`).

Storage buckets: `entry-media` (private: originals, posters, card thumbnails — see
POST_FORMATS), `previews` (public: tiny blurred teasers), `avatars` (public:
`<user_id>/<file>`), `covers` (public: `<creator_id>/<file>` — atelier banner, atelier
avatar, uploaded covers of text posts). File names: `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`,
lowercase uuids.

## 3. Routes (History API, path based)

| Path | View module | Auth |
| --- | --- | --- |
| `/app` | `views/feed.js` | optional (guests: latest from everyone) |
| `/app/discover` (`?q=&category=&kind=&sort=`) | `views/discover.js` | optional |
| `/app/c/:slug` (`?join=1` opens the join dialog) | `views/creator.js` | optional |
| `/app/p/:id` | `views/entry.js` | optional |
| `/app/library` | `views/library.js` | required |
| `/app/memberships` | `views/memberships.js` | required |
| `/app/messages`, `/app/messages/:creatorId/:memberId` | `views/messages.js` | required |
| `/app/notifications` | `views/notifications.js` | required |
| `/app/studio` (`?tab=published\|drafts\|members\|notes`) | `views/studio.js` (no atelier → open-your-atelier flow) | required |
| `/app/studio/new` (`?kind=text\|image\|video`), `/app/studio/edit/:id` | `views/editor.js` | creator |
| `/app/studio/settings` (`?tab=atelier\|tiers`) | `views/studio-settings.js` | creator |
| `/app/settings` (`?tab=profile\|account\|notifications\|data`) | `views/settings.js` | required |
| `/app/login`, `/app/signup`, `/app/forgot` | `views/auth.js` | guest |
| `/app/reset` | `views/auth.js` (new password after a recovery link) | recovery session |
| `/app/welcome` | `views/onboarding.js` | required |
| other `/app/*` | `views/not-found.js` | — |

Legacy: `/app.html` (and `/app.html#discover`, `#archive`, `#circle`, `#memberships`,
`#studio`, `#settings`, `#entry/<id>`) is replaced (`history.replaceState`) by the new
path after supabase-js has consumed any auth params in the URL. Auth emails keep
redirecting to `/app.html` (the URL in the Supabase allow-list). `PASSWORD_RECOVERY` → `/app/reset`.
The landing page already forwards auth params to `/app.html`; its CTAs point at `/app`,
`/app/signup` and `/app/studio`, and show "Open the app" when a session token exists in
localStorage (`sb-bwezbxwdmnmfbibpusaf-auth-token`).

Guards: `required` without session → `/app/login?next=<path>` (`next` accepted only if it
starts with `/app/` or equals `/app`). `guest` with session → `next` or `/app`. `creator` =
required + an atelier, else `/app/studio`. A signed-in user whose `settings.onboarded`
is false is sent once to `/app/welcome` (not from `/app/reset`, `/app/settings`, `/app/welcome`).

## 4. Files and ownership

```
app.html                       shell document (core)
src/main.js                    boot: client → api → store → router (core)
src/config.js                  Supabase URL + publishable key (keep)
src/media.js                   media preparation (keep, from post formats; owners: editor)
src/api.js                     re-export: export { createApi } from './api/index.js'
src/api/index.js               createApi(client, {url, key, XHR, now, uuid}) composing:
src/api/util.js                check(), friendly(), mappers (toCreator, toEntry, toTier, ...), publicUrl()
src/api/{auth,viewer,creators,tiers,entries,media,social,memberships,messages,
        notifications,search,reports,account,realtime}.js
src/core/router.js routes.js store.js ui.js shell.js format.js covers.js
src/views/*.js                 one module per row of §3
src/styles/base.css shell.css  (core)   src/styles/<area>.css (feature owners)
src/design.css                 tokens (keep)    src/icons.js (core; others may append icons)
src/landing.js, index.html     landing page (auth agent: CTA changes only)
supabase/functions/delete-account/index.ts   (api agent)
tests/helpers/dom.mjs (core)   tests/helpers/fake-api.mjs (api agent)
tests/*.test.mjs, tests/views/*.test.mjs
```
`src/platform.js`, `src/store.js`, `src/platform.css` are replaced and deleted at the end
(their behaviour is ported, including everything in POST_FORMATS.md).

## 5. Core contracts

### 5.1 Safe HTML (`core/ui.js`)
`html` tagged template escapes every interpolation by default (text and attribute
context), joins arrays, drops `null/undefined/false`; returns a `Safe`. `raw(s)` marks
trusted markup (icons, other `html` results are already `Safe`). `safeUrl(u)` allows
`https:`, `http:`, `mailto:`, `blob:` and same-origin `/` paths, else `'#'`. Never put
user data in `raw`, never concatenate user data into markup.

### 5.2 View modules
```js
export default {
  title: 'Discover',                 // string | (ctx, data) => string
  auth: 'optional',                  // 'optional' | 'required' | 'guest' | 'creator'
  async load(ctx) { return data },   // optional; throw → error state with Retry
  render(ctx, data) { return html`` },
  mount(el, ctx, data) { return cleanup }   // optional
}
```
`ctx = { api, store, router, params, query, path, ui, rerender(), navigate(path, opts) }`.
Router shows `ui.skeleton('page')` while `load` runs, then render → mount. Listeners only
inside `el` (`ui.delegate`). Cleanup runs on route change. `ctx.router.block = () => message|null`
lets a view (editor) confirm before leaving; `beforeunload` is wired to the same hook.

### 5.3 Router (`core/router.js`)
`createRouter({ routes, outlet, store, api })` → `{ start(), navigate(path, {replace}), current, block }`.
Intercepts same-origin `a[href^="/app"]` clicks (no `target`, no modifier keys, not `[data-native]`),
pushes state, scrolls to top (restores on back/forward), moves focus to `#main`, sets
`document.title = "<title> — REFLUENZ"`, announces route changes in an `aria-live` region.

### 5.4 Store (`core/store.js`)
```js
state = { ready, session, user /* {id,email} */, profile /* {id,name,bio,website,avatarUrl,avatarPath} */,
  settings /* {compact,welcomeDismissed,onboarded,notifyPrefs} */, myCreator /* Creator|null */,
  tiers /* global ladder [{id,level,name}] */, following:Set, saved:Set, liked:Set,
  memberships:Map<creatorId, Membership>, unread:{notifications, messages} }
subscribe(fn) → unsubscribe;  init(api);  reloadViewer();  refreshUnread()
requireAuth(message?) → boolean      // guests: opens a sign-in dialog, returns false
canRead(entry) → boolean             // UI hint: own atelier, access 'public', or member level ≥ entry level
levelOf(tierId) → 0..3               // 'public' → 0
toggleFollow(creatorId) / toggleSave(entryId) / toggleLike(entry)   // optimistic + rollback + toast; toggleLike adjusts entry.likeCount
join(creatorId, tierId) / leave(creatorId)
```

### 5.5 UI kit (`core/ui.js`, `core/format.js`, `core/covers.js`)
`html raw esc safeUrl icon(name,size) avatar(person,{size}) entryCard(entry,{compact,showCreator})
creatorCard(creator) followButton(creatorId) saveButton(entry) likeButton(entry) tierCard(tier,{current,selected,action})
badge(text,tone) button(label,{variant,size,type,attrs}) skeleton(kind,count) emptyState({icon,title,text,action})
errorState(error,{retry}) toast(msg,{tone}) modal.open({title,body,className,onMount,onClose})→{el,close}
confirmDialog({title,text,confirmLabel,tone})→Promise<bool> delegate(root,type,selector,fn) setBusy(btn,busy)
debounce(fn,ms) infiniteScroll(sentinel,loadMore)→disconnect pickFiles({accept,multiple})→Promise<File[]>
kindBadge(entry)`.
`format.js`: `timeAgo formatDate money(cents,currency) plural compactNumber initials duration fileSize`.
`covers.js`: card cover hydration ported from `hydrateMedia` (POST_FORMATS "Cards"): `hydrateCovers(root, entries, api, store)` —
uploaded text cover (`coverUrl`) or editorial preset for text posts; for media posts the blurred preview until the
signed thumbnail/poster loads; locked media posts never hydrate.

### 5.6 Shell (`core/shell.js`)
Sidebar: Home, Discover, Library, Messages (badge), Notifications (badge), Memberships,
Studio / "Open your atelier", Settings; creators get a **New post** button (Text / Image /
Video chooser → `/app/studio/new?kind=`). Topbar: search (→ `/app/discover?q=`), bell with
count, avatar menu (Settings, My atelier, Sign out); guests: "Sign in" + "Join free".
Mobile bottom bar: Home, Discover, New post (creators) or Library, Messages, You.
Owns `#modal`, `#toast`, `#view`, `#main`, the route announcer. Realtime updates badges and
toasts new messages while not on that thread.

## 6. API contract (`src/api`)

All methods async; return camelCase objects; throw `Error(friendlyMessage)` (keep `err.code`).
`limit` default 12; cursors are opaque (ISO timestamp of the last item), `nextCursor: null` at the end.

**Shapes**
- `Creator { id, slug, ownerId, name, initials, category, descriptor, location, image, bio, avatarUrl, avatarPath, coverUrl, coverPath, links:[{label,url}], isShowcase, followerCount, memberCount, entryCount, createdAt }`
- `Tier { id /* 'essential'|'premium'|'signature' */, level, creatorId, name, priceCents, currency, description, perks:[], enabled }`
- `Entry { id, creatorId, creator?, kind, title, subtitle, excerpt, category, format, image, access, status, minutes, mediaCount, previewUrl, duration, coverUrl, coverPath, likeCount, commentCount, readCount, date, publishedAt, createdAt, updatedAt }`
- `Media` — exactly as POST_FORMATS (`{ id, entryId, kind, path, posterPath, previewPath, mime, size, width, height, duration, alt, position }`)
- `Person { id, name, avatarUrl }` · `Comment { id, entryId, parentId, body, createdAt, editedAt, author: Person }`
- `Membership { creatorId, tierId, level, tier: Tier, creator: Creator, createdAt }`
- `Thread { creatorId, memberId, creator: Creator, member: Person, lastBody, lastSender, lastAt, unread }`
- `Message { id, creatorId, memberId, from:'member'|'creator', text, date, readAt }` · `Note { id, creatorId, text, date }`
- `Notification { id, type, actor: Person|null, creator: {id,slug,name}|null, entry: {id,title}|null, commentId, readAt, createdAt }`
- `Stats { followers, members, entries, drafts, likes, comments, reads, monthlyValueCents, newMembers30d, newFollowers30d, byTier:[{tierId,name,level,enabled,priceCents,members}], topEntries:[{id,title,kind,likeCount,commentCount,readCount}] }`

**Methods**
- auth: `getSession() onAuthChange(fn) signIn(email,pw) signUp(email,pw,name)→{confirmed} resendConfirmation(email) resetPassword(email) updatePassword(pw) updateEmail(email) signOut()`
- viewer: `loadViewer()→{profile,settings,myCreator,tiers,following:[],saved:[],liked:[],memberships:[Membership]}`
  `saveProfile({name,bio,website})→profile saveSettings(partial)→settings uploadAvatar(blob)→profile removeAvatar()→profile`
- creators: `listCreators({category,sort:'popular'|'new',limit,offset})→Creator[] suggestedCreators(limit)→Creator[]`
  `getCreatorBySlug(slug)→{creator,tiers}|null getCreator(id)→Creator|null createAtelier(values)→Creator updateAtelier(id,values)→Creator`
  `slugAvailable(slug)→boolean uploadCreatorImage(creatorId,'avatar'|'cover',blob)→Creator removeCreatorImage(creatorId,kind)→Creator`
- tiers: `listTiers(creatorId)→Tier[] updateTier(creatorId,tierId,{name,priceCents,currency,description,perks,enabled})→Tier`
- entries: `feed({scope:'following'|'all',category,kind,sort:'new'|'popular',cursor,limit})→{items,nextCursor}`
  `creatorEntries(creatorId,{status,kind,cursor,limit})→{items,nextCursor} getEntry(id)→Entry|null getBody(id)→string|null`
  `saveEntry(id,values,status)→id` (values `{kind,title,subtitle,body,category,format,image,access}`)
  `deleteEntry(id) uploadEntryCover(creatorId,blob)→path setEntryCover(entryId,path|null) recordRead(id)`
- media (port verbatim from `src/api.js`, POST_FORMATS): `media(entryIds)→{[id]:Media[]} signedUrls(paths,expiresIn)→{[path]:url}`
  `uploadMedia(entryId,creatorId,prepared,{position,alt,onProgress,signal})→Media updateMedia(id,{alt,position}) removeMedia(list) previewUrl(path)`
- social: `setFollow(creatorId,on) setLike(entryId,on) setBookmark(entryId,on) savedEntries({cursor,limit})→{items,nextCursor}`
  `listComments(entryId)→Comment[] addComment(entryId,body,parentId)→Comment editComment(id,body)→Comment deleteComment(id)`
- memberships: `join(creatorId,tierId)→Membership leave(creatorId) myMemberships()→Membership[]`
  `circleMembers(creatorId)→[{member:Person,tier:Tier,joinedAt}] creatorStats(creatorId)→Stats`
- messages: `inbox()→Thread[] thread(creatorId,memberId)→Message[] sendMessage(creatorId,memberId,from,text)→Message`
  `markThreadRead(creatorId,memberId) listNotes(creatorId)→Note[] postNote(creatorId,text)→Note deleteNote(id)`
- notifications: `listNotifications({cursor,limit})→{items,nextCursor} unreadCounts()→{notifications,messages}`
  `markNotificationsRead(ids|'all') deleteNotification(id)`
- search: `search(q)→{creators,entries}` · reports: `report({targetType,targetId,reason,details})`
- account: `exportData()→object deleteAccount()` (edge function) · realtime: `subscribe(userId,{onNotification,onMessage})→unsubscribe`

## 7. Conventions
- Design: `design.css` tokens, square geometry, fine rules, eyebrow labels, large tight headings,
  no pills/gradients/emoji; editorial presets in monochrome, uploaded media in colour.
- Async actions: `setBusy`, human toasts, never lose typed text, uploads show per-file progress and
  can be cancelled (POST_FORMATS).
- Lists: skeleton, empty state with a next step, error state with Retry, pagination.
- Accessibility: landmarks, labels, visible focus, `aria-pressed`, `aria-live` toasts and route
  announcer, `<dialog>`, alt text, `controls playsinline` video without autoplay, 44px targets on
  touch, no horizontal scroll at 375px, reduced motion respected.
- Guests trigger `store.requireAuth('…')` for account actions.
- Copy: calm, editorial, specific; never "demo", "mock", "fake", "lorem".
- Security: no unescaped user data in markup, no inline scripts/handlers (CSP), external links
  `rel="noopener noreferrer" target="_blank"`, client validation + server RLS.
