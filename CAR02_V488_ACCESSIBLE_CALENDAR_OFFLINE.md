# DPRO CAR02 V4.88 — Accessible Review-Only Calendar

Official V4.87 baseline: [GitHub Actions run 39739191331](https://github.com/dpromstk2000-lab/line-shaken-liff/actions/runs/39739191331) — **1330/1330 PASS, zero failures**, 2026-10-22. Baseline review-branch HEAD: `f41c5ae28ec2753804d4c357beaef64629e80f31`.

## User-visible corrections

- In V4.87, clicking a day rebuilt the whole calendar and clicking a time rebuilt
  the whole time grid, removing the activated button and potentially losing
  keyboard/screen-reader focus. V4.88 changes selected styles in place, keeping
  both button identity and focus stable.
- The available calendar dates now use a single Tab stop, Left/Right/Up/Down
  arrows for candidate-day movement, and Home/End for the actual Monday-first
  week (including partial weeks). Disabled days are skipped.
- A live status announcement identifies the selected day/time without claiming
  booking success. Selected button state uses `aria-pressed`; current day uses
  `aria-current=date`.
- All candidate slots are rechecked at click and simulated confirmation time,
  so an elapsed slot is refused after a clock change. No real reservation is made.
- Responsive HTML from V4.87 remains intact; the review-specific V4.88 HTML is
  never automatically published to GitHub Pages or a Worker.

## Immutable business rules

- All V4.85-V4.87 policies and official QA files are preserved byte-for-byte;
  no new provider, remote availability, approved shop schedule, staff identity,
  booking write, payment, customer data or LINE dispatch is introduced.
- Japanese 30-minute time slots, 09:00–17:30; 60-day booking window; one-year
  synthetic closure inventory requirement; Sunday and synthetic closure rules.
- HTML CSP `connect-src 'none'`, no forms, no customer input, noindex. All
  displayed availability is **synthetic offline data**, not live availability.
- R52 hard release lock remains `true`. Commercial decision is **NO_GO/HOLD**;
  verified real commercial provider proofs **0/7**. Nothing here approves a sale.

## QA and upload

26 new automated tests pass locally, with 334/334 recent local regression tests.
The repository-wide official GitHub target is >=1356/1356, zero failures.

1. Upload only the five V4.88 root-source files from the ROOT ZIP to the root
   of `car02-v434-review-only`.
2. Upload only `car02-v488-accessible-calendar-offline-qa.yml` from the WORKFLOWS
   ZIP to that branch's `.github/workflows/` directory.
3. Verify official GitHub Actions job and its log counters; keep `main` and
   production untouched. Never merge the Draft PR without authorization.
