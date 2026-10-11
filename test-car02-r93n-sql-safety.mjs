import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('./R93N_PG17_READY_ACK_RECONCILE_QA_ONLY.sql',import.meta.url),'utf8');
for(const item of [
 'car02_r93n_qa_ci',"current_setting('server_version_num')::int<170000",'to_regclass(\'public.ksh_car02_photos\') IS NOT NULL',
 'CREATE SCHEMA car02_r93n_qa', 'REVOKE ALL ON SCHEMA', 'REVOKE ALL ON ALL FUNCTIONS',
 'CREATE FUNCTION car02_r93n_qa.qa_prove_ready', 'AND p.upload_state=\'ready\'',
 'AND s.active IS TRUE','AND s.role=role_name','AND p.storage_path=storage_path',
 'AND p.byte_size=nbytes','AND p.sha256=digest','NOT EXISTS (SELECT 1 FROM car02_r93n_qa.cleanup_jobs',
 'COMMIT;', 'BEGIN;', 'ROLLBACK;', 'DROP SCHEMA car02_r93n_qa CASCADE;',
 'R93N_PG17_FRESH_COMMIT_ACK_RECONCILIATION_PASS',
 'R93N_CROSS_SHOP_ACCEPTED','R93N_INACTIVE_STAFF_ACCEPTED','R93N_WRONG_ROLE_ACCEPTED',
 'R93N_PUBLIC_BUCKET_ACCEPTED','R93N_PATH_MISMATCH_ACCEPTED','R93N_BYTES_MISMATCH_ACCEPTED',
 'R93N_HASH_MISMATCH_ACCEPTED','R93N_PENDING_ACCEPTED','R93N_QUEUED_CLEANUP_ACCEPTED'
]) test('disposable SQL contract: '+item,()=>assert.ok(sql.includes(item)));
test('SQL never references network deployment or live credentials',()=>{
 for(const f of [/\bwrangler\s+deploy\b/i,/\bsupabase\s+db\s+push\b/i,/\bGITHUB_TOKEN\b/i,/\bsecrets\s*\./i])
 assert.equal(f.test(sql),false);
});
test('SQL commits setup then opens new read transaction',()=>{
 let i=sql.indexOf('REVOKE ALL ON ALL FUNCTIONS');let c=sql.indexOf('COMMIT;',i);
 let b=sql.indexOf('BEGIN;',c);let x=sql.indexOf('DO $$ DECLARE',b);
 assert.ok(i>=0&&c>i&&b>c&&x>b);
});
