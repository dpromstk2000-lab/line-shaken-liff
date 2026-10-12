import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {R111_CONTRACT,R111_PUBLIC_KEYS,R111_USERS,assertR111Env,validateR111Query,
 safeR111Row,checkR111Identity,createR111ReadonlyInbox} from './car02-r111-readonly-inbox-isolated.mjs';
import {verifyR111Workflow,R111_STEPS} from './car02-r111-workflow-guard.mjs';
const sql=readFileSync('R111_PG17_READONLY_INBOX_QA_ONLY.sql','utf8');
const yml=readFileSync('.github/workflows/car02-r111-readonly-inbox-qa.yml','utf8');
const code=readFileSync('car02-r111-readonly-inbox-isolated.mjs','utf8');
const driver=readFileSync('car02-r111-pg17-readonly-inbox-qa.mjs','utf8');
const job='33333333-3333-4333-8333-333333333109';
const role='car02_r111_a_ci';
const identity={db:'car02_r109_qa_ci',pg:170000,user_name:role,session_name:role,
 superuser:false,bypass_rls:false,inherits:false,live_table_absent:true};
const base={job_id:job,shop_code:'street_house_kitsuki',state:'QUARANTINED',reason:'UPLOAD_UNCERTAIN',
 created_at:new Date('2026-10-12T05:00:00.123Z'),review_count:2,escalated:true,
 latest_event_kind:'ESCALATED_FOR_REVIEW',latest_recorded_at:new Date('2026-10-12T05:01:00.123Z')};
const cursor={createdAt:'2026-10-12T05:00:00.123Z',jobId:job};
test('R111 never permits production or delete',()=>{
 assert.equal(R111_CONTRACT.productionReady,false);assert.equal(R111_CONTRACT.storageDeleteAuthorized,false);
 assert.equal(R111_CONTRACT.mutationsAuthorized,false);assert.equal(R111_CONTRACT.releaseDecision,'NO_GO');
 assert.equal(R111_CONTRACT.migrationDecision,'HOLD');
});
test('only isolated QA environment accepted',()=>{
 const e={R111_DISPOSABLE_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',PGDATABASE:'car02_r109_qa_ci'};
 assertR111Env(e);for(const k of Object.keys(e))assert.throws(()=>assertR111Env({...e,[k]:'wrong'}));
});
test('query uses safe pagination defaults',()=>{
 assert.deepEqual(validateR111Query({}),{limit:20,escalatedOnly:false,cursor:null});
 assert.deepEqual(validateR111Query({limit:1,escalatedOnly:true,cursor}),{limit:1,escalatedOnly:true,cursor});
});
test('untrusted query fields fail closed',()=>{
 for(const bad of [null,[],{shop:'other_shop'},{tenant:'other_shop'},{sql:'DELETE'},Object.create(null),
  {limit:0},{limit:51},{limit:1.5},{limit:'2'},{escalatedOnly:'true'},{cursor:'fake'},
  {cursor:{...cursor,token:'x'}},{cursor:{...cursor,jobId:'x'}},
  {cursor:{...cursor,createdAt:'2026-10-12T05:00:00Z'}},
  {cursor:{...cursor,createdAt:'2026-99-12T05:00:00.123Z'}}])
  assert.throws(()=>validateR111Query(bad),/R111_QUERY_INVALID|R111_CURSOR_INVALID/);
});
test('R111 viewer role is exact unprivileged login with no RLS bypass',()=>{
 checkR111Identity(identity,role);
 for(const changed of [{db:'postgres'},{pg:160000},{pg:180000},{user_name:'postgres'},
  {session_name:'postgres'},{superuser:true},{bypass_rls:true},{inherits:true},
  {live_table_absent:false}])assert.throws(()=>checkR111Identity({...identity,...changed},role));
});
test('row projection hides tenant, path, digest, photo id, bucket and evidence content',()=>{
 const row=safeR111Row({...base,path:'secret',proof_sha256:'x',photo_id:'secret'},'street_house_kitsuki');
 assert.deepEqual(Object.keys(row),R111_PUBLIC_KEYS);
 assert.equal(JSON.stringify(row).includes('secret'),false);
 assert.equal(row.createdAt,'2026-10-12T05:00:00.123Z');
 assert.equal(row.reviewCount,2);
 assert.ok(Object.isFrozen(row));
});
test('cross-tenant or suspicious database rows refuse projection',()=>{
 for(const changed of [{shop_code:'other_shop'},{state:'DELETED'},{reason:'DELETE_NOW'},
  {review_count:-1},{review_count:'2'},{escalated:'true'},{job_id:'bad'},
  {created_at:'2026-10-12'},{latest_recorded_at:'not-date'},
  {latest_event_kind:'DELETE_AUTHORIZED'}])
  assert.throws(()=>safeR111Row({...base,...changed},'street_house_kitsuki'));
});
test('only two exact fixed viewer roles accepted',()=>{
 assert.deepEqual(Object.values(R111_USERS),['street_house_kitsuki','other_shop']);
 const p={environment:'isolated_qa',dbName:'car02_r109_qa_ci',pgPool:{connect:async()=>{}},expectedUser:role};
 assert.equal(createR111ReadonlyInbox(p).readOnly,true);
 for(const changed of [{environment:'production'},{dbName:'postgres'},{expectedUser:'postgres'},{expectedUser:'car02_r110_a_ci'},{pgPool:{}}])
  assert.throws(()=>createR111ReadonlyInbox({...p,...changed}),/R111_DISPOSABLE_ONLY/);
});
test('schema is checked against disposable PG17 and no real photo table',()=>{
 assert.match(sql,/current_database\(\)<>'car02_r109_qa_ci'/);
 assert.match(sql,/server_version_num/);assert.match(sql,/to_regclass\('public\.ksh_car02_photos'\)/);
 assert.match(sql,/R111_DISPOSABLE_PG17_ONLY/);
});
test('view explicitly uses security invoker AND security barrier',()=>{
 assert.match(sql,/CREATE VIEW car02_r109_qa\.r111_review_inbox WITH \(security_invoker=true,security_barrier=true\)/);
 assert.match(sql,/date_trunc\('milliseconds',l\.created_at\)/);
});
test('roles cannot bypass RLS or inherit write privileges',()=>{
 assert.equal((sql.match(/LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT/g)||[]).length,2);
 assert.match(sql,/CREATE POLICY r111_ledger_viewer/);assert.match(sql,/CREATE POLICY r111_events_viewer/);
 assert.match(sql,/CASE current_user/);
 assert.doesNotMatch(sql,/GRANT (?:INSERT|UPDATE|DELETE|TRUNCATE|ALL) /);
});
test('tenant RLS is applied on both underlying tables, not only view',()=>{
 assert.match(sql,/ON car02_r109_qa\.quarantine_ledger FOR SELECT/);
 assert.match(sql,/ON car02_r109_qa\.quarantine_review_events FOR SELECT/);
 assert.match(sql,/GRANT SELECT \(shop_code,job_id,state,reason,created_at\)/);
 assert.match(sql,/GRANT SELECT \(shop_code,job_id,event_kind,recorded_at,event_id\)/);
 assert.doesNotMatch(sql,/GRANT SELECT ON car02_r109_qa\.(?:quarantine_ledger|quarantine_review_events)/);
});
test('viewer output cannot expose SHA, storage path, photo id',()=>{
 const publicSql=sql.split('CREATE VIEW car02_r109_qa.r111_review_inbox')[1].split('REVOKE ALL')[0];
 assert.doesNotMatch(publicSql,/l\.sha256|l\.storage_path|l\.photo_id|e\.proof_sha256/);
 assert.ok(R111_PUBLIC_KEYS.every(k=>typeof k==='string'));
});
test('review count and escalation never imply delete permission',()=>{
 assert.match(sql,/count\(\*\)::int AS review_count/);
 assert.match(sql,/bool_or\(e\.event_kind='ESCALATED_FOR_REVIEW'\)/);
 assert.equal(R111_CONTRACT.storageDeleteAuthorized,false);
});
test('snapshot pagination is deterministic with job ID tie-break',()=>{
 assert.match(code,/ORDER BY created_at DESC,job_id DESC LIMIT \$4/);
 assert.match(code,/\(created_at,job_id\)<\(\$2::timestamptz,\$3::uuid\)/);
 assert.match(code,/q\.limit\+1/);
});
test('every SQL request is BEGIN READ ONLY with commit or rollback',()=>{
 assert.match(code,/client\.query\('BEGIN READ ONLY'\)/);
 assert.match(code,/client\.query\('COMMIT'\)/);
 assert.match(code,/client\.query\('ROLLBACK'\)/);
 assert.doesNotMatch(code,/\b(?:UPDATE|INSERT INTO|DELETE FROM|TRUNCATE)\b/);
});
test('R111 has no Storage/HTTP/secret transport',()=>{
 for(const content of [sql,code,driver]){
  assert.doesNotMatch(content,/SUPABASE_SERVICE_ROLE_KEY|CAR02_DATABASE_URL|storage\/v1|\.supabase\.co|wrangler deploy/i);
 }
 assert.doesNotMatch(code,/\bfetch\s*\(/);
});
test('PG17 driver verifies tenant-only view, page, nonmutation, restart',()=>{
 for(const key of ['R111_TENANT_SCOPED_READONLY_INBOX_PASS','R111_KEYSET_PAGE_AND_ESCALATION_FILTER_PASS',
 'R111_RESTART_PERSISTENCE_AND_NO_MUTATION_PASS','R111_DISPOSABLE_READONLY_INBOX_QA_PASS',
 'security_invoker=true','SET ROLE'])assert.ok(driver.includes(key),key);
});
test('workflow is manual read-only with immutability and cleanup',()=>{
 const r=verifyR111Workflow(yml);assert.equal(r.ok,true);assert.equal(r.steps,R111_STEPS.length);
 assert.equal(r.productionReady,false);assert.equal(r.releaseDecision,'NO_GO');
});
test('workflow cannot change triggers or grant writes',()=>{
 for(const changed of [yml.replace('workflow_dispatch:','push:'),yml.replace('contents: read','contents: write'),
  yml.replace('image: postgres:17','image: postgres:16'),
  yml.replace('if: always()','if: success()'),
  yml.replace('R111_PRODUCTION_NO_GO_MIGRATION_HOLD','PRODUCTION_READY'),
  yml.replace('      - name: Confirm no deploy and release lock','      - name: Hidden deployment\n      - name: Confirm no deploy and release lock'),
  yml+'\n# ${{ secrets.SERVICE_ROLE_KEY }}',yml+'\n# wrangler deploy'])
  assert.throws(()=>verifyR111Workflow(changed));
});
test('safety guard requires every role and database cleanup proof',()=>{
 for(const changed of [yml.replace('car02_r111_a_ci car02_r111_b_ci ','car02_r111_b_ci '),
  yml.replace('DROP DATABASE IF EXISTS car02_r109_qa_ci','SELECT 1;'),
  yml.replace('R111_DISPOSABLE_DB_AND_ROLES_REMOVED','R111_SKIPPED')])
  assert.throws(()=>verifyR111Workflow(changed));
});
function fakePool({badIdentity=false,badRow=false,failQuery=false}={}){
 const state={queries:[],release:[],connects:0};
 const client={async query(q,args){state.queries.push({q,args});
  if(q==='BEGIN READ ONLY'||q==='COMMIT'||q==='ROLLBACK')return {rows:[],rowCount:0};
  if(q.includes('SELECT current_database() AS db'))return {rows:[{...identity,...(badIdentity?{user_name:'postgres'}:{})}]};
  if(q.includes('SELECT job_id::text')){
   if(failQuery)throw Object.assign(new Error('R111_DB_UNAVAILABLE'),{code:'08006'});
   return {rows:[{...base,...(badRow?{shop_code:'other_shop'}:{})}],rowCount:1};
  }throw Error('UNEXPECTED_SQL');
 },release(discard){state.release.push(discard)}};
 return {state,async connect(){state.connects++;return client}};
}
test('fake pool read-only response strips sensitive fields',async()=>{
 const pool=fakePool();const inbox=createR111ReadonlyInbox({environment:'isolated_qa',dbName:'car02_r109_qa_ci',pgPool:pool,expectedUser:role});
 const result=await inbox.list({limit:10});assert.equal(result.items.length,1);assert.equal(result.hasMore,false);
 assert.equal(result.items[0].jobId,job);assert.equal(result.releaseDecision,'NO_GO');
 assert.equal(pool.state.queries[0].q,'BEGIN READ ONLY');assert.ok(pool.state.queries.some(x=>x.q==='COMMIT'));
});
test('forged server identity aborts before any view query',async()=>{
 const pool=fakePool({badIdentity:true});const inbox=createR111ReadonlyInbox({environment:'isolated_qa',dbName:'car02_r109_qa_ci',pgPool:pool,expectedUser:role});
 await assert.rejects(inbox.list(),/R111_BAD_ROLE/);
 assert.ok(pool.state.queries.some(x=>x.q==='ROLLBACK'));
 assert.equal(pool.state.queries.some(x=>x.q.includes('SELECT job_id::text')),false);
});
test('cross-shop database result raises error and rolls back',async()=>{
 const pool=fakePool({badRow:true});const inbox=createR111ReadonlyInbox({environment:'isolated_qa',dbName:'car02_r109_qa_ci',pgPool:pool,expectedUser:role});
 await assert.rejects(inbox.list(),/R111_ROW_TENANT_MISMATCH/);
 assert.ok(pool.state.queries.some(x=>x.q==='ROLLBACK'));
});
test('DB query failure never returns partial success',async()=>{
 const pool=fakePool({failQuery:true});const inbox=createR111ReadonlyInbox({environment:'isolated_qa',dbName:'car02_r109_qa_ci',pgPool:pool,expectedUser:role});
 await assert.rejects(inbox.list(),/R111_DB_UNAVAILABLE/);
 assert.ok(pool.state.queries.some(x=>x.q==='ROLLBACK'));
});
test('invalid cursor never opens a DB session',async()=>{
 const pool=fakePool();const inbox=createR111ReadonlyInbox({environment:'isolated_qa',dbName:'car02_r109_qa_ci',pgPool:pool,expectedUser:role});
 await assert.rejects(inbox.list({limit:999}),/R111_QUERY_INVALID/);
 assert.equal(pool.state.connects,0);
});
