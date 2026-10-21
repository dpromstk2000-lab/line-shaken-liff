import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CAR02_V451_RELEASE_LOCK,CAR02_V451_ATOMIC_SQL,createCar02OfflineJobAuthorizationR451} from './car02-job-authorization-r451.mjs';
const shop='qa_shop_a',tenantB='qa_shop_b';
const owner='00000000-0000-0000-0000-000000004511',staff='00000000-0000-0000-0000-000000004513';
const sessOwner='00000000-0000-0000-0000-000000004512',sessStaff='00000000-0000-0000-0000-000000004514';
const job='00000000-0000-0000-0000-000000004518',unassigned='00000000-0000-0000-0000-000000004522';
const issuer='https://car02-qa.supabase.co/auth/v1',now=2_000_000_000_000;
const req=(u='staff',mixed=false)=>new Request('https://car02.test/isolated-job',{headers:{authorization:'Bearer synthetic-'+u+'-jwt-token',...(mixed?{'x-line-id-token':'mixed'}:{})}});
const rejected=p=>assert.rejects(p,e=>e?.code==='CAR02_UNAUTHORIZED'&&e.status===401);
function fixture({actor='staff',shopCode=shop,routeOk=true,mode='isolated_qa',jwtOk=true,
   exp=now+100000,role='authenticated',audience='authenticated',iss=issuer,throws=false,
   lostAck=false,returned=null,wrongSubject=false,wrongSession=false}={}){
 const calls=[];let memberRole=actor==='staff'?'staff':'owner',active=true,live=true;
 let fence=now-30000,sessionCreated=now-10000;
 const jobs=new Map([[job,{version:1,assignee:staff,locked:false,archived:false}],
   [unassigned,{version:1,assignee:null,locked:false,archived:false}],
   ['00000000-0000-0000-0000-000000004519',{version:1,assignee:owner,locked:false,archived:false}],
   ['00000000-0000-0000-0000-000000004520',{version:1,assignee:staff,locked:true,archived:false}],
   ['00000000-0000-0000-0000-000000004521',{version:1,assignee:staff,locked:false,archived:true}]]);
 const user=actor==='staff'?staff:owner,sid=actor==='staff'?sessStaff:sessOwner;
 const store={query:async(sql,params)=>{
   calls.push({sql,params});if(throws)throw Error('sensitive db error');
   if(sql!==CAR02_V451_ATOMIC_SQL)throw Error('INVALID_SQL');
   if(returned!==null)return{rows:returned};
   const [tenant,subject,sessionId,id,version]=params,o=jobs.get(id);
   if(tenant!==shop||subject!==user||sessionId!==sid||!active||!live||
      sessionCreated<=fence||!o||o.archived||o.version!==version||
      (memberRole!=='owner'&&(memberRole!=='staff'||o.locked||o.assignee!==subject)))return{rows:[]};
   o.version++;if(lostAck)throw Error('COMMIT response lost');
   return{rows:[{applied:true,new_version:o.version}]};
 }};
 const api=createCar02OfflineJobAuthorizationR451({store,expectedIssuer:issuer,nowMs:()=>now,
  authorizeShop:async()=>({verified:routeOk,mode,shopCode}),
  verifyJwt:async()=>({verified:jwtOk,sub:wrongSubject?'00000000-0000-0000-0000-000000004599':user,
    sessionId:wrongSession?'00000000-0000-0000-0000-000000004598':sid,
    issuer:iss,audience,role,expMs:exp})});
 return{api,calls,jobs,actualSubject:user,actualSession:sid,
   set memberRole(x){memberRole=x},set active(x){active=x},set live(x){live=x},
   set fence(x){fence=x},set sessionCreated(x){sessionCreated=x}};
}
const touch=(f,id=job,request=req())=>f.api.touchJob({request,jobId:id,expectedVersion:1});
test('V451 locked, exactly one parameterized statement, no untrusted adapter fallback',()=>{
 assert.equal(CAR02_V451_RELEASE_LOCK,true);
 assert.equal(CAR02_V451_ATOMIC_SQL,'SELECT applied,new_version FROM v451_private.qa_role_bound_job_cas($1::text,$2::uuid,$3::uuid,$4::uuid,$5::integer)');
 assert.throws(()=>createCar02OfflineJobAuthorizationR451(),/TRUSTED_OFFLINE_ADAPTERS_REQUIRED/);
});
test('assigned staff with fresh session updates only assigned unlocked job',async()=>{
 const f=fixture(),r=await touch(f);assert.deepEqual(r,{status:'applied_review_only',newVersion:2});
 assert.deepEqual(f.calls,[{sql:CAR02_V451_ATOMIC_SQL,params:[shop,staff,sessStaff,job,1]}]);
 assert.equal(Object.isFrozen(r),true);
});
test('owner may modify non-archived unassigned job',async()=>{
 const f=fixture({actor:'owner'});const r=await touch(f,unassigned,req('owner'));
 assert.equal(r.status,'applied_review_only');assert.equal(f.jobs.get(unassigned).version,2);
});
test('staff cannot modify unassigned job',async()=>{
 const f=fixture();assert.equal((await touch(f,unassigned)).status,'indeterminate');
 assert.equal(f.jobs.get(unassigned).version,1);
});
test('staff cannot modify another staff member assigned job',async()=>{
 const f=fixture(),id='00000000-0000-0000-0000-000000004519';
 assert.equal((await touch(f,id)).status,'indeterminate');assert.equal(f.jobs.get(id).version,1);
});
test('staff cannot modify a locked job even when assigned',async()=>{
 const f=fixture(),id='00000000-0000-0000-0000-000000004520';
 assert.equal((await touch(f,id)).status,'indeterminate');assert.equal(f.jobs.get(id).version,1);
});
test('archived jobs cannot be edited even by owner',async()=>{
 const id='00000000-0000-0000-0000-000000004521';
 for(const who of ['staff','owner']){
  const f=fixture({actor:who});assert.equal((await touch(f,id,req(who))).status,'indeterminate');
  assert.equal(f.jobs.get(id).version,1);
 }
});
test('role downgrade is read from database, not from JWT or request',async()=>{
 const f=fixture({actor:'owner'});f.memberRole='staff';
 const r=await f.api.touchJob({request:req('owner'),jobId:unassigned,expectedVersion:1,
  role:'owner',isAssigned:true,shopCode:tenantB});
 assert.equal(r.status,'indeterminate');assert.equal(f.jobs.get(unassigned).version,1);
});
test('other shop cannot update same UUID job',async()=>{
 const f=fixture({shopCode:tenantB});assert.equal((await touch(f)).status,'indeterminate');
 assert.equal(f.jobs.get(job).version,1);
});
test('optimistic version ensures no double update on repeated request',async()=>{
 const f=fixture();assert.equal((await touch(f)).status,'applied_review_only');
 assert.equal((await touch(f)).status,'indeterminate');assert.equal(f.jobs.get(job).version,2);
});
test('revoked member / terminated provider session denied at DB authority',async()=>{
 for(const state of ['active','live']){
  const f=fixture();f[state]=false;assert.equal((await touch(f)).status,'indeterminate');
  assert.equal(f.jobs.get(job).version,1);
 }
});
test('old/equal-to-fence sessions denied regardless of JWT token freshness',async()=>{
 for(const fence of [now-10000,now+1]){
  const f=fixture();f.fence=fence;assert.equal((await touch(f)).status,'indeterminate');
 }
});
test('wrong signed subject and session cannot update assignment',async()=>{
 for(const config of [{wrongSubject:true},{wrongSession:true}]){
  const f=fixture(config);assert.equal((await touch(f)).status,'indeterminate');
 }
});
test('invalid JWT signature, issuer, role, audience or expiry rejected pre-DB',async()=>{
 for(const config of [{jwtOk:false},{iss:'https://evil.supabase.co/auth/v1'},
   {role:'service_role'},{audience:'anon'},{exp:now}]){
  const f=fixture(config);await rejected(touch(f));assert.equal(f.calls.length,0);
 }
});
test('mixed LINE token / unknown tenant / wrong route mode rejected before DB',async()=>{
 for(const config of [{shopCode:'../evil'},{routeOk:false},{mode:'production'}]){
  const f=fixture(config);await rejected(touch(f));assert.equal(f.calls.length,0);
 }
 const f=fixture();await rejected(touch(f,job,req('staff',true)));assert.equal(f.calls.length,0);
});
test('client supplied shop, role, assignment, session cannot override server-bound SQL',async()=>{
 const f=fixture();await f.api.touchJob({request:req(),jobId:job,expectedVersion:1,
  shopCode:tenantB,role:'owner',assignedUser:'fake',sessionId:sessOwner,archived:false});
 assert.deepEqual(f.calls[0].params,[shop,staff,sessStaff,job,1]);
});
test('invalid job ID, bearer token and expected version fail before database',async()=>{
 const f=fixture();for(const args of [
  {request:req(),jobId:'bad',expectedVersion:1},
  {request:req(),jobId:job,expectedVersion:0},
  {request:req(),jobId:job,expectedVersion:1.5},
  {request:new Request('https://car02.test'),jobId:job,expectedVersion:1}]){
  await rejected(f.api.touchJob(args));
 }assert.equal(f.calls.length,0);
});
test('lost COMMIT ACK / invalid rows never claim success or auto retry',async()=>{
 const a=fixture({lostAck:true});assert.deepEqual(await touch(a),{status:'indeterminate'});
 assert.equal(a.jobs.get(job).version,2);assert.equal(a.calls.length,1);
 for(const r of [[],[{applied:'true',new_version:2}],
  [{applied:true,new_version:3}],[{applied:true,new_version:2},{applied:true,new_version:2}]]){
  assert.equal((await touch(fixture({returned:r}))).status,'indeterminate');
 }
 assert.equal((await touch(fixture({throws:true}))).status,'indeterminate');
});
test('production entry stays hard locked; V451 detached from all active routes',()=>{
 const entry=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
 assert.match(entry,/const\s+CAR02_RELEASE_LOCK\s*=\s*true/);
 assert.doesNotMatch(entry,/job-authorization-r451|v451_private/);
});
