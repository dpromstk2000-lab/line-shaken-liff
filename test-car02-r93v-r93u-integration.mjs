import test from 'node:test';
import assert from 'node:assert/strict';
import {createCar02R93VIsolatedIdempotencyBridge as makeBridge} from './car02-r93v-idempotency-http-bridge-isolated.mjs';
import {createCar02R93UIsolatedStagingRouter as makeRouter} from './car02-r93u-staging-upload-route-isolated.mjs';
const O='22222222-2222-4222-8222-222222222222';
const R='33333333-3333-4333-8333-333333333333';
const P='77777777-7777-4777-8777-777777777777';
const K='44444444-4444-4444-8444-444444444444';
const SHOP='street_house_kitsuki';
const ORIGIN='https://qa.example.test';
const URL=`${ORIGIN}/functions/v1/dpro-car02-stage/api/car02/uploads/${O}/${R}`;
const bytes=new Uint8Array([137,80,78,71,13,10,26,10,1,2,3,4]);
const HEADERS={origin:ORIGIN,authorization:'Bearer isolated-test-not-live',
 'content-type':'image/png','idempotency-key':K};
function app({gate=true}={}){
 const calls={business:0,auth:0,upload:0,create:0};
 const bridge=makeBridge({environment:'isolated_qa',dbName:'car02_r93q_qa_ci',shopCode:SHOP,
  releaseEnabled:async()=>gate,origins:[ORIGIN],
  authenticate:async()=>{calls.auth++;return {verified:true,shopCode:SHOP,role:'staff',
    subject:'staff:11111111-1111-4111-8111-111111111111'};},
  durableUpload:{upload:async x=>{calls.upload++;assert.equal(x.intentKey,K);return {
   photoId:P,state:'ready',mimeType:x.mimeType,byteSize:x.bytes.length};}}});
 const router=makeRouter({environment:'isolated_qa',dbName:'car02_r93q_qa_ci',
  reviewGate:async()=>gate,
  createUploadHandler:async()=>{calls.create++;return bridge;},
  createBusinessHandler:async()=>{calls.business++;return async()=>new Response('B');}});
 return {router,calls};
}
test('R93U prefixed upload -> R93V key -> original R82 -> durable port',async()=>{
 const {router,calls}=app();const result=await router(new Request(URL,{method:'POST',headers:HEADERS,body:bytes}));
 assert.equal(result.status,201);assert.equal((await result.json()).photoId,P);
 assert.equal(calls.upload,1);assert.equal(calls.auth,1);assert.equal(calls.business,0);
});
test('prefixed preflight passes Idempotency-Key without authenticating',async()=>{
 const {router,calls}=app();
 const result=await router(new Request(URL,{method:'OPTIONS',headers:{origin:ORIGIN,
  'access-control-request-method':'POST',
  'access-control-request-headers':'authorization, content-type, idempotency-key'}}));
 assert.equal(result.status,204);
 assert.match(result.headers.get('access-control-allow-headers'),/Idempotency-Key/);
 assert.equal(calls.auth,0);assert.equal(calls.upload,0);
});
test('closed outer gate blocks handler construction and body consumption',async()=>{
 const {router,calls}=app({gate:false});
 const request=new Request(URL,{method:'POST',headers:HEADERS,body:bytes});
 const result=await router(request);
 assert.equal(result.status,503);assert.equal(request.bodyUsed,false);
 assert.deepEqual(calls,{business:0,auth:0,upload:0,create:0});
});
test('oversized prefixed upload fails before authentication and durable port',async()=>{
 const {router,calls}=app();const b=new Uint8Array(5*1024*1024+1);
 const result=await router(new Request(URL,{method:'POST',headers:HEADERS,body:b}));
 assert.equal(result.status,413);assert.equal(calls.auth,0);assert.equal(calls.upload,0);
});
test('malformed key rejected after prefix normalization, before auth',async()=>{
 const {router,calls}=app();const result=await router(new Request(URL,{method:'POST',
  headers:{...HEADERS,'idempotency-key':'bad'},body:bytes}));
 assert.equal(result.status,400);assert.equal(calls.auth,0);assert.equal(calls.upload,0);
});
test('wrong route and legacy R51 path cannot become upload composition',async()=>{
 const {router,calls}=app();const wrong=await router(new Request(URL.replace('/uploads/','/notuploads/'),
  {method:'POST',headers:HEADERS,body:bytes}));
 assert.equal(wrong.status,404);assert.equal(calls.auth,0);assert.equal(calls.upload,0);
});
console.log('R93V_R93U_SOURCE_COMPOSITION_PASS');
