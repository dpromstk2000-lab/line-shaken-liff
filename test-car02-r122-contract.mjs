import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createR122DisposablePgPhotoLedger,R122_CONTRACT} from './car02-r122-pg17-photo-ledger-isolated.mjs';
const root=p=>fs.readFileSync(p,'utf8');
const sql=root('R122_PG17_PHOTO_LEDGER_QA_ONLY.sql');
const model=root('car02-r122-pg17-photo-ledger-isolated.mjs');
const runner=root('car02-r122-pg17-photo-bridge-qa.mjs');
const workflow=root('.github/workflows/car02-r122-pg17-photo-ledger-isolated-qa.yml');
test('R122 never claims production or live storage coverage',()=>{
 assert.equal(R122_CONTRACT.productionReady,false);
 assert.equal(R122_CONTRACT.realSupabaseTested,false);
 assert.equal(R122_CONTRACT.realStorageTested,false);
 assert.equal(R122_CONTRACT.releaseDecision,'NO_GO');
 assert.equal(R122_CONTRACT.migrationDecision,'HOLD');
 assert.equal(R122_CONTRACT.doesNotWireR47,true);
});
test('R122 adapter rejects production environment',()=>{
 assert.throws(()=>createR122DisposablePgPhotoLedger({environment:'production',dbName:'car02_r122_qa_ci',expectedUser:'car02_r122_a_ci',pool:{connect(){}}}),/R122_DISPOSABLE_ONLY/);
});
test('R122 adapter rejects unexpected db',()=>{
 assert.throws(()=>createR122DisposablePgPhotoLedger({environment:'isolated_qa',dbName:'postgres',expectedUser:'car02_r122_a_ci',pool:{connect(){}}}),/R122_DISPOSABLE_ONLY/);
});
test('R122 adapter rejects privileged PostgreSQL account',()=>{
 assert.throws(()=>createR122DisposablePgPhotoLedger({environment:'isolated_qa',dbName:'car02_r122_qa_ci',expectedUser:'postgres',pool:{connect(){}}}),/R122_DISPOSABLE_ONLY/);
});
test('R122 ledger never contains live Storage operations',()=>{
 assert.doesNotMatch(model, /\bfetch\s*\(|\bhttps?:\/\/|\bwrangler\b|\.remove\s*\(/i);
 assert.match(model,/current_database\(\)/);
 assert.match(model,/session_user AS sess/);
 assert.match(model,/rolbypassrls/);
});
test('R122 SQL fails closed unless using exact disposable PG17 DB',()=>{
 assert.match(sql,/current_database\(\) <> 'car02_r122_qa_ci'/);
 assert.match(sql,/server_version_num/);
 assert.match(sql,/to_regclass\('public\.ksh_car02_photos'\) IS NOT NULL/);
});
test('R122 SQL uses two tenant-only nonprivileged roles',()=>{
 assert.match(sql,/CREATE ROLE car02_r122_a_ci LOGIN NOSUPERUSER/);
 assert.match(sql,/CREATE ROLE car02_r122_b_ci LOGIN NOSUPERUSER/);
 assert.match(sql,/NOBYPASSRLS NOINHERIT/);
});
test('R122 SQL enforces RLS on sensitive records',()=>{
 for(const t of ['report_scope','photo_intents','audit_events']){
  assert.match(sql,new RegExp('ALTER TABLE car02_r122_qa\\.'+t+' ENABLE ROW LEVEL SECURITY'));
  assert.match(sql,new RegExp('ALTER TABLE car02_r122_qa\\.'+t+' FORCE ROW LEVEL SECURITY'));
 }
});
test('R122 SQL has DB-side 3-photo cap and immutable state trigger',()=>{
 assert.match(sql,/CREATE TRIGGER r122_report_cap BEFORE INSERT/);
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/OLD\.state <> 'PENDING'/);
 assert.match(sql,/R122_PHOTO_TERMINAL_OR_REBIND_DENIED/);
});
test('R122 SQL audit is trigger-generated and immutable',()=>{
 assert.match(sql,/CREATE TRIGGER r122_audit_insert AFTER INSERT/);
 assert.match(sql,/CREATE TRIGGER r122_audit_update AFTER UPDATE OF state/);
 assert.match(sql,/CREATE TRIGGER r122_refuse_audit_update_delete/);
 assert.match(sql,/CREATE TRIGGER r122_refuse_audit_truncate/);
});
test('R122 integration exercises R121 without replacing source',()=>{
 assert.match(runner,/createR121IsolatedPhotoCandidate/);
 assert.match(runner,/Array\.from\(\{length:6\}/);
 assert.match(runner,/RETRY_NEEDS_REVIEW/);
 assert.match(runner,/THREE_PHOTO_LIMIT|23514/);
});
test('R122 workflow uses read-only checkout and isolated PostgreSQL17',()=>{
 assert.match(workflow,/permissions:\s*\n\s+contents: read/);
 assert.match(workflow,/image: postgres:17/);
 assert.match(workflow,/persist-credentials: false/);
 assert.match(workflow,/car02_r118_readonly_source_gate\.py --strict/);
 assert.match(workflow,/DROP DATABASE IF EXISTS car02_r122_qa_ci/);
 assert.match(workflow,/if: always\(\)/);
});
test('R122 workflow cannot deploy, migrate production or push to main',()=>{
 assert.doesNotMatch(workflow,/(?:wrangler\s+deploy|supabase\s+db\s+push|npm\s+publish|git\s+push|cloudflare\/workers|deploy-pages)/i);
 assert.match(workflow,/CAR02_RELEASE_LOCK: 'true'/);
});

test('R122 restore rechecks low-privilege tenant RLS and immutable audit',()=>{
 const restore=root('car02-r122-restore-readonly-qa.mjs');
 assert.match(restore,/car02_r122_restore_ci/);
 assert.match(restore,/tenantARows:3/);
 assert.match(restore,/DELETE FROM car02_r122_qa.audit_events/);
 assert.match(workflow,/R122_RESTORED_DB_TENANT_RLS_AND_AUDIT_PASS/);
});
