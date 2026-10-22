import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSupabaseStaffTokenVerifierR46} from './car02-auth-providers-r46.mjs';
import {createCar02OfflineSupabaseSessionBridgeR468,CAR02_V468_RELEASE_LOCK}
 from './car02-supabase-session-bridge-r468.mjs';
const subject='00000000-0000-0000-0000-000000004681';
const sessionId='00000000-0000-0000-0000-000000004682';
const wrongId='00000000-0000-0000-0000-000000004683';
const shop='qa_shop_a',now=1800000000,exp=now+400;
const issuer='https://offline-qa.supabase.example/auth/v1';
const jwt=(claims={})=>[
 Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url'),
 Buffer.from(JSON.stringify({sub:subject,session_id:sessionId,exp,iss:issuer,aud:'authenticated',role:'authenticated',...claims})).toString('base64url'),
 'fake_offline_signature_never_provider_valid'
].join('.');
function f({claims={},token=jwt(claims),shopCode=shop,reviewerRole='session_bridge_auditor',
 mode='isolated_qa',verified=true,isolation='isolated_mock_only',testOnly=true,
 userId=subject,userAud='authenticated',isAnonymous=false,userDeleted=null,userBanned=null,
 providerOk=true,providerThrows=false,identityThrows=false,
 session={},membership={},readSessionThrows=false,readMembershipThrows=false,
 nowSeconds=()=>now, headerOverride=null}={}){
 const calls={provider:0,session:0,membership:0};
 const fetchImpl=async(url,opt)=>{
  calls.provider++;
  assert.equal(url,issuer+'/user');assert.equal(opt.method,'GET');
  if(providerThrows)throw Error('test provider network secret');
  return {ok:providerOk,json:async()=>({id:userId,aud:userAud,is_anonymous:isAnonymous,
    deleted_at:userDeleted,banned_until:userBanned})};
 };
 const r46=createSupabaseStaffTokenVerifierR46({supabaseUrl:'https://offline-qa.supabase.example',
  anonKey:'offline_public_key_123456789',fetchImpl,nowSeconds});
 const bridge=createCar02OfflineSupabaseSessionBridgeR468({
  authorizeReviewer:async()=>({verified,mode,role:reviewerRole,shopCode}),
  inspectIsolation:async()=>({verified:true,environment:isolation,testOnly}),
  verifyStaffJwt:async(args)=>{if(identityThrows)throw Error('mock identity failure');return r46(args)},
  readSession:async()=>{calls.session++;if(readSessionThrows)throw Error('mock session failure');return{
   source:'isolated_mock_session_store',active:true,userSub:subject,sessionId,
   expiresAtSec:exp,createdAtMs:1799000000000,generation:3,...session}},
  readMembership:async()=>{calls.membership++;if(readMembershipThrows)throw Error('mock membership failure');return{
   source:'isolated_mock_membership',active:true,shopCode,userSub:subject,role:'staff',
   generation:3,acknowledgedGeneration:3,postcommitFenceAtMs:1798000000000,...membership}},
  nowSeconds
 });
 const request=new Request('https://offline.invalid/qa',{headers:{Authorization:headerOverride??'Bearer '+token}});
 return {bridge,request,calls,token};
}
const run=async cfg=>{const x=f(cfg);return {...x,result:await x.bridge.inspect({request:x.request})}};
const denied=(r,reason)=>{assert.equal(r.status,'no_go');assert.equal(r.reason,reason);
 assert.equal(r.releasePermitted,false);assert.equal(r.businessWriteAllowed,false);
 assert.equal(r.lineDispatchAllowed,false);assert.equal(r.realSupabaseSessionVerified,false);
 assert.equal(r.providerCredentialsUsed,false);assert.ok(Object.isFrozen(r));};
test('R468 stays release-locked, offline only with mandatory injected interfaces',()=>{
 assert.equal(CAR02_V468_RELEASE_LOCK,true);
 assert.throws(()=>createCar02OfflineSupabaseSessionBridgeR468(),/REQUIRED_OFFLINE_ADAPTERS/);
});
test('actual R46 mock identity, same provider session, member and fence all correlate yet NO_GO',async()=>{
 const r=await run();denied(r.result,'offline_bridge_consistent_still_no_go');
 assert.deepEqual(r.calls,{provider:1,session:1,membership:1});assert.equal(r.result.checksObserved,3);
});
test('unverified reviewer does not call provider or session store',async()=>{
 const r=await run({verified:false});denied(r.result,'untrusted_reviewer_or_environment');
 assert.equal(r.calls.provider,0);assert.equal(r.calls.session,0);
});
test('not a session_bridge_auditor denies all provider activity',async()=>{
 const r=await run({reviewerRole:'owner'});denied(r.result,'untrusted_reviewer_or_environment');assert.equal(r.calls.provider,0);
});
test('live or production mode is forbidden before reading JWT',async()=>{
 const r=await run({mode:'production'});denied(r.result,'untrusted_reviewer_or_environment');assert.equal(r.calls.provider,0);
});
test('environment must explicitly be an offline mock, not a real provider',async()=>{
 for(const isolation of ['production','staging','disposable_pg17']){
  const r=await run({isolation});denied(r.result,'untrusted_reviewer_or_environment');assert.equal(r.calls.provider,0);
 }
});
test('testOnly false rejects before any mocked provider access',async()=>{
 const r=await run({testOnly:false});denied(r.result,'untrusted_reviewer_or_environment');assert.equal(r.calls.provider,0);
});
test('JWT with missing or malformed session_id is denied before provider',async()=>{
 for(const c of [{session_id:null},{session_id:'bad'},{session_id:42}]){
  const r=await run({claims:c});denied(r.result,'invalid_unsigned_session_claim');assert.equal(r.calls.provider,0);
 }
});
test('wrong JWT issuer, audience and role fail before R46',async()=>{
 for(const c of [{iss:'https://evil.invalid/auth/v1'},{aud:'wrong'},{role:'service_role'},
  {exp:'not_timestamp'},{sub:wrongId.slice(0,5)}]){
  const r=await run({claims:c});
  if(c.iss)denied(r.result,'provider_or_adapter_rejected');
  else denied(r.result,'invalid_unsigned_session_claim');
  assert.equal(r.calls.session,0);
 }
});
test('expired claim never contacts R46 mocked service',async()=>{
 const r=await run({claims:{exp:now}});denied(r.result,'expired_or_invalid_clock');assert.equal(r.calls.provider,0);
});
test('malformed bearer header and multiple credentials denied',async()=>{
 for(const h of ['Basic secret','Bearer broken','Bearer one two','Bearer '+jwt()+' extra']){
  const r=await run({headerOverride:h});assert.match(r.result.reason,/^invalid_/);assert.equal(r.calls.provider,0);
 }
});
test('R46 rejects mismatch between decoded subject and verified /user response',async()=>{
 const r=await run({userId:wrongId});denied(r.result,'provider_or_adapter_rejected');assert.equal(r.calls.session,0);
});
test('R46 rejects anonymous, deleted and actively banned Auth users',async()=>{
 for(const opts of [{isAnonymous:true},{userDeleted:'2026-01-01'},{userBanned:'2099-01-01T00:00:00Z'}]){
  const r=await run(opts);denied(r.result,'provider_or_adapter_rejected');assert.equal(r.calls.session,0);
 }
});
test('R46 rejects provider API down, non-ok or thrown identity resolver',async()=>{
 for(const opts of [{providerOk:false},{providerThrows:true},{identityThrows:true}]){
  const r=await run(opts);denied(r.result,'provider_or_adapter_rejected');assert.equal(r.calls.session,0);
 }
});
test('session store source must be explicit mock and never caller-supplied',async()=>{
 for(const session of [{source:'real_supabase'},{active:false},{userSub:wrongId},
  {sessionId:wrongId},{expiresAtSec:now},{createdAtMs:0},{generation:0}]){
  const r=await run({session});denied(r.result,'trusted_session_not_observed');assert.equal(r.calls.membership,0);
 }
});
test('separate session store failing does not authorize',async()=>{
 const r=await run({readSessionThrows:true});denied(r.result,'provider_or_adapter_rejected');assert.equal(r.calls.membership,0);
});
test('another tenant never becomes authorized even though user session matches',async()=>{
 const r=await run({membership:{shopCode:'qa_shop_b'}});denied(r.result,'membership_or_postcommit_generation_not_observed');
});
test('inactive, malformed, or mismatched membership is denied',async()=>{
 for(const membership of [{active:false},{source:'client_role'},{userSub:wrongId},
  {role:'customer'},{role:'admin'},{generation:4},{acknowledgedGeneration:4},
  {postcommitFenceAtMs:1799000000000},{postcommitFenceAtMs:0}]){
  const r=await run({membership});denied(r.result,'membership_or_postcommit_generation_not_observed');
 }
});
test('membership lookup error fails closed without exposing error internals',async()=>{
 const r=await run({readMembershipThrows:true});denied(r.result,'provider_or_adapter_rejected');
 assert.equal(JSON.stringify(r.result).includes('failure'),false);
});
test('client shop, role, sessionId and generation spoofing is ignored',async()=>{
 const r=f();const req=new Request('https://offline.invalid/qa?role=owner&shop=qa_shop_b',
  {headers:{Authorization:'Bearer '+r.token,'x-session-id':wrongId,'x-role':'owner'}});
 const res=await r.bridge.inspect({request:req,shopCode:'qa_shop_b',role:'owner',sessionId:wrongId});
 denied(res,'offline_bridge_consistent_still_no_go');assert.equal(r.calls.provider,1);
});
test('actual R46 and R52 source remain unmodified and no business binding',()=>{
 const r46=readFileSync(new URL('./car02-auth-providers-r46.mjs',import.meta.url),'utf8');
 const r52=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
 assert.match(r46,/return\s*\{\s*verified:true,sub:user\.id,exp:claims\.exp\}/);
 assert.match(r52,/const CAR02_RELEASE_LOCK=true;/);
 assert.doesNotMatch(r52,/session-bridge-r468|createCar02OfflineSupabaseSessionBridgeR468/);
});
