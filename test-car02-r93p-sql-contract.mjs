import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('./R93P_PG17_UNIFIED_READY_OUTBOX_QA_ONLY.sql',import.meta.url),'utf8');
for(const item of [
 'car02_r93p_qa_ci',"current_setting('server_version_num')::int<170000",'to_regclass(\'public.ksh_car02_photos\') IS NOT NULL',
 'CREATE SCHEMA car02_r93p_qa', 'REVOKE ALL ON SCHEMA', 'REVOKE ALL ON ALL FUNCTIONS',
 'CREATE FUNCTION car02_r93p_qa.qa_prove_ready', 'AND p.upload_state=\'ready\'',
 'AND s.active IS TRUE','AND s.role=$6','AND p.storage_path=$8',
 'AND p.byte_size=$10','AND p.sha256=$11','NOT EXISTS (SELECT 1 FROM car02_r93p_qa.cleanup_jobs',
 'COMMIT;', 'BEGIN;', 'ROLLBACK;', 'DROP SCHEMA car02_r93p_qa CASCADE;',
 'R93P_PG17_UNIFIED_READY_AND_PHOTO_ID_OUTBOX_PASS',
 'R93P_CROSS_SHOP_ACCEPTED','R93P_INACTIVE_STAFF_ACCEPTED','R93P_WRONG_ROLE_ACCEPTED',
 'R93P_PUBLIC_BUCKET_ACCEPTED','R93P_PATH_MISMATCH_ACCEPTED','R93P_BYTES_MISMATCH_ACCEPTED',
 'R93P_HASH_MISMATCH_ACCEPTED','R93P_PENDING_ACCEPTED','R93P_QUEUED_CLEANUP_ACCEPTED'
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

// Regression for R93P GitHub run #1: a column and same-named function argument
// must never be compared without a numbered/qualified parameter.
test('all eleven R93P SQL function args use explicit positional bindings',()=>{
 const body=sql.split('CREATE FUNCTION car02_r93p_qa.qa_prove_ready(',2)[1].split('$$;',1)[0];
 const expected=[
  'p.id=$1','p.shop_code=$2','p.order_id=$3','p.report_id=$4',
  's.staff_id=$5','s.role=$6','p.storage_bucket=$7','p.storage_path=$8',
  'p.mime_type=$9','p.byte_size=$10','p.sha256=$11'
 ];
 for(const expr of expected) assert.ok(body.includes(expr),`argument not explicitly bound: ${expr}`);
 assert.doesNotMatch(body,/p\.storage_path\s*=\s*storage_path\b/i);
});
test('path mismatch is an explicit SQL negative test and cannot be a column tautology',()=>{
 assert.ok(sql.includes("'different/path.jpg'"));
 assert.ok(sql.includes('R93P_PATH_MISMATCH_ACCEPTED'));
 assert.match(sql,/p\.storage_path\s*=\s*\$8\b/);
});

test('R93P SQL denies same photo-id outbox regardless of metadata',()=>{
 assert.ok(sql.includes('R93P_MISLABELED_JOB_DID_NOT_VETO'));
 assert.match(sql,/NOT EXISTS \(SELECT 1 FROM car02_r93p_qa\.cleanup_jobs j WHERE j\.photo_id=p\.id\)/);
 assert.doesNotMatch(sql,/j\.shop_code\s*=|j\.storage_path\s*=/);
});
