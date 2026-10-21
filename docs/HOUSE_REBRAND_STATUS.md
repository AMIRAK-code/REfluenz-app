# House rebrand — status

The brand rules are in `docs/HOUSE_IDENTITY.md`.

**Shipped 2026-10-21.** The work was done on the branch `feature/house-rebrand` and merged into `main`.

## Done

- **Pitch (`public/pitch/`).**
  - A "Back to top" button in the footer.
  - The sound control stays on screen through every scene.
- **API (`src/api/*`).**
  - `TIER_DEFAULTS` holds the House defaults: Member, Private and Black Label.
  - `houseTier()` maps tier rows that still carry the original defaults.
  - `houseWords()` translates "atelier" and "circle" in database errors.
  - Error copy now says Studio and House.
- **Copy across the app.**
  - **Public side:** the Studio page, the join dialog, posts, the feed, Discover, Library and Memberships.
  - **Creator side:** the Studio dashboard, opening a Studio, Studio settings and tiers, the editor and account settings.
  - **Everything else:** messages, notifications, sign-in and sign-up, onboarding, and the shell (sidebar and account menu).
- **Look.**
  - Black, stone and gold tokens in `src/styles/base.css`.
  - The black sidebar uses gold for active items (`shell.css`).
  - Headings and large figures use an Apple-like sans (`--display`).
  - Hanken Grotesk and Inter Tight now load from Google Fonts in `app.html` and `index.html`.
- **Landing page (`index.html`, `src/landing.js`, `src/landing.css`).**
  - New House copy and the same palette.
  - The hero image is now the Creation of Adam, shared with the pitch.
  - The inline script is unchanged; the CSP pins it by hash.
- **Tests.** 1,058 of 1,058 pass, including a unit test for the legacy tier mapping. Lint and build pass.
- **Docs.** README, `docs/ARCHITECTURE.md` and `TASKS.md` are updated.

## Waiting on the owner: one SQL paste

The file is `supabase/migrations/20261020120000_house_identity.sql`. It is safe to run more than once. Paste it into the
Supabase SQL editor of the live project, `gughgswzovomkxjlqvsr`. Claude's connector and CLI cannot reach that account.

It does four things:
- Renames the shared ladder to Member, Private and Black Label, with the House lines and perks for new Studios.
- Rewrites tier rows that still hold the original defaults.
- Moves Ivy into the Photography category.
- Adds six showcase Studios outside fashion, each with one open post:
  - Noor Haddad (Writing)
  - Theo Marsh (Music)
  - Ana Ruiz (Food)
  - Kenji Mori (Technology)
  - Maya Okafor (Education)
  - Leo Brandt (Art, film)

The app already shows the House tier names before the paste. The new showcase Studios appear only after it.

To confirm it ran, open this URL:
`https://gughgswzovomkxjlqvsr.supabase.co/rest/v1/tiers?select=id,name&apikey=<publishable key from src/config.js>`

## Known leftovers (by design)

- The landing film's transcript still says "The digital atelier", because the film itself does. A re-cut of the film
  would fix both.
- Identifiers keep their old names: `createAtelier`, `.atelier-*`, `circle_notes`, and the tier ids
  `essential`, `premium` and `signature`.
- Three database functions still raise "atelier" errors. The client rewrites that text on display.
- The fake API's sample data ("Atelier Solene", "Inner circle") is test content, not product copy.
