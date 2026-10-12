import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {R110_CONTRACT,R110_REVIEW_USERS,assertR110Environment,validateR110Event,checkR110Identity,
 eventIsIdentical,createR110ReviewLedger} from './car02-r110-review-events-isolated.mjs';
import {verifyR110Workflow,R110_STEPS} from './car02-r110-workflow-guard.mjs';
const sql=readFileSync('R110_PG17_REVIEW_EVENTS_QA_ONLY.sql','utf8');
const code=readFileSync('car02-r110-review-events-isolated.mjs','utf8');
const driver=readFileSync('car02-r110-pg17-review-events-qa.mjs','utf8');
const yml=readFileSync('.github/workflows/car02-r110-append-only-review-qa.yml','utf8');
const A={eventId:'11111111-1111-4111-8111-111111111110',shop:'street_house_kitsuki',
 jobId:'33333333-3333-4333-8333-333333333109',eventKind:'EVIDENCE_HASH_RECORDED',proofSha256:'a'.repeat(64)};
const identity={db:'car02_r109_qa_ci',pg:170000,user_name:'car02_r110_a_ci',session_name:'car02_r110_a_ci',
 superuser:false,bypass_rls:false,inherits:false,live_table_absent:true};
const stored={event_id:A.eventId,shop_code:A.shop,job_id:A.jobId,event_kind:A.eventKind,proof_sha256:A.proofSha256};
const opts={environment:'isolated_qa',dbName:'car02_r109_qa_ci',expectedUser:'car02_r110_a_ci'};
test('R110 is evidence-only: NO_GO, HOLD and no approval or delete capability',()=>{
 assert.equal(R110_CONTRACT.liveStorageDelete,false);assert.equal(R110_CONTRACT.reviewIsAuthorization,false);
 assert.equal(R110_CONTRACT.productionReady,false);assert.equal(R110_CONTRACT.releaseDecision,'NO_GO');
 assert.equal(R110_CONTRACT.migrationDecision,'HOLD');
});
test('R110 exact QA environment checked',()=>{
 const env={R110_DISPOSABLE_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',PGDATABASE:'car02_r109_qa_ci'};
 assertR110Environment(env);
 for(const k of Object.keys(env))assert.throws(()=>assertR110Environment({...env,[k]:'wrong'}));
});
test('R110 accepts only canonical evidence hashes and escalation events',()=>{
 assert.deepEqual(validateR110Event(A),A);assert.equal(Object.isFrozen(validateR110Event(A)),true);
 assert.equal(validateR110Event({...A,eventKind:'ESCALATED_FOR_REVIEW'}).eventKind,'ESCALATED_FOR_REVIEW');
});
test('R110 refuses approval, done, deletion, free-text and outside fields',()=>{
 for(const kind of ['APPROVED','DELETE','DONE','RELEASE','STORAGE_DELETED','REVIEW_NOTE'])
  assert.throws(()=>validateR110Event({...A,eventKind:kind}),/R110_REVIEW_EVENT_INVALID/);
 for(const field of ['note','photoBytes','customerId','token','authorization','serviceRoleKey'])
  assert.throws(()=>validateR110Event({...A,[field]:'secret'}),/R110_REVIEW_EVENT_INVALID/);
});
test('R110 rejects cross-tenant request and malformed IDs and proof digests',()=>{
 for(const change of [{shop:'another_shop'},{shop:'INVALID'},{eventId:'hi'},{jobId:'bad'},
  {proofSha256:'h'.repeat(64)},{proofSha256:'a'.repeat(63)}])
  assert.throws(()=>validateR110Event({...A,...change}),/R110_REVIEW_EVENT_INVALID/);
});
test('R110 rejects malformed structure, inherited properties and non-plain objects',()=>{
 for(const bad of [null,[],Object.create(null),Object.assign(Object.create({admin:true}),A),
  {...A,admin:true}])assert.throws(()=>validateR110Event(bad),/R110_REVIEW_EVENT_INVALID/);
});
test('R110 reviewer roles are independent fixed low-privilege shop identities',()=>{
 assert.deepEqual(R110_REVIEW_USERS,{car02_r110_a_ci:'street_house_kitsuki',car02_r110_b_ci:'other_shop'});
 checkR110Identity(identity,'car02_r110_a_ci');
});
test('R110 rejects impersonation, role switches and privilege escalation',()=>{
 for(const change of [{db:'postgres'},{pg:160000},{pg:180000},{user_name:'postgres'},
  {session_name:'car02_r110_b_ci'},{superuser:true},{bypass_rls:true},{inherits:true},{live_table_absent:false}])
  assert.throws(()=>checkR110Identity({...identity,...change},'car02_r110_a_ci'));
});
test('R110 idempotent retry accepts exact prior event only',()=>{
 assert.equal(eventIsIdentical(stored,A),true);
 for(const change of [{eventId:'11111111-1111-4111-8111-111111111111'},
  {shop:'other_shop'},{jobId:'44444444-4444-4444-8444-444444444109'},
  {eventKind:'ESCALATED_FOR_REVIEW'},{proofSha256:'b'.repeat(64)}])
  assert.equal(eventIsIdentical(stored,{...A,...change}),false);
});
test('R110 constructor fails without verified disposable connection and scoped reviewer',()=>{
 const fake={connect(){throw Error('NO_CONNECT')}};
 assert.equal(createR110ReviewLedger({...opts,pgPool:fake}).noApprovalRoute,true);
 for(const change of [{environment:'production'},{dbName:'postgres'},{expectedUser:'postgres'},
  {expectedUser:'car02_r109_a_ci'},{pgPool:{}}])
  assert.throws(()=>createR110ReviewLedger({...opts,pgPool:fake,...change}),/R110_DISPOSABLE_ONLY/);
});
test('R110 schema demands fresh PG17 disposable DB with R109 ledger fixture',()=>{
 for(const phrase of ["current_database()<>'car02_r109_qa_ci'","to_regclass('public.ksh_car02_photos') IS NOT NULL",
  "to_regclass('car02_r109_qa.quarantine_ledger') IS NULL",'R110_DISPOSABLE_PG17_ONLY'])
  assert.ok(sql.includes(phrase),phrase);
});
test('R110 fixture uses distinct nonbypass login reviewer roles',()=>{
 assert.match(sql,/CREATE ROLE car02_r110_a_ci LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT/);
 assert.match(sql,/CREATE ROLE car02_r110_b_ci LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT/);
 assert.match(sql,/FORCE ROW LEVEL SECURITY/);
 assert.match(sql,/CASE current_user/);
});
test('R110 composite foreign key binds immutable review events to R109 job and tenant',()=>{
 assert.match(sql,/CREATE UNIQUE INDEX r110_ledger_shop_job_unique/);
 assert.match(sql,/FOREIGN KEY\(shop_code,job_id\) REFERENCES car02_r109_qa.quarantine_ledger\(shop_code,job_id\)/);
 assert.match(sql,/event_id uuid PRIMARY KEY/);
});
test('R110 source strictly prevents review event updates and delete privileges',()=>{
 assert.match(sql,/REVOKE ALL ON car02_r109_qa.quarantine_review_events FROM PUBLIC/);
 assert.match(sql,/GRANT SELECT,INSERT ON car02_r109_qa.quarantine_review_events/);
 assert.doesNotMatch(sql,/GRANT\s+(?:ALL|UPDATE|DELETE|TRUNCATE)\b/i);
 assert.match(sql,/CREATE TRIGGER r110_refuse_update_delete BEFORE UPDATE OR DELETE/);
 assert.match(sql,/CREATE TRIGGER r110_refuse_truncate BEFORE TRUNCATE/);
});
test('R110 record transaction compares all fields after event-id conflict, never overwrites',()=>{
 assert.match(code,/await c.query\('BEGIN'\)/);
 assert.match(code,/ON CONFLICT \(event_id\) DO NOTHING RETURNING event_id/);
 assert.match(code,/eventIsIdentical\(selected.rows\[0\],ev\)/);
 assert.match(code,/await c.query\('ROLLBACK'\)/);
 assert.doesNotMatch(code,/ON CONFLICT.*DO UPDATE/);
});
test('R110 driver includes actual PG negative checks and restart verification',()=>{
 for(const marker of ['R110_APPEND_ONLY_RLS_SCHEMA_VERIFIED_PASS','R110_TENANT_FK_IDEMPOTENCY_DENIAL_PASS',
  'R110_RESTART_DURABILITY_PASS','R110_IMMUTABLE_AND_NO_DELETE_AUTHORIZATION_PASS',
  'R110_DISPOSABLE_REVIEW_EVENTS_QA_PASS','23503','42501','SET ROLE'])
  assert.ok(driver.includes(marker),marker);
});
test('R110 contains no live URLs, delete or dispatch transport',()=>{
 for(const s of [code,driver,sql]){
  assert.doesNotMatch(s,/SUPABASE_SERVICE_ROLE_KEY|CAR02_DATABASE_URL|storage\/v1|\.supabase\.co|wrangler deploy|LINE_CHANNEL_ACCESS_TOKEN/i);
 }
 assert.doesNotMatch(code,/\bfetch\s*\(/);
});
test('R110 workflow manual, read-only and checks actual postcleanup absence',()=>{
 const status=verifyR110Workflow(yml);
 assert.equal(status.steps,R110_STEPS.length);assert.equal(status.disposableOnly,true);
 assert.equal(status.releaseDecision,'NO_GO');assert.equal(status.migrationDecision,'HOLD');
});
test('R110 workflow guard rejects added triggers, permissions, hidden step and secret usage',()=>{
 for(const edit of [yml.replace('workflow_dispatch:','push:'),yml.replace('contents: read','contents: write'),
   yml.replace('image: postgres:17','image: postgres:16'),
   yml.replace('      - name: Confirm NO_GO HOLD without deployment','      - name: Hidden step\n      - name: Confirm NO_GO HOLD without deployment'),
   yml+'\n# ${{ secrets.STORAGE_ADMIN }}',yml+'\n# wrangler deploy'])
   assert.throws(()=>verifyR110Workflow(edit));
});
test('R110 workflow guard refuses missing cleanup checks or unlocked production',()=>{
 for(const edit of [yml.replace('if: always()','if: success()'),
  yml.replaceAll('R110_DISPOSABLE_DATABASE_AND_ROLES_REMOVED','R110_SKIP'),
  yml.replace('R110_PRODUCTION_NO_GO_MIGRATION_HOLD','R110_PRODUCTION_READY'),
  yml.replace('const CAR02_RELEASE_LOCK=true','const CAR02_RELEASE_LOCK=false')])
  assert.throws(()=>verifyR110Workflow(edit));
});
const fakePool=({existing=null,wrongRole=false,failInsert=false,rollbackFails=false}={})=>{
 const state={existing,queries:[],released:[]};
 const client={async query(q,params){
  state.queries.push(q);
  if(q==='BEGIN'||q==='COMMIT')return {rows:[],rowCount:0};
  if(q==='ROLLBACK'){if(rollbackFails)throw Error('ROLLBACK_FAILED');return {rows:[],rowCount:0};}
  if(q.includes('SELECT current_database() AS db'))return {rows:[{...identity,...(wrongRole?{user_name:'postgres'}:{})}]};
  if(q.includes('INSERT INTO car02_r109_qa.quarantine_review_events')){
   if(failInsert)throw Object.assign(Error('SIMULATED_DB_DISCONNECT'),{code:'08006'});
   if(state.existing)return {rows:[],rowCount:0};
   state.existing={event_id:params[0],shop_code:params[1],job_id:params[2],event_kind:params[3],proof_sha256:params[4]};
   return {rows:[{event_id:params[0]}],rowCount:1};
  }
  if(q.includes('SELECT event_id::text'))return {rows:state.existing?[state.existing]:[]};
  throw Error('UNEXPECTED_TEST_QUERY');
 },release(discard){state.released.push(discard)}};
 return {state,connect:async()=>client};
};
test('R110 fake transaction accepts first event and exact concurrent retry',async()=>{
 const f=fakePool();const l=createR110ReviewLedger({...opts,pgPool:f});
 assert.deepEqual(await l.record(A),{status:'RECORDED_NOT_AUTHORIZED',duplicate:false});
 assert.deepEqual(await l.record(A),{status:'RECORDED_NOT_AUTHORIZED',duplicate:true});
 assert.equal(f.state.queries.filter(x=>x==='COMMIT').length,2);
 assert.deepEqual(f.state.released,[false,false]);
});
test('R110 fake event collision refuses changed evidence and rolls back',async()=>{
 const f=fakePool({existing:stored});const l=createR110ReviewLedger({...opts,pgPool:f});
 await assert.rejects(l.record({...A,proofSha256:'b'.repeat(64)}),/R110_EVENT_REBIND_DENIED/);
 assert.ok(f.state.queries.includes('ROLLBACK'));assert.ok(!f.state.queries.includes('COMMIT'));
});
test('R110 fake reviewer identity rejected before any write',async()=>{
 const f=fakePool({wrongRole:true});const l=createR110ReviewLedger({...opts,pgPool:f});
 await assert.rejects(l.record(A),/R110_BAD_ROLE/);
 assert.ok(!f.state.queries.some(x=>x.includes('INSERT INTO')));
});
test('R110 fake insert failure never creates a successful review receipt',async()=>{
 const f=fakePool({failInsert:true});const l=createR110ReviewLedger({...opts,pgPool:f});
 await assert.rejects(l.record(A),/SIMULATED_DB_DISCONNECT/);
 assert.ok(f.state.queries.includes('ROLLBACK'));assert.ok(!f.state.queries.includes('COMMIT'));
});
test('R110 fake rollback failure discards unsafe DB connection',async()=>{
 const f=fakePool({failInsert:true,rollbackFails:true});const l=createR110ReviewLedger({...opts,pgPool:f});
 await assert.rejects(l.record(A),/SIMULATED_DB_DISCONNECT/);assert.deepEqual(f.state.released,[true]);
});
