import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {createV42OfflineSessionLab} from './car02-v42-signed-session-binding-isolated.mjs';
import {createV45InMemoryRollbackLab,V45_MODE} from './car02-v45-rollback-unit-of-work-isolated.mjs';
const SUB='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const digest=createHash('sha256').update('v45 synthetic intent').digest('hex');
const keypair=generateKeyPairSync('ed25519');let now;
const lab=createV42OfflineSessionLab({privateKey:keypair.privateKey,publicKey:keypair.publicKey,kid:'v45-qa-key',issuer:'qa-issuer',audience:'qa-audience',nowSeconds:()=>now});
function fixture(overrides={}){
  now=1750000000;const store=createV45InMemoryRollbackLab();
  const membership={shop_code:'SHOP_A',user_sub:SUB,staff_role:'staff',active:true,auth_version:7};
  const token=lab.issue({sub:SUB,shopCode:'SHOP_A',role:'staff',authVersion:7,ttlSeconds:100});
  const args={environment:'isolated_qa',allowIsolatedQa:true,lab,token,shopCode:'SHOP_A',operation:'report',
    idempotencyKey:'v45-test-key-0001',intentDigest:digest,membership,mutationResult:{ok:true,bytes:1},...overrides};
  return{store,args,membership};
}
const denied=err=>/^CAR02_V45_/.test(err?.code);
async function rejectRollsBack(change,{preExisting=false}={}){
  const {store,args,membership}=fixture();
  if(preExisting)await store.execute(args);
  const before=store.inspect().records;
  args.idempotencyKey=preExisting?'v45-test-key-0001':'v45-test-key-0002';
  change(args,membership);
  await assert.rejects(()=>store.execute(args),denied);
  assert.deepEqual(store.inspect().records,before);
  const last=store.inspect().receipts.at(-1);assert.equal(last.outcome,'rolled_back');
  assert.deepEqual(last.steps,['BEGIN','ROLLBACK']);
}
test('non-deployable label is explicit, no real PG rollback proof',()=>{
  assert.equal(V45_MODE.deployable,false);assert.equal(V45_MODE.realDatabase,false);
  assert.equal(V45_MODE.realRollbackProven,false);assert.equal(V45_MODE.realRowLockProven,false);
  assert.equal(V45_MODE.externalSideEffectsReversible,false);assert.equal(V45_MODE.release,'NO_GO');
});
for(const operation of ['create','report','present','complete']){
 test(`successful ${operation} creates one committed synthetic ledger entry`,async()=>{
  const {store,args}=fixture({operation});const result=await store.execute(args);
  assert.equal(result.mode,'new');assert.equal(result.writeCount,1);assert.equal(store.inspect().records.length,1);
  assert.equal(store.inspect().receipts.at(-1).outcome,'committed');
  assert.deepEqual(store.inspect().receipts.at(-1).steps,['BEGIN','COMMIT']);
 });
 test(`idempotent ${operation} returns committed replay without new write`,async()=>{
  const {store,args}=fixture({operation});await store.execute(args);
  const receipt=await store.execute({...args,mutationResult:{ok:false}});
  assert.equal(receipt.mode,'replay');assert.equal(receipt.writeCount,0);
  assert.deepEqual(receipt.result,{ok:true,bytes:1});assert.equal(store.inspect().records.length,1);
 });
}
for(const stage of ['afterBegin','afterLock','afterRead','afterStage','beforeCommit']){
 test(`expiring in ${stage} never commits a staged mutation`,async()=>{
  await rejectRollsBack(args=>{args.hook=async s=>{if(s===stage)now+=100;};});
 });
 test(`revocation in ${stage} never publishes a synthetic mutation`,async()=>{
  await rejectRollsBack((args,row)=>{args.hook=async s=>{if(s===stage)row.active=false;};});
 });
 test(`role change in ${stage} never publishes a synthetic mutation`,async()=>{
  await rejectRollsBack((args,row)=>{args.hook=async s=>{if(s===stage)row.staff_role='owner';};});
 });
 test(`version change in ${stage} never publishes a synthetic mutation`,async()=>{
  await rejectRollsBack((args,row)=>{args.hook=async s=>{if(s===stage)row.auth_version=8;};});
 });
}
for(const faultAt of ['lock','read','mutate','commit']){
 test(`injected ${faultAt} fault rolls back and preserves ledger`,async()=>{
  await rejectRollsBack(args=>{args.faultAt=faultAt;});
 });
}
for(const corrupt of [{shop_code:''},{active:false},{auth_version:0},{active:true,auth_version:8},{user_sub:OTHER},{shop_code:'SHOP_B'},{staff_role:'owner'}]){
 test(`malformed membership fails closed: ${JSON.stringify(corrupt)}`,async()=>{
  await rejectRollsBack((args,row)=>{args.membership={...row,...corrupt};});
 });
}
for(const bad of [{environment:'production'},{allowIsolatedQa:false},{lab:null},{token:null},{operation:'delete'},{shopCode:'SHOP_B'},{idempotencyKey:'short'},{intentDigest:'0'.repeat(4)}]){
 test(`configuration rejects ${JSON.stringify(bad)} without commitment`,async()=>{
  const {store,args}=fixture(bad);await assert.rejects(()=>store.execute(args),denied);
  assert.equal(store.inspect().records.length,0);
 });
}
test('post-commit reader cannot mutate internal persisted state',async()=>{
 const {store,args}=fixture();await store.execute(args);const a=store.inspect();a.records[0][1].snapshot.ok=false;
 assert.equal(store.inspect().records[0][1].snapshot.ok,true);
});
test('tampered stored snapshot reauthorization fails after membership version change',async()=>{
 const {store,args,membership}=fixture();await store.execute(args);membership.auth_version=8;
 await assert.rejects(()=>store.execute(args),denied);
 assert.equal(store.inspect().records.length,1);assert.equal(store.inspect().receipts.at(-1).outcome,'rolled_back');
});
test('expired replay rolls back without leaking old cached success',async()=>{
 const {store,args}=fixture();await store.execute(args);now+=100;
 await assert.rejects(()=>store.execute(args),denied);
 assert.equal(store.inspect().records.length,1);
});
test('mutation staged before expiry is discarded, never committed',async()=>{
 const {store,args}=fixture();args.hook=async s=>{if(s==='afterStage')now+=100;};
 await assert.rejects(()=>store.execute(args),denied);
 assert.equal(store.inspect().records.length,0);
});
test('rollback failure stays unmistakably unconfirmed, no apparent success',async()=>{
 const {store,args}=fixture({faultAt:'rollback'});args.hook=async s=>{if(s==='afterStage')now+=100;};
 await assert.rejects(()=>store.execute(args),err=>err.code==='CAR02_V45_ROLLBACK_UNCONFIRMED');
 assert.equal(store.inspect().records.length,0);
 assert.equal(store.inspect().receipts.at(-1).outcome,'rollback_unconfirmed');
});
test('stale replays under different shop, user and role cannot bypass permissions',async()=>{
 const {store,args,membership}=fixture();await store.execute(args);
 for(const mutation of [()=>{args.shopCode='SHOP_B'},()=>{membership.user_sub=OTHER},()=>{membership.staff_role='owner'}]){
  const original={shopCode:args.shopCode,user_sub:membership.user_sub,staff_role:membership.staff_role};
  mutation();await assert.rejects(()=>store.execute(args),denied);
  Object.assign(membership,{user_sub:original.user_sub,staff_role:original.staff_role});args.shopCode=original.shopCode;
 }
 assert.equal(store.inspect().records.length,1);
});
test('hook failure is rolled back even after staged write',async()=>{
 await rejectRollsBack(args=>{args.hook=async s=>{if(s==='afterStage')throw Error('synthetic failure');};});
});
test('failed previous transaction cannot contaminate next good run',async()=>{
 const {store,args}=fixture();args.faultAt='commit';await assert.rejects(()=>store.execute(args),denied);
 delete args.faultAt;const ok=await store.execute(args);assert.equal(ok.mode,'new');assert.equal(store.inspect().records.length,1);
});

test('missing membership is rejected before transaction begins',async()=>{const {store,args}=fixture({membership:null});await assert.rejects(()=>store.execute(args),denied);assert.equal(store.inspect().receipts.length,0);});
