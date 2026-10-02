# Atelier platform — implementation and verification ledger

## Constraints
- `index.html` is the visual source of truth: #fbf9f9 paper, #000 ink,
  #715b33 bronze, Hanken Grotesk, square geometry, hairline rules, editorial scale.
- Preserve landing composition and core positioning. No new accent palette.
- Demo is explicitly local, with no real payments, accounts, messages or analytics.
- Work in `feature/atelier-platform`. Verify each round, update this ledger, commit.
- Do not push or merge. Upstream Git history was not in the supplied ZIP.
- README read in full. No CLAUDE.md, AGENTS.md or handoff found in the archive.

## Rounds
- [x] 0. Audit archive, record design contract, preserve baseline, create feature branch.
  Verified: archive file inventory, current app and API, entrypoints and deployment config.
  Found: inert controls, false-success network fallbacks, remote-only assets, catch-all routing.
- [x] 1. Ship self-contained landing and editorial platform shell with meaningful demo links.
  Verified: dependency-free production build, JavaScript syntax/imports, local page asset paths.
  Implemented: shared palette, square geometry, editorial landing/demo links, responsive shell.
  Browser screenshots blocked: Chromium unavailable; download denied by network policy.
  Hanken Grotesk declaration retained with local Arial fallback; font asset not supplied.
- [x] 2. Complete member flows: discovery/filter/search, article reader, bookmarks, follows,
  tier access, membership changes, conversation history, account preferences, data export/reset.
  Verified: unit tests for reload persistence, membership access hierarchy, corrupt storage,
  atomic storage failures, safe text output and data export. Native dialog semantics used.
  Supplied browser journey suite; execution remains blocked by missing Chromium.
- [x] 3. Complete creator studio: draft, preview, publish, edit/delete, circle broadcast,
  member CSV, transparent sample metrics; harden storage and validation.
  Verified: lightweight interface integration tests mount all seven views, run member actions,
  save/publish/delete a creator entry, switch roles, and publish a circle note.
  10 tests pass. These tests do not substitute for browser layout or keyboard verification.
- [ ] 4. Run desktop/mobile and keyboard QA, fix issues, document real deployment boundaries.
  Completed available checks: build, syntax/imports/assets, 10 logic/interface tests.
  Outstanding gate: actual browser layout, keyboard, screenshots and console checks.
  Chromium installation was denied (HTTP 403); browser suite supplied for local execution.
  See docs/VERIFICATION.md and README for exact limitations and launch boundaries.
- [ ] 5. Produce 30-second motion film with the same art direction; integrate into landing.
  Verify: duration, resolution, representative frames, playback, reduced-motion behavior.
- [ ] 6. Final clean build, round commits, portable patches and source ZIP; handoff for one push.

## Architecture decision
Dependency downloads, old external images and CDNs are unavailable in this workspace.
Use native ES modules and a dependency-free Node static build/server for the pitch demo.
This deliberately replaces the unfinished React shell while retaining the original in Git.
Existing backend remains a separate mock development API, not a production service.
No app flow silently falls back from a failed server call to invented success.

## Release scope
This is a polished, functional browser-local demonstration. Production auth, database,
payment processing, moderation, email delivery and cross-device sync require integration.
No claim of production readiness will be made without those services.
