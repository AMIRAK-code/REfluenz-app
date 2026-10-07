# REFLUENZ — The Digital Atelier

A creator-membership platform in the spirit of Patreon, with an editorial identity. Anyone can browse public work without an account. A free account lets you follow creators, save and like posts, comment, message creators and join a creator's circle at one of their tiers. Any member can open **one atelier** (a creator page), publish **text, image or video** posts (public, or for a tier and above), name and price their three tiers, see their members and numbers, and post circle notes.

The visual system follows the landing page: warm white, black, restrained bronze, square geometry, fine rules, monochrome editorial imagery and large, tightly set headings.

**Payments are not live.** Joining a circle is free during early access and the interface says so wherever a price is shown. See [Payments](#payments-not-live-yet).

## Run

Requires **Node.js 22.8 or later**. There are no runtime npm dependencies (the Supabase client loads as an ES module from jsDelivr, pinned in `src/main.js`). `npm install` only adds `happy-dom`, which the view tests use.

```sh
npm install
npm run dev        # http://localhost:5173 (PORT=5188 npm run dev or --port picks another)
                   #   /          landing page
                   #   /app       the platform (the dev server rewrites /app and /app/* to app.html, like vercel.json)
npm run build      # copies the static site to dist/
npm run preview    # serves dist/
```

Vercel builds with `npm run build` and serves `dist/`. `vercel.json` rewrites `/app` and `/app/*` to `/app.html` and sends the security headers (strict Content-Security-Policy, HSTS, no sniffing). The dev server sends the same headers, so a policy violation shows up locally.

## The product

| Path | Page |
| --- | --- |
| `/app` | Home: latest from everyone for guests; Following, filters and a rail of suggestions for members |
| `/app/discover` | Search, categories, kinds, sort |
| `/app/c/:slug` | An atelier: posts, membership tiers, about; `?join=1` opens the join dialog |
| `/app/p/:id` | A post: text, image gallery or video, likes, comments, share, report; locked posts show a blurred preview |
| `/app/library`, `/app/memberships` | Saved posts (with export), circles you belong to |
| `/app/messages`, `/app/notifications` | Conversations and activity, live |
| `/app/studio` | Open your atelier, then numbers, published, drafts, members (CSV), circle notes |
| `/app/studio/new`, `/app/studio/edit/:id` | The post editor (text, image, video) |
| `/app/studio/settings`, `/app/settings` | Atelier and tiers; profile, account, notifications, data export, delete account |
| `/app/login`, `/app/signup`, `/app/forgot`, `/app/reset`, `/app/welcome` | Sign in, create an account, recover, welcome tour |

Showcase ateliers (REFLUENZ's own sample content, no owner) carry a "Showcase" badge, can be followed, joined and read, but not messaged.

## Architecture

Static site, no bundler: native ES modules served as they are. The contract every module is built against is **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** (routes, ownership, core contracts, the API, conventions, testing). Media (text, image, video) follows **[`docs/POST_FORMATS.md`](docs/POST_FORMATS.md)**.

```
app.html                 shell document (strict CSP: no inline script, style or handler)
index.html, src/landing.* landing page (forwards auth e-mail links to /app.html, shows "Open the app" when signed in)
src/main.js              boot: supabase-js → createApi → startApp
src/api/*                the data layer: the only code that talks to Supabase (auth, viewer, creators, tiers, entries,
                         media, social, memberships, messages, notifications, search, reports, account, realtime)
src/core/*               router, store, ui kit (safe html``), shell, covers, format, paths, constants, route table
src/views/*              one module per page (views/<area>/ for helpers), loaded lazily by the router
src/styles/*, design.css tokens (design.css), base and shell styles, one stylesheet per feature area
src/media.js             picture and video preparation (canvas, <video>) for uploads
supabase/                migrations and the delete-account edge function
tests/                   node:test; tests/helpers has an in-memory api (fake-api.mjs) and a happy-dom harness (dom.mjs)
scripts/                 check.mjs (lint), serve.mjs (dev server), build.mjs
```

Rules the code keeps: markup is built with the escaping `html` tag (never string concatenation of user data), no inline handlers, external links `rel="noopener noreferrer"`, every list has a skeleton, an empty state with a next step, an error state with Retry and pagination, writes disable their button and keep what was typed on error, and the layout works at 375 px with 44 px touch targets on touch screens.

## Backend: Supabase

- Project: `refluenz` (`bwezbxwdmnmfbibpusaf`, eu-central-1). The URL and publishable key are in `src/config.js`; they are public by design, every table is protected by row level security.
- Schema, policies, functions and seed data are in `supabase/migrations/`, in the order they were applied. The latest are `20261006231142_platform_v2.sql` and `20261006231241_platform_v2_indexes.sql`.
- `src/api/*` is the only code that talks to Supabase. Views get plain camelCase objects and friendly error messages.

| Table | What it holds |
| --- | --- |
| `profiles`, `user_settings` | Name, bio, website, avatar; preferences and notification choices (created on sign-up) |
| `creators`, `creator_tiers`, `tiers` | Ateliers (one per owner; showcase ateliers have none); each atelier's name, price, perks and open/closed state for the shared ladder `essential` < `premium` < `signature` |
| `entries`, `entry_bodies`, `entry_media`, `entry_reads` | Post metadata and the free first-paragraph excerpt; the full text (readable only with the right tier); image and video files; read counts |
| `follows`, `bookmarks`, `likes`, `comments`, `memberships` | Personal lists and social data |
| `messages`, `circle_notes`, `notifications` | Private member and creator threads, circle notes, the activity feed (realtime) |
| `reports`, `app_private.rate_log` | Reports of posts, comments and ateliers; rate limits |

Storage buckets: `entry-media` (private, signed links), `previews` (public, tiny blurred teasers), `avatars` and `covers` (public).

### Setup notes

1. **Auth URLs.** Dashboard → Authentication → URL Configuration. Set **Site URL** to the production domain (`https://refluenz.com`) and add these **Redirect URLs**:
   - `https://refluenz.com/app.html`
   - `http://localhost:5173/app.html` (and any preview domain you use, for example `https://<project>.vercel.app/app.html`)

   Confirmation and password-reset emails link back to `/app.html` on the current origin. The app replaces that address with the clean path (`/app`, or `/app/reset` after a recovery link). An expired or reused link lands on `/app/login` with a "Send me a new link" action.
2. **Email.** The built-in sender is rate-limited. Configure custom SMTP before launch.
3. **Delete-account edge function.** Account deletion calls `supabase/functions/delete-account`, which verifies the caller's token itself, removes the person's files (entry-media, previews, covers, avatars), their atelier and finally the user. It must be deployed with JWT verification **off**, because the project's publishable key is not a JWT:

   ```sh
   supabase functions deploy delete-account --project-ref bwezbxwdmnmfbibpusaf --no-verify-jwt
   ```

   It uses the `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` that Supabase injects into every function; set nothing by hand. It answers CORS only for `https://refluenz.com` and `localhost` / `127.0.0.1`; add your preview origins to `ORIGINS` in `index.ts` if you test deletion there. Until it is deployed, "Delete my account" in Settings fails with an error message and nothing is deleted.
4. **Migrations.** Apply `supabase/migrations/*.sql` in order to a new project. The two `platform_v2` migrations are already applied to production.

## Payments: not live yet

Joining a circle is free during early access, and the UI says so. Membership rows are written by the member directly. To charge for tiers, add Stripe (Checkout plus a webhook running with the service role), drop the member-side `join circle` and `change tier` insert and update policies so only the webhook writes `memberships`, and replace the "free during early access" notes in the views. The paywall itself (`entry_bodies` row level security) needs no change.

## Testing

```sh
npm run lint     # syntax and imports of every script, page assets, CSP hashes, no inline code in app.html
npm test         # node --test: data layer, core, every view, links between pages, boot
npm run build
```

- `tests/api-v2.test.mjs` runs the real data layer against a hand-written fake of the parts of supabase-js it uses (including the media upload pipeline), and checks the in-memory fake against it.
- `tests/contract.test.mjs` fails when `docs/ARCHITECTURE.md` (routes, API methods, shapes) and the code disagree.
- `tests/core.test.mjs` and `tests/boot.test.mjs` cover the router, store, ui kit, shell and every route for a guest, a member and a creator.
- `tests/views/*.test.mjs` mount each page in happy-dom against the fake api: guest, member and owner rendering, each action on its happy and failure path, empty states, pagination, hostile strings.
- `tests/links.test.mjs` checks that every link on every page leads to a route.

Row level security was additionally verified with SQL role simulation against the live project: gated bodies stay hidden without the right tier, drafts are private, ateliers cannot be edited by others, and creators can reply only inside threads a member started.

Browser checks (real layout at 375 px, drag and drop, canvas and video preparation, playback of signed media) are not covered by the unit tests and are done by hand before a release.

## Design and assets

Shared design tokens are in `src/design.css`. Hanken Grotesk is the preferred font declaration; if it is not self-hosted the page falls back to Arial and the system sans. For exact typography, add a licensed Hanken Grotesk WOFF2 and an `@font-face` declaration. Editorial cover presets are small monochrome JPEGs in `public/editorial/v1/` (cached for a year; a changed picture needs a new folder, see `docs/ASSETS.md`). No trackers or third-party scripts other than the pinned Supabase client.

## Motion film

`public/film/refluenz-introduction.mp4` is the finished 30-second film, embedded on the landing page with native controls; it does not autoplay. To reproduce it, install Pillow and NumPy, ensure FFmpeg is on PATH, then:

```sh
python scripts/render-film.py
ffmpeg -framerate 24 -i video-frames/frame-%04d.jpg -i video-frames/score.wav -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -t 30 -movflags +faststart public/film/refluenz-introduction.mp4
```
