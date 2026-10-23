# DPRO CAR02 V4.93 — Resilient offline booking preview

Date: 2026-10-23 JST. Review-only branch `car02-v434-review-only`.

## Accepted starting point

V4.92: GitHub Actions run `39879720241`, **1,482/1,482 PASS**.
https://github.com/dpromstk2000-lab/line-shaken-liff/actions/runs/39879720241

Do not modify the R52 production release lock, V4.89 or V4.92 accepted HTML, V4.91 firewall, V4.92 controller, production Worker, shared Supabase, LINE, billing, or GitHub main. Draft PR remains unmerged; commercial decision **NO_GO/HOLD**; provider proof count **0/7**.

## V4.93 changes

`car02-booking-calendar-resilient-r493.mjs` is a new outer safety boundary around the accepted V4.92 isolated UI controller. It checks exact safe Date shape, clones the clock instant before use, catches thrown clock/fixture calls, and fail-closes the controls if initial UI construction fails. It never introduces an endpoint, customer form or write authority.

`car02-standalone-preview-builder-r493.mjs` pins accepted V4.92 standalone HTML SHA256 and the new resilience module SHA256, then builds `CAR02_V493_RESILIENT_STANDALONE_OFFLINE_PREVIEW.html` with an exact SHA256 CSP for one inline script. The original V4.92 HTML is never changed.

## Local QA

- New V4.93 Node tests: **21/21 PASS**.
- All locally available CAR02 tests: **481/481 PASS**.
- Actual Chromium/browser binary unavailable in initial workspace: **real-browser visual/hardware QA not performed**. VM DOM and synthetic keyboard interactions tested; do not label HUMAN ACCEPTANCE PASS.
- Expected GitHub whole-repository suite: **1,503 tests** or more, all PASS. V4.93 is not formally accepted until a successful GitHub Actions run.

## Offline demo instructions

To inspect later, download the one-file HTML, disconnect the testing PC from the network, and double-click it. Use only synthetic dates and times. Never enter real customer information. Closing and reopening the file does not store data; the interface never books, holds, notifies or calls providers.
