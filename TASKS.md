# REFLUENZ task board

Orchestrator: Opus 5.5. Implementers and reviewers: Sonnet subagents. Checkers: Haiku subagents.

## Done — post formats: text, image, video (contract: `docs/POST_FORMATS.md`)

- [x] Migration `20261005153611_post_formats.sql` (applied), media pipeline, editor, cards, reader
- [x] Landing page forwards email-confirmation / recovery links to `/app.html`
- [x] Reviews, browser QA, 155 tests; merged to `main` and live on refluenz.com

## Now — platform v2 (contract: `docs/ARCHITECTURE.md`)

### Phase 1 — Database
- [x] Reconciled additive migration `20261006090000_platform_v2.sql` (per-creator tiers over the access ladder, avatars/covers, guest browsing, comments, counters, reads, inbox, notifications, reports, search, stats, rate limits)
- [ ] Adversarial review: dry run with simulated users, security, correctness, backward compatibility, performance → verify → fix
- [x] Applied to production (`20261006231142_platform_v2.sql`, `20261006231241_platform_v2_indexes.sql`)
- [ ] Advisors clean on production
- [ ] Edge function `delete-account`: written (`supabase/functions/delete-account`), **deploy pending** with `--no-verify-jwt` (see README)

### Phase 2 — Foundation
- [x] API layer `src/api/*` (media ported verbatim) + fake API + api tests (`tests/api-v2.test.mjs`, `tests/contract.test.mjs`)
- [x] Core: router, store, UI kit, covers, shell, routes, app.html, styles, Vercel rewrites + headers, dev-server fallback, test harness
- [x] Integration check

### Phase 3 — Features (built and unit-tested; not yet checked in a real browser)
- [x] Auth + onboarding + landing CTAs (expired-link errors reach the sign-in page)
- [x] Home feed, Discover + search, Library
- [x] Creator page + join dialog + Memberships
- [x] Post page: text, gallery, video, likes, comments, share, report, lock
- [x] Messages + Notifications (realtime)
- [x] Studio: stats, posts, drafts, members, circle notes
- [x] Editor: text / image / video (POST_FORMATS save flow), text cover upload
- [x] Studio settings (atelier, avatar/cover, slug, links, tiers) + Account settings (profile, avatar, email, password, notifications, export, delete)

### Phase 4 — Review, QA, ship
- [x] Cutover: old `platform.js`, `store.js`, `platform.css` and their tests removed (coverage ported), `src/api.js` re-exports the new data layer, docs and README updated
- [x] Cross-feature checks: every link lands on a route (`tests/links.test.mjs`), every stylesheet linked, dev server serves every module and route
- [ ] Security, correctness/integration, UX/a11y/mobile, resilience, performance reviews → verify → fix
- [ ] Browser QA end to end (guest, member, creator; all three post kinds) at 375 px, tablet and desktop
- [ ] Deploy the edge function, merge, deploy, verify live

### Later
- [ ] Payments (Stripe Checkout + webhook), when funded: see README "Payments"
- [ ] Remove an uploaded text-post cover that was never attached (needs an api method to delete one cover file; harmless until then)
- [ ] Click the Retry button in the view tests that call `router.reload()` instead (the listener bug they worked around is fixed)
- [ ] Remove the legacy mock server `backend/server.js` and `public/mock/*` (unused by the app)
