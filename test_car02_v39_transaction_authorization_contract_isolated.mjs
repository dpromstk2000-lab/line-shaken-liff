import test from 'node:test';
import assert from 'node:assert/strict';
import {v39QaTxAuthorizeAndReplay,v39QaScopeDigest,V39_MODE} from './car02-v39-transaction-authorization-contract-isolated.mjs';
const ISS='https://auth.example.test',AUD='car02-review';
const subject='00000000-0000-4000-8000-000000000001';
const SHOP='QA-SHOP-1',NOW=1770000000;
const INTENT='e'.repeat(64);
const base=()=>({
 environment:'isolated_qa',allowIsolatedQa:true,tx:{id:'qa-tx-001',state:'open'},
 actor:{verified:true,shopCode:SHOP,role:'staff',subject:`staff:${subject}`},
 claims:{cryptographicallyVerified:true,iss:ISS,aud:AUD,sub:subject,authVersion:3,exp:NOW+300,nbf:NOW-30},
 shopCode:SHOP,operation:'create',idempotencyKey:'idempotency-001',intentDigest:INTENT,
 expectedIssuer:ISS,expectedAudience:AUD,nowSeconds:()=>NOW,
 lockMembership:async ({txId,userSub,shopCode})=>({lockKind:'FOR_UPDATE',txId,userSub,shopCode,active:true,role:'staff',authVersion:3}),
 readReplay:async ()=>null,mutate:async ()=>({ok:true,id:'new-order'})
});
const denied=async v=>await assert.rejects(()=>v39QaTxAuthorizeAndReplay(v),{code:'CAR02_V39_QA_DENIED'});
const savedFor=v=>({scopeDigest:v39QaScopeDigest({shopCode:v.shopCode,subject:v.actor.subject,role:v.actor.role,operation:v.operation,key:v.idempotencyKey,intentDigest:v.intentDigest}),shopCode:v.shopCode,actorSubject:v.actor.subject,actorRole:v.actor.role,intentDigest:v.intentDigest,authVersion:v.claims.authVersion,completed:true,snapshot:{ok:true,id:'prior'}});

test('mode permanently locked to isolated QA',()=>{
 assert.deepEqual(V39_MODE,{environment:'isolated_qa',deployable:false,liveAuthentication:false,realDbTransaction:false,realRowLock:false,R43Patched:false,release:'NO_GO',migration:'HOLD'});
 assert.equal(Object.isFrozen(V39_MODE),true);
});
test('new write follows lock -> replay lookup -> mutate',async()=>{
 const v=base(),order=[];
 v.lockMembership=async p=>{order.push('lock');return base().lockMembership(p)};
 v.readReplay=async()=>{order.push('replay');return null};
 v.mutate=async()=>{order.push('mutate');return {ok:true}};
 assert.deepEqual(await v39QaTxAuthorizeAndReplay(v),{ok:true});
 assert.deepEqual(order,['lock','replay','mutate']);
});
test('authorized cached replay follows lock -> replay, never mutate',async()=>{
 const v=base(),order=[],snapshot=savedFor(v);
 v.lockMembership=async p=>{order.push('lock');return base().lockMembership(p)};
 v.readReplay=async()=>{order.push('replay');return snapshot};
 v.mutate=async()=>{order.push('mutate');throw Error('unexpected')};
 assert.deepEqual(await v39QaTxAuthorizeAndReplay(v),{ok:true,id:'prior'});
 assert.deepEqual(order,['lock','replay']);
});
test('does not trust stale object snapshot after permission revocation',async()=>{
 const v=base();v.readReplay=async()=>savedFor(v);
 v.lockMembership=async p=>({...await base().lockMembership(p),active:false});
 await denied(v);
});
test('no silent commit or transaction management',async()=>{
 const v=base();await v39QaTxAuthorizeAndReplay(v);assert.equal(v.tx.state,'open');
});
test('replay returns defensive copy',async()=>{
 const v=base(),snapshot=savedFor(v);v.readReplay=async()=>snapshot;
 const r=await v39QaTxAuthorizeAndReplay(v);r.id='tampered';assert.equal(snapshot.snapshot.id,'prior');
});
test('mutation return is defensive copy',async()=>{
 const v=base(),source={nested:{x:1}};v.mutate=async()=>source;
 const r=await v39QaTxAuthorizeAndReplay(v);r.nested.x=999;assert.equal(source.nested.x,1);
});
test('role owner can succeed with matching locked owner role',async()=>{
 const v=base();v.actor.role='owner';v.lockMembership=async p=>({...await base().lockMembership(p),role:'owner'});
 assert.equal((await v39QaTxAuthorizeAndReplay(v)).ok,true);
});

const variants=[
 ['environment not QA',v=>{v.environment='production'}],
 ['explicit QA opt-in missing',v=>{v.allowIsolatedQa=false}],
 ['tx missing',v=>{v.tx=null}],
 ['tx closed before entry',v=>{v.tx.state='committed'}],
 ['tx id blank',v=>{v.tx.id=''}],
 ['actor unverified',v=>{v.actor.verified=false}],
 ['actor cross tenant',v=>{v.actor.shopCode='OTHER'}],
 ['actor customer',v=>{v.actor.role='customer'}],
 ['actor line principal',v=>{v.actor.subject='line:abc'}],
 ['actor subject differs from claim',v=>{v.actor.subject='staff:someone-else'}],
 ['claims unverified',v=>{v.claims.cryptographicallyVerified=false}],
 ['JWT issuer incorrect',v=>{v.claims.iss='https://evil.example'}],
 ['JWT audience incorrect',v=>{v.claims.aud='other'}],
 ['JWT expired',v=>{v.claims.exp=NOW}],
 ['JWT malformed expiry',v=>{v.claims.exp='1770000300'}],
 ['JWT not before future',v=>{v.claims.nbf=NOW+1}],
 ['JWT malformed nbf',v=>{v.claims.nbf='0'}],
 ['JWT version stale zero',v=>{v.claims.authVersion=0}],
 ['JWT version float',v=>{v.claims.authVersion=3.5}],
 ['JWT version string',v=>{v.claims.authVersion='3'}],
 ['operation not known',v=>{v.operation='delete'}],
 ['idempotency key missing',v=>{v.idempotencyKey=''}],
 ['idempotency key too short',v=>{v.idempotencyKey='x'}],
 ['invalid idempotency key',v=>{v.idempotencyKey='bad value 1234'}],
 ['intent digest malformed',v=>{v.intentDigest='not-hex'}],
 ['bad issuer config',v=>{v.expectedIssuer=''}],
 ['bad audience config',v=>{v.expectedAudience=''}],
 ['missing lock callback',v=>{v.lockMembership=null}],
 ['missing replay reader',v=>{v.readReplay=null}],
 ['missing mutator',v=>{v.mutate=null}]
];
for(const [label,change] of variants)test(`reject invalid entry: ${label}`,async()=>{const v=base();change(v);await denied(v)});

const locks=[
 ['not actually locked',p=>({...p,lockKind:'READ_ONLY'})],
 ['wrong transaction',p=>({...p,txId:'other'})],
 ['wrong shop',p=>({...p,shopCode:'OTHER'})],
 ['wrong user',p=>({...p,userSub:'other'})],
 ['inactive',p=>({...p,active:false})],
 ['wrong role',p=>({...p,role:'owner'})],
 ['customer role',p=>({...p,role:'customer'})],
 ['version behind',p=>({...p,authVersion:2})],
 ['version ahead',p=>({...p,authVersion:4})],
 ['version missing',p=>({...p,authVersion:undefined})],
 ['version string',p=>({...p,authVersion:'3'})],
 ['lock result missing',p=>null],
 ['lock result array',p=>[]]
];
for(const [label,change] of locks)test(`deny locked membership mismatch: ${label}`,async()=>{
 const v=base(),events=[];v.lockMembership=async p=>{events.push('lock');return change(await base().lockMembership(p))};
 v.readReplay=async()=>{events.push('replay');return null};v.mutate=async()=>{events.push('mutate');return {}};
 await denied(v);assert.deepEqual(events,['lock']);
});
const replays=[
 ['scope mismatch',s=>({...s,scopeDigest:'a'.repeat(64)})],
 ['wrong shop',s=>({...s,shopCode:'OTHER'})],
 ['wrong actor',s=>({...s,actorSubject:'staff:other'})],
 ['wrong role',s=>({...s,actorRole:'owner'})],
 ['wrong intent',s=>({...s,intentDigest:'a'.repeat(64)})],
 ['unfinished',s=>({...s,completed:false})],
 ['no version',s=>({...s,authVersion:null})],
 ['version mismatch',s=>({...s,authVersion:2})],
 ['no snapshot',s=>{const x={...s};delete x.snapshot;return x}],
 ['array row',s=>[s]],
 ['non-object row',s=>"row"]
];
for(const [label,change] of replays)test(`deny cache on invalid replay: ${label}`,async()=>{
 const v=base();let worked=false;v.readReplay=async()=>change(savedFor(v));v.mutate=async()=>{worked=true;return {}};
 await denied(v);assert.equal(worked,false);
});
const callbackFailures=[
 ['lock throws',v=>v.lockMembership=async()=>{throw Error('secret-lock-information')}],
 ['reader throws',v=>v.readReplay=async()=>{throw Error('secret-db-information')}],
 ['mutate throws',v=>v.mutate=async()=>{throw Error('secret-write-information')}],
 ['lock closes transaction',v=>v.lockMembership=async p=>{v.tx.state='closed';return base().lockMembership(p)}],
 ['reader closes transaction',v=>v.readReplay=async()=>{v.tx.state='closed';return null}],
 ['mutator closes transaction',v=>v.mutate=async()=>{v.tx.state='closed';return {ok:true}}]
];
for(const [label,change] of callbackFailures)test(`fail closed without error leak: ${label}`,async()=>{
 const v=base();change(v);await denied(v)
});
test('same key and intent yields identical deterministic scoped digest',()=>{
 const v=base(),a={shopCode:v.shopCode,subject:v.actor.subject,role:v.actor.role,operation:v.operation,key:v.idempotencyKey,intentDigest:v.intentDigest};
 assert.equal(v39QaScopeDigest(a),v39QaScopeDigest({...a}));
});
for(const field of ['shopCode','subject','role','operation','key','intentDigest'])test(`scope digest segregated by ${field}`,()=>{
 const v=base(),a={shopCode:v.shopCode,subject:v.actor.subject,role:v.actor.role,operation:v.operation,key:v.idempotencyKey,intentDigest:v.intentDigest};
 const other={...a,[field]:field==='role'?'owner':field==='operation'?'report':field==='intentDigest'?'a'.repeat(64):field==='key'?'other-key-12345':'DIFFERENT'};
 assert.notEqual(v39QaScopeDigest(a),v39QaScopeDigest(other));
});
