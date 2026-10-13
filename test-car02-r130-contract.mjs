/** R130 static safety contracts. This is NOT a production security certification. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const code=fs.readFileSync('car02-r130-recovery-review-isolated.mjs','utf8');
const previous=fs.readFileSync('car02-r129-escrow-recovery-isolated.mjs','utf8');
const priorWitness=fs.readFileSync('car02-r128-witness-escrow-isolated.mjs','utf8');
const cases=fs.readFileSync('test-car02-r130-recovery-review.mjs','utf8');
const yml=fs.readFileSync('.github/workflows/car02-r130-dual-review-hold-isolated-qa.yml','utf8');
const checks=[
 ['release_locked',()=>assert.match(code,/release:'NO_GO'/)],
 ['migration_held',()=>assert.match(code,/migration:'HOLD'/)],
 ['explicit_nonproduction',()=>assert.match(code,/productionReady:false/)],
 ['offline_flag_required',()=>assert.match(code,/R130_OFFLINE_QA==='yes'/)],
 ['old_offline_flag_still_required',()=>assert.match(code,/R129_OFFLINE_QA==='yes'/)],
 ['safe_temp_root_prefix',()=>assert.match(code,/startsWith\('car02-r129-'\)/)],
 ['no_file_write_calls',()=>assert.doesNotMatch(code,/\bfs\.(?:writeFile|rename|unlink|rm|mkdir|rmdir|copyFile|openSync|truncate|appendFile)(?:Sync)?\(/)],
 ['no_network_client_imports',()=>assert.doesNotMatch(code,/from ['"](?:node:)?(?:https?|net|tls|child_process)['"]|fetch\s*\(/)],
 ['old_signed_witness_validation',()=>assert.match(code,/inspectIndependentEscrow\(/)],
 ['real_r129_fingerprint',()=>assert.match(code,/version:'R129',operationId,registryRecords,projected/)],
 ['old_version_pending_only',()=>assert.match(code,/intent\.status==='PENDING'/)],
 ['disk_change_detected',()=>assert.match(code,/SNAPSHOT_CHANGED/)],
 ['late_review_rechecks_freshness',()=>assert.match(code,/prepareManualRecoveryReview\(\{\.\.\.context,nowMs\}\)/)],
 ['signature_validation',()=>assert.match(code,/verify\(null,Buffer\.from\(message\)/)],
 ['two_independent_reviewer_keys',()=>assert.match(code,/SAME_REVIEWER_KEY/)],
 ['revoked_signer_guard',()=>assert.match(code,/REVIEWER_REVOKED/)],
 ['lock_not_cleared',()=>assert.match(code,/lockRemovalAuthorized:false/)],
 ['manual_replay_not_auto',()=>assert.match(code,/automaticRecoveryAuthorized:false/)],
 ['external_pin_still_required',()=>assert.match(code,/independentPinPublicationRequired:true/)],
 ['real_external_store_not_claimed',()=>assert.match(code,/externalStoreVerificationRequired:true/)],
 ['prior_witness_requires_real_signature',()=>assert.match(priorWitness,/verify\(null,Buffer\.from\(encode\(p\)\)/)],
 ['r129_source_still_has_pending_hold',()=>assert.match(previous,/PENDING_MANUAL_HOLD/)],
 ['forty_two_cases',()=>assert.equal((cases.match(/test\('R130_/g)||[]).length,42)],
 ['checkout_readonly',()=>assert.match(yml,/permissions:\s*\n\s*contents: read/)],
 ['protected_originals_gate',()=>assert.match(yml,/car02_r118_readonly_source_gate\.py --strict/)],
 ['three_rounds',()=>assert.match(yml,/for i in 1 2 3;/)],
 ['no_secret_deploy',()=>assert.doesNotMatch(yml,/secrets\.|wrangler\s+deploy|supabase\s+db\s+push|git\s+push/i)],
 ['credentials_not_persisted',()=>assert.match(yml,/persist-credentials: false/)],
];
for(const [name,check] of checks)test('R130_'+name,check);
