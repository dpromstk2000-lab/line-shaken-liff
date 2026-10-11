import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('./R93Q_PG17_ONE_SCHEMA_LIFECYCLE_QA_ONLY.sql',import.meta.url),'utf8');
for(const x of [
 'car02_r93q_qa_ci',"current_setting('server_version_num')::integer<170000",'CREATE SCHEMA car02_r93q_qa',
 'REVOKE ALL ON SCHEMA car02_r93q_qa FROM PUBLIC',"to_regclass('public.ksh_car02_photos') IS NOT NULL",
 'CREATE FUNCTION car02_r93q_qa.qa_prove_ready','p.id=$1','p.shop_code=$2','s.staff_id=$3',
 'p.storage_path=$4','p.sha256=$5',"p.upload_state='ready'","o.status='draft'",'s.active IS TRUE',
 'NOT EXISTS (','j.photo_id=p.id', 'R93Q_COMMITTED_READY_NOT_PROVED','R93Q_CROSS_TENANT_ACCEPTED',
 'R93Q_WRONG_PATH_ACCEPTED','R93Q_WRONG_SHA_ACCEPTED','R93Q_REVOKED_STAFF_ACCEPTED',
 'R93Q_MISLABELLED_OUTBOX_ACCEPTED','DROP SCHEMA car02_r93q_qa CASCADE;',
 'R93Q_PG17_ONE_SCHEMA_LIFECYCLE_FRESH_PROOF_AND_CLEANUP_PASS'])
 test('disposable SQL invariant: '+x,()=>assert.ok(sql.includes(x)));
test('a full commit precedes a new independent transaction',()=>{
 const c=sql.lastIndexOf('COMMIT;'),b=sql.indexOf('BEGIN;',c),p=sql.indexOf('qa_prove_ready(photo',b);
 assert.ok(c>0&&b>c&&p>b);
});
test('no production access strings or network deployment commands',()=>{
 for(const p of [/\bwrangler\s+deploy\b/i,/\bsupabase\s+(?:db\s+push|functions\s+deploy)\b/i,/\bGITHUB_TOKEN\b/i, /\bsecrets\./i])assert.equal(p.test(sql),false);
});
test('the exact single namespace is used throughout, never R93M/R93P schemas',()=>{
 assert.doesNotMatch(sql,/car02_r93[mp]_qa\./i);
 assert.doesNotMatch(sql,/public\.ksh_car02_photos\s+(?:INSERT|UPDATE)/i);
});
