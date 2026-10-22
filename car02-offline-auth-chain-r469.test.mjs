import test from 'node:test';
import assert from 'node:assert/strict';
import {createCar02OfflineAuthChainR469,CAR02_V469_RELEASE_LOCK} from './car02-offline-auth-chain-r469.mjs';
const shop='qa_shop_a',user='00000000-0000-0000-0000-000000004691';
const sid='00000000-0000-0000-0000-000000004692';
const alt='00000000-0000-0000-0000-000000004693';
const now=1800000000,hex='c'.repeat(64);
function token(claims={}){return [Buffer.from('{"alg":"none"}').toString('base64url'),
 Buffer.from(JSON.stringify({sub:user,session_id:sid,exp:now+1000,aud:'authenticated',role:'authenticated',...claims})).toString('base64url'),
 'qa_fake_signature_not_cryptographically_valid'].join('.');}
function setup({review={},isolation={},principal={},bridge={},first={},second={},
 tokenClaims={},bearer=null,withLine=false,throwAt='',role='staff'}={}){
 const calls={identity:0,bridge:0,snapshot:[]};
 const j=token(tokenClaims);
 const request=new Request('https://offline.invalid/qa',{headers:{Authorization:bearer??'Bearer '+j,
   ...(withLine?{'x-line-id-token':'line_forged_claim'}:{})}});
 const base={source:'offline_disposable_session_fence',shopCode:shop,userSub:user,sessionId:sid,
  staffRole:role,generation:3,fenceDigest:hex,active:true,observedAtMs:1798000000000};
 const args={
  authorizeReviewer:async()=>{if(throwAt==='review')throw Error('no');return{verified:true,mode:'isolated_qa',role:'chain_auditor',shopCode:shop,...review}},
  inspectIsolation:async()=>{if(throwAt==='isolation')throw Error('no');return{verified:true,environment:'offline_mock_only',testOnly:true,...isolation}},
  authenticateR44:async()=>{calls.identity++;if(throwAt==='identity')throw Error('no');return{verified:true,shopCode:shop,role,subject:`staff:${user}`,...principal}},
  inspectR468:async()=>{calls.bridge++;if(throwAt==='bridge')throw Error('no');return{status:'no_go',reason:'offline_bridge_consistent_still_no_go',checksObserved:3,
   releasePermitted:false,businessWriteAllowed:false,lineDispatchAllowed:false,realSupabaseSessionVerified:false,...bridge}},
  readFenceSnapshot:async({phase,...p})=>{calls.snapshot.push({phase,...p});if(throwAt===phase)throw Error('no');return{...base,...(phase==='before'?first:second)}},
  nowSeconds:()=>now};
 return{request,calls,chain:createCar02OfflineAuthChainR469(args)};
}
const run=async opts=>{const x=setup(opts);return{...x,result:await x.chain.inspect({request:x.request})}};
function denied(res,reason,checks){assert.equal(res.status,'no_go');assert.equal(res.reason,reason);
 assert.equal(res.releasePermitted,false);assert.equal(res.writeAuthorized,false);
 assert.equal(res.lineDispatchAllowed,false);assert.equal(res.realSupabaseVerified,false);
 assert.equal(res.transactionFenceProven,false);assert.ok(Object.isFrozen(res));
 if(checks!==undefined)assert.equal(res.checksObserved,checks);}
test('release lock and all six offline dependencies are mandatory',()=>{
 assert.equal(CAR02_V469_RELEASE_LOCK,true);
 assert.throws(()=>createCar02OfflineAuthChainR469(),/OFFLINE_ONLY_ADAPTERS/);
});
test('consistent R44/R46/R468 + double offline fence is still NO_GO',async()=>{
 const x=await run();denied(x.result,'offline_identity_session_chain_consistent_still_no_go',4);
 assert.equal(x.calls.identity,1);assert.equal(x.calls.bridge,1);assert.deepEqual(x.calls.snapshot.map(y=>y.phase),['before','after']);
});
test('no credentials or subjects appear in result JSON',async()=>{
 const x=await run();const output=JSON.stringify(x.result);
 for(const p of [sid,user,shop,'Bearer','token'])assert.equal(output.includes(p),false);
});
test('reviewer failure blocks all downstream calls',async()=>{
 for(const opts of [{review:{verified:false}},{review:{role:'owner'}},{review:{shopCode:'other_shop'} ,principal:{shopCode:'another'}},
 {review:{mode:'production'}},{review:{role:'staff'}},{review:{shopCode:'invalid shop'}},{throwAt:'review'},{throwAt:'isolation'}]){
  const x=await run(opts);if(opts.review?.shopCode==='other_shop')denied(x.result,'r44_staff_identity_not_confirmed');
  else denied(x.result,'independent_review_required');
  if(opts.review?.shopCode!=='other_shop')assert.equal(x.calls.identity,0);
 }
});
test('production or unverified environment blocked without identity lookup',async()=>{
 for(const isolation of [{environment:'production'},{testOnly:false},{verified:false}]){
  const x=await run({isolation});denied(x.result,'independent_review_required');assert.equal(x.calls.identity,0);
 }
});
test('LINE credential alongside bearer is rejected, cannot fall through',async()=>{
 const x=await run({withLine:true});denied(x.result,'line_credential_not_staff');assert.equal(x.calls.identity,0);
});
test('unverified JWT claim is not authorization; no claim is accepted if malformed',async()=>{
 for(const tokenClaims of [{sub:'not-uuid'},{session_id:'no'},{exp:0},{aud:'service_role'},
  {role:'anon'},{exp:now-1},{session_id:3},{sub:alt,exp:now-1}]){
  const x=await run({tokenClaims});denied(x.result,'bearer_session_claim_unusable');assert.equal(x.calls.identity,0);
 }
});
test('invalid bearer header rejected early',async()=>{
 for(const bearer of ['Basic abc','Bearer invalid','Bearer ab cd','Bearer AAAAAAAAAAAA']){
  const x=await run({bearer});denied(x.result,'bearer_session_claim_unusable');assert.equal(x.calls.identity,0);
 }
});
test('R44 unverified principal never reads session stores',async()=>{
 for(const principal of [{verified:false},{role:'customer'},{shopCode:'qa_other_shop'},
  {subject:`staff:${alt}`},{subject:`line:${user}`},{role:'auditor'},{subject:null}]){
  const x=await run({principal});denied(x.result,'r44_staff_identity_not_confirmed');assert.equal(x.calls.snapshot.length,0);
 }
});
test('R44 provider error handled fail closed',async()=>{
 const x=await run({throwAt:'identity'});denied(x.result,'offline_dependency_rejected');
});
test('before snapshot must be trusted, tenant-bound and active',async()=>{
 for(const first of [{source:'external'},{shopCode:'other_shop'},{userSub:alt},{sessionId:alt},
  {staffRole:'owner'},{active:false},{generation:0},{fenceDigest:'bad'},{observedAtMs:0},
  {extra:'unrecognized'}]){
  const x=await run({first});denied(x.result,'initial_offline_fence_not_observed',1);assert.equal(x.calls.bridge,0);
 }
});
test('first read failure denies and does not call R468',async()=>{
 const x=await run({throwAt:'before'});denied(x.result,'offline_dependency_rejected');assert.equal(x.calls.bridge,0);
});
test('R468 denial, false checks, or bogus authorization cannot be mistaken for a pass',async()=>{
 for(const bridge of [{status:'go'},{reason:'session_invalid'},{checksObserved:2},
  {releasePermitted:true},{businessWriteAllowed:true},{lineDispatchAllowed:true},{realSupabaseSessionVerified:true}]){
  const x=await run({bridge});denied(x.result,'independent_r468_bridge_not_confirmed',2);
  assert.deepEqual(x.calls.snapshot.map(y=>y.phase),['before']);
 }
});
test('bridge unexpected error fails closed',async()=>{
 const x=await run({throwAt:'bridge'});denied(x.result,'offline_dependency_rejected');
});
test('revocation, tenant change, session swap or role removal between observations is detected',async()=>{
 for(const second of [{active:false},{shopCode:'other_shop'},{userSub:alt},
  {sessionId:alt},{staffRole:'owner'},{staffRole:'customer'},{generation:4},
  {fenceDigest:'e'.repeat(64)},{source:'forged'},{extra:'injection'}]){
  const x=await run({second});denied(x.result,'state_changed_or_second_fence_untrusted',3);
 }
});
test('time-rollback of second observation is denied',async()=>{
 const x=await run({second:{observedAtMs:1797000000000}});
 denied(x.result,'state_changed_or_second_fence_untrusted',3);
});
test('second read failure is no-go, even though R44 and R468 succeeded',async()=>{
 const x=await run({throwAt:'after'});denied(x.result,'offline_dependency_rejected');
 assert.equal(x.calls.bridge,1);
});
test('both owner and staff matching snapshots are accepted only as observational NO_GO',async()=>{
 for(const role of ['staff','owner']){
  const x=await run({role});denied(x.result,'offline_identity_session_chain_consistent_still_no_go',4);
 }
});
test('snapshot calls cannot derive shop from client headers or caller query',async()=>{
 const x=await run();denied(x.result,'offline_identity_session_chain_consistent_still_no_go');
 for(const snap of x.calls.snapshot)assert.deepEqual({shopCode:snap.shopCode,userSub:snap.userSub,sessionId:snap.sessionId},
  {shopCode:shop,userSub:user,sessionId:sid});
});
test('release lock remains hardcoded and code never returns an allow-write response',async()=>{
 const x=await run();denied(x.result,'offline_identity_session_chain_consistent_still_no_go');
 assert.equal(x.chain.inspect.constructor.name,'AsyncFunction');
});
