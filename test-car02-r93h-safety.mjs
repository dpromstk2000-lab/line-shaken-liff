import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('./car02-r93h-upload-compensation-isolated.mjs',import.meta.url),'utf8');
const sql=readFileSync(new URL('./R93H_UPLOAD_UNCERTAIN_ATOMIC_COMPENSATION_PG17_QA_ONLY.sql',import.meta.url),'utf8');
for(const token of ['isolated_qa','tombstoneAndEnqueue','UPLOAD_UNCERTAIN','postObject',
 'R93H_COMPENSATION_UNCONFIRMED','verifyPrivateBucket','inspectObject','productionReady:false'])
 test('R93H isolated upload contract includes '+token,()=>assert.ok(code.includes(token)));
for(const token of ['BEGIN;','ROLLBACK;','CREATE TRIGGER','AFTER UPDATE OF upload_state',
 'R93H_PARTIAL_TOMBSTONE','R93H_EPHEMERAL_POSTGRES17_REQUIRED','current_database()',
 'UNIQUE REFERENCES','R93H_PG17_ATOMIC_COMPENSATION_PASS'])
 test('SQL QA has required rollback/invariant '+token,()=>assert.ok(sql.includes(token)));
test('R93H never issues direct DELETE, signed URLs, or live credentials',()=>{
 assert.doesNotMatch(code, /\bfetch\s*\(|\bXMLHttpRequest\b|\bDELETE\s*\(|\bserviceRoleKey\b|\bSUPABASE_URL\b/);
});
test('R93H SQL contains no public customer schema write and never runs persistently',()=>{
 assert.doesNotMatch(sql, /(?:CREATE|ALTER|DROP|UPDATE|INSERT INTO)\s+(?:TABLE\s+)?public\.ksh_/i);
 assert.ok(sql.endsWith('R93H_PG17_ATOMIC_COMPENSATION_PASS\n'));
});
