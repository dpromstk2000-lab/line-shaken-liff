import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildR93WDurableEnvelope as envelope,createR93WIsolatedDurableHttpPort as make,R93W_CONTRACT as CONTRACT} from './car02-r93w-durable-http-reservation-isolated.mjs';
const SHOP='street_house_kitsuki',DB='car02_r93q_qa_ci';
const O='22222222-2222-4222-8222-222222222222',R='33333333-3333-4333-8333-333333333333';
const KEY='44444444-4444-4444-8444-444444444444';
const actor={verified:true,shopCode:SHOP,role:'staff',subject:'staff:11111111-1111-4111-8111-111111111111'};
const png=Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3,4]);
const jpeg=Uint8Array.from([255,216,255,224,0,1,2,3]);
const webp=Uint8Array.from([82,73,70,70,4,0,0,0,87,69,66,80,1]);
const base=()=>({actor:{...actor},shop:SHOP,orderId:O,reportId:R,intentKey:KEY,mimeType:'image/png',bytes:png});
for(const [mime,bytes,ext] of [['image/png',png,'png'],['image/jpeg',jpeg,'jpg'],['image/webp',webp,'webp']]){
 test('correct deterministic envelope for '+mime,()=>{
  const v=envelope({...base(),mimeType:mime,bytes});
  assert.equal(v.path,`${SHOP}/${O}/${R}/${KEY}.${ext}`);
  assert.equal(v.sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.equal(v.byteSize,bytes.length);assert.equal(v.bucket,'ksh-car02-private-photos');
  assert.ok(Object.isFrozen(v));assert.ok(Object.isFrozen(v.actor));
 });
}
for(const [name,edit] of [
 ['shop mismatch',v=>v.shop='other_shop'],['missing order',v=>v.orderId='bad'],
 ['report malformed',v=>v.reportId='x'],['missing key',v=>v.intentKey=''],
 ['unverified actor',v=>v.actor.verified=false],['actor shop mismatch',v=>v.actor.shopCode='other'],
 ['owner not staff-shaped',v=>v.actor.subject='owner:11111111-1111-4111-8111-111111111111'],
 ['unsupported actor',v=>v.actor.role='system'],['bad mime',v=>v.mimeType='image/gif'],
 ['spoof PNG as JPEG',v=>v.mimeType='image/jpeg'],['spoof WEBP as PNG',v=>v.bytes=webp],
 ['tiny file',v=>v.bytes=Uint8Array.from([137,80,78])],
 ['too large',v=>v.bytes=new Uint8Array(5*1024*1024+1)],
 ['not uint8',v=>v.bytes='bad'],['suspicious scope',v=>v.shop='shop/../evil'],
 ['missing actor',v=>delete v.actor],['tampered key',v=>v.intentKey=KEY+'%2f'],
 ]){
 test('invalid input denied without DB: '+name,()=>{let v=base();edit(v);assert.throws(()=>envelope(v));});
}
for(const change of [{environment:'production'},{dbName:'production'},{shopCode:'bad shop'},
 {intents:{}},{intents:{reserve:undefined}}]){
 test('constructor fail closed '+JSON.stringify(Object.keys(change)),()=>{
  assert.throws(()=>make({environment:'isolated_qa',dbName:DB,shopCode:SHOP,intents:{reserve:async()=>{}},...change}));
 });
}
test('R93W calls durable port with exact envelope, then does not falsely acknowledge READY',async()=>{
 let calls=0,stored;
 const p=make({environment:'isolated_qa',dbName:DB,shopCode:SHOP,intents:{reserve:async x=>{calls++;stored=x;
  return {photoId:'77777777-7777-4777-8777-777777777777',state:'pending',action:'VERIFY_STORAGE_OR_COMPENSATE'};}}});
 await assert.rejects(p.upload(base()),{code:'R93W_STORAGE_AND_READY_PROOF_NOT_CONNECTED'});
 assert.equal(calls,1);assert.equal(stored.intentKey,KEY);
});
test('even an already-ready DB receipt cannot be HTTP-success without Storage proof',async()=>{
 const p=make({environment:'isolated_qa',dbName:DB,shopCode:SHOP,intents:{reserve:async()=>({photoId:'77777777-7777-4777-8777-777777777777',state:'ready',action:'DO_NOT_REUPLOAD'})}});
 await assert.rejects(p.upload(base()),{code:'R93W_STORAGE_AND_READY_PROOF_NOT_CONNECTED'});
});
test('malformed durable DB acknowledgement is not accepted',async()=>{
 const p=make({environment:'isolated_qa',dbName:DB,shopCode:SHOP,intents:{reserve:async()=>({photoId:'no-id',state:'ready',action:'DO_NOT_REUPLOAD'})}});
 await assert.rejects(p.upload(base()),{code:'R93W_INVALID_DURABLE_RESERVATION'});
});
test('bad input does not invoke durable DB port',async()=>{
 let hits=0;const p=make({environment:'isolated_qa',dbName:DB,shopCode:SHOP,intents:{reserve:async()=>{hits++;}}});
 await assert.rejects(p.upload({...base(),bytes:new Uint8Array(0)}));assert.equal(hits,0);
});
test('R93S errors propagate as generic failure; never trigger direct delete',async()=>{
 const p=make({environment:'isolated_qa',dbName:DB,shopCode:SHOP,intents:{reserve:async()=>{throw Error('DATABASE_DOWN')}}});
 await assert.rejects(p.upload(base()),/DATABASE_DOWN/);
});
test('contract never approves live upload, deploy, or migration',()=>{
 assert.equal(CONTRACT.productionReady,false);assert.equal(CONTRACT.liveStorageOperations,false);
 assert.equal(CONTRACT.neverReturnsHttp201,true);assert.equal(CONTRACT.releaseDecision,'NO_GO');
 assert.equal(CONTRACT.migrationDecision,'HOLD');assert.equal(CONTRACT.readyProofConnected,false);
});
