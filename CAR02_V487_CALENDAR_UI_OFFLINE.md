# DPRO CAR02 V4.87 — Read-Only Booking Calendar UI Preview

V4.86 baseline GitHub Actions: [39737344624](https://github.com/dpromstk2000-lab/line-shaken-liff/actions/runs/39737344624), 1288/1288 PASS.

## Added UI, not commercial booking

The new `CAR02_V487_BOOKING_CALENDAR_READONLY_PREVIEW.html` is a review-only,
same-origin HTML/module preview. It uses the new pure Monday-first month grid,
the immutable V4.86 18-slot day model and the unchanged V4.85 calendar rules:

- Accessible date/time buttons and keyboard focus indicators; selected state
  and live announcement for screen readers.
- Responsive design (large readable text, 7-day calendar on mobile,
  4/3-column 30-minute time grid and unclipped bottom cards).
- Prevent past days/times, Sundays, declared synthetic closure days, synthetic
  occupied time slots and dates more than 60 days ahead. Treat one-year closure
  coverage separately from 60-day booking window.
- Fake closed/occupied data is generated from a fixed shape relative to the
  current Asia/Tokyo calendar date. These are **not** approved store holidays or
  authentic booking availability.
- Read-only final confirmation checks availability again, but cannot reserve,
  save, authenticate, issue a payment, send LINE or call a service.
- Browser CSP enforces `connect-src 'none'`, forms and external media blocked,
  noindex/nofollow. No customer names, telephone or vehicle registration input.

The preview is NOT a production dashboard, and it is not published by merely
committing this file to the review branch. Future owner-approved capacity and
provider connections remain unverified, as do all seven real commercial
provider proofs. Release lock remains true, decision stays NO_GO/HOLD.

## GitHub upload sequence

1. Place the six new V4.87 root files in the root of branch
   `car02-v434-review-only` using the dedicated ROOT ZIP.
2. Separately place the one V4.87 workflow YAML inside `.github/workflows/`
   on the same review branch using the dedicated WORKFLOWS ZIP.
3. Verify GitHub Actions tests >=1330/1330 with fail=0, baseline pins and
   synthetic UI parity. Never merge the Draft PR or deploy to `main`.

Tests added: 42 local tests (time math, leap years, valid/invalid month grids,
baseline day candidate parity, DOM button click flow, CSP/no network and
responsive HTML). Official V4.87 GitHub CI is pending manual review uploads.
