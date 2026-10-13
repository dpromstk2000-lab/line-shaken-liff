// Offline source contract QA only. R125 PostgreSQL and production remain untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync('car02-r126-signed-chain-isolated.mjs','utf8');
const workflow=fs.readFileSync('.github/workflows/car02-r126-signed-audit-snapshot-isolated-qa.yml','utf8');
const legacy=fs.readFileSync('R125_PG17_REVIEW_JOURNAL_QA_ONLY.sql','utf8');
const cases=[
 ['r125_source_is_disposable',()=>assert.match(legacy,/current_database\(\)<>\s*'car02_r125_qa_ci'/)],
 ['r125_pg17_guard',()=>assert.match(legacy,/server_version_num[\s\S]{0,120}170000[\s\S]{0,145}180000/)],
 ['r125_chain_hash',()=>assert.match(legacy,/v_prev\|\|':'\|\|v_hash/)],
 ['r125_immutable_audit',()=>assert.match(legacy,/audit_no_update BEFORE UPDATE OR DELETE/)],
 ['source_requires_trusted_public_key',()=>assert.match(source,/trustedPublicKey/)],
 ['source_rejects_expiration',()=>assert.match(source,/R126_[A-Z_]+|EXPIRED/)],
 ['source_binds_snapshot_digest',()=>assert.match(source,/snapshotDigest:h\(canonical\(rows\)\)/)],
 ['source_binding_is_not_self_signed',()=>assert.doesNotMatch(source,/bundle\.publicKey\s*\|\|/)],
 ['source_no_network_calls',()=>assert.doesNotMatch(source,/fetch\s*\(|https?:\/\/|\.connect\s*\(/)],
 ['workflow_checkout_readonly',()=>assert.match(workflow,/permissions:\s*\n\s*contents: read/)],
 ['workflow_release_lock',()=>assert.match(workflow,/CAR02_RELEASE_LOCK: 'true'/)],
 ['workflow_enforces_source_gate',()=>assert.match(workflow,/car02_r118_readonly_source_gate\.py --strict/)],
 ['workflow_replays_three_times',()=>assert.match(workflow,/for i in 1 2 3;/)],
 ['workflow_no_deploy_or_secrets',()=>assert.doesNotMatch(workflow,/wrangler\s+deploy|supabase\s+db\s+push|git\s+push|secrets\./i)],
];
for(const [name,check] of cases)test('R126_'+name,check);
