# DPRO CAR02 V4.89 — double-click standalone offline demo

Official V4.88 GitHub Actions baseline: [39740405022](https://github.com/dpromstk2000-lab/line-shaken-liff/actions/runs/39740405022) — 1356/1356 PASS, zero failures, branch commit `983a748795ace5ce54fe79cb2da73414b37d4807`.

## What changed

V4.87/V4.88's read-only HTML required a same-origin local web server because
it loaded `.mjs` modules. A normal Windows double-click on a downloaded
`file:///...html` would not reliably load those modules. V4.89 produces the
complete self-contained
`CAR02_V489_STANDALONE_OFFLINE_BOOKING_PREVIEW.html`:

- One HTML file; five existing JavaScript modules embedded into independent
  closures to preserve the original private scopes and avoid name collisions.
- No npm, bundler dependency, CDN, hosting, Worker, browser extension, API,
  real provider, database, client information or credentials required.
- Source SHA-256 pinned for the five existing modules and one HTML template.
  A changed baseline refuses the build instead of silently changing the demo.
- The generated inline script is protected by its calculated CSP SHA-256 hash.
  `default-src 'none'; connect-src 'none'; img-src 'none'` still blocks remote
  content. It has no external script/CSS references or customer input forms.
- The V4.88 keyboard controls and no-booking simulated confirmation remain
  operational. A fresh opening uses the computer's current date and Japan
  Standard Time for fake candidate generation.
- Local emulator tests execute the embedded JavaScript against a fake DOM,
  proving that date→time→confirmation works without network calls. This is
  not a screenshot or a manual real-browser acceptance test.

## How to view

1. Download the separate `DPRO_CAR02_OFFLINE_PREVIEW_V489_20261022.zip`.
2. Extract the ZIP and double-click the only HTML file. Chrome or Edge should
   render the offline candidate calendar without a server or internet access.
3. Select a synthetic day and time and click "選択内容を画面で確認する". It will
   confirm only the display state, never save anything.

The preview is **not** the production dashboard. It is **not a real appointment
booking service**; no reservation, hold, cancellation, staff approval, real
capacity, payment, notification or provider connection is performed. Real
commercial acceptance proofs are 0/7, NO_GO/HOLD and R52 release lock true.

## CI

15 new tests (source integrity, deterministic output, CSP SHA-256, no network,
offline DOM behavior) PASS locally. Recent local regression: 349/349 PASS.
Official V4.89 GitHub Actions acceptance target: at least 1371/1371 PASS,
failures zero. GitHub upload: 5 root files first, then one YAML to
`.github/workflows/`, *only* on review branch `car02-v434-review-only`.
