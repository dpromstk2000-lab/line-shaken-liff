import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const file='R93L_PG17_ATOMIC_COMPENSATION_QA_ONLY.sql';
const code=fs.readFileSync(file,'utf8');
const moduleCode=fs.readFileSync('car02-r93l-pg-compensation-isolated.mjs','utf8');
for(const term of [
 'current_database()', "'car02_r93l_qa_ci'", "to_regclass('public.ksh_car02_photos') IS NOT NULL",
 'server_version_num', 'REVOKE ALL ON SCHEMA','REVOKE ALL ON ALL TABLES',
 'FROM car02_r93l_qa.staff','FOR UPDATE','JOIN car02_r93l_qa.reports',
 'JOIN car02_r93l_qa.work_orders',"upload_state='pending'", "SET upload_state='deleted'",
 'INSERT INTO car02_r93l_qa.cleanup_jobs', 'RETURNING job_id',
 "EXCEPTION WHEN unique_violation", 'R93L_PARTIAL_TOMBSTONE',
 'R93L_DUPLICATE_ALLOWED', 'R93L_SCOPE_FAILURE_',
 'ROLLBACK;', 'R93L_PG17_REAL_TRANSACTION_AND_ROLLBACK_PASS'])
 test('PG17 script contract: '+term,()=>assert(code.includes(term),term));
test('script creates neither public business tables nor shared production migration',()=>{
 assert(!/CREATE TABLE\s+public\./i.test(code));
 assert(!/ALTER TABLE\s+public\./i.test(code));
 assert(!/\\connect\s+.*production/i.test(code));
});
test('PG and Node scopes match',()=>{
 assert(moduleCode.includes('FROM car02_r93l_qa.staff'));
 assert(moduleCode.includes('FROM car02_r93l_qa.photos p'));
 assert(moduleCode.includes("'pending'"));
 assert(moduleCode.includes("'deleted'"));
 assert(moduleCode.includes("'queued'"));
});
test('no direct Storage DELETE, no network endpoint, no hard-coded credential',()=>{
 assert(!/\bfetch\s*\(/.test(moduleCode));
 assert(!/\bDELETE\b/.test(moduleCode));
 assert(!/process\.env|https:\/\//.test(moduleCode));
});
test('transaction boundary and failure rollback are explicit',()=>{
 assert(moduleCode.includes("client.query('BEGIN')"));
 assert(moduleCode.includes("client.query('COMMIT')"));
 assert(moduleCode.includes("client.query('ROLLBACK')"));
 assert(moduleCode.indexOf("client.query('COMMIT')")>moduleCode.indexOf('INSERT INTO car02_r93l_qa.cleanup_jobs'));
});
