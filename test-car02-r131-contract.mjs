/** Static guardrails for R131; not live production authorization. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync('car02-r131-independent-hold-seal-isolated.mjs','utf8');
const prev=fs.readFileSync('car02-r130-recovery-review-isolated.mjs','utf8');
const cases=fs.readFileSync('test-car02-r131-independent-hold-seal.mjs','utf8');
const yml=fs.readFileSync('.github/workflows/car02-r131-independent-hold-seal-isolated-qa.yml','utf8');
const requirements=[
 ['release_is_no_go',()=>assert.match(source,/release:'NO_GO'/)],
 ['migration_is_hold',()=>assert.match(source,/migration:'HOLD'/)],
 ['no_automatic_recovery',()=>assert.match(source,/automaticRecoveryAuthorized:false/)],
 ['no_lock_removal',()=>assert.match(source,/lockRemovalAuthorized:false/)],
 ['requires_four_offline_gates',()=>['R129_OFFLINE_QA','R130_OFFLINE_QA','R131_OFFLINE_QA','CAR02_RELEASE_LOCK'].forEach(x=>assert.match(source,new RegExp(x)))],
 ['trust_independent_challenge',()=>assert.match(source,/expectedChallenge/)],
 ['requires_prior_minimum_pin',()=>assert.match(source,/TRUSTED_PIN_MISMATCH/)],
 ['requires_two_r130_signatures',()=>assert.match(source,/verifyDualRecoveryReview\(/)],
 ['checks_signed_payload',()=>assert.match(source,/verify\(null,Buffer\.from\(JSON\.stringify\(seal\.payload\)\)/)],
 ['checks_sealer_independence',()=>assert.match(source,/SEALER_NOT_INDEPENDENT/)],
 ['sealer_distinct_from_witnesses',()=>assert.match(source,/context\.trustedWitnesses/)],
 ['checks_seal_expiry',()=>assert.match(source,/SEAL_EXPIRED/)],
 ['checks_exact_shape',()=>assert.match(source,/SEAL_PAYLOAD/)],
 ['double_disk_read',()=>assert.match(source,/prepareManualRecoveryReview\(/)],
 ['no_file_writes',()=>assert.doesNotMatch(source,/\b(?:fs|fsp)\.(?:writeFile|rename|unlink|rm|mkdir|rmdir|copyFile|openSync|truncate|appendFile)(?:Sync)?\(/)],
 ['no_network_or_worker',()=>assert.doesNotMatch(source,/from ['"](?:node:)?(?:https?|net|tls|child_process)['"]|\bfetch\s*\(|\bwrangler\b/)],
 ['prior_stage_remains_closed',()=>assert.match(prev,/DUAL_REVIEWED_STILL_HOLD/)],
 ['forty_two_behaviour_cases',()=>assert.equal((cases.match(/test\('R131_/g)||[]).length,42)],
 ['workflow_checkout_readonly',()=>assert.match(yml,/permissions:\s*\n\s*contents: read/)],
 ['workflow_no_credentials',()=>assert.match(yml,/persist-credentials: false/)],
 ['workflow_original_gate',()=>assert.match(yml,/car02_r118_readonly_source_gate\.py --strict/)],
 ['workflow_runs_three_rounds',()=>assert.match(yml,/for i in 1 2 3;/)],
 ['workflow_no_live_deploy_or_secrets',()=>assert.doesNotMatch(yml,/secrets\.|wrangler\s+deploy|supabase\s+db\s+push|git\s+push/i)],
 ['no_signed_private_keys_in_artifacts',()=>assert.doesNotMatch(yml,/SIGNING_PRIVATE_KEY|-----BEGIN PRIVATE KEY-----|\.pem\b|\.key\b/i)],
 ['nonproduction_gate_in_workflow',()=>assert.match(yml,/R131_NO_GO_HOLD_GATE_PASS/)],
];
for(const [label,check] of requirements)test(`R131_contract_${label}`,check);
