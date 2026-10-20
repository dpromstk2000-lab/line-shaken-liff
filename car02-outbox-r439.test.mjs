import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CAR02_V439_RELEASE_LOCK,CAR02_V439_CLAIM_SQL,CAR02_V439_FINISH_SQL,createCar02OfflineOutboxR439} from './car02-outbox-r439.mjs';
const shop='qa_shop_a',other='qa_shop_b';
const eventId='00000000-0000-0000-0000-000000004399';
const orderId='00000000-0000-0000-0000-000000004381';
const token='00000000-0000-0000-0000-000000004398';
const ackId='00000000-0000-0000-0000-000000004397';
const payload={shopCode:shop,eventType:'synthetic_version_touch',orderId};
function setup({exists=true,ack='confirmed',malformedPayload=false,missingAck=false,
   invalidToken=false,claimError=false,finishError=false,brokenFinish=false,
   wrongShop=false,doubleClaim=false,wrongAckId=false}={}) {
 const logs=[];let sent=0;
 const store={query:async(sql,args)=>{
   logs.push({sql,args});
   if(sql===CAR02_V439_CLAIM_SQL){
     if(claimError)throw Error('claim database unavailable');
     if(!exists)return {rows:[]};
     if(doubleClaim)return {rows:[{event_id:eventId,payload},{event_id:eventId,payload}]};
     return {rows:[{event_id:eventId,payload:wrongShop?{...payload,shopCode:other}:malformedPayload?{...payload,secret:'x'}:payload}]};
   }
   if(sql===CAR02_V439_FINISH_SQL){
     if(finishError)throw Error('lost final acknowledgement');
     return {rows:[{completed:!brokenFinish}]};
   }
   throw Error('UNREVIEWED_SQL');
 }};
 const sendSynthetic=async(event)=>{
  sent++;assert.equal(event.eventId,eventId);assert.equal(event.shopCode,shop);
  assert.ok(Object.isFrozen(event));assert.ok(Object.isFrozen(event.payload));
  if(ack==='throws')throw Error('offline provider may have already accepted message');
  if(ack==='unknown')return {confirmed:false};
  if(missingAck)return null;
  return {confirmed:true,eventId:wrongAckId?orderId:eventId,providerReceiptId:ackId};
 };
 const gate=createCar02OfflineOutboxR439({store,sendSynthetic,makeClaimToken:()=>invalidToken?'non-uuid':token});
 return {gate,logs,get sent(){return sent}};
}
test('V439 source is explicitly locked and SQL is fixed server-side',()=>{
 assert.equal(CAR02_V439_RELEASE_LOCK,true);
 assert.equal(CAR02_V439_CLAIM_SQL,'SELECT event_id,payload FROM public.v439_qa_claim_next($1::text,$2::uuid)');
 assert.equal(CAR02_V439_FINISH_SQL,'SELECT public.v439_qa_finish($1::text,$2::uuid,$3::uuid,$4::text) AS completed');
 assert.throws(()=>createCar02OfflineOutboxR439(),/V439_REVIEW_CONFIG_REQUIRED/);
});
test('empty outbox returns idle and never sends',async()=>{
 const h=setup({exists:false});assert.deepEqual(await h.gate.dispatchOne(shop),{status:'idle'});
 assert.equal(h.sent,0);assert.equal(h.logs.length,1);
});
test('positive externally checked synthetic ACK -> one confirmed finish',async()=>{
 const h=setup();assert.deepEqual(await h.gate.dispatchOne(shop),{status:'delivered',eventId});
 assert.equal(h.sent,1);assert.equal(h.logs.length,2);
 assert.deepEqual(h.logs[0],{sql:CAR02_V439_CLAIM_SQL,args:[shop,token]});
 assert.deepEqual(h.logs[1],{sql:CAR02_V439_FINISH_SQL,args:[shop,eventId,token,'confirmed']});
});
test('provider transport error requires manual review, never blind retry',async()=>{
 const h=setup({ack:'throws'});assert.deepEqual(await h.gate.dispatchOne(shop),{status:'manual_review',eventId});
 assert.equal(h.sent,1);assert.deepEqual(h.logs[1].args,[shop,eventId,token,'uncertain']);
});
test('missing or explicitly unknown provider acknowledgement is not delivered',async()=>{
 for(const config of [{missingAck:true},{ack:'unknown'},{wrongAckId:true}]){
  const h=setup(config);assert.equal((await h.gate.dispatchOne(shop)).status,'manual_review');
  assert.equal(h.sent,1);assert.equal(h.logs[1].args[3],'uncertain');
 }
});
test('malformed payload is quarantined WITHOUT invoking mock transport',async()=>{
 const h=setup({malformedPayload:true});assert.equal((await h.gate.dispatchOne(shop)).status,'manual_review');
 assert.equal(h.sent,0);assert.equal(h.logs[1].args[3],'uncertain');
});
test('payload with incorrect tenant does not reach transport',async()=>{
 const h=setup({wrongShop:true});assert.equal((await h.gate.dispatchOne(shop)).status,'manual_review');
 assert.equal(h.sent,0);
});
test('unknown claim token, invalid shop and dangerous input never dispatch',async()=>{
 const h=setup({invalidToken:true});assert.equal((await h.gate.dispatchOne(shop)).status,'indeterminate');
 assert.equal(h.logs.length,0);
 for(const s of ['', ' bad', '../etc', ' '.repeat(257)]){
  const x=setup();assert.equal((await x.gate.dispatchOne(s)).status,'denied');
 }
});
test('claim transport exception gives indeterminate without any send',async()=>{
 const h=setup({claimError:true});assert.equal((await h.gate.dispatchOne(shop)).status,'indeterminate');
 assert.equal(h.sent,0);
});
test('multiple claimed events in one result fails closed before transport',async()=>{
 const h=setup({doubleClaim:true});assert.equal((await h.gate.dispatchOne(shop)).status,'indeterminate');
 assert.equal(h.sent,0);
});
test('finish transport exception never reports delivery even after mock ACK',async()=>{
 const h=setup({finishError:true});assert.deepEqual(await h.gate.dispatchOne(shop),{status:'indeterminate',eventId});
 assert.equal(h.sent,1);
});
test('DB reports finish rejected: indeterminate, not delivered',async()=>{
 const h=setup({brokenFinish:true});assert.equal((await h.gate.dispatchOne(shop)).status,'indeterminate');
});
test('repository original release lock must remain true and V439 detached',()=>{
 const original=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
 assert.match(original,/const\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/);
 assert.doesNotMatch(original,/car02-outbox-r439|v439_qa_/);
});
