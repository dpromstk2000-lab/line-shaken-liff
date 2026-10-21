import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CAR02_V456_RELEASE_LOCK,CAR02_V456_READ_SQL,createCar02OfflineReviewConsistencyR456} from './car02-review-consistency-r456.mjs';
const event='00000000-0000-0000-0000-000000004533';
const shop='qa_shop_a';
const denied=p=>assert.rejects(p,e=>e.code==='CAR02_AUDIT_UNAUTHORIZED'&&e.status===401);
function fixture({verified=true,mode='isolated_qa',role='auditor',shopCode=shop,
  resultState='consistent_closed',stage='closed_without_delivery_assertion',steps=2,
  rows=null,connectionFailure=false,readFailure=false,beginFailure=false,rollbackFailure=false,
  missingRelease=false,invalidClient=false}={}){
 const queries=[],released=[];let connects=0;
 const pool={connect:async()=>{
   connects++;if(connectionFailure)throw Error('secret connection');
   if(invalidClient)return{query:null,release:()=>{}};
   return{query:async(sql,params=[])=>{
     queries.push({sql,params});
     if(sql.startsWith('BEGIN')&&beginFailure)throw Error('BEGIN failure');
     if(sql===CAR02_V456_READ_SQL){if(readFailure)throw Error('sensitive SQL error');
       return{rows:rows??[{integrity_state:resultState,event_id:event,review_stage:stage,audit_steps:steps}]};}
     if(sql==='ROLLBACK'&&rollbackFailure)throw Error('ROLLBACK lost');
     return{rows:[]};
   },...(missingRelease?{}:{release:e=>released.push(Boolean(e))})};
 }};
 const audit=createCar02OfflineReviewConsistencyR456({pool,authorizeAuditor:async()=>({
   verified,mode,role,shopCode})});
 return {audit,queries,released,get connects(){return connects}};
}
const inspect=f=>f.audit.inspect({request:{},eventId:event});
test('release lock, exact read-only SQL and mandatory trusted adapters',()=>{
 assert.equal(CAR02_V456_RELEASE_LOCK,true);
 assert.equal(CAR02_V456_READ_SQL,
 'SELECT integrity_state,event_id,review_stage,audit_steps FROM v456_private.qa_review_consistency($1::text,$2::uuid)');
 assert.throws(()=>createCar02OfflineReviewConsistencyR456(),/SERVER_ADAPTERS_REQUIRED/);
});
test('closed dual-person record is NOT reported as LINE delivered',async()=>{
 const f=fixture(),r=await inspect(f);
 assert.deepEqual(r,{status:'reviewed_without_delivery_proof'});assert.ok(Object.isFrozen(r));
 assert.equal(JSON.stringify(r).includes('delivered'),false);
 assert.equal(typeof f.audit.retry,'undefined');assert.equal(typeof f.audit.send,'undefined');
});
test('pending second reviewer explicitly remains awaiting, not delivered',async()=>{
 const f=fixture({resultState:'consistent_awaiting',stage:'awaiting_independent_signoff',steps:1});
 assert.deepEqual(await inspect(f),{status:'awaiting_independent_signoff'});
});
test('database-detected tampering never authorizes positive result',async()=>{
 const f=fixture({resultState:'inconsistent'});
 assert.deepEqual(await inspect(f),{status:'indeterminate'});
});
test('source receipt or event absent returns indeterminate',async()=>{
 for(const rows of [[],[{integrity_state:'inconsistent',event_id:event,review_stage:'closed_without_delivery_assertion',audit_steps:1}]]){
  assert.deepEqual(await inspect(fixture({rows})),{status:'indeterminate'});
 }
});
test('wrong or duplicate source rows are always indeterminate',async()=>{
 for(const rows of [
  [{integrity_state:'consistent_closed',event_id:'00000000-0000-0000-0000-000000004599',review_stage:'closed_without_delivery_assertion',audit_steps:2}],
  [{integrity_state:'consistent_closed',event_id:event,review_stage:'closed_without_delivery_assertion',audit_steps:2},
   {integrity_state:'consistent_closed',event_id:event,review_stage:'closed_without_delivery_assertion',audit_steps:2}]]){
  assert.deepEqual(await inspect(fixture({rows})),{status:'indeterminate'});
 }
});
test('stage mismatch cannot be called a complete investigation',async()=>{
 const f=fixture({stage:'awaiting_independent_signoff'});
 assert.equal((await inspect(f)).status,'indeterminate');
});
test('audit step count mismatch fails closed',async()=>{
 for(const steps of [0,1,3,-1,'2',null]){
  assert.equal((await inspect(fixture({steps}))).status,'indeterminate');
 }
});
test('unknown integrity state is never elevated to a success',async()=>{
 const f=fixture({resultState:'sent_and_delivered'});
 assert.equal((await inspect(f)).status,'indeterminate');
});
test('authorization is server-owned and checked before any DB access',async()=>{
 for(const x of [{verified:false},{mode:'production'},{role:'owner'},
  {role:'staff'},{shopCode:'../../bad'}]){
  const f=fixture(x);await denied(inspect(f));assert.equal(f.connects,0);
 }
});
test('invalid event ID rejected before opening DB',async()=>{
 const f=fixture();await denied(f.audit.inspect({eventId:'bad'}));
 assert.equal(f.connects,0);
});
test('request-selected shop/role ignored and actual tenant used in query',async()=>{
 const f=fixture();await f.audit.inspect({eventId:event,shopCode:'qa_shop_b',role:'owner',
  request:{shopCode:'qa_shop_b',role:'auditor',delivery:'delivered'}});
 assert.deepEqual(f.queries[3].params,[shop,event]);
});
test('only BEGIN READ ONLY, SET LOCAL, SELECT and ROLLBACK; no COMMIT/write',async()=>{
 const f=fixture();await inspect(f);
 assert.deepEqual(f.queries.map(x=>x.sql),[
  'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
  "SET LOCAL statement_timeout = '12s'","SET LOCAL lock_timeout = '2s'",CAR02_V456_READ_SQL,'ROLLBACK']);
 assert.deepEqual(f.released,[false]);
});
test('unreachable PG returns indeterminate and never leaks error',async()=>{
 const r=await inspect(fixture({connectionFailure:true}));
 assert.deepEqual(r,{status:'indeterminate'});
});
test('bad client or missing release cannot produce a positive audit',async()=>{
 for(const config of [{invalidClient:true},{missingRelease:true}]){
   assert.deepEqual(await inspect(fixture(config)),{status:'indeterminate'});
 }
});
test('read failure ends snapshot and discards DB connection',async()=>{
 const f=fixture({readFailure:true});assert.equal((await inspect(f)).status,'indeterminate');
 assert.deepEqual(f.released,[true]);assert.equal(f.queries.at(-1).sql,'ROLLBACK');
});
test('failure to finish snapshot fails closed',async()=>{
 for(const config of [{beginFailure:true},{rollbackFailure:true}]){
  assert.equal((await inspect(fixture(config))).status,'indeterminate');
 }
});
test('CI source lock and V453-V455 unchanged, no R52 production integration',()=>{
 const live=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
 assert.match(live,/const\s+CAR02_RELEASE_LOCK\s*=\s*true/);
 assert.doesNotMatch(live,/review-consistency-r456|v456_private/);
 for(const [v,n] of [[453,'atomic-job-outbox'],[454,'outbox-claim'],[455,'manual-review-dual-control']]){
  const src=readFileSync(new URL(`./car02-${n}-r${v}.mjs`,import.meta.url),'utf8');
  assert.match(src,/RELEASE_LOCK\s*=\s*true/);
 }
});
