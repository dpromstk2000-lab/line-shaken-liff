import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CAR02_V454_RELEASE_LOCK,CAR02_V454_CLAIM_SQL,CAR02_V454_QUARANTINE_SQL,
 createCar02OfflineOutboxClaimR454} from './car02-outbox-claim-r454.mjs';
const shop='qa_shop_a',event='00000000-0000-0000-0000-000000004533',
 worker='00000000-0000-0000-0000-000000004541',otherWorker='00000000-0000-0000-0000-000000004542',
 token='00000000-0000-0000-0000-000000004543',otherToken='00000000-0000-0000-0000-000000004544';
const bad=p=>assert.rejects(p,e=>e?.code==='CAR02_DISPATCH_UNAUTHORIZED'&&e.status===401);
function setup({shopCode=shop,workerId=worker,role='dispatcher',verified=true,mode='isolated_qa',throwDB=false,
 badClaimRows=null,badReviewRows=null,ackLostClaim=false,ackLostReview=false,seeded=true}={}){
 const records=new Map(),calls=[];let claimed=0,reviewed=0,currentWorker=workerId;
 const key=s=>s+'|'+event;
 const store={query:async(sql,p)=>{
  calls.push({sql,p});if(throwDB)throw Error('secret connection');
  const [tenant,id,who,nonce,reason]=p;
  if(sql===CAR02_V454_CLAIM_SQL){
   if(badClaimRows!==null)return{rows:badClaimRows};
   if(!seeded||tenant!==shop||id!==event||records.has(key(tenant)))return{rows:[]};
   records.set(key(tenant),{workerId:who,token,state:'claimed',reason:null});claimed++;
   if(ackLostClaim)throw Error('claim committed; acknowledgement lost');
   return{rows:[{event_id:event,claim_token:token,state:'claimed'}]};
  }
  if(sql===CAR02_V454_QUARANTINE_SQL){
   if(badReviewRows!==null)return{rows:badReviewRows};
   const x=records.get(key(tenant));
   if(!x||tenant!==shop||id!==event||x.workerId!==who||x.token!==nonce||x.state!=='claimed')
    return{rows:[{quarantined:false}]};
   x.state='manual_review';x.reason=reason;reviewed++;
   if(ackLostReview)throw Error('review committed; acknowledgement lost');
   return{rows:[{quarantined:true}]};
  }
  throw Error('FORBIDDEN_QUERY');
 }};
 const api=createCar02OfflineOutboxClaimR454({store,authorizeWorker:async()=>({
  verified,mode,role,shopCode,workerId:currentWorker})});
 return{api,records,calls,set workerId(v){currentWorker=v},get claimed(){return claimed},get reviewed(){return reviewed}};
}
const take=f=>f.api.claim({request:{fake:true},eventId:event});
const review=(f,over={})=>f.api.quarantine({request:{fake:true},eventId:event,claimToken:token,reason:'send_unknown',...over});
test('hard release lock and both fixed parameterized statements',()=>{
 assert.equal(CAR02_V454_RELEASE_LOCK,true);
 assert.match(CAR02_V454_CLAIM_SQL,/^SELECT event_id,claim_token,state FROM v454_private\.qa_claim_outbox/);
 assert.match(CAR02_V454_QUARANTINE_SQL,/^SELECT quarantined FROM v454_private\.qa_quarantine_claim/);
 assert.throws(()=>createCar02OfflineOutboxClaimR454(),/SERVER_ADAPTERS_REQUIRED/);
});
test('one pending V453 event yields one claim, no real dispatch',async()=>{
 const f=setup(),r=await take(f);
 assert.deepEqual(r,{status:'claimed_review_only',claimToken:token});
 assert.equal(f.claimed,1);assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].p,[shop,event,worker]);
 assert.ok(Object.isFrozen(r));assert.equal(typeof f.api.send,'undefined');
});
test('duplicate claim is refused even by same worker and same event',async()=>{
 const f=setup();await take(f);
 assert.deepEqual(await take(f),{status:'indeterminate'});assert.equal(f.claimed,1);
});
test('correct worker plus claim nonce may quarantine ambiguous outcome',async()=>{
 const f=setup();await take(f);
 assert.deepEqual(await review(f),{status:'manual_review_required'});
 assert.equal(f.records.get(shop+'|'+event).state,'manual_review');
 assert.equal(f.reviewed,1);
});
test('review is one-way and cannot requeue or reclaim',async()=>{
 const f=setup();await take(f);await review(f);
 assert.equal((await take(f)).status,'indeterminate');
 assert.equal((await review(f)).status,'indeterminate');assert.equal(f.reviewed,1);
});
test('unknown event never grants a claim',async()=>{
 const f=setup({seeded:false});assert.equal((await take(f)).status,'indeterminate');assert.equal(f.claimed,0);
});
test('other shop cannot claim event from this shop',async()=>{
 const f=setup({shopCode:'qa_shop_b'});assert.equal((await take(f)).status,'indeterminate');
 assert.deepEqual(f.calls[0].p,['qa_shop_b',event,worker]);
});
test('claim nonce stolen but wrong worker cannot quarantine',async()=>{
 const f=setup();await take(f);f.workerId=otherWorker;
 assert.equal((await review(f)).status,'indeterminate');
 f.workerId=worker;assert.equal((await review(f,{claimToken:otherToken})).status,'indeterminate');
 assert.equal((await review(f)).status,'manual_review_required');
});
test('invalid worker or nonisolated mode never touches database',async()=>{
 for(const opt of [{verified:false},{mode:'production'},{role:'owner'},{role:'staff'},
  {shopCode:'../bad'},{workerId:'not-a-uuid'}]){
  const f=setup(opt);await bad(take(f));assert.equal(f.calls.length,0);
 }
});
test('invalid event id never opens a database connection',async()=>{
 const f=setup();await bad(f.api.claim({request:{},eventId:'wrong'}));assert.equal(f.calls.length,0);
});
test('invalid claim token and reason rejected before SQL',async()=>{
 const f=setup();await bad(review(f,{claimToken:'bad'}));
 await bad(review(f,{reason:'delivered'}));
 await bad(review(f,{reason:'auto_retry'}));assert.equal(f.calls.length,0);
});
test('all three narrow review reason codes accepted and no delivery flag',async()=>{
 for(const reason of ['send_unknown','provider_no_receipt','worker_crash']){
  const f=setup();await take(f);const r=await review(f,{reason});
  assert.equal(r.status,'manual_review_required');assert.deepEqual(Object.keys(r),['status']);
 }
});
test('database error before claim fails closed',async()=>{
 const f=setup({throwDB:true});assert.deepEqual(await take(f),{status:'indeterminate'});
});
test('lost claim ACK never automatically tries again',async()=>{
 const f=setup({ackLostClaim:true});assert.deepEqual(await take(f),{status:'indeterminate'});
 assert.equal(f.claimed,1);assert.equal(f.calls.length,1);
});
test('lost review ACK never silently marks delivered or calls LINE',async()=>{
 const f=setup({ackLostReview:true});await take(f);
 assert.deepEqual(await review(f),{status:'indeterminate'});
 assert.equal(f.reviewed,1);assert.equal(f.calls.length,2);
});
test('unknown DB fields and wrong claim tokens are not accepted',async()=>{
 for(const row of [[{event_id:event,claim_token:otherToken,state:'pending'}],[{event_id:event,claim_token:'bad',state:'claimed'}],
   [{event_id:event,claim_token:token,state:'claimed'},{event_id:event,claim_token:token,state:'claimed'}]]){
  const f=setup({badClaimRows:row});assert.equal((await take(f)).status,'indeterminate');
 }
});
test('malformed quarantine result cannot be interpreted as success',async()=>{
 for(const rows of [[],[{quarantined:'true'}],[{quarantined:false}],[{quarantined:true},{quarantined:true}]]){
  const f=setup({badReviewRows:rows});assert.equal((await review(f)).status,'indeterminate');
 }
});
test('client-provided shop and worker IDs never override trusted identity',async()=>{
 const f=setup();await f.api.claim({request:{shopCode:'qa_shop_b',workerId:otherWorker},eventId:event,
  shopCode:'qa_shop_b',workerId:otherWorker});
 assert.deepEqual(f.calls[0].p,[shop,event,worker]);
});
test('R52 hard release lock stays active, V453 and V454 are isolated',()=>{
 const live=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
 const prev=readFileSync(new URL('./car02-atomic-job-outbox-r453.mjs',import.meta.url),'utf8');
 assert.match(live,/const\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/);
 assert.match(prev,/CAR02_V453_RELEASE_LOCK\s*=\s*true/);
 assert.doesNotMatch(live,/outbox-claim-r454|v454_private/);
});
