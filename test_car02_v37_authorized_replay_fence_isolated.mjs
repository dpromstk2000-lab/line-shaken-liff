import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createV37QaAuthorizedReplayFence,V37_MODE} from './car02-v37-authorized-replay-fence-isolated.mjs';
const NOW=1800000000,SHOP='shop-synthetic-a',SUB='synthetic-user';
const MID='11111111-1111-4111-8111-111111111111';
const ACTOR={verified:true,role:'staff',subject:'staff:'+SUB,shopCode:SHOP};
const ROW={membershipId:MID,userSub:SUB,shopCode:SHOP,role:'staff',active:true,suspended:false,
 revokedAt:null,authVersion:8,validFrom:NOW-100,validUntil:NOW+500};
const SESSION={verified:true,sub:SUB,authVersion:8,exp:NOW+180};
const KEY='idempotency-test-key-001';
function setup({actor=ACTOR,row=ROW,session=SESSION,clock=()=>NOW,locker,reader,environment='isolated_qa',allowIsolatedQa=true}={}){
 let worked=0,authReads=0,locks=0;
 const cfg={environment,allowIsolatedQa,nowSeconds:clock,
  readVerifiedSession:async q=>{authReads++;return reader?reader(q):session;},
  lockMembershipRow:async q=>{locks++;return locker?locker(q):{lockHeld:true,rows:[row]};}};
 const execute=createV37QaAuthorizedReplayFence(cfg);
 const run=({a=actor,shopCode=SHOP,operation='report',idempotencyKey=KEY,payload={message:'qa'},work}={})=>
  execute({actor:a,shopCode,operation,idempotencyKey,payload,
    work:work??(async()=>{worked++;return {value:'sample',workCount:worked};})});
 return {run,execute,get worked(){return worked},get authReads(){return authReads},get locks(){return locks}};
}
async function denied(p){await assert.rejects(p,e=>e?.code==='CAR02_V37_QA_DENIED'&&e.message==='CAR02_V37_QA_DENIED');}
test('explicit nondeployable mode and hold',()=>{assert.equal(V37_MODE.productionReady,false);assert.equal(V37_MODE.realDbTransaction,false);assert.equal(V37_MODE.realSignedJwtVerifierBound,false);assert.equal(V37_MODE.deployable,false);assert.equal(V37_MODE.release,'NO_GO');assert.equal(V37_MODE.migration,'HOLD');});
for(const op of ['create','report','present','complete'])test('authorized first and replay for '+op,async()=>{const h=setup();const x=await h.run({operation:op});assert.deepEqual(x,{value:'sample',workCount:1});assert.deepEqual(await h.run({operation:op}),x);assert.equal(h.worked,1);assert.equal(h.authReads,2);assert.equal(h.locks,2);});
test('repeated same key never repeats work',async()=>{const h=setup();for(let i=0;i<6;i++)assert.deepEqual(await h.run(),{value:'sample',workCount:1});assert.equal(h.worked,1);assert.equal(h.authReads,6);});
test('unique keys execute independently',async()=>{const h=setup();await h.run();await h.run({idempotencyKey:'different-key-00001'});assert.equal(h.worked,2);});
test('different operations have separate scopes',async()=>{const h=setup();await h.run({operation:'report'});await h.run({operation:'present'});assert.equal(h.worked,2);});
test('replay checks authentication before accessing existing result',async()=>{let enabled=true;const h=setup({locker:()=>({lockHeld:true,rows:[{...ROW,active:enabled}]})});await h.run();enabled=false;await denied(()=>h.run());assert.equal(h.worked,1);assert.equal(h.authReads,2);assert.equal(h.locks,2);});
test('authorization failure does not reuse earlier response',async()=>{let ver=8;const h=setup({reader:()=>({...SESSION,authVersion:8}),locker:()=>({lockHeld:true,rows:[{...ROW,authVersion:ver}]})});await h.run();ver=9;await denied(()=>h.run());assert.equal(h.worked,1);});
test('new session version cannot claim old replay result',async()=>{let ver=8;const h=setup({reader:()=>({...SESSION,authVersion:ver}),locker:()=>({lockHeld:true,rows:[{...ROW,authVersion:ver}]})});await h.run();ver=9;await denied(()=>h.run());assert.equal(h.worked,1);await h.run({idempotencyKey:'fresh-key-after-version'});assert.equal(h.worked,2);});
test('same key different payload rejects and does not run work',async()=>{const h=setup();await h.run();await denied(()=>h.run({payload:{message:'different'}}));assert.equal(h.worked,1);});
test('canonical object key order does not change fingerprint',async()=>{const h=setup();const a=await h.run({payload:{a:1,b:2}});assert.deepEqual(await h.run({payload:{b:2,a:1}}),a);assert.equal(h.worked,1);});
test('deep canonical key order does not change fingerprint',async()=>{const h=setup();await h.run({payload:{a:[{x:1,y:2}]}});await h.run({payload:{a:[{y:2,x:1}]}});assert.equal(h.worked,1);});
test('snapshot cloning prevents replay mutation',async()=>{const h=setup();const first=await h.run({work:()=>({value:{list:[1]}})});first.value.list.push(999);const again=await h.run();assert.deepEqual(again,{value:{list:[1]}});assert.equal(h.worked,0);});
test('failed work is not recorded',async()=>{const h=setup();await denied(()=>h.run({work:()=>{throw Error('secret internal code')}}));assert.deepEqual(await h.run(),{value:'sample',workCount:1});});
test('invalid first result is not recorded',async()=>{const h=setup();await denied(()=>h.run({work:()=>undefined}));assert.deepEqual(await h.run(),{value:'sample',workCount:1});});
test('oversized result is denied and not recorded',async()=>{const h=setup();await denied(()=>h.run({work:()=>({data:'a'.repeat(9000)})}));assert.equal(h.worked,0);await h.run();assert.equal(h.worked,1);});
test('replay still validates newly supplied payload',async()=>{const h=setup();await h.run();await denied(()=>h.run({payload:{message:'qa',unexpected:1}}));assert.equal(h.worked,1);});
test('parallel same-key attempt fails closed',async()=>{const h=setup();let resolveWork;let entered;const enteredP=new Promise(r=>entered=r);const first=h.run({work:()=>{entered();return new Promise(r=>resolveWork=r);}});await enteredP;await denied(()=>h.run());resolveWork({ok:true});assert.deepEqual(await first,{ok:true});assert.deepEqual(await h.run(),{ok:true});});
test('parallel requests with different keys remain isolated',async()=>{const h=setup();const v=await Promise.all([h.run({idempotencyKey:'different-key-00002'}),h.run({idempotencyKey:'different-key-00003'})]);assert.equal(h.worked,2);assert.equal(v.length,2);});
test('subject isolation',async()=>{const h=setup();await h.run();await denied(()=>h.run({a:{...ACTOR,subject:'staff:other-user'}}));assert.equal(h.worked,1);});
test('role isolation when not authoritative is rejected',async()=>{const h=setup();await h.run();await denied(()=>h.run({a:{...ACTOR,role:'owner'}}));assert.equal(h.worked,1);});
test('shop isolation',async()=>{const h=setup();await h.run();await denied(()=>h.run({shopCode:'shop-synthetic-b'}));assert.equal(h.worked,1);});
for(const op of ['delete','read','decide','approve','refund','',null,3])test('unsupported operation denied '+String(op),async()=>{const h=setup();await denied(()=>h.run({operation:op}));assert.equal(h.worked,0);assert.equal(h.authReads,0);});
for(const key of ['short','has space key-001','bad/key-000001','bad:key-000001','',null,'🔐'.repeat(6),'a'.repeat(151)])test('malformed replay key denied '+String(key)?.slice(0,20),async()=>{const h=setup();await denied(()=>h.run({idempotencyKey:key}));assert.equal(h.worked,0);assert.equal(h.authReads,0);});
for(const a of [null,[],{},false,{...ACTOR,verified:false},{...ACTOR,role:'customer'},{...ACTOR,shopCode:'other'},{...ACTOR,subject:'line:synthetic-user'},{...ACTOR,subject:'staff:'},{...ACTOR,subject:'staff:with space'}])test('bad actor denied '+JSON.stringify(a),async()=>{const h=setup();await denied(()=>h.run({a}));assert.equal(h.worked,0);});
for(const payload of [null,[],42,'text',false,{x:undefined},{x:NaN},{x:Infinity},{x:()=>null},{x:new Date()}, {'__proto__':null},{x:123.5},{x:BigInt(1)}])test('invalid payload denied '+String(payload?.x??typeof payload),async()=>{const h=setup();await denied(()=>h.run({payload}));assert.equal(h.worked,0);});
for(const payload of [Object.assign(Object.create(null),{x:1}),JSON.parse('{"__proto__":1}'),JSON.parse('{"constructor":1}'),JSON.parse('{"prototype":1}')])test('prototype or unsafe object denied',async()=>{const h=setup();await denied(()=>h.run({payload}));assert.equal(h.worked,0);});
test('cycle body denied',async()=>{const p={a:1};p.me=p;const h=setup();await denied(()=>h.run({payload:p}));});
test('oversized body denied',async()=>{const h=setup();await denied(()=>h.run({payload:{veryLong:'x'.repeat(9000)}}));});
test('too deep body denied',async()=>{let p={value:1};for(let i=0;i<12;i++)p={a:p};const h=setup();await denied(()=>h.run({payload:p}));});
for(const changes of [{revokedAt:NOW},{active:false},{suspended:true},{authVersion:9},{role:'owner'},{shopCode:'foreign-shop'},{validUntil:NOW},{membershipId:'not-uuid'}])test('membership denied '+JSON.stringify(changes),async()=>{const h=setup({row:{...ROW,...changes}});await denied(()=>h.run());assert.equal(h.worked,0);});
for(const changes of [{verified:false},{authVersion:7},{exp:NOW},{sub:'foreign-user'},{authVersion:0},{authVersion:'8'}])test('synthetic session denied '+JSON.stringify(changes),async()=>{const h=setup({session:{...SESSION,...changes}});await denied(()=>h.run());assert.equal(h.worked,0);});
test('member lookup exception sanitized and no work',async()=>{const h=setup({locker:()=>{throw Error('private SQL secrets')}});await denied(()=>h.run());assert.equal(h.worked,0);});
test('session verifier exception sanitized and no work',async()=>{const h=setup({reader:()=>{throw Error('secret issuer')}});await denied(()=>h.run());assert.equal(h.worked,0);});
test('missing QA opt-in denied',()=>assert.throws(()=>createV37QaAuthorizedReplayFence({environment:'isolated_qa',readVerifiedSession:()=>SESSION,lockMembershipRow:()=>ROW}),/CAR02_V37_QA_DENIED/));
test('real environment denied',()=>assert.throws(()=>createV37QaAuthorizedReplayFence({environment:'production',allowIsolatedQa:true,readVerifiedSession:()=>SESSION,lockMembershipRow:()=>ROW}),/CAR02_V37_QA_DENIED/));
test('clock exceptions denied',async()=>{const h=setup({clock:()=>{throw Error('secret clock')}});await denied(()=>h.run());});
test('synthetic ledger does not persist across separate instances',async()=>{const a=setup(),b=setup();await a.run();await b.run();assert.equal(a.worked,1);assert.equal(b.worked,1);});
