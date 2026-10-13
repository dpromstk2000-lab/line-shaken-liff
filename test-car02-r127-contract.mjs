// R127 offline source / workflow guard. This does NOT test production PKI or real DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync('car02-r127-independent-trust-isolated.mjs','utf8');
const testSource=fs.readFileSync('test-car02-r127-independent-trust.mjs','utf8');
const old=fs.readFileSync('car02-r126-signed-chain-isolated.mjs','utf8');
const yaml=fs.readFileSync('.github/workflows/car02-r127-independent-trust-isolated-qa.yml','utf8');
const checks=[
 ['imports_R126_verification',()=>assert.match(source,/verifySyntheticBundle/)],
 ['independent_trust_configuration',()=>assert.match(source,/validateKeyMap\(trustedAuditors\)/)],
 ['minimum_pinned_checkpoint_required',()=>assert.match(source,/independentPin/)],
 ['anti_rollback_guard',()=>assert.match(source,/PIN_ROLLBACK/)],
 ['anti_fork_guard',()=>assert.match(source,/PIN_FORK/)],
 ['two_distinct_auditors',()=>assert.match(source,/TRUST_INDEPENDENCE/)],
 ['ed25519_public_key_type',()=>assert.match(source,/asymmetricKeyType==='ed25519'/)],
 ['key_rotation_signer_id',()=>assert.match(source,/signingKeyId/)],
 ['revoked_key_denial',()=>assert.match(source,/KEY_REVOKED/)],
 ['append_only_chain_check',()=>assert.match(source,/HASH_CHAIN/)],
 ['snapshot_signature_checked',()=>assert.match(source,/verifySyntheticBundle\(bundle,rows/)],
 ['no_production_grants',()=>assert.ok(source.includes("release:'NO_GO'")&&source.includes("migration:'HOLD'"))],
 ['no_network_or_storage',()=>assert.doesNotMatch(source,/fetch\s*\(|\.connect\s*\(|wrangler|supabase|https?:\/\//i)],
 ['R126_trusted_public_key',()=>assert.match(old,/trustedPublicKey/)],
 ['42_independent_functional_cases',()=>assert.equal((testSource.match(/test\('R127_/g)||[]).length,42)],
 ['workflow_readonly_permissions',()=>assert.match(yaml,/permissions:\s*\n\s*contents: read/)],
 ['workflow_uses_source_gate',()=>assert.match(yaml,/car02_r118_readonly_source_gate\.py --strict/)],
 ['workflow_3_full_repeats',()=>assert.match(yaml,/for i in 1 2 3;/)],
 ['workflow_no_deploy',()=>assert.doesNotMatch(yaml,/wrangler\s+deploy|supabase\s+db\s+push|git\s+push|secrets\./i)],
 ['workflow_not_self_approving_production',()=>assert.match(yaml,/R127_OFFLINE_QA: 'yes'/)],
];
for(const [name,check] of checks)test('R127_'+name,check);
