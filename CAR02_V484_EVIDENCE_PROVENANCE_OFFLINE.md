# DPRO CAR02 V4.84 — Commercial evidence provenance, offline review only

Branch: `car02-v434-review-only` (never merge automatically). V4.83 official 1143/1143 PASS: [GitHub Run 39727016029](https://github.com/dpromstk2000-lab/line-shaken-liff/actions/runs/39727016029). Preserve R52 `CAR02_RELEASE_LOCK=true` and V4.83 originals. The default commercial verdict is **NO_GO/HOLD**.

## What this improves

Seven commercial acceptance gaps are enumerated with the expected provider family, so CI simulations, a plausible hash, a timestamp or an unverified human assertion **cannot** be recorded as real-provider proof. The intake can indicate missing rows, synthetic rows, CI rows and well-formed but **untrusted external metadata**. It never claims to authenticate an issuer or validate any provider.

1. Supabase Auth revocation of live sessions — `supabase`
2. Actual staff/Worker/store access control — `cross_provider`
3. Commit-time transaction authorization fence — `supabase`
4. LINE webhook, dispatch, delivery and retry — `line`
5. Offsite tamper-resistant WORM records outside CI — `independent_archive`
6. Independent signature keys, validation and rotation — `independent_kms`
7. CAR02-only isolated staging authorization and owner commercial acceptance — `owner_acceptance`

All seven remain **0/7 independently verified**. The final owner acceptance is a separate requirement and no data field in an untrusted JSON manifest grants that authority. The intake rejects unknown fields (including `ownerApproved` and `providerVerified`), forged baseline, duplicated categories, reused digest, mismatched source/environment, noncanonical or stale timestamps, and malformed evidence shape. Hash syntax is checked; the hash is **not cryptographically verified against provider contents**.

## Cost and provider isolation

- **Additional cost: ¥0** for these local/GitHub synthetic checks (subject to GitHub's own applicable limits). No paid Supabase upgrade is requested.
- No new Supabase organization/project, reuse/pausing of existing projects, SQL, RLS modification, service credentials, LINE message, Worker deploy, or billing action.
- Review-only CI contains synthetic fixtures and source checks, not actual customer/store/project identifiers or secrets.
- V4.83 read-only capacity finding: 2 other-purpose active Free projects; no apparent Free slot for CAR02. This is not evidence of a CAR02 isolated staging environment.
- The manifest classifier is never a standalone GO gate: even seven `external_metadata` rows return HOLD with zero actual verified proofs.

## CI and next boundary

New tests: 48 synthetic provenance/fail-closed cases. V4.83 baseline: 1143/1143. Target combined GitHub tests: **at least 1191**, to be verified from the actual GitHub Actions run. A local 169/169 subset is not the full repository suite.

When external proof is actually available, it must be independently checked at the relevant provider, bound to the approved CAR02-only isolation, accompanied by tamper-resistant audit evidence and reviewed by the owner. Those actions require separate scope/authorization. This V4.84 code deliberately implements none of them. No paid plan is required merely to continue offline development.
