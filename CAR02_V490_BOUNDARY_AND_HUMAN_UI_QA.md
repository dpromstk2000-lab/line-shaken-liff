# DPRO CAR02 V4.90 — Offline boundary and human UI QA

Status: **local QA only**, review-only branch `car02-v434-review-only`.
The V4.89 standalone HTML is **unchanged**, SHA256-pinned, and already has
official GitHub Actions **1371/1371 PASS** at
https://github.com/dpromstk2000-lab/line-shaken-liff/actions/runs/39741937815 .

## Verified human UI observations (2026-10-22)

- Desktop browser offline HTML: chose synthetic date `2026-10-23`, time `10:00`,
  clicked screen-only confirmation; observed message that booking/hold/notification
  do not occur.
- Narrowed desktop browser to about 400 px: three visual captures showed a
  7-column calendar, 3-column time slots, selection summary, confirmation notice,
  safety note and footer without visible horizontal overflow or clipping.
- These are **visual observations**, not a full device-matrix test. **No actual
  phone hardware** was tested and no customer or provider acceptance was obtained.
- Only the observations are recorded. Screenshots are not shipped or embedded.

## New deterministic boundary sweep

V4.90 freezes the exact V4.89 standalone HTML checksum and tests the existing
V4.85–V4.87 synthetic-only policy, daily view and month grid under eight clocks:

1. October 2026 normal business day.
2. JST 23:59 before New Year.
3. JST 00:01 on New Year's Day.
4. January/February transition.
5. Minute before 2028 leap-day transition.
6. Minute after 2028 leap-day transition.
7. 2028 leap day midday.
8. 2028/2029 New Year transition.

Per clock it scans offsets 0–61 days and all 18 half-hour slots, comparing each
view candidate against the original V4.85 decision, plus every overlapping
month grid. Expected results: **8 clocks, 496 days, 8,928 half-hour decisions,
25 month grids**, zero mismatches. It checks day 61 excluded, synthetic day+7
closed and Sundays closed. Additional unit tests freeze mobile layout contract,
keyboard focus, CSP, and the human test's limited scope.

Local new test count: **25/25 PASS**. Baseline GitHub Node count: 1371.
The workflow verifies the 25 tests separately with TAP (because Node runner
versions aggregate nested tests differently) and also runs the whole repository
suite with the baseline minimum of 1371. The official V4.90 result is **pending**
until its actual GitHub Actions run succeeds; do not quote a hypothetical count.

## Safety boundary

- No actual booking, hold, notifications, network, Worker/LINE/Supabase access,
  SQL, deployment, billable account creation or change to GitHub main.
- R52 hard `releaseLock=true`; commercial **NO_GO/HOLD**.
- All seven independent real-provider proof categories remain **0/7**.
- Even a successful offline sweep is not an owner GO decision.
- GitHub operation (if authorized): upload only these four root files to the
  `car02-v434-review-only` branch, plus the dedicated workflow to
  `.github/workflows/`. Do not merge a Draft PR.
