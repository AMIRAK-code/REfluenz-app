# REFLUENZ — The Digital Atelier

An editorial landing page and a creator-membership web app, in the spirit of Patreon: anyone can register for free, follow creators, and join a creator’s circle at one of three tiers to unlock their member entries. The visual system follows the original `index.html`: warm white, black, restrained bronze, square geometry, fine rules, monochrome imagery and large, tightly set headings.

## Run

Requires **Node.js 22.8 or later**. There are no npm dependencies; the Supabase client loads as an ES module from jsDelivr.

```sh
npm run dev
# http://localhost:5173 — landing page
# http://localhost:5173/app.html — the platform (sign in or create an account)
```

```sh
npm run build   # copies the static site to dist/
npm run preview
```

Vercel builds with `npm run build` and serves `dist/`. The platform is at `/app.html` (also `/app`).

## Backend: Supabase

- Project: `refluenz` (`bwezbxwdmnmfbibpusaf`, eu-central-1). The URL and publishable key are in `src/config.js`; they are public by design.
- Schema, policies and seed data live in `supabase/migrations/`, in the order they were applied.
- `src/api.js` is the only module that talks to Supabase. `src/platform.js` renders views from the data it returns.

| Table | What it holds | Who can read / write |
| --- | --- | --- |
| `profiles` | Display name, bio, preferences (created on sign-up) | Members read; owner updates |
| `creators` | Ateliers. Four house ateliers are seeded without an owner | Everyone reads; owner creates/edits one atelier |
| `entries` | Entry metadata and a free first-paragraph excerpt | Published rows public; drafts owner-only |
| `entry_bodies` | The full text | Only if public, the reader’s tier covers it, or they own it |
| `tiers` | Essential €9, Premium €19, Signature €39 | Everyone reads |
| `memberships` | A member’s tier per creator | Member and the creator read; member writes (see below) |
| `follows`, `bookmarks`, `likes` | Personal lists | Owner only |
| `messages` | Private member ↔ creator threads (realtime) | Only the two participants; creators can only reply |
| `circle_notes` | Creator broadcasts (realtime) | Members read; owner posts |

Entries are saved through the `save_entry` function, which validates input and writes metadata and body atomically. Policy helpers live in the non-exposed `app_private` schema.

## Payments: not live yet

Joining a circle is free during early access, and the UI says so. Membership rows are written by the member directly. To charge for tiers, add Stripe (Checkout plus a webhook running with the service role), drop the `join circle` and `change tier` insert/update policies, and let only the webhook write `memberships`. The paywall itself (`entry_bodies` RLS) needs no change.

## Auth settings to check in the Supabase dashboard

Authentication → URL Configuration: set **Site URL** to the production domain and add `https://<your-domain>/app.html` (and `http://localhost:5173/app.html` for local work) to **Redirect URLs**, otherwise confirmation and password-reset emails link to the wrong place. The built-in email sender is rate-limited; configure custom SMTP before launch.

## Verification

```sh
npm run lint
npm test
npm run build
```

Unit tests cover access rules, validation, escaping and CSV safety. Interface tests mount the platform against an in-memory API that mirrors the server rules and walk through member and creator journeys. Row level security was additionally verified with SQL role simulation against the live project: gated bodies stay hidden without the right tier, drafts are private, ateliers cannot be edited by others, and creators can reply only inside threads a member started.

## Design and assets

Shared design tokens are in `src/design.css`. Hanken Grotesk remains the preferred font declaration; it was not supplied in the archive, and its download was blocked. The offline demo uses Arial/system sans as fallback. For exact typography, self-host a licensed Hanken Grotesk WOFF2 and add an `@font-face` declaration before launch.

The three monochrome editorial photographs were generated for this demo. Their art direction and provenance are documented in `docs/ASSETS.md`. No remote images, CDNs, trackers or APIs are needed by the new pages.

## Motion film

`public/film/refluenz-introduction.mp4` is the finished 30-second film. It is embedded on the landing page with native playback controls; it does not autoplay. The film uses a stylized interface study, not a screen recording.

To reproduce it, install Pillow and NumPy, ensure FFmpeg is on PATH, then:

```sh
python scripts/render-film.py
ffmpeg -framerate 24 -i video-frames/frame-%04d.jpg -i video-frames/score.wav -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -t 30 -movflags +faststart public/film/refluenz-introduction.mp4
```
