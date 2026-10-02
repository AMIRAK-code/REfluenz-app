# REFLUENZ — The Digital Atelier

An editorial landing page and functional, browser-local creator platform demo. The visual system follows the original `index.html`: warm white, black, restrained bronze, square geometry, fine rules, monochrome imagery and large, tightly set headings.

## Run

Requires **Node.js 22.8 or later**. There are no runtime npm dependencies.

```sh
npm run dev
# http://localhost:5173 — landing page
# http://localhost:5173/app.html — member demo
# http://localhost:5173/app.html?role=creator#studio — creator demo
```

```sh
npm run build
npm run preview
```

Deploy `dist/` to a static host. The supplied Vercel configuration preserves the landing page at `/` and the platform at `/app.html` (also `/app`). It no longer rewrites every request into the app.

## Try a two-minute product walkthrough

1. Open the landing page and choose **Step inside the demo**.
2. Read *The pieces you return to*. Bookmark it, then open **Private archive**.
3. Open **Discover**, search or filter by category, and visit a creator’s atelier.
4. Try a demo membership. Read a gated entry, then manage or cancel the plan.
5. Send a local message in **Your circle**.
6. Switch to **Creator**. Create an entry, preview it, save a draft, then publish.
7. Switch back to **Member** to see the new entry in the atelier.
8. Export or reset local demo data from **Settings**.

## Included behavior

- Chronological entries, category filters, creator and entry search, following.
- Reader dialogs, per-creator tier access, bookmarks, appreciation and share links.
- Persistent local conversations, memberships, profile and compact-card preference.
- Creator drafts, preview, publish, edit, delete, circle notes and sample-member CSV.
- Explicit empty states, recoverable storage errors, input limits and escaped user text.
- Responsive layouts, native dialogs, keyboard focus styles and reduced-motion support.
- A 30-second, 1920×1080 motion film with an original ambient score and captions.

## Demo boundary

This is a **functional pitch/demo experience, not a production multi-user SaaS**. Creators, entries, member records and prices are illustrative. Data lives under `refluenz.atelier.v1` in browser local storage. No real authentication, server publication, payments, email, or message delivery occurs. No card details are requested. Access gates demonstrate the experience; client-side data is not a secure paywall.

The original `backend/server.js` remains available via `npm run server` as a separate legacy mock API. The redesigned demo does not call it. It is not suitable for public production deployment: it has no authenticated authorization or durable storage.

Before a live launch, integrate authenticated identities, server-side authorization and persistent storage, payment-provider webhooks, real message delivery, moderation and operational monitoring. Replace illustrative records, validate pricing and product terms, and run the browser suite.

## Verification

```sh
npm run lint
npm test
npm run build
```

`npm run lint` parses JavaScript and checks local imports/assets. Ten unit/interface integration tests cover persistence, access rules, corrupt storage, storage failure atomicity, escaping, draft/publish/delete and creator/member flows. The lightweight interface host does **not** render CSS or simulate a real browser.

A Playwright suite is included for desktop/mobile layouts, live browser journeys, console errors, and screenshots:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
npm run build
npm run test:browser
```

The browser suite could not run in the authoring workspace: Chromium was absent and its download was denied. This is an outstanding release gate, not a passing check. See `docs/VERIFICATION.md`.

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

## Git handoff

The uploaded ZIP had no `.git` history. Its untouched contents were committed as a local baseline, with each implementation round committed on `feature/atelier-platform`. Nothing was pushed or merged. Apply the supplied patch series to a branch in your original clone; do not merge the archive’s unrelated root history. See `docs/GIT_HANDOFF.md`.
