/** DPRO CAR02 V3.5: purely synthetic transaction-timing tests. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createV35QaStaffMutationGate,V35_MODE} from './car02-v35-tx-time-membership-isolated.mjs';
const NOW=1800000000,SHOP='qa-shop-alpha',SUB='staff-qa',MID='11111111-1111-4111-8111-111111111111';
const row={membershipId:MID,userSub:SUB,shopCode:SHOP,role:'staff',active:true,
 suspended:false,revokedAt:null,authVersion:3,validFrom:NOW-10,validUntil:NOW+600};
const actor=Object.freeze({verified:true,role:'staff',subject:'staff:'+SUB,shopCode:SHOP});
function harness({membership=row,actorValue=actor,reader,now=()=>NOW,shopCode=SHOP}={}){
 let reads=0,writes=0;
 const gate=createV35QaStaffMutationGate({environment:'isolated_qa',allowIsolatedQa:true,
  nowSeconds:now,lockMembershipRow:async request=>{
   reads++;return reader?reader(request):{lockHeld:true,rows:[membership]};
  }});
 return {get reads(){return reads},get writes(){return writes},
  run:({operation='report',a=actorValue,shop=shopCode,work}={})=>gate({actor:a,shopCode:shop,
    operation,work:work??(async()=>{writes++;return 'qa-write-result'})})};
}
const denied=async (h,opts)=>{await assert.rejects(()=>h.run(opts),e=>e?.code==='CAR02_V35_QA_DENIED');assert.equal(h.writes,0)};
test('isolated mode is never deployable',()=>{assert.equal(V35_MODE.deployable,false);assert.equal(V35_MODE.databaseConnected,false);assert.equal(V35_MODE.release,'NO_GO');});
for(const op of ['create','report','present','complete'])test('valid staff synthetic operation '+op,async()=>{
 const h=harness();assert.equal(await h.run({operation:op}),'qa-write-result');assert.equal(h.reads,1);assert.equal(h.writes,1);
});
for(const role of ['staff','owner'])test('exact stored role works '+role,async()=>{
 const h=harness({membership:{...row,role},actorValue:{...actor,role}});assert.equal(await h.run(),'qa-write-result');
});
for(const invalid of [
 ['inactive',{active:false}],['suspended',{suspended:true}],['revoked',{revokedAt:NOW-1}],
 ['wrong shop',{shopCode:'another-shop'}],['wrong subject',{userSub:'another-staff'}],
 ['owner downgrade',{role:'owner'}],['revokedAt undefined',{revokedAt:undefined}],
 ['suspended missing',{suspended:undefined}],['active truthy',{active:1}],
 ['unknown role',{role:'admin'}],['bad membership UUID',{membershipId:'1'}],
 ['authVersion missing',{authVersion:undefined}],['authVersion zero',{authVersion:0}],
 ['authVersion float',{authVersion:1.5}],['validFrom missing',{validFrom:undefined}],
 ['validUntil missing',{validUntil:undefined}],['validUntil equal',{validUntil:NOW-10}],
 ['starts tomorrow',{validFrom:NOW+1}],['expires now',{validUntil:NOW}],
 ['foreign membership tenant',{shopCode:'qa-shop-beta'}]
])test('denies invalid row: '+invalid[0],async()=>denied(harness({membership:{...row,...invalid[1]}})));
for(const val of [[],[row,row],null,undefined,{},'invalid'])test('denies corrupt rows '+String(val),async()=>denied(harness({reader:()=>({lockHeld:true,rows:val})})));
for(const val of [false,undefined,'yes',null,1])test('requires simulated lock flag '+String(val),async()=>denied(harness({reader:()=>({lockHeld:val,rows:[row]})})));
for(const a of [null,{}, {...actor,verified:false},{...actor,role:'customer'},
 {...actor,subject:'line:'+SUB},{...actor,subject:'staff:'},
 {...actor,subject:'staff:another'}, {...actor,shopCode:'qa-shop-beta'}])
 test('rejects invalid actor '+JSON.stringify(a),async()=>denied(harness({actorValue:a})));
for(const op of ['decide','delete','history','',null,undefined])test('rejects operation '+String(op),async()=>{
 const h=harness();await denied(h,{operation:op??null});assert.equal(h.reads,0);
});
test('missing work denies without read',async()=>{const h=harness();
 await denied(h,{work:'not a function'});assert.equal(h.reads,0);
});
test('callback error does not leak internal secret',async()=>{const h=harness({reader:()=>{throw Error('private-secret-db-address')}});
 await assert.rejects(()=>h.run(),e=>e.message==='CAR02_V35_QA_DENIED');assert.equal(h.writes,0);
});
test('invalid clock stops synthetic mutation',async()=>denied(harness({now:()=>NaN})));
test('clock callback error stops synthetic mutation',async()=>denied(harness({now:()=>{throw Error('private clock')}})));
test('isolated mode cannot be omitted',()=>assert.throws(()=>createV35QaStaffMutationGate({lockMembershipRow:async()=>({})}),/CAR02_V35_QA_DENIED/));
test('isolated QA opt in required',()=>assert.throws(()=>createV35QaStaffMutationGate({environment:'isolated_qa',lockMembershipRow:async()=>({})}),/CAR02_V35_QA_DENIED/));
test('bad lock callback config denied',()=>assert.throws(()=>createV35QaStaffMutationGate({environment:'isolated_qa',allowIsolatedQa:true,lockMembershipRow:null}),/CAR02_V35_QA_DENIED/));
test('bad clock callback config denied',()=>assert.throws(()=>createV35QaStaffMutationGate({environment:'isolated_qa',allowIsolatedQa:true,lockMembershipRow:async()=>({}),nowSeconds:22}),/CAR02_V35_QA_DENIED/));
test('synthetic revocation after previous success prevents next write',async()=>{
 let r={...row};let count=0;
 const h=harness({reader:()=>({lockHeld:true,rows:[r]})});
 assert.equal(await h.run({work:()=>{count++;return 'ok'}}),'ok');
 r={...r,revokedAt:NOW};await assert.rejects(()=>h.run({work:()=>{count++;return 'bad'}}),/CAR02_V35_QA_DENIED/);
 assert.equal(count,1);assert.equal(h.reads,2);
});
test('role downgrade after authentication but before synthetic commit fails',async()=>{
 const h=harness({membership:{...row,role:'staff'},actorValue:{...actor,role:'owner'}});await denied(h);
});
test('simulated transaction recheck uses server identity, not caller-supplied metadata',async()=>{
 const h=harness({reader:q=>{assert.deepEqual(q,{userSub:SUB,shopCode:SHOP,operation:'report'});assert(Object.isFrozen(q));
  return {lockHeld:true,rows:[row]};}});
 assert.equal(await h.run(),'qa-write-result');
});
test('snapshot passed to fake work is minimal and frozen',async()=>{
 const h=harness();const output=await h.run({work:ctx=>{assert(Object.isFrozen(ctx));
  assert.deepEqual(ctx,{shopCode:SHOP,subject:'staff:'+SUB,role:'staff',operation:'report'});
  return 'qa-pass';}});assert.equal(output,'qa-pass');
});
test('server lookup occurs again for each synthetic mutation',async()=>{
 let count=0;const h=harness({reader:()=>{count++;return {lockHeld:true,rows:[row]}}});
 await h.run();await h.run();assert.equal(count,2);assert.equal(h.writes,2);
});
test('callback must not recheck from a cached success',async()=>{
 let r={...row};const h=harness({reader:()=>({lockHeld:true,rows:[r]})});
 await h.run();r={...r,active:false};await assert.rejects(()=>h.run(),/CAR02_V35_QA_DENIED/);
 assert.equal(h.writes,1);
});
