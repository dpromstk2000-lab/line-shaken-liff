# DPRO CAR02 V4.91 — booking input firewall (isolated QA only)

## Official accepted baseline

- V4.90 GitHub Actions run **39748618887**: **1396/1396 PASS**, SHA `e237f788892d5812cac9a6a7a449d2a3f5d54c86`.
- CI URL: https://github.com/dpromstk2000-lab/line-shaken-liff/actions/runs/39748618887
- V4.89 standalone HTML remains byte-identical. V4.85–V4.90 accepted sources are not edited.
- R52 `releaseLock=true`; commercial decision `NO_GO_HOLD` (0/7 commercial proofs).

## New work

V4.91 adds a **new, unattached in-memory adapter** for displaying synthetic booking candidates only. It validates that request and calendar payloads have exactly their expected own data keys, no symbol/extra/derived keys, no getters, no inherited claims, no sparse inventory arrays, and a plain valid Date. Exceptions fail closed. It delegates calendar policy to existing V4.85 and normalizes returned decisions to a frozen `HOLD` object, never a reservation authority. No original API, UI, production release gate, or database operation changes.

The 59 new tests cover valid synthetic fixtures, immutable/no-PII outputs, timezone boundaries, malformed dates, half-hour constraints, closures/occupied slots, missing one-year coverage, property injection, accessors, symbols, inherited objects, arrays, Date subclasses, and a throwing proxy. These tests **do not prove security of all possible runtime objects or any live system**.

### Local checks (2026-10-22)

- `node --test-reporter=tap v481_source/car02-booking-input-firewall-r491.test.mjs` → **59/59 PASS**.
- `node --test v481_source/car02-*.test.mjs` → **11/11 test files PASS** (local runner's file count; not GitHub's total test count).
- V4.91 CI will separately assert 59 TAP tests and at least **1455** whole-repository Node tests. **Until GitHub Actions succeeds, V4.91 is READY, not formally PASS.**

### Release decisions

This new adapter is **not connected to the customer-facing V4.89 HTML**, nor to a live booking route. The actual phone/device UI, real provider permissions, message delivery, WORM evidence, key rotation, and 7 commercial proofs remain unverified. Never merge or deploy based on these local results.

### Upload destination

GitHub branch `car02-v434-review-only` only. Root files under repository root; workflow at `.github/workflows/car02-v491-offline-input-firewall-qa.yml`. The R52 lock, V4.89 accepted HTML, V4.90 accepted workflow, `main`, production Worker, LINE and shared Supabase must stay unchanged.
