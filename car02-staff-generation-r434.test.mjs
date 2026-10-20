import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  CAR02_V434_RELEASE_LOCK,createCar02GenerationBoundStaffAuthR434,
  assertCar02StaffMutationGenerationR434
} from './car02-staff-generation-r434.mjs';
const sub='00000000-0000-0000-0000-000000004434';
const sessionOld='00000000-0000-0000-0000-000000000101';
const sessionNew='00000000-0000-0000-0000-000000000102';
const shop='street_house_kitsuki';
const clock=2_000_000_000_000;
const digest=x=>createHash('sha256').update(x).digest('hex');
const denied=fn=>assert.rejects(fn,e=>e.code==='CAR02_UNAUTHORIZED'&&e.status===401);
const req=(token='signed-new-token-abcdefghijkl')=>new Request('https://car02.test/hold',{headers:{authorization:'Bearer '+token}});
function setup(){
 let state={userSub:sub,shopCode:shop,active:true,role:'staff',authVersion:1,authGenerationCommittedAtMs:clock-350_000};
 const sessions=new Map([
  ['signed-old-token-abcdefghijkl',{verified:true,active:true,userSub:sub,sessionId:sessionOld,createdAtMs:clock-300_000}],
  ['signed-new-token-abcdefghijkl',{verified:true,active:true,userSub:sub,sessionId:sessionNew,createdAtMs:clock-1000}]
 ]);
 let onProof=null;let nread=0;
 const authenticate=createCar02GenerationBoundStaffAuthR434({shopCode:shop,
  verifyStaffJwt:async()=>({verified:true,sub,exp:Math.floor(clock/1000)+600}),
  readStaffMembership:async()=>{nread++;return {...state};},
  attestProviderSession:async({accessToken})=>{
    if(onProof)await onProof();
    const p=sessions.get(accessToken);return p?{...p,credentialSha256:p.credentialSha256 ?? digest(accessToken)}:null;
  },nowMs:()=>clock});
 return {authenticate,sessions,get state(){return state;},set state(x){state=x;},set onProof(x){onProof=x;},get reads(){return nread;}};
}
test('hard release lock stays true',()=>assert.equal(CAR02_V434_RELEASE_LOCK,true));
test('fresh trusted provider session authenticates to immutable version-scoped actor',async()=>{
 const h=setup();const x=await h.authenticate(req());
 assert.equal(x.authVersion,1);assert.equal(x.role,'staff');assert.equal(x.providerSessionId,sessionNew);
 assert.ok(Object.isFrozen(x));assert.equal(h.reads,2);
});
test('old provider session denied after revoke+reactivate (even when token remains valid)',async()=>{
 const h=setup();await h.authenticate(req('signed-old-token-abcdefghijkl'));
 h.state={...h.state,active:false,authVersion:2,authGenerationCommittedAtMs:clock-100_000};
 await denied(()=>h.authenticate(req('signed-old-token-abcdefghijkl')));
 h.state={...h.state,active:true,authVersion:3,authGenerationCommittedAtMs:clock-50_000};
 await denied(()=>h.authenticate(req('signed-old-token-abcdefghijkl')));
 // A newly attested session, subsequent to generation COMMIT, can authenticate.
 const p=h.sessions.get('signed-new-token-abcdefghijkl');p.createdAtMs=clock-1000;
 assert.equal((await h.authenticate(req())).authVersion,3);
});
test('revocation during asynchronous attestation cannot use earlier membership read',async()=>{
 const h=setup();h.onProof=async()=>{h.state={...h.state,active:false,authVersion:2,authGenerationCommittedAtMs:clock-500};};
 await denied(()=>h.authenticate(req()));
});
test('missing authoritative epoch / fake or expired proof fail closed',async()=>{
 const h=setup();h.state={...h.state,authGenerationCommittedAtMs:undefined};await denied(()=>h.authenticate(req()));
 h.state={...h.state,authGenerationCommittedAtMs:clock-350_000};
 h.sessions.get('signed-new-token-abcdefghijkl').createdAtMs=clock+1;
 await denied(()=>h.authenticate(req()));
 h.sessions.get('signed-new-token-abcdefghijkl').createdAtMs=clock-350_000;
 await denied(()=>h.authenticate(req()));
 h.sessions.get('signed-new-token-abcdefghijkl').createdAtMs=clock-1000;
 h.sessions.get('signed-new-token-abcdefghijkl').credentialSha256='attacker';
 await denied(()=>h.authenticate(req()));
 await denied(()=>h.authenticate(req('signed-unknown-token-abcdefghijkl')));
});
test('tenant, malformed auth and LINE/mixed credentials reject',async()=>{
 const h=setup();
 await denied(()=>h.authenticate(new Request('https://test',{headers:{authorization:'Bearer x'}})));
 await denied(()=>h.authenticate(new Request('https://test',{headers:{authorization:'Bearer signed-new-token-abcdefghijkl','x-line-id-token':'signed-line-token-abc'}})));
 const wrong=createCar02GenerationBoundStaffAuthR434({shopCode:'other_shop',
  verifyStaffJwt:async()=>({verified:true,sub,exp:Math.floor(clock/1000)+100}),
  readStaffMembership:async()=>({...h.state}),attestProviderSession:async()=>({}),nowMs:()=>clock});
 await denied(()=>wrong(req()));
});
test('R46-style verified identity without trusted provider-session adapter is not enough',async()=>{
 assert.throws(()=>createCar02GenerationBoundStaffAuthR434({shopCode:shop,verifyStaffJwt:async()=>({verified:true})}),/CAR02_V434_SERVER_CONFIG_REQUIRED/);
});
test('mutation transaction locks and matches auth generation, never uses caller role alone',async()=>{
 const h=setup();const actor=await h.authenticate(req());
 let seen='';
 const tx={query:async(sql,params)=>{seen=sql;assert.deepEqual(params,[shop,sub]);return {rows:[{shop_code:shop,user_sub:sub,staff_role:'staff',active:true,auth_version:1,auth_generation_committed_at_ms:clock-350_000}]}}};
 assert.equal(await assertCar02StaffMutationGenerationR434({transactionClient:tx,actor,shopCode:shop}),true);
 assert.match(seen,/FOR UPDATE/);assert.match(seen,/WHERE shop_code=\$1 AND user_sub=\$2/);
 const deniedTx={query:async()=>({rows:[{shop_code:shop,user_sub:sub,staff_role:'owner',active:true,auth_version:2,auth_generation_committed_at_ms:clock-100_000}]})};
 await denied(()=>assertCar02StaffMutationGenerationR434({transactionClient:deniedTx,actor,shopCode:shop}));
 await denied(()=>assertCar02StaffMutationGenerationR434({transactionClient:tx,actor:{...actor,authVersion:10},shopCode:shop}));
});
