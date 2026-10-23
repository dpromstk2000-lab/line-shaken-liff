# DPRO CAR02 V4.97 — Offline calendar initial label consistency

Date: 2026-10-23 (JST). Review branch: `car02-v434-review-only`.

## Starting point

- V4.96 formally accepted: GitHub Actions run 39890429319, 1,577/1,577 PASS.
- V4.94 standalone offline calendar accepted: SHA256 `ac2d04c351892d218894926ea3fd2e45fef399e996b177778f94baadf5be663e`.
- 2026-10-23 desktop human acceptance images: calendar/date/time choice, confirmation button, synthetic confirmation message visible and correct. **PC basic calendar UI PASS**.
- Smartphone real-device acceptance and real booking/provider integration remain **NOT VERIFIED**.

## Narrow patch

The initial calendar status message inherited the `V4.92` label although the visible V4.94 preview heading/footer were current. V4.97 changes **only one inline JavaScript text literal**, `announce('V4.92 安全な隔離プレビューです。すべて架空の候補です。')` to the identical text with `V4.97`, plus three display-only title/header/footer labels. No accepted source is overwritten. The historic internal V4.92 controller's protocol version and booking checks stay intact.

Changing an inline script requires updating its CSP SHA256. The builder pins the accepted HTML bytes, applies the four exact-once replacements, recalculates the CSP hash for the adjusted script, and validates the unchanged strict `default-src 'none'`, `connect-src 'none'`, and `form-action 'none'` directives. CSS is byte-identical to accepted V4.94. No network or storage calls are added.

New generated standalone preview HTML SHA256: `406ac21e84de128a00d4bcbe636e6186eb89897a243c2b0a820fb5258ba3dc3e`.

## QA gate

- 30 dedicated offline label/security tests: **30/30 PASS (local)**.
- All locally available regression tests: **585/585 PASS** (`node --test --test-isolation=none v481_source/car02-*.test.mjs`). This is not equivalent to GitHub CI.
- GitHub Actions minimum: **1,607/1,607 PASS** (1,577 accepted + 30 new).
- Until GitHub Actions PASS, V4.97 remains **local candidate**, V4.96 retains formal acceptance.

## Protected boundaries

R52 `releaseLock=true`; commercial **NO_GO/HOLD**; independent real-provider proofs **0/7**. Production Worker, shared Supabase, LINE, GitHub main, billing, real bookings and all real customer data unchanged. No Draft PR merge.

## Upload policy

GitHub ROOT ZIP: only five directly uploadable V4.97 files at ZIP root. Workflow YAML: a separate ZIP with one `.yml` at ZIP root, to be uploaded specifically into `.github/workflows/`. Handoff ZIP is for new-chat continuity only and never for direct GitHub upload.
