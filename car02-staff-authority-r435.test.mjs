import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  createCar02ScopedStaffAuthorityR435,CAR02_V435_RELEASE_LOCK
} from './car02-staff-authority-r435.mjs';
import {CAR02_V434_RELEASE_LOCK} from './car02-staff-generation-r434.mjs';

const shop='street_house_kitsuki';
const userSub='00000000-0000-0000-0000-000000004435';
const session='00000000-0000-0000-0000-000000000435';
const clock=2_000_000_000_000;
const token='V435-review-only-signed-token';
const sha=x=>createHash('sha256').update(x).digest('hex');
const req=()=>new Request('https://car02.test/isolation',{headers:{authorization:'Bearer '+token}});
const denied=p=>assert.rejects(p,e=>e.code==='CAR02_UNAUTHORIZED'&&e.status===401);
function mock(){
 let member={userSub,shopCode:shop,active:true,role:'staff',authVersion:7,authGenerationCommittedAtMs:clock-50_000};
 let proof={verified:true,active:true,userSub,sessionId:session,createdAtMs:clock-1000,credentialSha256:sha(token)};
 const config={shopCode:shop, nowMs:()=>clock,
  verifyStaffJwt:async({accessToken})=>{assert.equal(accessToken,token);return {verified:true,sub:userSub,exp:Math.floor(clock/1000)+300};},
  readStaffMembership:async()=>({...member}),
  attestProviderSession:async()=>({...proof})};
 const entry=createCar02ScopedStaffAuthorityR435(config);
 const rows=()=>[{shop_code:shop,user_sub:userSub,staff_role:member.role,active:member.active,
  auth_version:member.authVersion,auth_generation_committed_at_ms:member.authGenerationCommittedAtMs}];
 const queries=[];
 const tx={query:async(sql,params)=>{queries.push({sql,params});return {rows:rows()}}};
 return {entry,config,tx,queries,get member(){return member},set member(x){member=x},get proof(){return proof},set proof(x){proof=x}};
}

test('both release locks remain closed',()=>{
 assert.equal(CAR02_V434_RELEASE_LOCK,true);
 assert.equal(CAR02_V435_RELEASE_LOCK,true);
});
test('fresh factory-issued identity checks row lock in existing transaction client',async()=>{
 const m=mock();const actor=await m.entry.authenticate(req());
 assert.ok(Object.isFrozen(actor));
 assert.equal(await m.entry.assertMutation({transactionClient:m.tx,actor,shopCode:shop}),true);
 assert.equal(m.queries.length,1);
 assert.match(m.queries[0].sql,/FOR UPDATE/);
 assert.deepEqual(m.queries[0].params,[shop,userSub]);
});
test('raw JSON actor with matching role, subject and generation is refused',async()=>{
 const m=mock();const actor=await m.entry.authenticate(req());
 await denied(m.entry.assertMutation({transactionClient:m.tx,actor:JSON.parse(JSON.stringify(actor)),shopCode:shop}));
 assert.equal(m.queries.length,0,'forged actor must be denied before DB access');
});
test('object-spread copy of genuine actor is not an issued capability',async()=>{
 const m=mock();const actor=await m.entry.authenticate(req());
 await denied(m.entry.assertMutation({transactionClient:m.tx,actor:Object.freeze({...actor}),shopCode:shop}));
 assert.equal(m.queries.length,0);
});
test('actor issued by another authority instance cannot be used across instances',async()=>{
 const a=mock();const b=mock();const actor=await a.entry.authenticate(req());
 await denied(b.entry.assertMutation({transactionClient:b.tx,actor,shopCode:shop}));
 assert.equal(b.queries.length,0);
});
test('untrusted role/tenant/subject payloads cannot reach SQL',async()=>{
 const m=mock();
 await denied(m.entry.assertMutation({transactionClient:m.tx,actor:{verified:true,role:'owner',authVersion:7,userSub,shopCode:shop},shopCode:shop}));
 assert.equal(m.queries.length,0);
});
test('server-issued actor is denied if membership becomes inactive',async()=>{
 const m=mock();const actor=await m.entry.authenticate(req());
 m.member={...m.member,active:false,authVersion:8,authGenerationCommittedAtMs:clock-500};
 await denied(m.entry.assertMutation({transactionClient:m.tx,actor,shopCode:shop}));
 assert.equal(m.queries.length,1);
});
test('old in-memory actor denied after revoke/reactivation version increments',async()=>{
 const m=mock();const actor=await m.entry.authenticate(req());
 m.member={...m.member,active:true,authVersion:9,authGenerationCommittedAtMs:clock-500};
 await denied(m.entry.assertMutation({transactionClient:m.tx,actor,shopCode:shop}));
});
test('server-issued actor cannot mutate another shop',async()=>{
 const m=mock();const actor=await m.entry.authenticate(req());
 await denied(m.entry.assertMutation({transactionClient:m.tx,actor,shopCode:'another_shop'}));
});
test('query failure fails closed without leaking provider or SQL details',async()=>{
 const m=mock();const actor=await m.entry.authenticate(req());
 const broken={query:async()=>{throw Error('sensitive SQL internal details')}};
 await denied(m.entry.assertMutation({transactionClient:broken,actor,shopCode:shop}));
});
test('authentication cannot succeed with pre-commit or missing session attestation',async()=>{
 const m=mock();m.proof={...m.proof,createdAtMs:clock-60_000};
 await denied(m.entry.authenticate(req()));
 m.proof={...m.proof,createdAtMs:clock-1000,verified:false};
 await denied(m.entry.authenticate(req()));
});
test('missing trusted adapters never silently falls back to old R44/R46',()=>{
 assert.throws(()=>createCar02ScopedStaffAuthorityR435({shopCode:shop}),/CAR02_V434_SERVER_CONFIG_REQUIRED/);
});
