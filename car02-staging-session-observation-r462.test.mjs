import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CAR02_V462_RELEASE_LOCK,CAR02_V462_REQUIRED_PROOFS,
 createCar02OfflineSessionObservationR462} from './car02-staging-session-observation-r462.mjs';
const sub='00000000-0000-0000-0000-000000004621',sid='00000000-0000-0000-0000-000000004622';
const shop='qa_shop_a',now=1850000000,creation=1850000000000-10000,fence=1850000000000-30000;
const req=()=>new Request('https://review.example/disabled',{headers:{authorization:'Bearer synthetic-isolated-jwt-462'}});
function setup({scope={verified:true,mode:'isolated_qa',shopCode:shop},user={verified:true,sub,exp:now+300},
 jwt={verified:true,sub,sessionId:sid,aud:'authenticated',role:'authenticated',exp:now+300},
 provider={source:'independent_provider_read',active:true,userSub:sub,sessionId:sid,createdAtMs:creation},
 member={shopCode:shop,userSub:sub,active:true,role:'staff',authVersion:5,
 fenceCommitAcknowledged:true,postcommitFenceAtMs:fence},throwAt='',time=now}={}){
 const calls=[];let clock=time;
 const invoke=(k,result)=>async(q)=>{calls.push({k,q});if(throwAt===k)throw Error('ISOLATED_ADAPTER_FAILED');return result;};
 const x=createCar02OfflineSessionObservationR462({
  authorizeShop:invoke('shop',scope),verifyAuthUserR46:invoke('r46',user),
  verifySignedSessionJwt:invoke('jwt',jwt),readProviderSession:invoke('provider',provider),
  readMemberWithFence:invoke('membership',member),nowSeconds:()=>clock});
 return{x,calls,set clock(v){clock=v}};
}
const inspect=(f,request=req())=>f.x.inspect({request});
const denied=async(f,reason,request=req())=>{const a=await inspect(f,request);assert.equal(a.status,'no_go');
 assert.equal(a.releasePermitted,false);assert.equal(a.writeAuthorized,false);
 assert.equal(a.realProviderEvidenceVerified,false);assert.equal(a.reason,reason);
 assert.equal(Object.isFrozen(a),true);return a;};
test('V462 strictly hard release locked; exact five provisional proof categories',()=>{
 assert.equal(CAR02_V462_RELEASE_LOCK,true);assert.equal(CAR02_V462_REQUIRED_PROOFS.length,5);
 assert.equal(Object.isFrozen(CAR02_V462_REQUIRED_PROOFS),true);
 assert.throws(()=>createCar02OfflineSessionObservationR462(),/OFFLINE_ADAPTERS_REQUIRED/);
});
test('all five isolated mock observations still NEVER authorize a business write or GO',async()=>{
 const f=setup();const r=await denied(f,'offline_observation_only_atomic_live_proof_missing');
 assert.equal(r.observedChecks,5);assert.deepEqual(f.calls.map(x=>x.k),['shop','r46','jwt','provider','membership']);
});
test('R46 checked user alone is insufficient: JWT missing session id denied',async()=>{
 const f=setup({jwt:{verified:true,sub,aud:'authenticated',role:'authenticated',exp:now+300}});
 await denied(f,'signed_session_claim_not_verified');assert.deepEqual(f.calls.map(x=>x.k),['shop','r46','jwt']);
});
test('forged JWT session id not independently validated is denied',async()=>{
 const f=setup({jwt:{verified:false,sub,sessionId:sid,aud:'authenticated',role:'authenticated',exp:now+300}});
 await denied(f,'signed_session_claim_not_verified');
});
test('signed JWT other subject is denied before provider read',async()=>{
 const f=setup({jwt:{verified:true,sub:'00000000-0000-0000-0000-000000004629',sessionId:sid,aud:'authenticated',role:'authenticated',exp:now+300}});
 await denied(f,'signed_session_claim_not_verified');assert.equal(f.calls.length,3);
});
test('token audience, role and expiry mismatch fail before provider read',async()=>{
 for(const change of [{aud:'anon'},{role:'service_role'},{exp:now+150},{exp:now}]){
  await denied(setup({jwt:{verified:true,sub,sessionId:sid,aud:'authenticated',role:'authenticated',exp:now+300,...change}}),'signed_session_claim_not_verified');
 }
});
test('expired, missing and mismatched R46 auth user denied',async()=>{
 for(const user of [null,{verified:false,sub,exp:now+300},{verified:true,sub,exp:now},
 {verified:true,sub:'not-a-uuid',exp:now+300}])await denied(setup({user}),'r46_user_unverified');
});
test('invalid, forged or production tenant scope refuses all I/O',async()=>{
 for(const scope of [null,{verified:false,mode:'isolated_qa',shopCode:shop},
 {verified:true,mode:'production',shopCode:shop},
 {verified:true,mode:'isolated_qa',shopCode:'../other'}]){
  const f=setup({scope});await denied(f,'untrusted_shop_scope');assert.deepEqual(f.calls.map(x=>x.k),['shop']);
 }
});
test('missing bearer or mixed LINE/STAFF credentials rejected before I/O',async()=>{
 for(const request of [new Request('https://review.example'),
 new Request('https://review.example',{headers:{authorization:'Bearer synthetic-isolated-jwt-462','x-line-id-token':'mix'}})]){
  const f=setup();await denied(f,'r46_user_unverified',request);assert.equal(f.calls.length,0);
 }
});
test('live provider row absence or termination cannot pass',async()=>{
 for(const provider of [null,{source:'independent_provider_read',active:false,userSub:sub,sessionId:sid,createdAtMs:creation},
 {source:'guessed_from_jwt',active:true,userSub:sub,sessionId:sid,createdAtMs:creation}]){
  await denied(setup({provider}),'provider_session_not_observed');
 }
});
test('other user session and session mismatch denied',async()=>{
 for(const provider of [
 {source:'independent_provider_read',active:true,userSub:'00000000-0000-0000-0000-000000004629',sessionId:sid,createdAtMs:creation},
 {source:'independent_provider_read',active:true,userSub:sub,sessionId:'00000000-0000-0000-0000-000000004629',createdAtMs:creation}]){
  await denied(setup({provider}),'provider_session_not_observed');
 }
});
test('unacknowledged fence and older or equal session time rejected',async()=>{
 const mk=(changes)=>({shopCode:shop,userSub:sub,active:true,role:'staff',authVersion:5,
 fenceCommitAcknowledged:true,postcommitFenceAtMs:fence,...changes});
 for(const member of [mk({fenceCommitAcknowledged:false}),mk({postcommitFenceAtMs:creation}),
 mk({postcommitFenceAtMs:creation+10})])await denied(setup({member}),'tenant_generation_or_fence_unverified');
});
test('revoked, other-tenant, invalid role, auth version missing all rejected',async()=>{
 const mk=(changes)=>({shopCode:shop,userSub:sub,active:true,role:'staff',authVersion:5,
 fenceCommitAcknowledged:true,postcommitFenceAtMs:fence,...changes});
 for(const member of [mk({active:false}),mk({shopCode:'qa_shop_b'}),
 mk({userSub:'00000000-0000-0000-0000-000000004629'}),mk({role:'admin'}),mk({authVersion:0})])
 await denied(setup({member}),'tenant_generation_or_fence_unverified');
});
test('owner observed as current role still NO_GO and no privilege token',async()=>{
 const m={shopCode:shop,userSub:sub,active:true,role:'owner',authVersion:5,
 fenceCommitAcknowledged:true,postcommitFenceAtMs:fence};
 const a=await denied(setup({member:m}),'offline_observation_only_atomic_live_proof_missing');
 assert.equal('shopCode' in a,false);assert.equal('sessionId' in a,false);
});
test('provider read, member read, signature and source errors all fail closed',async()=>{
 for(const [key,reason] of [['shop','r46_user_unverified'],['r46','r46_user_unverified'],
 ['jwt','signed_session_claim_not_verified'],['provider','provider_session_not_observed'],
 ['membership','tenant_generation_or_fence_unverified']])await denied(setup({throwAt:key}),reason);
});
test('server source and release locks remain unchanged, no production binding',()=>{
 for(const n of ['car02-edge-entry-r52.ts','car02-auth-seam-audit-r461.mjs']){
  const s=readFileSync(new URL('./'+n,import.meta.url),'utf8');
  assert.match(s,n.includes('r52')?/CAR02_RELEASE_LOCK=true/:/CAR02_V461_RELEASE_LOCK=true/);
  assert.doesNotMatch(s,/staging-session-observation-r462/);
 }
});
test('request fields cannot override shop/user/session source adapters',async()=>{
 const f=setup();const input={request:req(),shopCode:'qa_shop_b',role:'owner',sessionId:'fake',userSub:'fake'};
 await denied(f,'offline_observation_only_atomic_live_proof_missing',input.request);
 assert.equal(f.calls[0].k,'shop');assert.deepEqual(f.calls[3].q,{sessionId:sid,userSub:sub});
});
test('read-only contract exposes no mutating capability or deliver method',()=>{
 const f=setup();assert.deepEqual(Object.keys(f.x),['inspect']);
 for(const method of ['send','update','authorize','commit','release','deploy'])assert.equal(typeof f.x[method],'undefined');
});
