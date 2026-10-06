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
- [ ] Apply to production; advisors clean; deployed client still works
- [ ] Edge function `delete-account`

### Phase 2 — Foundation (parallel)
- [ ] API layer `src/api/*` (media ported verbatim) + fake API + api tests
- [ ] Core: router, store, UI kit, covers, shell, routes, app.html, styles, Vercel rewrites + headers, dev-server fallback, test harness
- [ ] Integration check

### Phase 3 — Features (parallel)
- [ ] Auth + onboarding + landing CTAs
- [ ] Home feed, Discover + search, Library
- [ ] Creator page + join dialog + Memberships
- [ ] Post page: text, gallery, video, likes, comments, share, report, lock
- [ ] Messages + Notifications (realtime)
- [ ] Studio: stats, posts, drafts, members, circle notes
- [ ] Editor: text / image / video (POST_FORMATS save flow), text cover upload
- [ ] Studio settings (atelier, avatar/cover, slug, links, tiers) + Account settings (profile, avatar, email, password, notifications, export, delete)

### Phase 4 — Review, QA, ship
- [ ] Security, correctness/integration, UX/a11y/mobile, resilience, performance reviews → verify → fix
- [ ] Browser QA end to end (guest, member, creator; all three post kinds)
- [ ] Delete replaced modules, docs, merge, deploy, verify live
