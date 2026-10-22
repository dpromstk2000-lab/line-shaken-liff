# DPRO CAR02 V4.85 — Booking calendar and 1-year shop closures (offline)

This change is a new, isolated-qa **candidate availability calculator**. It does not modify or connect any existing CAR02 booking page, HTTP handler, PostgreSQL fixture, Supabase, Worker, LINE, credentials, customer identity or live reservation. Branch `car02-v434-review-only`; GitHub main untouched; commercial **NO_GO/HOLD** and R52 release lock unchanged.

Baseline: [V4.84 official PASS 1191/1191, Run 39730053633](https://github.com/dpromstk2000-lab/line-shaken-liff/actions/runs/39730053633).

## Policies maintained and improved

- Preserve the actual *isolated QA* booking validation rules: Asia/Tokyo timezone; strictly future slot, half-hours starting at `:00` or `:30`; `09:00` through `17:30` inclusive; Sundays closed; maximum booking lead time 60 days. This is **not** authority to extend customer booking acceptance to 365 days.
- Separately require a supplied calendar coverage declaration through one calendar year ahead (with Feb 29 rollover). Custom closure dates can be listed for that full year even though bookings remain limited to 60 days.
- Reject missing annual coverage, malformed dates, duplicate closures, closures outside the declared period, duplicate or invalid synthetic occupied slots, unexpected fields, wrong environment and untrusted accessors.
- Reject past bookings, already elapsed same-day starts, times outside half-hour boundaries, Sunday, declared shop closure and occupied candidate slots.
- The schedule/closure declaration is **untrusted offline input**. Neither an official national holiday API nor the store owner was contacted. A declared closure is not verified owner approval; missing closures must not be interpreted as confirmation that a shop is open.
- Even when the result is `candidate_available_offline_only`, it always reports `bookingCreationAllowed=false`, `databaseMutationAllowed=false`, `lineDispatchAllowed=false`, `releaseLock=true`, `0/7` commercial provider proofs. No booking ID or reservation is generated.

## Example (local only)

```js
import {evaluateCar02BookingCalendarR485} from './car02-booking-calendar-policy-r485.mjs';
const answer=evaluateCar02BookingCalendarR485({
  now:new Date('2026-10-22T01:10:00Z'), // 10:10 JST
  selection:{day:'2026-11-05',time:'10:30'},
  calendar:{systemCode:'CAR02',environment:'isolated_qa',
    coverageThrough:'2027-10-22',
    closedDays:['2026-11-03'],occupiedSlots:['2026-11-04T10:30']}
});
// answer.candidateAvailableInOfflineUi === true
// answer.bookingCreationAllowed === false; answer.decision === 'HOLD'
```

## Verification and next binding boundary

V4.85 adds 53 isolated tests. Baseline V4.84 1191/1191 means GitHub's combined CI should show **at least 1244/1244**; this must be confirmed from actual logs, not assumed from local subset tests. Include an additional read-only comparison with the previously pinned V1.5/V1.6 isolated QA validators. No existing source may be altered as part of this change.

Actual owner holiday calendar approval and integration into a CAR02-only isolated staging DB would be a **separate** authorized activity. Free local tests continue without requiring a new Supabase project or paid plan.
