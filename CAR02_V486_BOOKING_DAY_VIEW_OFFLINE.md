# CAR02 V4.86 | Synthetic Booking Day View | Offline Only

## Purpose

Provide a bounded calendar-day view model for the eventual CAR02 booking UI,
derived exclusively from the unchanged V4.85 local synthetic availability
decision. This work does not connect, authenticate, check genuine capacity,
create reservations, send LINE messages, change billing, or deploy anything.

## Inputs and outputs

- Exact top-level input keys: `day`, `calendar`, `now`.
- Calendar must be V4.85 `systemCode=CAR02`, `environment=isolated_qa`,
  with a validated one-calendar-year `coverageThrough`, synthetic `closedDays`
  and `occupiedSlots`. Real owner approval / statutory holidays are unverified.
- Candidate rows run from `09:00` to `17:30` in 30-minute steps (18 maximum).
- Possible row states: `candidate`, `occupied`, `elapsed_or_out_of_window`.
- Closure, Sunday, invalid data and out-of-window days do not disclose rows.
- Each `candidate` flag must equal the existing V4.85
  `candidateAvailableInOfflineUi` flag for the exact day/time.
- Results and nested arrays/rows are immutable and exclude customer identities
  and backend identifiers. Candidate is never booking authorization.

## Conditions that remain invariant

- Existing R52 `CAR02_RELEASE_LOCK=true`; `NO_GO/HOLD`; 0/7 genuine commercial
  provider proofs; GitHub `main`, Worker, Supabase and LINE untouched.
- Existing QA booking horizon 60 days. One-year metadata horizon is for
  closure coverage, **not** permission to book one year ahead.
- `Asia/Tokyo`, Sundays closed, past times forbidden, 30-minute start grid.
- Data comes only from isolated synthetic fixtures. Actual occupancy, owner
  calendar, holidays and identity still require future integrations and proofs.

## Verification

V4.85 baseline [39735698096](https://github.com/dpromstk2000-lab/line-shaken-liff/actions/runs/39735698096):
1244/1244 GitHub Actions PASS. V4.86 adds 44 local tests; minimum expected
next GitHub count 1288. Official V4.86 CI is pending until the manual review-
branch source and workflow uploads are performed.

## Upload destinations (never `main`)

1. The four new V4.86 source/contract/README files belong directly at the
   repository root of branch `car02-v434-review-only`.
2. The single V4.86 workflow YAML belongs at `.github/workflows/` on that
   same review branch. Keep the upload packages separate.

Neither upload constitutes commercial release or any provider proof.
