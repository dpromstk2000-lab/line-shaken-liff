# DPRO CAR02 V4.92 — Firewall-guarded offline calendar

## Status (2026-10-23 JST)

- Starting point: V4.91 formally accepted, GitHub Actions `39877125442`, **1,455/1,455 PASS**.
- V4.92 is **local candidate only** until review-only GitHub Actions reports SUCCESS.
- R52 release lock is true. Commercial decision stays **NO_GO/HOLD**; provider proofs **0/7**.
- Does not affect Worker, Supabase, LINE, Square, calendars, live data, billing or `main`.

## Changes

1. `car02-booking-firewalled-day-r492.mjs`: only shows synthetic day candidates after both V4.86 daily-projection and V4.91 exact-input firewall accept. Any disagreement fails closed; cannot book.
2. `car02-booking-calendar-firewalled-r492.mjs`: isolated keyboard-accessible offline UI; verifies day, time and confirmation. R488 original controller is unchanged.
3. `car02-standalone-preview-builder-r492.mjs`: generates one local HTML with inlined immutable V4.89 code and pinned V4.91/V4.92 sources, CSP sha256. It validates original V4.89 output hash, refusing modified source.
4. `CAR02_V492_FIREWALLED_STANDALONE_OFFLINE_PREVIEW.html`: self-contained artifact; double-click locally. Contains no customer form, HTTP calls, external assets, script URLs or live features.
5. `car02-booking-firewalled-ui-r492.test.mjs`: 27 Node tests covering normal selection, malicious fixture denial, expiry, keyboard focus, CSP, pinned baseline, and VM DOM mounting.

## Test and safe review

Run `node --test car02-booking-firewalled-ui-r492.test.mjs` on an isolated copy. In GitHub Actions, whole-repository regression minimum is **1,482 tests**. Local isolated fake-DOM smoke passes. Actual Chromium/browser visual inspection was **not** possible within the initial local runner; do not mark HUMAN UI PASS.

For optional visual review, download the HTML to a non-production PC, disconnect it from the network, double-click, select a demo date and half-hour time, and check the warning message. Never enter a customer's identity: there is no input field or reservation submission. Browser CSP blocks external connections in any case.

## No commercial authorization

`candidateAvailableInOfflineUi=true` only means a wholly synthetic display candidate. It does not establish real capacity or a booking reservation. Both availability and release must remain HOLD until separate, fully evidenced, authorized provider checks and real user acceptance occur. Draft PR remains unmerged.
