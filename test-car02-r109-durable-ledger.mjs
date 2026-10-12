import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {R109_CONTRACT,R109_TEST_USERS,assertR109Env,validateR109Request,
 matchR109Ledger,checkR109RoleIdentity,createR109Ledger} from './car02-r109-durable-ledger-isolated.mjs';
import {verifyR109Workflow,R109_STEPS} from './car02-r109-workflow-guard.mjs';
const sql=readFileSync('R109_PG17_DURABLE_QUARANTINE_QA_ONLY.sql','utf8');
const yml=readFileSync('.github/workflows/car02-r109-durable-quarantine-qa.yml','utf8');
const code=readFileSync('car02-r109-durable-ledger-isolated.mjs','utf8');
const driver=readFileSync('car02-r109-pg17-durable-ledger-qa.mjs','utf8');
const SHOP='street_house_kitsuki',JOB='33333333-3333-4333-8333-333333333109';
const PHOTO='11111111-1111-4111-8111-111111111109';
const PATH='street_house_kitsuki/77777777-7777-4777-8777-777777777109/88888888-8888-4888-8888-888888888109/99999999-9999-4999-8999-999999999109.jpg';
const row={shop:SHOP,jobId:JOB,photoId:PHOTO,path:PATH,sha256:'a'.repeat(64),reason:'UPLOAD_UNCERTAIN'};
const proof={db:'car02_r109_qa_ci',pg:170000,user_name:'car02_r109_a_ci',session_name:'car02_r109_a_ci',
 superuser:false,bypass_rls:false,inherits:false,live_table_absent:true};
function stored(x=row){return {job_id:x.jobId,shop_code:x.shop,photo_id:x.photoId,storage_path:x.path,
 sha256:x.sha256,reason:x.reason,bucket:'ksh-car02-private-photos',state:'QUARANTINED'};}
test('R109 never grants live storage delete, release or DB migration',()=>{
 assert.equal(R109_CONTRACT.productionReady,false);assert.equal(R109_CONTRACT.realStorageDeletion,false);
 assert.equal(R109_CONTRACT.releaseDecision,'NO_GO');assert.equal(R109_CONTRACT.migrationDecision,'HOLD');
});
test('R109 only accepts exact disposable PostgreSQL identity',()=>{
 const env={R109_DISPOSABLE_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',PGDATABASE:'car02_r109_qa_ci'};
 assertR109Env(env);
 for(const k of Object.keys(env))assert.throws(()=>assertR109Env({...env,[k]:'wrong'}));
});
test('R109 queue accepts only canonical tenant scoped metadata',()=>{
 assert.deepEqual(validateR109Request(row),row);
 assert.equal(Object.isFrozen(validateR109Request(row)),true);
});
test('R109 request rejects unknown fields, credentials and forged transport keys',()=>{
 for(const key of ['serviceRoleKey','accessToken','signedUrl','admin'])
  assert.throws(()=>validateR109Request({...row,[key]:'secret'}),/R109_INVALID_SCOPE/);
});
test('R109 request rejects other tenant, escape, wrong object id and nonphoto extension',()=>{
 for(const change of [{shop:'other_shop'},{path:'../escape'},{path:PATH+'?query=1'},
  {path:PATH.replace(/jpg$/,'svg')},{path:PATH.replace('77777777','!7777777')},{shop:'SHOP'}])
  assert.throws(()=>validateR109Request({...row,...change}),/R109_INVALID_SCOPE/);
});
test('R109 rejects invalid job or photo IDs and untrusted digests',()=>{
 for(const change of [{jobId:'bad'},{photoId:'other'},{sha256:'f'.repeat(63)},{reason:'DELETE_NOW'}])
  assert.throws(()=>validateR109Request({...row,...change}),/R109_INVALID_SCOPE/);
});
test('R109 duplicate only valid for an exact preserved row including reason and digest',()=>{
 assert.equal(matchR109Ledger(stored(),row),true);
 for(const change of [{photoId:'11111111-1111-4111-8111-111111111110'},
  {reason:'ACK_LOST'},{sha256:'b'.repeat(64)},{path:PATH.replace('.jpg','.png')},
  {jobId:'55555555-5555-4555-8555-555555555555'}])
  assert.equal(matchR109Ledger(stored(),{...row,...change}),false);
});
test('R109 existing row cannot be renamed to state DONE or public bucket',()=>{
 assert.equal(matchR109Ledger({...stored(),state:'DONE'},row),false);
 assert.equal(matchR109Ledger({...stored(),bucket:'public'},row),false);
});
test('R109 role identity must be same session, nonbypass, nonprivileged PG17',()=>{
 checkR109RoleIdentity(proof,'car02_r109_a_ci');
 for(const d of [{db:'postgres'},{pg:160000},{pg:180000},{session_name:'postgres'},
  {superuser:true},{bypass_rls:true},{inherits:true},{live_table_absent:false}])
  assert.throws(()=>checkR109RoleIdentity({...proof,...d},'car02_r109_a_ci'));
});
test('R109 refuses production mode, unapproved user, absent connection and storage transports',()=>{
 const opts={environment:'isolated_qa',dbName:'car02_r109_qa_ci',
  pgPool:{connect(){throw Error('DO_NOT_CONNECT')}},expectedUser:'car02_r109_a_ci'};
 assert.equal(createR109Ledger(opts).noStorageDelete,true);
 for(const m of [{environment:'production'},{dbName:'postgres'},{expectedUser:'postgres'},
  {pgPool:{}},{expectedUser:'bad'}])assert.throws(()=>createR109Ledger({...opts,...m}),/R109_DISPOSABLE_ONLY/);
});
test('R109 fixture rejects non-disposable and existing live photo tables',()=>{
 assert.match(sql,/current_database\(\) <> 'car02_r109_qa_ci'/);
 assert.match(sql,/to_regclass\('public\.ksh_car02_photos'\) IS NOT NULL/);
 assert.match(sql,/server_version_num/);
 assert.match(sql,/R109_DISPOSABLE_PG17_ONLY/);
});
test('R109 fixture two roles explicitly cannot bypass RLS',()=>{
 assert.equal(Object.keys(R109_TEST_USERS).length,2);
 assert.match(sql,/LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT/g);
 assert.match(sql,/FORCE ROW LEVEL SECURITY/);
 assert.match(sql,/CASE current_user/);
 assert.doesNotMatch(sql,/current_setting\('car02\.tenant'/);
});
test('R109 DB permissions give only SELECT and INSERT to tenant roles',()=>{
 assert.match(sql,/GRANT SELECT,INSERT ON car02_r109_qa\.quarantine_ledger/);
 assert.doesNotMatch(sql,/GRANT (?:ALL|UPDATE|DELETE|TRUNCATE)\b/);
 assert.match(sql,/REVOKE ALL ON car02_r109_qa\.quarantine_ledger FROM PUBLIC/);
});
test('R109 permanent path reservation and strict composite photo FK enforced in SQL',()=>{
 assert.match(sql,/storage_path text NOT NULL UNIQUE/);
 assert.match(sql,/FOREIGN KEY \(shop_code,photo_id\) REFERENCES/);
 assert.match(sql,/left\(storage_path,char_length\(shop_code\)\+1\)=shop_code \|\| '\/'/);
 assert.match(sql,/sha256 ~/);assert.match(sql,/state='QUARANTINED'/);
});
test('R109 cannot be mutated by normal DML or TRUNCATE even as table owner',()=>{
 assert.match(sql,/CREATE TRIGGER r109_refuse_update_delete BEFORE UPDATE OR DELETE/);
 assert.match(sql,/CREATE TRIGGER r109_refuse_truncate BEFORE TRUNCATE/);
 assert.match(sql,/RAISE EXCEPTION 'R109_LEDGER_IMMUTABLE'/);
});
test('R109 write is transaction-scoped, exact on job conflict and never overwrites',()=>{
 assert.match(code,/await client\.query\('BEGIN'\)/);
 assert.match(code,/ON CONFLICT \(job_id\) DO NOTHING RETURNING job_id/);
 assert.match(code,/matchR109Ledger\(existing\.rows\[0\],input\)/);
 assert.match(code,/await client\.query\('ROLLBACK'\)/);
 assert.doesNotMatch(code,/ON CONFLICT \(job_id\) DO UPDATE/);
});
test('R109 driver proves role/tenant separation, restart persistence, collisions and immutable record',()=>{
 for(const term of ['R109_DURABLE_RESTART_RETRY_PASS','R109_IMMUTABLE_TOMBSTONE_NO_STORAGE_DELETE_PASS',
  'R109_TENANT_AND_IDEMPOTENCY_HARD_DENIAL_PASS','R109_PG17_RLS_AND_IMMUTABLE_TRIGGERS_PASS',
  'SET ROLE','23503','23505'])assert.ok(driver.includes(term),term);
});
test('R109 does not access real Storage/Supabase or production service keys',()=>{
 for(const s of [code,driver,sql])assert.doesNotMatch(s,/SUPABASE_SERVICE_ROLE_KEY|CAR02_DATABASE_URL|wrangler deploy|storage\/v1|\.supabase\.co/i);
 assert.doesNotMatch(code,/\bfetch\s*\(/);
});
test('R109 workflow is manual, read-only, PG17 disposable, with cleanup and hard lock',()=>{
 const v=verifyR109Workflow(yml);assert.equal(v.steps,R109_STEPS.length);assert.equal(v.disposableOnly,true);
 assert.equal(v.releaseDecision,'NO_GO');assert.equal(v.migrationDecision,'HOLD');
});
test('R109 rejects workflow trigger / permissions / hidden step changes',()=>{
 for(const changed of [yml.replace('workflow_dispatch:','push:'),yml.replace('contents: read','contents: write'),
 yml.replace('image: postgres:17','image: postgres:16'),
 yml.replace('      - name: Confirm NO_GO HOLD and no deployment','      - name: Hidden step\n      - name: Confirm NO_GO HOLD and no deployment'),
 yml+'\n# ${{ secrets.SERVICE_ROLE_KEY }}',yml+'\n# wrangler deploy'])
  assert.throws(()=>verifyR109Workflow(changed));
});
test('R109 workflow never silently skips the DB cleanup proof or end lock',()=>{
 for(const changed of [yml.replace('if: always()','if: success()'),
  yml.replaceAll('R109_DISPOSABLE_DB_AND_ROLES_REMOVED','SKIPPED'),
  yml.replace('R109_PRODUCTION_NO_GO_MIGRATION_HOLD','PRODUCTION_READY')])
  assert.throws(()=>verifyR109Workflow(changed));
});
function fakeLedgerPool({existing=null,forgedRole=false,failInsert=false}={}){
 const state={existing,queries:[],release:[],connects:0};
 const client={async query(q,values){
  state.queries.push(q);
  if(q==='BEGIN'||q==='COMMIT'||q==='ROLLBACK')return {rows:[],rowCount:0};
  if(q.includes('SELECT current_database() AS db'))return {rows:[{...proof,...(forgedRole?{user_name:'car02_r109_b_ci'}:{})}],rowCount:1};
  if(q.includes('INSERT INTO car02_r109_qa.quarantine_ledger')){
   if(failInsert)throw Object.assign(new Error('SIMULATED_PG_DISCONNECT'),{code:'08006'});
   if(state.existing)return {rows:[],rowCount:0};
   state.existing=stored({shop:values[1],jobId:values[0],photoId:values[2],path:values[3],sha256:values[4],reason:values[5]});
   return {rows:[{job_id:values[0]}],rowCount:1};
  }
  if(q.includes('SELECT job_id::text'))return {rows:state.existing?[state.existing]:[],rowCount:state.existing?1:0};
  throw Error('UNEXPECTED_TEST_QUERY');
 },release(flag){state.release.push(flag)}};
 return {state,connect:async()=>{state.connects++;return client}};
}
test('R109 fake transaction: first insert and identical retry are distinguishable, without rebinding',async()=>{
 const fake=fakeLedgerPool();const q=createR109Ledger({environment:'isolated_qa',dbName:'car02_r109_qa_ci',pgPool:fake,expectedUser:'car02_r109_a_ci'});
 assert.deepEqual(await q.enqueue(row),{status:'QUARANTINED',duplicate:false});
 assert.deepEqual(await q.enqueue(row),{status:'QUARANTINED',duplicate:true});
 assert.equal(fake.state.queries.filter(x=>x==='COMMIT').length,2);
 assert.deepEqual(fake.state.release,[false,false]);
});
test('R109 fake transaction: matching job but changed hash is rejected and rolled back',async()=>{
 const fake=fakeLedgerPool({existing:stored()});const q=createR109Ledger({environment:'isolated_qa',dbName:'car02_r109_qa_ci',pgPool:fake,expectedUser:'car02_r109_a_ci'});
 await assert.rejects(q.enqueue({...row,sha256:'b'.repeat(64)}),/R109_REBIND_OR_SCOPE_DENIED/);
 assert.ok(fake.state.queries.includes('ROLLBACK'));
 assert.ok(!fake.state.queries.includes('COMMIT'));
});
test('R109 fake transaction: forged database session rejects before insert',async()=>{
 const fake=fakeLedgerPool({forgedRole:true});const q=createR109Ledger({environment:'isolated_qa',dbName:'car02_r109_qa_ci',pgPool:fake,expectedUser:'car02_r109_a_ci'});
 await assert.rejects(q.enqueue(row),/R109_BAD_ROLE/);
 assert.ok(fake.state.queries.includes('ROLLBACK'));
 assert.equal(fake.state.queries.some(x=>x.includes('INSERT INTO')),false);
});
test('R109 fake transaction: DB insert failure rolls back, never reports success',async()=>{
 const fake=fakeLedgerPool({failInsert:true});const q=createR109Ledger({environment:'isolated_qa',dbName:'car02_r109_qa_ci',pgPool:fake,expectedUser:'car02_r109_a_ci'});
 await assert.rejects(q.enqueue(row),/SIMULATED_PG_DISCONNECT/);
 assert.ok(fake.state.queries.includes('ROLLBACK'));
 assert.ok(!fake.state.queries.includes('COMMIT'));
});
