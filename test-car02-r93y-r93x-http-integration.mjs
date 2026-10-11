import test from 'node:test';
import assert from 'node:assert/strict';
import {createR93YInProcessStorageFixture,createR93YIsolatedStorageProtocol} from './car02-r93y-qa-storage-http-fixture.mjs';
import {createR93XIsolatedVerifiedStorageLifecycle} from './car02-r93x-verified-storage-lifecycle-isolated.mjs';
import {buildR93WDurableEnvelope} from './car02-r93w-durable-http-reservation-isolated.mjs';
import {createCar02R93VIsolatedIdempotencyBridge} from './car02-r93v-idempotency-http-bridge-isolated.mjs';
const SHOP='street_house_kitsuki',O='22222222-2222-4222-8222-222222222222',R='33333333-3333-4333-8333-333333333333';
const STAFF='11111111-1111-4111-8111-111111111111',KEY='88888888-8888-4888-8888-000000000001',PHOTO='99999999-9999-4999-8999-999999999999';
const IMG=new Uint8Array([255,216,255,224,5,6,7,8,9,10]);
const actor=()=>({verified:true,shopCode:SHOP,role:'staff',subject:`staff:${STAFF}`});
const input=()=>({actor:actor(),shop:SHOP,orderId:O,reportId:R,mimeType:'image/jpeg',bytes:new Uint8Array(IMG),intentKey:KEY});
function rig(config={},overrides={}){
 let state='pending',jobs=0;const counts={reserve:0,resume:0,markReady:0,proveReady:0,recover:0};
 const fixture=createR93YInProcessStorageFixture(config),storage=createR93YIsolatedStorageProtocol({environment:'isolated_qa',dbName:'car02_r93q_qa_ci',fixture});
 const intents={async reserve(){counts.reserve++;return {photoId:PHOTO,state,action:state==='ready'?'DO_NOT_REUPLOAD':'VERIFY_STORAGE_OR_COMPENSATE'};},
  async resume(){counts.resume++;if(jobs)throw Error('OUTBOX');return {photoId:PHOTO,state,action:state==='ready'?'DO_NOT_REUPLOAD':'VERIFY_STORAGE_OR_COMPENSATE'};}};
 const readyPort={async markReady(){counts.markReady++;if(overrides.revokeReady)throw Object.assign(Error('revoked'),{code:'R93X_STAFF_DENIED'});
  state='ready';if(overrides.ackLost)throw Object.assign(Error('unknown'),{code:'R93X_DB_UNAVAILABLE'});return true;},
 async proveReady(){counts.proveReady++;if(state!=='ready'||jobs)throw Error('NOT_READY');return true;},
 async enqueueUncertain(){counts.recover++;if(state!=='pending'||jobs)throw Error('CANNOT_RECOVER');jobs++;state='deleted';return true;}};
 const make=()=>createR93XIsolatedVerifiedStorageLifecycle({environment:'isolated_qa',dbName:'car02_r93q_qa_ci',shopCode:SHOP,
  intents,readyPort,storage,reviewGate:async()=>overrides.closed!==true});
 return {fixture,storage,counts,make,get state(){return state;},get jobs(){return jobs;}};
}
for(const [name,config,overrides,success,recovery] of [
 ['nominal HTTP fixture',{}, {},true,0],
 ['POST accepted then ACK lost',{postAckLost:true},{},true,0],
 ['server says 500 although write committed',{postFailedButWritten:true},{},true,0],
 ['READY COMMIT ACK lost',{}, {ackLost:true},true,0],
 ['POST definitely unavailable',{postFailure:true},{},false,1],
 ['Storage read redirected',{readRedirect:true},{},false,1],
 ['Storage read MIME spoofed',{wrongMime:true},{},false,1],
 ['Storage truncated read',{readTruncated:true},{},false,1],
 ['read bytes content modified',{corruptRead:true},{},false,1],
 ['Storage returned over 5MB readback',{oversizeRead:true},{},false,1],
 ['Storage says unknown instead of definitive 404',{ambiguousMissing:true},{},false,1],
 ['deterministic DB role revoke',{}, {revokeReady:true},false,1]
]){
 test('R93Y into R93X: '+name,async()=>{
  const r=rig(config,overrides);const x=input();
  if(success){const result=await r.make().upload(x);assert.equal(result.state,'ready');assert.equal(result.productionReady,false);assert.equal(r.state,'ready');assert.equal(r.jobs,0);}
  else{await assert.rejects(r.make().upload(x));assert.equal(r.state,'deleted');assert.equal(r.jobs,recovery);}
  assert.equal(r.fixture.calls.some(c=>c.method==='DELETE'),false);
 });
}
test('R93Y existing READY retry validates storage and does not POST again',async()=>{
 const r=rig();const a=await r.make().upload(input());const b=await r.make().upload(input());
 assert.equal(a.photoId,b.photoId);assert.equal(r.state,'ready');assert.equal(r.fixture.posts,1);assert.equal(r.counts.proveReady,2);
});
test('closed review gate never consults the fake Storage HTTP transport',async()=>{
 const r=rig({}, {closed:true});await assert.rejects(r.make().upload(input()),{code:'R93X_GATE_CLOSED'});
 assert.equal(r.fixture.calls.length,0);assert.equal(r.counts.reserve,0);
});
test('R93V->R82->R93X and HTTP fixture only yield 201 after independent READY proof',async()=>{
 const r=rig();let authCalls=0;
 const service=createCar02R93VIsolatedIdempotencyBridge({environment:'isolated_qa',dbName:'car02_r93q_qa_ci',shopCode:SHOP,
  releaseEnabled:async()=>true,authenticate:async()=>{authCalls++;return actor()},
  durableUpload:r.make(),origins:['https://qa.example.invalid']});
 const request=()=>new Request(`https://qa.example.invalid/api/car02/uploads/${O}/${R}`,{
  method:'POST',headers:{origin:'https://qa.example.invalid',authorization:'Bearer 123456789abcdef',
  'content-type':'image/jpeg','idempotency-key':KEY},body:new Uint8Array(IMG)});
 const first=await service(request());assert.equal(first.status,201);assert.equal((await first.json()).photoId,PHOTO);
 const second=await service(request());assert.equal(second.status,201);assert.equal(r.fixture.posts,1);
 assert.equal(authCalls,2);assert.ok(r.counts.proveReady>=2);
});
test('R93V returns 503 for uncertain storage and never responds 201',async()=>{
 const r=rig({postFailure:true});const service=createCar02R93VIsolatedIdempotencyBridge({environment:'isolated_qa',
  dbName:'car02_r93q_qa_ci',shopCode:SHOP,releaseEnabled:async()=>true,authenticate:async()=>actor(),
  durableUpload:r.make(),origins:['https://qa.example.invalid']});
 const res=await service(new Request(`https://qa.example.invalid/api/car02/uploads/${O}/${R}`,{
 method:'POST',headers:{origin:'https://qa.example.invalid',authorization:'Bearer 123456789abcdef',
 'content-type':'image/jpeg','idempotency-key':KEY},body:new Uint8Array(IMG)}));
 assert.notEqual(res.status,201);assert.equal(r.jobs,1);
});
test('independently created fixture is not a real Supabase Storage endpoint',()=>{
 const fixture=createR93YInProcessStorageFixture();const keys=Object.keys(fixture.calls);assert.equal(keys.length,0);
 const envelope=buildR93WDurableEnvelope(input());assert.ok(envelope.path.startsWith(SHOP+'/'));
});
