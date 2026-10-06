# REFLUENZ task board

Orchestrator: Opus 5.5. Implementers and reviewers: Sonnet subagents. Checkers: Haiku subagents.

## Now — post formats: text, image, video (contract: `docs/POST_FORMATS.md`)

- [x] Migration `20261005153611_post_formats.sql`: `entries.kind`, `entry_media`, private `entry-media` + public `previews` buckets, kind-aware `save_entry`
- [x] Landing page forwards email-confirmation / recovery links to `/app.html`
- [x] Adversarial migration review (security + correctness) and verification of each finding
- [x] `src/media.js`: image downscale/re-encode, video metadata + poster, blurred previews
- [x] `src/api.js`: media queries, signed URLs, uploads with progress, cleanup on delete
- [x] `src/platform.js`: Text / Image / Video editor, upload progress, cards with badges, gallery and video reader, format filter
- [x] Rolled-back dry run of the migration with simulated users, then apply to production
- [x] Integration: lint + tests green across the three modules
- [x] Code review (security, correctness, UX/mobile) → verify → fix
- [x] Browser QA on localhost with real image and video uploads (creator + member + locked tier)
- [ ] Commit, push, deploy

## Paused — production v2 rebuild

Plan: `docs/ARCHITECTURE.md`. Schema draft (not applied): `docs/drafts/production_v2_schema_draft.sql`.
Covers per-creator tiers, comments, notifications, search, path routing, account deletion and more.
Reconcile it with the post-formats schema before resuming.
