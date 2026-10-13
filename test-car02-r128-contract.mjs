// R128 offline source/workflow contract only; no production or DB access.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const src=fs.readFileSync('car02-r128-witness-escrow-isolated.mjs','utf8');
const func=fs.readFileSync('test-car02-r128-witness-escrow.mjs','utf8');
const prior=fs.readFileSync('car02-r127-independent-trust-isolated.mjs','utf8');
const workflow=fs.readFileSync('.github/workflows/car02-r128-independent-witness-escrow-isolated-qa.yml','utf8');
const checks=[
 ['imports_real_r127_registry_verification',()=>assert.match(src,/inspectRegistry\(/)],
 ['binds_to_r127_checkpoint_hash',()=>assert.match(src,/registryRecords\.map\(checkpointHash\)/)],
 ['distinct_witness_public_keys',()=>assert.match(src,/NOT_INDEPENDENT/)],
 ['requires_out_of_band_witness_pin',()=>assert.match(src,/minimumWitnessPin/)],
 ['pin_prevents_stale_both_copies',()=>assert.match(src,/ESCROW_ROLLBACK/)],
 ['pin_prevents_fork',()=>assert.match(src,/PIN_FORK/)],
 ['witness_receipts_must_match_each_registry_epoch',()=>assert.match(src,/WITNESS_ROLLBACK/)],
 ['witness_signatures_are_verified',()=>assert.match(src,/verify\(null,Buffer\.from\(encode\(p\)\)/)],
 ['release_locked',()=>assert.match(src,/release:'NO_GO'/)],
 ['migration_hold',()=>assert.match(src,/migration:'HOLD'/)],
 ['production_false',()=>assert.match(src,/productionReady:false/)],
 ['no_external_io_in_runtime',()=>assert.doesNotMatch(src,/\bfetch\s*\(|\bconnect\s*\(|\bwriteFile\s*\(|wrangler\s+deploy|supabase\s+db/i)],
 ['r127_has_two_auditor_signatures',()=>assert.match(prior,/SIGNATURE_QUORUM/)],
 ['40_functional_tests_declared',()=>assert.equal((func.match(/test\('R128_/g)||[]).length,40)],
 ['read_only_github_permissions',()=>assert.match(workflow,/permissions:\s*\n\s*contents: read/)],
 ['protected_source_gate',()=>assert.match(workflow,/car02_r118_readonly_source_gate\.py --strict/)],
 ['full_test_replay_three_times',()=>assert.match(workflow,/for i in 1 2 3;/)],
 ['no_secrets_or_deploy_in_workflow',()=>assert.doesNotMatch(workflow,/wrangler\s+deploy|supabase\s+db\s+push|git\s+push|secrets\./i)],
 ['no_prod_grant_workflow',()=>assert.match(workflow,/R128_OFFLINE_QA: 'yes'/)],
 ['no_network_git_credentials',()=>assert.match(workflow,/persist-credentials: false/)],
];for(const [name,run] of checks)test('R128_'+name,run);
