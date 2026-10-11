import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const m=readFileSync(new URL('./car02-r93o-outbox-identity-guard-isolated.mjs',import.meta.url),'utf8');
const q=readFileSync(new URL('./R93O_PG17_OUTBOX_PHOTO_ID_VETO_QA_ONLY.sql',import.meta.url),'utf8');
for(const [description,mark] of [
 ['temporary DB only','car02_r93o_qa_ci'],['PostgreSQL 17 guard',"server_version_num')::int<170000"],
 ['prevent existing schema reuse',"to_regnamespace('car02_r93o_qa') IS NOT NULL"],
 ['prevent production photo table',"to_regclass('public.ksh_car02_photos') IS NOT NULL"],
 ['schema creation','CREATE SCHEMA car02_r93o_qa'],
 ['revoke public','REVOKE ALL ON SCHEMA'], ['photo-only outbox filter','WHERE j.photo_id=p.id'],
 ['mismatched outbox case','R93O_MISLABELED_OUTBOX_ACCEPTED'],
 ['bad outbox path','R93O_WRONG_OUTBOX_PATH_ACCEPTED'],
 ['unrelated outbox allowed','R93O_UNRELATED_OUTBOX_BLOCKED'],
 ['rollback','ROLLBACK;'],['schema cleanup','R93O_PG17_OUTBOX_PHOTO_ID_VETO_AND_ROLLBACK_PASS']
])test(`SQL contract ${description}`,()=>assert.ok(q.includes(mark)));
test('SQL never allows outbox path/shop to determine cleanup conflict',()=>{
 const statement=q.match(/NOT EXISTS \(SELECT 1 FROM car02_r93o_qa\.cleanup_jobs j WHERE [^)]+\)/)?.[0];
 assert.ok(statement);assert.match(statement,/j\.photo_id=p\.id/);
 assert.doesNotMatch(statement,/j\.(?:shop_code|storage_path)/);
});
test('Node SQL outbox check is photo ID only with parameter binding',()=>{
 assert.match(m,/FROM car02_r93o_qa\.cleanup_jobs WHERE photo_id=\$1/);
 assert.doesNotMatch(m,/FROM car02_r93o_qa\.cleanup_jobs\s+WHERE.*(?:shop_code|storage_path)/);
});
test('no deploy command, production secret, or live URL',()=>{
 for(const re of [/\bwrangler\s+deploy\b/i,/\bsupabase\s+db\s+push\b/i,/\bGITHUB_TOKEN\b/,/\bsecrets\s*\./, /https?:\/\//]){
  assert.equal(re.test(q),false);assert.equal(re.test(m),false);
 }
});
test('rollback follows all tests and schema cannot leak',()=>{
 const last=q.indexOf('R93O_WRONG_OUTBOX_PATH_ACCEPTED');const rb=q.lastIndexOf('ROLLBACK;');
 assert.ok(rb>last);assert.ok(q.indexOf('R93O_SCHEMA_LEAK',rb)>rb);
});
test('no live imports or storage deletion',()=>{
 assert.doesNotMatch(m,/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/);
 assert.doesNotMatch(m,/(?:storage\.remove|storage\.delete|deleteObject)\s*\(/);
});
