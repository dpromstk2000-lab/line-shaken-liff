# DPRO CAR02 V4.94 — Readability-only offline demo

Date: 2026-10-23 JST. Review-only branch `car02-v434-review-only`.

## Accepted starting point

V4.93 formally accepted, GitHub Actions run `39885099015`: **1,503/1,503 PASS**.
https://github.com/dpromstk2000-lab/line-shaken-liff/actions/runs/39885099015

## V4.94 changes

An additive CSS patch increases default text size, disabled-state contrast,
keyboard focus outline and touch-target height, with a two-column time grid
on screens at most 380px wide. The script in the accepted V4.93 standalone
HTML remains **byte-for-byte identical**, with its SHA256 CSP unchanged.

The builder pins V4.93 HTML SHA256
`e663a41545136a08dbb7f0811885a9c23c7153cdef6f433615e7460398b7c9a3`.
New HTML SHA256 is
`ac2d04c351892d218894926ea3fd2e45fef399e996b177778f94baadf5be663e`.

## QA

- New V4.94 local TAP tests: **18/18 PASS**.
- Local regression (all available tests): **499/499 PASS**.
- GitHub Actions required: minimum **1,521/1,521 PASS** including previous accepted coverage.
- No actual Chromium/browser executable available in test environment. Do not
  label real-device visual QA or HUMAN ACCEPTANCE PASS.

## Non-negotiable protections

R52 releaseLock=true; production Worker, shared Supabase, LINE, billing,
GitHub main and real customer data must not be changed. No PR merge.
Commercial **NO_GO/HOLD**, verified provider proofs **0/7**.

Demo only: all candidate slots are synthetic, there are no forms, provider
requests, actual reservations, holds, billing operations or notifications.

## Upload ZIP policy

The GitHub repository-root ZIP contains only directly uploadable files at ZIP
root. The workflow ZIP contains exactly the one `.yml` at ZIP root, because
the user opens `.github/workflows/` in GitHub before uploading. The handoff ZIP
is separate and is not a GitHub upload artifact.
