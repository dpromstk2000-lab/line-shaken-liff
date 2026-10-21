import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CAR02_V452_RELEASE_LOCK,CAR02_V452_TOUCH_SQL,createCar02OfflineJobIdempotencyR452} from './car02-job-idempotency-r452.mjs';
const shop='qa_shop_a',other='qa_shop_b';
const staff='00000000-0000-0000-0000-000000004513',owner='00000000-0000-0000-0000-000000004511';
const staffSid='00000000-0000-0000-0000-000000004514',ownerSid='00000000-0000-0000-0000-000000004512';
const job='00000000-0000-0000-0000-000000004518',noOwner='00000000-0000-0000-0000-000000004522';
const requestId='00000000-0000-0000-0000-000000004526',requestId2='00000000-0000-0000-0000-000000004527';
const issuer='https://car02-qa.supabase.co/auth/v1',now=2_000_000_000_000;
const req=(kind='staff',mixed=false)=>new Request('https://car02.test/review-only',{headers:{authorization:'Bearer synthetic-'+kind+'-jwt-token',...(mixed?{'x-line-id-token':'fake'}:{})}});
const denied=p=>assert.rejects(p,e=>e?.code==='CAR02_UNAUTHORIZED'&&e.status===401);
const input=(kind='staff',over={})=>({request:req(kind),jobId:job,expectedVersion:1,requestId,...over});
function setup({user='staff',shopCode=shop,routeValid=true,mode='isolated_qa',jwtValid=true,
  tokenExpired=false,issuerValue=issuer,role='authenticated',audience='authenticated',
  wrongSub=false,wrongSession=false,throwBefore=false,ackLost=false,rows=null}={}){
 const actualUser=user==='owner'?owner:staff, actualSession=user==='owner'?ownerSid:staffSid;
 let active=true,live=true,staffRole=user==='owner'?'owner':'staff',fence=now-30000,created=now-5000;
 const jobs=new Map([[job,{version:1,assigned:staff,locked:false,archived:false}],
 [noOwner,{version:1,assigned:null,locked:false,archived:false}],
 ['00000000-0000-0000-0000-000000004520',{version:1,assigned:staff,locked:true,archived:false}],
 ['00000000-0000-0000-0000-000000004521',{version:1,assigned:staff,locked:false,archived:true}]]);
 const receipts=new Map(),calls=[];
 const store={query:async(sql,args)=>{
  calls.push({sql,args});
  if(throwBefore)throw Error('secret database error');
  if(sql!==CAR02_V452_TOUCH_SQL)throw Error('FORBIDDEN_SQL');
  if(rows!==null)return{rows};
  const [tenant,sub,sid,id,expected,key]=args,cur=jobs.get(id);
  if(tenant!==shop||sub!==actualUser||sid!==actualSession||!active||!live||created<=fence||
    !cur||cur.archived||(staffRole==='staff'&&(cur.locked||cur.assigned!==sub)))return{rows:[]};
  const rKey=tenant+'|'+key,prev=receipts.get(rKey);
  if(prev){
    if(prev.sub!==sub||prev.sid!==sid||prev.id!==id||prev.expected!==expected)return{rows:[]};
    return{rows:[{applied:false,new_version:prev.newVersion}]};
  }
  if(cur.version!==expected)return{rows:[]};
  cur.version++;
  receipts.set(rKey,{sub,sid,id,expected,newVersion:cur.version});
  if(ackLost)throw Error('SQL response lost after durable COMMIT');
  return{rows:[{applied:true,new_version:cur.version}]};
 }};
 const api=createCar02OfflineJobIdempotencyR452({store,expectedIssuer:issuer,nowMs:()=>now,
   authorizeShop:async()=>({verified:routeValid,mode,shopCode}),
   verifyJwt:async()=>({verified:jwtValid,issuer:issuerValue,role,audience,
     sub:wrongSub?'00000000-0000-0000-0000-000000004599':actualUser,
     sessionId:wrongSession?'00000000-0000-0000-0000-000000004598':actualSession,
     expMs:tokenExpired?now:now+100000})});
 return {api,store,jobs,receipts,calls,actualUser,actualSession,
   set active(x){active=x},set live(x){live=x},set staffRole(x){staffRole=x},
   set fence(x){fence=x},set created(x){created=x},set ackLost(x){ackLost=x}};
}
test('lock and exact parameterized SQL, no real adapter fallback',()=>{
 assert.equal(CAR02_V452_RELEASE_LOCK,true);
 assert.equal(CAR02_V452_TOUCH_SQL,'SELECT applied,new_version FROM v452_private.qa_receipted_job_cas($1::text,$2::uuid,$3::uuid,$4::uuid,$5::integer,$6::uuid)');
 assert.throws(()=>createCar02OfflineJobIdempotencyR452(),/TRUSTED_OFFLINE_ADAPTERS_REQUIRED/);
});
test('first authorized staff request atomically persists receipt and version change',async()=>{
 const f=setup(),r=await f.api.touchJob(input());
 assert.deepEqual(r,{status:'applied_review_only',newVersion:2});
 assert.ok(Object.isFrozen(r));assert.equal(f.jobs.get(job).version,2);
 assert.equal(f.receipts.size,1);assert.deepEqual(f.calls[0].args,[shop,staff,staffSid,job,1,requestId]);
});
test('identical replay is duplicate without second business update',async()=>{
 const f=setup();await f.api.touchJob(input());
 assert.deepEqual(await f.api.touchJob(input()),{status:'duplicate_review_only',newVersion:2});
 assert.equal(f.receipts.size,1);assert.equal(f.jobs.get(job).version,2);
});
test('new request id cannot bypass expectedVersion CAS',async()=>{
 const f=setup();await f.api.touchJob(input());
 assert.equal((await f.api.touchJob(input('staff',{requestId:requestId2}))).status,'indeterminate');
 assert.equal(f.jobs.get(job).version,2);
});
test('same request ID different job or expected version denied, no cross-operation reuse',async()=>{
 const f=setup();await f.api.touchJob(input());
 assert.equal((await f.api.touchJob(input('staff',{jobId:noOwner}))).status,'indeterminate');
 assert.equal((await f.api.touchJob(input('staff',{expectedVersion:2}))).status,'indeterminate');
 assert.equal(f.receipts.size,1);
});
test('lost COMMIT ACK is never treated as success and caller does not auto retry',async()=>{
 const f=setup({ackLost:true});assert.deepEqual(await f.api.touchJob(input()),{status:'indeterminate'});
 assert.equal(f.calls.length,1);assert.equal(f.receipts.size,1);assert.equal(f.jobs.get(job).version,2);
 f.ackLost=false;
 assert.equal((await f.api.touchJob(input())).status,'duplicate_review_only');
 assert.equal(f.jobs.get(job).version,2);
});
test('replay does not bypass membership revocation',async()=>{
 const f=setup();await f.api.touchJob(input());f.active=false;
 assert.equal((await f.api.touchJob(input())).status,'indeterminate');
});
test('replay does not bypass provider session termination',async()=>{
 const f=setup();await f.api.touchJob(input());f.live=false;
 assert.equal((await f.api.touchJob(input())).status,'indeterminate');
});
test('replay cannot bypass subsequent job lock',async()=>{
 const f=setup();await f.api.touchJob(input());f.jobs.get(job).locked=true;
 assert.equal((await f.api.touchJob(input())).status,'indeterminate');
});
test('replay cannot bypass subsequent job archive',async()=>{
 const f=setup();await f.api.touchJob(input());f.jobs.get(job).archived=true;
 assert.equal((await f.api.touchJob(input())).status,'indeterminate');
});
test('staff cannot edit unassigned or locked jobs',async()=>{
 const f=setup();for(const id of [noOwner,'00000000-0000-0000-0000-000000004520'])
  assert.equal((await f.api.touchJob(input('staff',{jobId:id}))).status,'indeterminate');
 assert.equal(f.receipts.size,0);
});
test('owner may edit unassigned but not archived jobs',async()=>{
 const f=setup({user:'owner'});
 assert.equal((await f.api.touchJob(input('owner',{jobId:noOwner}))).status,'applied_review_only');
 assert.equal((await f.api.touchJob(input('owner',{jobId:'00000000-0000-0000-0000-000000004521',requestId:requestId2}))).status,'indeterminate');
});
test('owner downgraded to staff loses unassigned job access immediately',async()=>{
 const f=setup({user:'owner'});f.staffRole='staff';
 assert.equal((await f.api.touchJob(input('owner',{jobId:noOwner}))).status,'indeterminate');
});
test('tenant mismatch and forged client-provided shop fields ignored',async()=>{
 const f=setup({shopCode:other});assert.equal((await f.api.touchJob(input())).status,'indeterminate');
 const g=setup();await g.api.touchJob({...input(),shopCode:other,role:'owner',sessionId:ownerSid});
 assert.deepEqual(g.calls[0].args,[shop,staff,staffSid,job,1,requestId]);
});
test('old session and equal-to-fence session denied',async()=>{
 for(const boundary of [now-5000,now+1]){
  const f=setup();f.fence=boundary;assert.equal((await f.api.touchJob(input())).status,'indeterminate');
 }
});
test('JWT issuer role audience signature and expiry are mandatory',async()=>{
 for(const opt of [{jwtValid:false},{issuerValue:'https://bad.supabase.co/auth/v1'},
   {role:'service_role'},{audience:'anon'},{tokenExpired:true}]){
  const f=setup(opt);await denied(f.api.touchJob(input()));assert.equal(f.calls.length,0);
 }
});
test('mixed LINE authorization and invalid route cannot call DB',async()=>{
 const f=setup();await denied(f.api.touchJob(input('staff',{request:req('staff',true)})));
 for(const opt of [{routeValid:false},{mode:'production'},{shopCode:'../bad'}]){
  const z=setup(opt);await denied(z.api.touchJob(input()));assert.equal(z.calls.length,0);
 }
});
test('bad ids version or missing bearer rejected before SQL',async()=>{
 const f=setup();for(const over of [{jobId:'bad'},{requestId:'bad'},{expectedVersion:0},
 {expectedVersion:3.14},{request:new Request('https://car02.test') }]){
  await denied(f.api.touchJob(input('staff',over)));
 }assert.equal(f.calls.length,0);
});
test('DB errors malformed rows and unknown booleans never claim applied or duplicated',async()=>{
 for(const opt of [{throwBefore:true},{rows:[]},{rows:[{applied:'false',new_version:2}]},
  {rows:[{applied:true,new_version:3}]},{rows:[{applied:false,new_version:2},{applied:true,new_version:2}]}]){
  const f=setup(opt);assert.equal((await f.api.touchJob(input())).status,'indeterminate');
 }
});
test('original R52 and V451 remain release locked and unmodified',()=>{
 const entry=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
 const prior=readFileSync(new URL('./car02-job-authorization-r451.mjs',import.meta.url),'utf8');
 assert.match(entry,/const\s+CAR02_RELEASE_LOCK\s*=\s*true/);
 assert.match(prior,/CAR02_V451_RELEASE_LOCK\s*=\s*true/);
 assert.doesNotMatch(entry,/job-idempotency-r452|v452_private/);
});
