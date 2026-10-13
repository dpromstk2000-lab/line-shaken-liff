// R129 offline contract inspection. Does NOT certify external storage, real DB or auth.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync('car02-r129-escrow-recovery-isolated.mjs','utf8');
const tests=fs.readFileSync('test-car02-r129-escrow-recovery.mjs','utf8');
const prev=fs.readFileSync('car02-r128-witness-escrow-isolated.mjs','utf8');
const yml=fs.readFileSync('.github/workflows/car02-r129-witness-crash-recovery-isolated-qa.yml','utf8');
const checks=[
 ['uses_real_R128_signature_and_pin_verifier',()=>assert.match(source,/inspectIndependentEscrow\(/)],
 ['uses_R127_registry_head_hash',()=>assert.match(source,/checkpointHash\(/)],
 ['out_of_band_witness_pin_input',()=>assert.match(source,/minimumWitnessPin/)],
 ['strict_isolation_flag',()=>assert.match(source,/R129_OFFLINE_QA==='yes'/)],
 ['temporary_directory_only',()=>assert.match(source,/path\.dirname\(p\)===tmp/)],
 ['local_atomic_replace',()=>assert.match(source,/fs\.renameSync\(temp,p\)/)],
 ['filesystem_sync',()=>assert.match(source,/fs\.fsyncSync\(fd\)/)],
 ['writer_lock',()=>assert.match(source,/R129_LOCKED|fail\('LOCKED'\)/)],
 ['pending_hold',()=>assert.match(source,/PENDING_MANUAL_HOLD/)],
 ['conflicting_retries_rejected',()=>assert.match(source,/OPERATION_CONFLICT/)],
 ['same_replay_wont_duplicate',()=>assert.match(source,/status:'REPLAY'/)],
 ['out_of_band_pin_candidate_not_trusted',()=>assert.match(source,/independentlyPinned:false/)],
 ['release_lock_policy',()=>assert.match(source,/release:'NO_GO'/)],
 ['db_migration_hold',()=>assert.match(source,/migration:'HOLD'/)],
 ['previous_witness_signature_enforced',()=>assert.match(prev,/\bverify\(null/)],
 ['thirty_three_functional_cases',()=>assert.equal((tests.match(/test\('R129_/g)||[]).length,33)],
 ['read_only_and_protected_source_gate',()=>{assert.match(yml,/permissions:\s*\n\s*contents: read/);assert.match(yml,/car02_r118_readonly_source_gate\.py --strict/)}],
 ['replay_three_times',()=>assert.match(yml,/for i in 1 2 3;/)],
 ['no_credentials_or_deploy',()=>{assert.match(yml,/persist-credentials: false/);assert.doesNotMatch(yml,/wrangler\s+deploy|supabase\s+db\s+push|git\s+push|secrets\./i)}],
];
for(const [label,check] of checks)test(`R129_${label}`,check);
