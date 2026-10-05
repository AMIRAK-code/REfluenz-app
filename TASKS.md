# REFLUENZ production rebuild — task board

Orchestrator: Opus 5.5. Implementers and reviewers: Sonnet subagents. Checkers: Haiku subagents.
Contract: `docs/ARCHITECTURE.md`. Schema: `supabase/migrations/20261005150000_production_v2.sql`.

## Phase 1 — Database (orchestrator + review workflow)
- [ ] Write v2 migration: per-creator tiers, text/image/video posts, media, storage, comments, notifications, search, counters, reads, inbox, reports, rate limits
- [ ] Adversarial review: RLS/security, SQL correctness, data-migration safety; dry-run in a rolled-back transaction
- [ ] Apply to production; run behavioural RLS tests (rolled back); advisors clean
- [ ] Deploy `delete-account` edge function

## Phase 2 — Foundation (parallel)
- [ ] API layer `src/api/*` + fake API for tests + edge function source
- [ ] Core: router, store, UI kit, shell, media helpers, routes, app.html, styles, Vercel rewrites + CSP, dev server fallback, test harness
- [ ] Integration check: lint + tests green, contract alignment

## Phase 3 — Features (parallel, one agent per area)
- [ ] Auth + onboarding + landing auth-forwarding
- [ ] Home feed, Discover + search, Library
- [ ] Creator page + join/tiers dialog + Memberships
- [ ] Post page: text reader, photo gallery, video player, likes, comments, share, report, lock
- [ ] Messages + Notifications (realtime)
- [ ] Studio dashboard: stats, posts, drafts, members, circle notes
- [ ] Editor: text / photos / video posts, uploads with progress, cover, tags, access, preview, autosave draft
- [ ] Studio settings (atelier profile, avatar/cover, slug, links, tiers CRUD) + Account settings (profile, avatar, email, password, notifications, export, delete)

## Phase 4 — Review and hardening
- [ ] Security, correctness/integration, UX/a11y/responsive, error states, performance reviews → verify → fix
- [ ] Browser QA end to end on localhost (member + creator accounts, all three post kinds)
- [ ] Docs + README; deploy
