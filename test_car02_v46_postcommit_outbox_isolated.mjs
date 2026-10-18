import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createV46OutboxLab,V46_MODE} from './car02-v46-postcommit-outbox-isolated.mjs';
const QUOTE='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ORDER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const digest=createHash('sha256').update('v46 isolated intent').digest('hex');
const actor={verified:true,role:'staff',subject:'staff:qa-user'};
function fixture(override={}){const lab=createV46OutboxLab();const args={environment:'isolated_qa',allowIsolatedQa:true,
 shopCode:'SHOP_A',actor,requestKey:'v46-test-request-0001',intentDigest:digest,
 quoteId:QUOTE,workOrderId:ORDER,eventType:'quote_presented',channel:'LINE',...override};return {lab,args};}
const isDenied=e=>e?.code?.startsWith('CAR02_V46_');
const msg='provider-qa-only-00001';
const config=()=>({environment:'isolated_qa',allowIsolatedQa:true});
test('all release indicators preserve NO_GO without PostgreSQL, LINE or network',()=>{
 assert.equal(V46_MODE.deployable,false);assert.equal(V46_MODE.realDb,false);
 assert.equal(V46_MODE.realLine,false);assert.equal(V46_MODE.realNetwork,false);
 assert.equal(V46_MODE.exactlyOnceDeliveryProven,false);assert.equal(V46_MODE.release,'NO_GO');
});
test('new committed quote creates exactly one outbox row without sending',async()=>{
 const {lab,args}=fixture();const r=await lab.transact(args);assert.equal(r.mode,'new');
 const s=lab.inspect();assert.equal(s.outbox.length,1);assert.equal(s.outbox[0][1].deliveryStatus,'pending');
 assert.equal(s.orders.length,1);assert.deepEqual(s.receipts[0].steps,['BEGIN','COMMIT']);
});
test('exact replay does not create another outbox event',async()=>{
 const {lab,args}=fixture();const one=await lab.transact(args);const two=await lab.transact(args);
 assert.equal(two.mode,'replay');assert.equal(one.outboxKey,two.outboxKey);
 assert.equal(lab.inspect().outbox.length,1);assert.equal(lab.inspect().orders.length,1);
});
for(const faultAt of ['beforeInsert','afterInsert','beforeCommit']){
 test(`fault ${faultAt} rolls back the quote and pending outbox together`,async()=>{
  const {lab,args}=fixture({faultAt});await assert.rejects(()=>lab.transact(args),isDenied);
  assert.deepEqual(lab.inspect().orders,[]);assert.deepEqual(lab.inspect().outbox,[]);
  assert.deepEqual(lab.inspect().receipts[0].steps,['BEGIN','ROLLBACK']);
 });
}
for(const stage of ['afterInsert','beforeCommit']){
 test(`async rejection during ${stage} commits no notification`,async()=>{
  const {lab,args}=fixture({onStage:async x=>{if(x===stage)throw Error('simulated expiration');}});
  await assert.rejects(()=>lab.transact(args),isDenied);assert.equal(lab.inspect().outbox.length,0);
 });
 test(`outbox not visible to dispatcher during ${stage} even before COMMIT`,async()=>{
  const {lab,args}=fixture({onStage:async x=>{if(x===stage){assert.equal(lab.inspect().outbox.length,0);}}});
  await lab.transact(args);assert.equal(lab.inspect().outbox.length,1);
 });
}
for(const override of [
 {environment:'production'},{allowIsolatedQa:false},{shopCode:''},{shopCode:' SHOP_A'},
 {actor:{verified:false,role:'staff',subject:'staff:qa-user'}},{actor:{verified:true,role:'customer',subject:'qa'}},
 {actor:{verified:true,role:'staff',subject:''}},{requestKey:'short'},
 {intentDigest:'bad'},{quoteId:'bad'},{workOrderId:'bad'},{eventType:'send_now'},
 {channel:'EMAIL'},{onStage:1},{faultAt:'network'}
]){
 test(`fail-closed invalid write: ${JSON.stringify(override).slice(0,90)}`,async()=>{
  const {lab,args}=fixture(override);await assert.rejects(()=>lab.transact(args),isDenied);
  assert.equal(lab.inspect().outbox.length,0);
 });
}
for(const collision of [
 {intentDigest:'0'.repeat(64)},{quoteId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},
 {workOrderId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'}
]){
 test(`replay with changed intent or target is rejected: ${Object.keys(collision)[0]}`,async()=>{
  const {lab,args}=fixture();await lab.transact(args);
  await assert.rejects(()=>lab.transact({...args,...collision}),isDenied);
  assert.equal(lab.inspect().outbox.length,1);
 });
}
test('different operation key cannot reuse same outbox deduplication key',async()=>{
 const {lab,args}=fixture();await lab.transact(args);
 await assert.rejects(()=>lab.transact({...args,requestKey:'v46-test-request-0002'}),isDenied);
 assert.equal(lab.inspect().outbox.length,1);
});
test('concurrent in-flight replay cannot create duplicate write',async()=>{
 const {lab,args}=fixture();let release;const barrier=new Promise(ok=>{release=ok});
 let entered;const gate=new Promise(ok=>{entered=ok});
 const p=lab.transact({...args,onStage:async()=>{entered();await barrier;}});await gate;
 await assert.rejects(()=>lab.transact(args),isDenied);release();await p;
 assert.equal(lab.inspect().outbox.length,1);
});
test('claim only possible after commit, and only once per pending event',async()=>{
 const {lab,args}=fixture();const eventKey=`car02:quote:${QUOTE}:presented`;
 assert.throws(()=>lab.claim({...config(),shopCode:'SHOP_A',dedupeKey:eventKey,operatorId:'worker1'}),isDenied);
 await lab.transact(args);const a=lab.claim({...config(),shopCode:'SHOP_A',dedupeKey:eventKey,operatorId:'worker1'});
 assert.ok(a.claimToken.startsWith('v46-lease-'));
 assert.throws(()=>lab.claim({...config(),shopCode:'SHOP_A',dedupeKey:eventKey,operatorId:'worker2'}),isDenied);
});
test('shop scope blocks cross-tenant claim',async()=>{
 const {lab,args}=fixture();const r=await lab.transact(args);
 assert.throws(()=>lab.claim({...config(),shopCode:'SHOP_B',dedupeKey:r.outboxKey,operatorId:'worker1'}),isDenied);
 assert.equal(lab.inspect().outbox[0][1].deliveryStatus,'pending');
});
test('successful provider acknowledgement sets sent once',async()=>{
 const {lab,args}=fixture();const r=await lab.transact(args);
 const lease=lab.claim({...config(),shopCode:args.shopCode,dedupeKey:r.outboxKey,operatorId:'worker1'});
 let sends=0;const a=await lab.dispatch({...config(),claim:lease,send:async()=>{sends++;return{accepted:true,providerMessageId:msg}}});
 assert.equal(a.status,'sent');assert.equal(sends,1);assert.equal(lab.inspect().outbox[0][1].deliveryStatus,'sent');
 await assert.rejects(()=>lab.dispatch({...config(),claim:lease,send:async()=>{sends++;return{accepted:true,providerMessageId:msg}}}),isDenied);
 assert.equal(sends,1);
});
for(const resultType of ['throw','timeout','ambiguous','wrong-shape','no-provider-id']){
 test(`uncertain provider outcome '${resultType}' quarantines without automatic retry`,async()=>{
  const {lab,args}=fixture();const r=await lab.transact(args);
  const lease=lab.claim({...config(),shopCode:args.shopCode,dedupeKey:r.outboxKey,operatorId:'worker1'});
  let sends=0;
  const send=async()=>{sends++;if(resultType==='throw')throw Error('provider declined? unknown');
   if(resultType==='timeout')return undefined;
   if(resultType==='ambiguous')return{accepted:false,providerMessageId:msg};
   if(resultType==='wrong-shape')return[];
   return {accepted:true};};
  const x=await lab.dispatch({...config(),claim:lease,send});assert.equal(x.status,'unknown');
  assert.equal(lab.inspect().outbox[0][1].deliveryStatus,'unknown');
  assert.throws(()=>lab.claim({...config(),shopCode:args.shopCode,dedupeKey:r.outboxKey,operatorId:'worker2'}),isDenied);
  await assert.rejects(()=>lab.dispatch({...config(),claim:lease,send}),isDenied);assert.equal(sends,1);
 });
}
test('wrong tenant or stale claim token cannot dispatch',async()=>{
 const {lab,args}=fixture();const r=await lab.transact(args);
 const lease=lab.claim({...config(),shopCode:args.shopCode,dedupeKey:r.outboxKey,operatorId:'worker1'});
 let calls=0;const send=async()=>{calls++;return{accepted:true,providerMessageId:msg}};
 for(const altered of [{...lease,shopCode:'SHOP_B'},{...lease,claimToken:'old-token'},
  {...lease,dedupeKey:'unknown-event'}])await assert.rejects(()=>lab.dispatch({...config(),claim:altered,send}),isDenied);
 assert.equal(calls,0);
});
for(const override of [{manualReviewConfirmedNotDelivered:false},{shopCode:'SHOP_B'},
 {dedupeKey:'wrong'}]){
 test(`uncertain state cannot be released without matching confirmed review: ${JSON.stringify(override)}`,async()=>{
 const {lab,args}=fixture();const r=await lab.transact(args);
 const lease=lab.claim({...config(),shopCode:args.shopCode,dedupeKey:r.outboxKey,operatorId:'worker1'});
 await lab.dispatch({...config(),claim:lease,send:async()=>{throw Error('unknown')}});
 assert.throws(()=>lab.reconcileUnknown({...config(),shopCode:'SHOP_A',dedupeKey:r.outboxKey,
 manualReviewConfirmedNotDelivered:true,...override}),isDenied);
 });
}
test('manual confirmation can reopen uncertain row; not an automatic guarantee',async()=>{
 const {lab,args}=fixture();const r=await lab.transact(args);
 const lease=lab.claim({...config(),shopCode:args.shopCode,dedupeKey:r.outboxKey,operatorId:'worker1'});
 await lab.dispatch({...config(),claim:lease,send:async()=>{throw Error('unknown')}});
 const s=lab.reconcileUnknown({...config(),shopCode:'SHOP_A',dedupeKey:r.outboxKey,manualReviewConfirmedNotDelivered:true});
 assert.equal(s.status,'pending');assert.equal(lab.inspect().outbox[0][1].attempts,1);
});
test('inspection snapshots cannot alter outbox',async()=>{
 const {lab,args}=fixture();await lab.transact(args);const snapshot=lab.inspect();
 snapshot.outbox[0][1].deliveryStatus='sent';assert.equal(lab.inspect().outbox[0][1].deliveryStatus,'pending');
});
test('no dispatch capability exists inside transaction arguments',async()=>{
 const {lab,args}=fixture();let sendCalls=0;
 await lab.transact({...args,send:async()=>{sendCalls++}});
 assert.equal(sendCalls,0);assert.equal(lab.inspect().outbox[0][1].deliveryStatus,'pending');
});
test('bad scope and mode deny dispatch/reconciliation',async()=>{
 const {lab,args}=fixture();const r=await lab.transact(args);
 assert.throws(()=>lab.claim({environment:'production',allowIsolatedQa:true,shopCode:'SHOP_A',dedupeKey:r.outboxKey,operatorId:'worker1'}),isDenied);
 assert.throws(()=>lab.reconcileUnknown({...config(),shopCode:'SHOP_A',dedupeKey:r.outboxKey,manualReviewConfirmedNotDelivered:true}),isDenied);
});
