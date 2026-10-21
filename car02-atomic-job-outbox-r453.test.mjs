import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CAR02_V453_RELEASE_LOCK,CAR02_V453_ATOMIC_SQL,createCar02OfflineAtomicJobOutboxR453} from './car02-atomic-job-outbox-r453.mjs';
const shop='qa_shop_a',other='qa_shop_b',staff='00000000-0000-0000-0000-000000004513';
const owner='00000000-0000-0000-0000-000000004511',sid='00000000-0000-0000-0000-000000004514';
const ownerSid='00000000-0000-0000-0000-000000004512',job='00000000-0000-0000-0000-000000004538';
const unassigned='00000000-0000-0000-0000-000000004537',locked='00000000-0000-0000-0000-000000004536';
const archived='00000000-0000-0000-0000-000000004535',requestId='00000000-0000-0000-0000-000000004533';
const reqOther='00000000-0000-0000-0000-000000004534',time=2_000_000_000_000;
const issuer='https://car02-qa.supabase.co/auth/v1';
const req=(type='staff',mixed=false)=>new Request('https://car02.test/synthetic',{headers:{authorization:'Bearer synthetic-'+type+'-provider-token',...(mixed?{'x-line-id-token':'mixed'}:{})}});
const args=(over={})=>({request:req(),jobId:job,expectedVersion:1,requestId,...over});
const denied=p=>assert.rejects(p,e=>e?.code==='CAR02_UNAUTHORIZED'&&e.status===401);
function fixture({who='staff',shopCode=shop,routeOK=true,mode='isolated_qa',jwtOK=true,
  issuerValue=issuer,audience='authenticated',jwtRole='authenticated',expired=false,
  wrongSubject=false,wrongSession=false,dbThrow=false,lostAck=false,rows=null,failOutbox=false}={}){
 const sub=who==='owner'?owner:staff,session=who==='owner'?ownerSid:sid;
 let memberRole=who,active=true,sessionActive=true,fence=time-30000,sessionCreated=time-10000;
 const jobs=new Map([[job,{version:1,assignee:staff,locked:false,archived:false}],
 [unassigned,{version:1,assignee:null,locked:false,archived:false}],
 [locked,{version:1,assignee:staff,locked:true,archived:false}],
 [archived,{version:1,assignee:staff,locked:false,archived:true}]]);
 const receipts=new Map(),outbox=new Map(),calls=[];
 const store={query:async(sql,params)=>{
  calls.push({sql,params});if(dbThrow)throw Error('secret DB error');
  if(sql!==CAR02_V453_ATOMIC_SQL)throw Error('UNREVIEWED_SQL');
  if(rows!==null)return {rows};
  const [tenant,u,s,id,expected,key]=params,record=jobs.get(id);
  if(tenant!==shop||u!==sub||s!==session||!active||!sessionActive||sessionCreated<=fence||
     !record||record.archived||(memberRole!=='owner'&&(memberRole!=='staff'||record.locked||record.assignee!==u)))return {rows:[]};
  const receipt=receipts.get(tenant+'|'+key),event=outbox.get(tenant+'|'+key);
  if(receipt){
   if(receipt.subject!==u||receipt.sid!==s||receipt.job!==id||receipt.expected!==expected||
      !event||event.job!==id||event.newVersion!==receipt.newVersion||event.state!=='pending')return {rows:[]};
   return{rows:[{applied:false,new_version:receipt.newVersion,event_id:key,dispatch_state:'pending'}]};
  }
  if(record.version!==expected)return {rows:[]};
  if(failOutbox)return {rows:[]}; // atomic SQL rollback => no partial writes.
  record.version++;
  receipts.set(tenant+'|'+key,{subject:u,sid:s,job:id,expected,newVersion:record.version});
  outbox.set(tenant+'|'+key,{job:id,newVersion:record.version,state:'pending',attempts:0});
  if(lostAck)throw Error('Lost acknowledgment AFTER commit');
  return{rows:[{applied:true,new_version:record.version,event_id:key,dispatch_state:'pending'}]};
 }};
 const api=createCar02OfflineAtomicJobOutboxR453({store,expectedIssuer:issuer,nowMs:()=>time,
   authorizeShop:async()=>({verified:routeOK,mode,shopCode}),
   verifyJwt:async()=>({verified:jwtOK,sub:wrongSubject?owner:sub,sessionId:wrongSession?ownerSid:session,
      issuer:issuerValue,audience,role:jwtRole,expMs:expired?time:time+50000})});
 return {api,jobs,receipts,outbox,calls,sub,session,
   set active(x){active=x},set sessionActive(x){sessionActive=x},
   set memberRole(x){memberRole=x},set fence(x){fence=x},set sessionCreated(x){sessionCreated=x},
   set lostAck(x){lostAck=x},set failOutbox(x){failOutbox=x}};
}
test('hard-lock, single trusted parameterized SQL and mandatory adapters',()=>{
 assert.equal(CAR02_V453_RELEASE_LOCK,true);
 assert.equal(CAR02_V453_ATOMIC_SQL,'SELECT applied,new_version,event_id,dispatch_state FROM v453_private.qa_touch_and_queue($1::text,$2::uuid,$3::uuid,$4::uuid,$5::integer,$6::uuid)');
 assert.throws(()=>createCar02OfflineAtomicJobOutboxR453(),/TRUSTED_OFFLINE_ADAPTERS_REQUIRED/);
});
test('first authorized staff update stores receipt and pending outbox together',async()=>{
 const f=fixture(),o=await f.api.touchAndQueue(args());
 assert.deepEqual(o,{status:'queued_review_only',newVersion:2,eventId:requestId});
 assert.equal(f.jobs.get(job).version,2);assert.equal(f.receipts.size,1);assert.equal(f.outbox.size,1);
 assert.equal(f.outbox.get(shop+'|'+requestId).state,'pending');assert.equal(f.outbox.get(shop+'|'+requestId).attempts,0);
 assert.equal(Object.isFrozen(o),true);
});
test('exact duplicate operation never inserts second queue item or modifies job twice',async()=>{
 const f=fixture();await f.api.touchAndQueue(args());const o=await f.api.touchAndQueue(args());
 assert.equal(o.status,'duplicate_queued_review_only');assert.equal(f.jobs.get(job).version,2);
 assert.equal(f.receipts.size,1);assert.equal(f.outbox.size,1);
});
test('outbox persistence failure aborts job update and receipt insertion',async()=>{
 const f=fixture({failOutbox:true});const o=await f.api.touchAndQueue(args());
 assert.equal(o.status,'indeterminate');assert.equal(f.jobs.get(job).version,1);
 assert.equal(f.receipts.size,0);assert.equal(f.outbox.size,0);
});
test('lost COMMIT ACK never claimed delivery or automatically replayed',async()=>{
 const f=fixture({lostAck:true});assert.deepEqual(await f.api.touchAndQueue(args()),{status:'indeterminate'});
 assert.equal(f.calls.length,1);assert.equal(f.outbox.size,1);
 f.lostAck=false;assert.equal((await f.api.touchAndQueue(args())).status,'duplicate_queued_review_only');
});
test('new request UUID with stale version never schedules duplicate outbox event',async()=>{
 const f=fixture();await f.api.touchAndQueue(args());
 assert.equal((await f.api.touchAndQueue(args({requestId:reqOther}))).status,'indeterminate');
 assert.equal(f.outbox.size,1);
});
test('same request ID cannot be reused for different job, version or identity',async()=>{
 const f=fixture();await f.api.touchAndQueue(args());
 assert.equal((await f.api.touchAndQueue(args({jobId:unassigned}))).status,'indeterminate');
 assert.equal((await f.api.touchAndQueue(args({expectedVersion:2}))).status,'indeterminate');
 assert.equal(f.outbox.size,1);
});
test('receipt replay fails closed when matching outbox evidence is missing',async()=>{
 const f=fixture();await f.api.touchAndQueue(args());f.outbox.clear();
 assert.equal((await f.api.touchAndQueue(args())).status,'indeterminate');
});
test('receipt replay fails closed when outbox event was changed',async()=>{
 const f=fixture();await f.api.touchAndQueue(args());f.outbox.get(shop+'|'+requestId).newVersion=999;
 assert.equal((await f.api.touchAndQueue(args())).status,'indeterminate');
});
test('owner can touch unassigned job but neither owner nor staff may touch archived',async()=>{
 const o=fixture({who:'owner'});
 assert.equal((await o.api.touchAndQueue(args({request:req('owner'),jobId:unassigned}))).status,'queued_review_only');
 for(const type of ['staff','owner']){
  const f=fixture({who:type});assert.equal((await f.api.touchAndQueue(args({request:req(type),jobId:archived}))).status,'indeterminate');
 }
});
test('staff cannot touch unassigned or locked job',async()=>{
 const f=fixture();for(const id of [unassigned,locked])assert.equal((await f.api.touchAndQueue(args({jobId:id}))).status,'indeterminate');
 assert.equal(f.outbox.size,0);
});
test('role downgrade blocks owner replay on unassigned job',async()=>{
 const f=fixture({who:'owner'});await f.api.touchAndQueue(args({request:req('owner'),jobId:unassigned}));
 f.memberRole='staff';assert.equal((await f.api.touchAndQueue(args({request:req('owner'),jobId:unassigned}))).status,'indeterminate');
});
test('revocation prevents even duplicate pending queue confirmation',async()=>{
 for(const state of ['active','sessionActive']){
  const f=fixture();await f.api.touchAndQueue(args());f[state]=false;
  assert.equal((await f.api.touchAndQueue(args())).status,'indeterminate');
 }
});
test('old or exact postcommit fence session cannot queue',async()=>{
 for(const limit of [time-10000,time+1]){
  const f=fixture();f.fence=limit;
  assert.equal((await f.api.touchAndQueue(args())).status,'indeterminate');
 }
});
test('tenant and actor from verified server cannot be overridden by request fields',async()=>{
 const f=fixture();await f.api.touchAndQueue({...args(),shopCode:other,role:'owner',sessionId:ownerSid,
   dispatchState:'delivered',attempts:99,eventId:reqOther});
 assert.deepEqual(f.calls[0].params,[shop,staff,sid,job,1,requestId]);
 const bad=fixture({shopCode:other});assert.equal((await bad.api.touchAndQueue(args())).status,'indeterminate');
});
test('incorrect signed subject or session denies tenant mutation',async()=>{
 for(const x of [{wrongSubject:true},{wrongSession:true}]){
  const f=fixture(x);assert.equal((await f.api.touchAndQueue(args())).status,'indeterminate');
 }
});
test('invalid signature, issuer, role, audience, expired JWT stop before DB',async()=>{
 for(const x of [{jwtOK:false},{issuerValue:'https://bad.supabase.co/auth/v1'},
    {jwtRole:'service_role'},{audience:'anon'},{expired:true}]){
  const f=fixture(x);await denied(f.api.touchAndQueue(args()));assert.equal(f.calls.length,0);
 }
});
test('wrong mode or invalid route and mixed LINE credential deny before DB',async()=>{
 for(const x of [{routeOK:false},{mode:'production'},{shopCode:'../bad'}]){
   const f=fixture(x);await denied(f.api.touchAndQueue(args()));assert.equal(f.calls.length,0);
 }
 const f=fixture();await denied(f.api.touchAndQueue(args({request:req('staff',true)})));
});
test('malformed ids, bearer, and expected version deny before DB',async()=>{
 const f=fixture();for(const v of [{jobId:'bad'},{requestId:'bad'},{expectedVersion:0},
   {expectedVersion:3.5},{request:new Request('https://test')}])await denied(f.api.touchAndQueue(args(v)));
 assert.equal(f.calls.length,0);
});
test('malformed or forged DB return never claims enqueue, duplicate or delivery',async()=>{
 for(const rows of [[],[{applied:true,new_version:2,event_id:reqOther,dispatch_state:'pending'}],
 [{applied:true,new_version:2,event_id:requestId,dispatch_state:'delivered'}],
 [{applied:'true',new_version:2,event_id:requestId,dispatch_state:'pending'}],
 [{applied:false,new_version:3,event_id:requestId,dispatch_state:'pending'}],
 [{applied:true,new_version:2,event_id:requestId,dispatch_state:'pending'},{applied:true}]]){
  const f=fixture({rows});assert.deepEqual(await f.api.touchAndQueue(args()),{status:'indeterminate'});
 }
 assert.deepEqual(await fixture({dbThrow:true}).api.touchAndQueue(args()),{status:'indeterminate'});
});
test('original R52, V452 remain hard locked and no production outbox integration exists',()=>{
 const edge=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
 const prev=readFileSync(new URL('./car02-job-idempotency-r452.mjs',import.meta.url),'utf8');
 assert.match(edge,/const\s+CAR02_RELEASE_LOCK\s*=\s*true/);
 assert.match(prev,/CAR02_V452_RELEASE_LOCK\s*=\s*true/);
 assert.doesNotMatch(edge,/atomic-job-outbox-r453|v453_private/);
});
