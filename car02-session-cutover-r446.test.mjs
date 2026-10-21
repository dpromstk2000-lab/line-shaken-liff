import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {CAR02_V446_RELEASE_LOCK,CAR02_V446_READ_SQL,CAR02_V446_WRITE_SQL,createCar02OfflineSessionCutoverR446} from './car02-session-cutover-r446.mjs';
const shop='qa_shop_a',other='qa_shop_b',sub='00000000-0000-0000-0000-000000004461';
const sidA='00000000-0000-0000-0000-000000004462',sidB='00000000-0000-0000-0000-000000004463';
const nonceA='00000000-0000-0000-0000-000000004464',nonceB='00000000-0000-0000-0000-000000004465';
const loginA='00000000-0000-0000-0000-000000004466',loginB='00000000-0000-0000-0000-000000004467';
const tokenA='signed-old-provider-token',tokenB='signed-fresh-provider-token',now=2_000_000_000_000;
const hash=t=>createHash('sha256').update(t).digest('hex');
const req=(token=tokenA,mixed=false)=>new Request('https://car02.test/isolated-446',{headers:{authorization:'Bearer '+token,...(mixed?{'x-line-id-token':'mixed'}:{})}});
const denied=p=>assert.rejects(p,e=>e?.code==='CAR02_UNAUTHORIZED'&&e.status===401);
function fixture(){
 const queries=[];
 let member={shopCode:shop,userSub:sub,active:true,role:'staff',version:1,nonce:nonceA};
 const proofs=new Map();
 let tokenVerified=true,tokenExpired=false,throwQuery=false;
 const recorded=(t,sessionId,loginId,nonce,version)=>proofs.set(sessionId,{shopCode:shop,userSub:sub,sessionId,loginId,tokenSha256:hash(t),nonce,version,active:true});
 recorded(tokenA,sidA,loginA,nonceA,1);
 const run=async(sql,params)=>{
  queries.push({sql,params});
  if(throwQuery)throw Error('secret DB information');
  if(![CAR02_V446_READ_SQL,CAR02_V446_WRITE_SQL].includes(sql))throw Error('unreviewed SQL');
  const [tenant,who,sessionId,tokenSha256]=params,proof=proofs.get(sessionId);
  if(tenant!==member.shopCode||who!==member.userSub||!member.active||
     !proof?.active||proof.shopCode!==tenant||proof.userSub!==who||
     proof.tokenSha256!==tokenSha256||proof.nonce!==member.nonce||proof.version!==member.version)
    return {rows:[]};
  return {rows:[{staff_role:member.role,auth_version:member.version,generation_nonce:member.nonce,login_id:proof.loginId}]};
 };
 const store={query:run};
 const verifyJwt=async ({accessToken})=>({verified:tokenVerified,sub,sessionId:accessToken===tokenB?sidB:sidA,expMs:tokenExpired?now-1:now+300_000});
 const gate=createCar02OfflineSessionCutoverR446({verifyJwt,store,nowMs:()=>now});
 return{gate,client:{query:run},queries,proofs,
   get member(){return member},set member(x){member=x},
   recordFresh(){recorded(tokenB,sidB,loginB,nonceB,3)},
   set verified(x){tokenVerified=x},set expired(x){tokenExpired=x},set failQuery(x){throwQuery=x}};
}
test('hard-release lock and fixed server-selected two SQL statements',()=>{
 assert.equal(CAR02_V446_RELEASE_LOCK,true);
 assert.match(CAR02_V446_READ_SQL,/^SELECT staff_role,auth_version/);
 assert.match(CAR02_V446_WRITE_SQL,/^SELECT staff_role,auth_version/);
 assert.notEqual(CAR02_V446_READ_SQL,CAR02_V446_WRITE_SQL);
 assert.throws(()=>createCar02OfflineSessionCutoverR446(),/CAR02_V446_TRUSTED_PROVIDER_AND_STORE_REQUIRED/);
});
test('valid signed token AND independently stored matching login event authenticate',async()=>{
 const f=fixture(),actor=await f.gate.authenticate(req(),shop);
 assert.equal(actor.verified,true);assert.equal(actor.authVersion,1);assert.equal(actor.generationNonce,nonceA);
 assert.ok(Object.isFrozen(actor));assert.deepEqual(f.queries[0].params,[shop,sub,sidA,hash(tokenA)]);
});
test('row-locked session check is required for same-transaction mutation gate',async()=>{
 const f=fixture(),a=await f.gate.authenticate(req(),shop);
 assert.equal(await f.gate.assertMutation({client:f.client,actor:a,shopCode:shop}),true);
 assert.equal(f.queries[1].sql,CAR02_V446_WRITE_SQL);
});
test('valid JWT but missing trusted new-login event denies',async()=>{
 const f=fixture();f.proofs.clear();await denied(f.gate.authenticate(req(),shop));
});
test('revoked member denies old session even when JWT remains verified',async()=>{
 const f=fixture();f.member={...f.member,active:false,version:2,nonce:nonceB};
 await denied(f.gate.authenticate(req(),shop));
});
test('reactivation denies old JWT and old provider session',async()=>{
 const f=fixture();f.member={...f.member,active:true,version:3,nonce:nonceB};
 await denied(f.gate.authenticate(req(),shop));
});
test('session proof recorded BEFORE new committed generation is rejected',async()=>{
 const f=fixture();f.member={...f.member,active:true,version:3,nonce:nonceB};
 // An old session may have valid signature but is bound to authVersion 1.
 await denied(f.gate.authenticate(req(),shop));
});
test('fresh independently verified new session and post-commit generation pass',async()=>{
 const f=fixture();f.member={...f.member,version:3,nonce:nonceB};f.recordFresh();
 const actor=await f.gate.authenticate(req(tokenB),shop);
 assert.equal(actor.authVersion,3);assert.equal(actor.providerSessionId,sidB);
 assert.equal(await f.gate.assertMutation({client:f.client,actor,shopCode:shop}),true);
});
test('old in-memory capability is denied at WRITE lock after reactivation',async()=>{
 const f=fixture(),actor=await f.gate.authenticate(req(),shop);
 f.member={...f.member,version:3,nonce:nonceB};f.recordFresh();
 await denied(f.gate.assertMutation({client:f.client,actor,shopCode:shop}));
});
test('provider session matches but token digest mismatch is rejected',async()=>{
 const f=fixture(),p=f.proofs.get(sidA);f.proofs.set(sidA,{...p,tokenSha256:hash(tokenB)});
 await denied(f.gate.authenticate(req(),shop));
});
test('provider-signin record belongs to another tenant: rejected',async()=>{
 const f=fixture(),p=f.proofs.get(sidA);f.proofs.set(sidA,{...p,shopCode:other});
 await denied(f.gate.authenticate(req(),shop));
});
test('marked-revoked login event cannot authenticate an active staff member',async()=>{
 const f=fixture(),p=f.proofs.get(sidA);f.proofs.set(sidA,{...p,active:false});
 await denied(f.gate.authenticate(req(),shop));
});
test('forged actor clone and arbitrary request fields cannot access lock',async()=>{
 const f=fixture(),a=await f.gate.authenticate(req(),shop);
 await denied(f.gate.assertMutation({client:f.client,actor:{...a},shopCode:shop}));
 await denied(f.gate.assertMutation({client:f.client,actor:a,shopCode:other}));
 assert.equal(f.queries.length,1);
});
test('valid JWT required, expired and mixed LINE credentials rejected',async()=>{
 const f=fixture();f.verified=false;await denied(f.gate.authenticate(req(),shop));
 f.verified=true;f.expired=true;await denied(f.gate.authenticate(req(),shop));
 f.expired=false;await denied(f.gate.authenticate(req(tokenA,true),shop));
});
test('missing or malformed bearer or tenant rejected before SQL',async()=>{
 const f=fixture();await denied(f.gate.authenticate(new Request('https://test'),shop));
 await denied(f.gate.authenticate(req(),'../cross-shop'));
 assert.equal(f.queries.length,0);
});
test('DB error during auth or row lock hides sensitive error details',async()=>{
 const f=fixture();f.failQuery=true;await denied(f.gate.authenticate(req(),shop));
 f.failQuery=false;const a=await f.gate.authenticate(req(),shop);
 f.failQuery=true;await denied(f.gate.assertMutation({client:f.client,actor:a,shopCode:shop}));
});
test('missing transaction connection does not accept provider attestation',async()=>{
 const f=fixture(),a=await f.gate.authenticate(req(),shop);
 await denied(f.gate.assertMutation({actor:a,shopCode:shop}));
});
test('production R52 release stays closed and never imports offline V446',()=>{
 const code=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
 assert.match(code,/const\s+CAR02_RELEASE_LOCK\s*=\s*true/);
 assert.doesNotMatch(code,/session-cutover-r446|v446_qa_/);
});
