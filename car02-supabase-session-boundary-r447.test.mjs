import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CAR02_V447_RELEASE_LOCK,CAR02_V447_READ_SQL,CAR02_V447_LOCK_SQL,
  createCar02SupabaseSessionBoundaryR447} from './car02-supabase-session-boundary-r447.mjs';
const shop='qa_shop_a',other='qa_shop_b',sub='00000000-0000-0000-0000-000000004471';
const old='00000000-0000-0000-0000-000000004472',fresh='00000000-0000-0000-0000-000000004473';
const nonce1='00000000-0000-0000-0000-000000004474',nonce3='00000000-0000-0000-0000-000000004475';
const issuer='https://car02-test.supabase.co/auth/v1',base=2_000_000_000_000;
const request=(which='old',mixed=false)=>new Request('https://car02.test/synthetic',{headers:{authorization:'Bearer synthetic-signed-'+which+'-token',...(mixed?{'x-line-id-token':'fake'}:{})}});
const denied=p=>assert.rejects(p,e=>e.code==='CAR02_UNAUTHORIZED'&&e.status===401);
function fixture(){
 let time=base,member={active:true,role:'staff',version:1,nonce:nonce1,fence:base-30000},verified=true;
 let sessionRows=new Map([[old,{userSub:sub,createdAtMs:base-20000,active:true}]]),queries=[];
 let forcedRows=null,dbError=false,issuerOverride=issuer,audience='authenticated',role='authenticated',claimsSub=sub,exp=base+600000;
 const lookup=async(sql,args)=>{
  queries.push({sql,args});if(dbError)throw Error('sensitive postgres failure');
  if(![CAR02_V447_READ_SQL,CAR02_V447_LOCK_SQL].includes(sql))throw Error('UNTRUSTED_SQL');
  if(forcedRows!==null)return{rows:forcedRows};
  const [tenant,who,sid]=args,s=sessionRows.get(sid);
  if(tenant!==shop||who!==sub||!s||!s.active||s.userSub!==who||!member.active||s.createdAtMs<=member.fence)
    return {rows:[]};
  return{rows:[{staff_role:member.role,auth_version:member.version,generation_nonce:member.nonce,
    session_created_ms:s.createdAtMs,postcommit_fence_ms:member.fence}]};
 };
 const boundary=createCar02SupabaseSessionBoundaryR447({expectedIssuer:issuer,nowMs:()=>time,
  store:{query:lookup},verifyJwt:async({accessToken})=>({verified,sub:claimsSub,
   sessionId:accessToken.includes('fresh')?fresh:old,issuer:issuerOverride,audience,role,expMs:exp,
   iatMs:time /* iat refresh CANNOT prove a new session */})});
 return{boundary,queries,client:{query:lookup},get member(){return member},set member(x){member=x},
  get sessions(){return sessionRows},set expired(x){exp=x?base-1:base+600000},set verified(x){verified=x},
  set issuer(x){issuerOverride=x},set audience(x){audience=x},set role(x){role=x},set sub(x){claimsSub=x},
  set time(x){time=x},set forcedRows(x){forcedRows=x},set broken(x){dbError=x},
  reactivate(){member={active:true,role:'staff',version:3,nonce:nonce3,fence:base+1000}},
  addFresh(createdAtMs=base+2000){sessionRows.set(fresh,{userSub:sub,createdAtMs,active:true})}};
}
const auth=(f,r=request())=>f.boundary.authenticate(r,shop);
test('hard release lock and static private-schema SQL',()=>{
 assert.equal(CAR02_V447_RELEASE_LOCK,true);
 assert.match(CAR02_V447_READ_SQL,/^SELECT .*v447_private\.qa_live_session/);
 assert.match(CAR02_V447_LOCK_SQL,/^SELECT .*v447_private\.qa_lock_live_session/);
 assert.throws(()=>createCar02SupabaseSessionBoundaryR447(),/V447_TRUSTED_SERVER_ADAPTERS_REQUIRED/);
});
test('initial provider session is recognized with exact shop subject and fence',async()=>{
 const f=fixture(),actor=await auth(f);assert.equal(actor.sessionId,old);
 assert.equal(actor.postcommitFenceMs,base-30000);assert.equal(actor.authVersion,1);
 assert.ok(Object.isFrozen(actor));assert.deepEqual(f.queries[0].args,[shop,sub,old]);
});
test('row-locked membership and live session must agree for write',async()=>{
 const f=fixture(),actor=await auth(f);assert.equal(await f.boundary.assertMutation({actor,shopCode:shop,transactionClient:f.client}),true);
 assert.equal(f.queries[1].sql,CAR02_V447_LOCK_SQL);
});
test('old session remains rejected after revoke and reactivation despite refreshed JWT iat',async()=>{
 const f=fixture();f.reactivate();await denied(auth(f));
 assert.equal(f.queries.length,1);
});
test('session born between member COMMIT and later post-COMMIT fence is denied',async()=>{
 const f=fixture();f.reactivate();f.addFresh(base+999);await denied(auth(f,request('fresh')));
});
test('session with created timestamp exactly equal to fence is denied',async()=>{
 const f=fixture();f.reactivate();f.addFresh(base+1000);await denied(auth(f,request('fresh')));
});
test('new provider session created strictly after trusted fence permits authentication',async()=>{
 const f=fixture();f.reactivate();f.addFresh();const a=await auth(f,request('fresh'));
 assert.equal(a.authVersion,3);assert.equal(a.sessionCreatedMs,base+2000);
 assert.equal(await f.boundary.assertMutation({actor:a,shopCode:shop,transactionClient:f.client}),true);
});
test('revoking provider session removes access even while JWT expiry stays valid',async()=>{
 const f=fixture(),s=f.sessions.get(old);f.sessions.set(old,{...s,active:false});await denied(auth(f));
});
test('provider session vanished from server DB fails closed',async()=>{
 const f=fixture();f.sessions.delete(old);await denied(auth(f));
});
test('revoke during same-process lifetime blocks mutation under row lock',async()=>{
 const f=fixture(),a=await auth(f);f.member={...f.member,active:false,version:2};
 await denied(f.boundary.assertMutation({actor:a,shopCode:shop,transactionClient:f.client}));
});
test('stale in-memory actor fails row lock after new generation and session',async()=>{
 const f=fixture(),a=await auth(f);f.reactivate();f.addFresh();
 await denied(f.boundary.assertMutation({actor:a,shopCode:shop,transactionClient:f.client}));
});
test('wrong issuer, audience, role and signature are rejected without DB access',async()=>{
 for(const change of [f=>f.issuer='https://evil.supabase.co/auth/v1',f=>f.audience='anon',
   f=>f.role='service_role',f=>f.verified=false]){
  const f=fixture();change(f);await denied(auth(f));assert.equal(f.queries.length,0);
 }
});
test('expired token is rejected, even with an active session in DB',async()=>{
 const f=fixture();f.expired=true;await denied(auth(f));assert.equal(f.queries.length,0);
});
test('invalid tenant and LINE-mixed credentials rejected before DB',async()=>{
 const f=fixture();await denied(f.boundary.authenticate(request(),'../other'));
 await denied(auth(f,request('old',true)));assert.equal(f.queries.length,0);
});
test('other shop and user cannot claim provider session',async()=>{
 const f=fixture();await denied(f.boundary.authenticate(request(),other));
 f.sub='00000000-0000-0000-0000-000000004499';await denied(auth(f));
});
test('forged and cloned actors rejected before row-locked query',async()=>{
 const f=fixture(),actor=await auth(f);await denied(f.boundary.assertMutation({actor:{...actor},shopCode:shop,transactionClient:f.client}));
 assert.equal(f.queries.length,1);
});
test('bad DB rows lacking valid post-commit session proof cannot authenticate',async()=>{
 for(const rows of [[{staff_role:'staff',auth_version:3,generation_nonce:nonce3,session_created_ms:base,postcommit_fence_ms:base}],
                    [{staff_role:'owner',auth_version:1,generation_nonce:nonce1,session_created_ms:base+3}],
                    [{staff_role:'staff',auth_version:1,generation_nonce:nonce1,session_created_ms:base,postcommit_fence_ms:base-3},{staff_role:'staff'}]]){
  const f=fixture();f.forcedRows=rows;await denied(auth(f));
 }
});
test('unreachable DB or missing transaction client never authorizes',async()=>{
 const f=fixture();f.broken=true;await denied(auth(f));
 f.broken=false;const a=await auth(f);await denied(f.boundary.assertMutation({actor:a,shopCode:shop}));
});
test('original release lock remains enabled and V447 is not wired to R52',()=>{
 const entry=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
 assert.match(entry,/const\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/);
 assert.doesNotMatch(entry,/supabase-session-boundary-r447|v447_private/);
});
