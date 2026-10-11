import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('./R93M_PG17_UNIFIED_PHOTO_LIFECYCLE_QA_ONLY.sql',import.meta.url),'utf8');
const src=readFileSync(new URL('./car02-r93m-pg-photo-lifecycle-isolated.mjs',import.meta.url),'utf8');
const required=[
 'current_database()',"current_database()<>'car02_r93m_qa_ci'",'server_version_num',
 "to_regclass('public.ksh_car02_photos') IS NOT NULL",'CREATE SCHEMA car02_r93m_qa',
 'REVOKE ALL ON SCHEMA car02_r93m_qa FROM PUBLIC',
 'REVOKE ALL ON ALL TABLES IN SCHEMA car02_r93m_qa FROM PUBLIC',
 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA car02_r93m_qa FROM PUBLIC',
 'CREATE TABLE car02_r93m_qa.staff','CREATE TABLE car02_r93m_qa.work_orders',
 'CREATE TABLE car02_r93m_qa.reports','CREATE TABLE car02_r93m_qa.photos',
 'CREATE TABLE car02_r93m_qa.cleanup_jobs',
 'CREATE TRIGGER car02_r93m_guard', 'R93M_HARD_DELETE_BLOCKED',
 'R93M_METADATA_CHANGED','R93M_TOMBSTONE_FINAL','R93M_READY_IMMUTABLE',
 'CREATE FUNCTION car02_r93m_qa.qa_reserve', 'CREATE FUNCTION car02_r93m_qa.qa_set_state',
 'R93M_STAFF_DENIED','R93M_THREE_PHOTO_LIMIT', 'R93M_BAD_PATH',
 'FOR UPDATE OF wo,rep','FOR UPDATE OF ph,rep,wo',
 "upload_state='pending'","'UPLOAD_UNCERTAIN'",'EXCEPTION WHEN unique_violation',
 'R93M_OUTBOX_FAILURE_PARTIAL_TOMBSTONE', 'R93M_LIMIT_NOT_ENFORCED',
 'ROLLBACK;','R93M_PG17_UNIFIED_LIFECYCLE_AND_ROLLBACK_PASS'];
for(const text of required)test('PostgreSQL contract includes '+text,()=>assert.ok(sql.includes(text)));
const jsRequired=['R93M_ISOLATION_REQUIRED','R93M_NOT_DISPOSABLE_DB',
 'R93M_STAFF_DENIED','R93M_DRAFT_SCOPE_REQUIRED','R93M_THREE_PHOTO_LIMIT',
 'R93M_PHOTO_SCOPE_MISMATCH','R93M_OUTBOX_UNVERIFIED','R93M_READY_UNVERIFIED',
 "WHERE id=$1 AND shop_code=$2 AND order_id=$3 AND report_id=$4 AND storage_path=$5",
 "await client.query('COMMIT')", "await client.query('ROLLBACK')",
 "to_regclass('public.ksh_car02_photos') IS NULL", "SET LOCAL lock_timeout"];
for(const x of jsRequired)test('live-protected PG adapter includes '+x,()=>assert.ok(src.includes(x)));
for(const str of ['process.env','DATABASE_URL','SUPABASE_SERVICE_ROLE_KEY','wrangler deploy','supabase db push'])
 test('adapter never references live access '+str,()=>assert.ok(!src.includes(str)));
test('SQL never touches public business tables with DML',()=>{
 assert.doesNotMatch(sql,/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|DROP\s+TABLE)\s+public\./i);
 assert.match(sql,/\nBEGIN;[\s\S]*ROLLBACK;\s*\\echo R93M_PG17_UNIFIED_LIFECYCLE_AND_ROLLBACK_PASS\s*$/);
});
