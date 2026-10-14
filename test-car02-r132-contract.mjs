/** R132 static nonproduction contract. Its checks are not production approvals. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=fn=>fs.readFileSync(fn,'utf8');
const src=read('car02-r132-readiness-gate-isolated.mjs');
const old=read('car02-r131-independent-hold-seal-isolated.mjs');
const tests=read('test-car02-r132-readiness-gate.mjs');
const yml=read('.github/workflows/car02-r132-preproduction-blockers-isolated-qa.yml');
const checks=[
['release_no_go',()=>assert.match(src,/release:'NO_GO'/)],
['migration_hold',()=>assert.match(src,/migration:'HOLD'/)],
['cannot_authorize_deploy',()=>assert.match(src,/deployAuthorized:false/)],
['cannot_authorize_db_migration',()=>assert.match(src,/databaseMigrationAuthorized:false/)],
['cannot_release_hold',()=>assert.match(src,/automaticHoldReleaseAuthorized:false/)],
['no_production_writes',()=>assert.match(src,/productionWritesAllowed:false/)],
['does_not_claim_external_auth',()=>assert.match(src,/realAuthVerified:false/)],
['does_not_claim_external_evidence',()=>assert.match(src,/externalProofVerified:false/)],
['requires_release_lock',()=>assert.match(src,/CAR02_RELEASE_LOCK/)],
['requires_r132_offline_flag',()=>assert.match(src,/R132_OFFLINE_QA/)],
['upstream_r131_held',()=>assert.match(old,/migration:'HOLD'/)],
['enforces_12_gate_catalog',()=>assert.equal((src.match(/\['[A-Z_]+','[a-z]+',/g)||[]).length,12)],
['candidate_data_only',()=>assert.match(src,/DOCUMENT_REFERENCE_ONLY/)],
['rejects_cross_tenant',()=>assert.match(src,/CROSS_TENANT/)],
['rejects_forged_approval',()=>assert.match(src,/ASSERTION_UNTRUSTED/)],
['report_digest_not_signed',()=>assert.match(src,/NOT a signature/)],
['rejects_policy_tamper',()=>assert.match(src,/POLICY_TAMPERED/)],
['rejects_forged_gates',()=>assert.match(src,/GATE_FORGED/)],
['no_fs_writes',()=>assert.doesNotMatch(src,/\b(?:fs|fsp)\.(?:writeFile|rename|unlink|rm|mkdir|copyFile|openSync|truncate|appendFile)(?:Sync)?\s*\(/)],
['no_network_or_runtime_deploy',()=>assert.doesNotMatch(src,/\bfetch\s*\(|\bwrangler\s+deploy\b|\b(?:https?|net|tls|child_process)\b/)],
['tests_52_cases',()=>assert.equal((tests.match(/test\('R132_/g)||[]).length+ (tests.match(/test\(`R132_gate_/g)||[]).length *12,52)],
['checkout_is_readonly',()=>assert.match(yml,/permissions:\s*\n\s*contents: read/)],
['checkout_without_credentials',()=>assert.match(yml,/persist-credentials: false/)],
['protect_originals_strict',()=>assert.match(yml,/car02_r118_readonly_source_gate\.py --strict/)],
['test_three_rounds',()=>assert.match(yml,/for i in 1 2 3;/)],
['no_secrets_or_deploy',()=>assert.doesNotMatch(yml,/secrets\.|\bwrangler\s+deploy\b|\bsupabase\s+db\s+push\b|git\s+push/i)],
['write_only_synthetic_local_evidence',()=>assert.match(yml,/qa-evidence-r132/)],
['gate_stays_closed',()=>assert.match(yml,/R132_NO_GO_HOLD_GATE_PASS/)],
];
for(const [name,fn] of checks)test(`R132_contract_${name}`,fn);
