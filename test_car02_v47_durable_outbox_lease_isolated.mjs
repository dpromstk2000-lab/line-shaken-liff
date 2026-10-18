import test from 'node:test';
import assert from 'node:assert/strict';
import {createV47OutboxLeaseLab,V47_MODE} from './car02-v47-durable-outbox-lease-isolated.mjs';
const config=()=>({environment:'isolated_qa',allowIsolatedQa:true});
const quoteId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const dedupeKey=`car02:quote:${quoteId}:presented`;
const original=()=>({shopCode:'SHOP_A',quoteId,workOrderId:'order-1',dedupeKey,
 deliveryStatus:'pending',claimToken:null,providerMessageId:null});
const fixture=()=>{const lab=createV47OutboxLeaseLab([original()]);return {lab,claimArgs:{...config(),shopCode:'SHOP_A',dedupeKey,workerId:'worker-1',nowMs:100000}};};
const denied=e=>e?.code?.startsWith('CAR02_V47_');
const accepted=async()=>({accepted:true,providerMessageId:'provider-msg-1'});
const data=(lab)=>lab.inspect().rows[0];
test('release remains NO_GO; no real PG or LINE assertions',()=>{
 assert.equal(V47_MODE.environment,'isolated_qa');assert.equal(V47_MODE.realPg,false);
 assert.equal(V47_MODE.realLease,false);assert.equal(V47_MODE.realLine,false);
 assert.equal(V47_MODE.deployable,false);assert.equal(V47_MODE.sqlApplied,false);
 assert.equal(V47_MODE.exactlyOnceDeliveryProven,false);assert.equal(V47_MODE.release,'NO_GO');
});
test('empty fixture has no automatically manufactured pending notification',()=>{
 assert.deepEqual(createV47OutboxLeaseLab().inspect().rows,[]);
});
for(const invalid of [null,{},[],{...original(),shopCode:''},{...original(),deliveryStatus:'sent'},
 {...original(),claimToken:'client-injected'},{...original(),providerMessageId:'client-injected'},
 {...original(),dedupeKey:'other'}, {...original(),workOrderId:''}]){
 test('invalid seeded outbox row fails closed '+JSON.stringify(invalid),()=>{
  assert.throws(()=>createV47OutboxLeaseLab([invalid]),denied);
 });
}
test('duplicate seeded notification key denied',()=>assert.throws(()=>createV47OutboxLeaseLab([original(),original()]),denied));
test('claim is fenced by shop and creates a unique persisted-intent token',()=>{
 const {lab,claimArgs}=fixture();assert.throws(()=>lab.claim({...claimArgs,shopCode:'SHOP_B'}),denied);
 const lease=lab.claim(claimArgs),r=data(lab);
 assert.equal(r.deliveryStatus,'sending');assert.equal(lease.expiresAtMs,160000);
 assert.equal(lease.claimToken,r.claimToken);assert.equal(r.claimOwner,'worker-1');
 assert.equal(r.attempts,1);assert.match(lease.claimToken,/^[0-9a-f-]{36}$/);
});
test('claim denied while same row is leased',()=>{
 const {lab,claimArgs}=fixture();lab.claim(claimArgs);
 assert.throws(()=>lab.claim({...claimArgs,workerId:'worker-2'}),denied);
});
for(const invalid of [{environment:'production'},{allowIsolatedQa:false},
 {workerId:''},{nowMs:0},{nowMs:1.5},{leaseMs:999},{leaseMs:300001},
 {shopCode:'SHOP_B'},{dedupeKey:'wrong-key'}]){
 test('bad claim request fails closed '+JSON.stringify(invalid),()=>{
  const {lab,claimArgs}=fixture();assert.throws(()=>lab.claim({...claimArgs,...invalid}),denied);
 });
}
test('successful provider acceptance sets sent only with original token',async()=>{
 const {lab,claimArgs}=fixture();const lease=lab.claim(claimArgs);
 const reply=await lab.dispatch({...config(),lease,send:accepted,nowMs:()=>100001});
 assert.equal(reply.status,'sent');assert.equal(data(lab).providerMessageId,'provider-msg-1');
 assert.equal(data(lab).claimToken,null);assert.equal(data(lab).leaseExpiresMs,null);
 assert.throws(()=>lab.claim(claimArgs),denied);
});
for(const candidate of [undefined,{accepted:false,providerMessageId:'provider-msg-1'},
 {accepted:true},{accepted:true,providerMessageId:''},[],{accepted:true,providerMessageId:42}]){
 test('ambiguous provider response quarantined '+JSON.stringify(candidate),async()=>{
  const {lab,claimArgs}=fixture();const lease=lab.claim(claimArgs);
  assert.equal((await lab.dispatch({...config(),lease,send:async()=>candidate,nowMs:()=>100100})).status,'unknown');
  assert.equal(data(lab).deliveryStatus,'unknown');assert.equal(data(lab).claimToken,null);
  assert.throws(()=>lab.claim({...claimArgs,nowMs:200000}),denied);
 });
}
test('provider throw or timeout-like error is uncertain, never auto-retried',async()=>{
 const {lab,claimArgs}=fixture();const lease=lab.claim(claimArgs);let attempts=0;
 await lab.dispatch({...config(),lease,send:async()=>{attempts++;throw Error('timeout');},nowMs:()=>100010});
 assert.equal(attempts,1);assert.equal(data(lab).deliveryStatus,'unknown');
 assert.throws(()=>lab.claim({...claimArgs,nowMs:180000}),denied);
});
test('expired before dispatch prevents provider invocation',async()=>{
 const {lab,claimArgs}=fixture();const lease=lab.claim(claimArgs);let sends=0;
 await assert.rejects(()=>lab.dispatch({...config(),lease,send:async()=>{sends++;return accepted();},nowMs:()=>160000}),denied);
 assert.equal(sends,0);assert.equal(data(lab).deliveryStatus,'unknown');
});
test('provider replies after expiry: do not mark sent or auto-retry',async()=>{
 const {lab,claimArgs}=fixture();const lease=lab.claim(claimArgs);let now=100010;
 const result=await lab.dispatch({...config(),lease,send:async()=>{now=160001;return accepted();},nowMs:()=>now});
 assert.equal(result.status,'unknown');assert.equal(data(lab).providerMessageId,null);
 assert.equal(data(lab).deliveryStatus,'unknown');
});
test('crashed worker expiry sweep quarantines; does not renew lease',()=>{
 const {lab,claimArgs}=fixture();const lease=lab.claim(claimArgs);
 assert.equal(lab.sweep({...config(),nowMs:159999}),0);
 assert.equal(lab.sweep({...config(),nowMs:160000}),1);
 assert.equal(lab.sweep({...config(),nowMs:170000}),0);
 assert.equal(data(lab).deliveryStatus,'unknown');
 assert.throws(()=>lab.claim({...claimArgs,nowMs:170001}),denied);
 assert.equal(data(lab).attempts,1);
});
for(const changed of [{shopCode:'SHOP_B'},{dedupeKey:'wrong'},{claimToken:'stale'},
 {workerId:'worker-2'},{expiresAtMs:160001}]){
 test('incorrect lease cannot invoke provider '+JSON.stringify(changed),async()=>{
  const {lab,claimArgs}=fixture();const lease=lab.claim(claimArgs);let sent=0;
  await assert.rejects(()=>lab.dispatch({...config(),lease:{...lease,...changed},
   send:async()=>{sent++;return accepted();},nowMs:()=>100001}),denied);
  assert.equal(sent,0);assert.equal(data(lab).deliveryStatus,'sending');
 });
}
test('same token cannot be concurrently dispatched by two callbacks',async()=>{
 const {lab,claimArgs}=fixture();const lease=lab.claim(claimArgs);
 let release;const wait=new Promise(resolve=>{release=resolve;});let sends=0;
 const first=lab.dispatch({...config(),lease,send:async()=>{sends++;await wait;return accepted();},nowMs:()=>100010});
 await assert.rejects(()=>lab.dispatch({...config(),lease,send:async()=>{sends++;return accepted();},nowMs:()=>100011}),denied);
 release();assert.equal((await first).status,'sent');assert.equal(sends,1);
});
test('late provider acknowledgement cannot overwrite swept lease state',async()=>{
 const {lab,claimArgs}=fixture();const lease=lab.claim(claimArgs);
 let release;const wait=new Promise(resolve=>{release=resolve;});
 const pending=lab.dispatch({...config(),lease,send:async()=>{await wait;return accepted();},nowMs:()=>100011});
 assert.equal(lab.sweep({...config(),nowMs:160001}),1);
 release();await assert.rejects(()=>pending,denied);
 assert.equal(data(lab).deliveryStatus,'unknown');assert.equal(data(lab).providerMessageId,null);
});
test('manual delivered confirmation records existing message, no resend',async()=>{
 const {lab,claimArgs}=fixture();const lease=lab.claim(claimArgs);
 await lab.dispatch({...config(),lease,send:async()=>undefined,nowMs:()=>100100});
 assert.equal(lab.reviewUnknown({...config(),shopCode:'SHOP_A',dedupeKey,
  reviewer:'reviewer-1',verifiedEvidence:'provider receipt ABCDEFG123',outcome:'confirmed_delivered',
  providerMessageId:'provider-msg-1',nowMs:300000}).status,'sent');
 assert.equal(data(lab).providerMessageId,'provider-msg-1');
 assert.throws(()=>lab.claim({...claimArgs,nowMs:300001}),denied);
});
test('manual confirmed-not-delivered may reopen for an explicit new claim',async()=>{
 const {lab,claimArgs}=fixture();const old=lab.claim(claimArgs);
 lab.sweep({...config(),nowMs:160001});
 lab.reviewUnknown({...config(),shopCode:'SHOP_A',dedupeKey,reviewer:'reviewer-1',
  verifiedEvidence:'verified absence from provider',outcome:'confirmed_not_delivered',nowMs:180000});
 const fresh=lab.claim({...claimArgs,nowMs:180001,workerId:'worker-2'});
 assert.notEqual(old.claimToken,fresh.claimToken);
 let called=0;
 await assert.rejects(()=>lab.dispatch({...config(),lease:old,send:async()=>{called++;return accepted();},nowMs:()=>180010}),denied);
 assert.equal(called,0);assert.equal(data(lab).claimToken,fresh.claimToken);
});
for(const invalid of [
 {reviewer:''},{verifiedEvidence:'short'},{outcome:'unknown'},{providerMessageId:'junk'},
 {shopCode:'SHOP_B'},{dedupeKey:'wrong'}, {nowMs:0},
 {outcome:'confirmed_delivered'},
]){
 test('manual reconciliation rejects unverifiable inputs '+JSON.stringify(invalid),async()=>{
 const {lab,claimArgs}=fixture();lab.claim(claimArgs);lab.sweep({...config(),nowMs:160000});
 const req={...config(),shopCode:'SHOP_A',dedupeKey,reviewer:'reviewer-1',
 verifiedEvidence:'verified not delivered audit',outcome:'confirmed_not_delivered',nowMs:170000,...invalid};
 assert.throws(()=>lab.reviewUnknown(req),denied);
 });
}
test('manual review denied on pending, sending and sent rows',async()=>{
 const req={...config(),shopCode:'SHOP_A',dedupeKey,reviewer:'reviewer-1',
 verifiedEvidence:'verified not delivered audit',outcome:'confirmed_not_delivered',nowMs:170000};
 const {lab,claimArgs}=fixture();assert.throws(()=>lab.reviewUnknown(req),denied);
 const lease=lab.claim(claimArgs);assert.throws(()=>lab.reviewUnknown(req),denied);
 await lab.dispatch({...config(),lease,send:accepted,nowMs:()=>100001});
 assert.throws(()=>lab.reviewUnknown(req),denied);
});
test('snapshots and source objects cannot mutate internal authorization data',()=>{
 const row=original(),lab=createV47OutboxLeaseLab([row]);row.shopCode='SHOP_EVIL';
 const s=lab.inspect();s.rows[0].deliveryStatus='sent';
 assert.equal(data(lab).deliveryStatus,'pending');
 assert.equal(data(lab).shopCode,'SHOP_A');
});
test('mode gates block production dispatch and sweep',async()=>{
 const {lab,claimArgs}=fixture();const lease=lab.claim(claimArgs);
 await assert.rejects(()=>lab.dispatch({environment:'production',allowIsolatedQa:true,lease,send:accepted,nowMs:()=>100001}),denied);
 assert.throws(()=>lab.sweep({environment:'production',allowIsolatedQa:true,nowMs:200000}),denied);
 assert.equal(data(lab).deliveryStatus,'sending');
});
