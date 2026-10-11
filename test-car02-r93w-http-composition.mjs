import test from 'node:test';
import assert from 'node:assert/strict';
import {createR93WIsolatedDurableHttpPort} from './car02-r93w-durable-http-reservation-isolated.mjs';
import {createCar02R93VIsolatedIdempotencyBridge} from './car02-r93v-idempotency-http-bridge-isolated.mjs';
import {createCar02R93UIsolatedStagingRouter} from './car02-r93u-staging-upload-route-isolated.mjs';
const SHOP='street_house_kitsuki',DB='car02_r93q_qa_ci',ORIGIN='https://qa.example.test';
const O='22222222-2222-4222-8222-222222222222',R='33333333-3333-4333-8333-333333333333';
const KEY='44444444-4444-4444-8444-444444444444';
const ACTOR={verified:true,shopCode:SHOP,role:'staff',subject:'staff:11111111-1111-4111-8111-111111111111'};
const png=Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3,4]);
const url=`${ORIGIN}/functions/v1/dpro-car02-stage/api/car02/uploads/${O}/${R}`;
const hdr={origin:ORIGIN,'content-type':'image/png',authorization:'Bearer local-fake-token-12345','idempotency-key':KEY};
function build({gate=true,actor=ACTOR,record}={}){
 const usage={reserve:0,auth:0,business:0};const memory=new Map();
 const intents={reserve:async x=>{usage.reserve++;record?.(x);
  const prev=memory.get(x.intentKey);
  if(prev){if(prev.sha256!==x.sha256||prev.actor.subject!==x.actor.subject||prev.path!==x.path)
   throw Error('R93S_INTENT_REUSE_CONFLICT');return prev.response;}
  const response={photoId:'77777777-7777-4777-8777-777777777777',state:'pending',action:'VERIFY_STORAGE_OR_COMPENSATE'};
  memory.set(x.intentKey,{...x,response});return response;
 }};
 const port=createR93WIsolatedDurableHttpPort({environment:'isolated_qa',dbName:DB,shopCode:SHOP,intents});
 const bridge=createCar02R93VIsolatedIdempotencyBridge({environment:'isolated_qa',dbName:DB,
  shopCode:SHOP,releaseEnabled:async()=>gate,authenticate:async()=>{usage.auth++;return actor;},durableUpload:port,origins:[ORIGIN]});
 const route=createCar02R93UIsolatedStagingRouter({environment:'isolated_qa',dbName:DB,
  reviewGate:async()=>gate,createUploadHandler:async()=>bridge,
  createBusinessHandler:async()=>{usage.business++;return async()=>new Response('BUSINESS')}});
 return {route,usage,memory};
}
const post=(patch={},body=png,postUrl=url)=>new Request(postUrl,{method:'POST',headers:{...hdr,...patch},body});
test('real R93U→R93V→R82→R93W reserves durable intent but HTTP NEVER returns 201',async()=>{
 let envelope;const c=build({record:x=>envelope=x});const res=await c.route(post());
 assert.equal(res.status,503);assert.equal((await res.json()).code,'CAR02_PHOTO_UPLOAD_UNAVAILABLE');
 assert.equal(c.usage.reserve,1);assert.equal(c.usage.auth,1);assert.equal(c.usage.business,0);
 assert.equal(envelope.intentKey,KEY);assert.equal(envelope.shopCode,SHOP);
 assert.equal(envelope.path,`${SHOP}/${O}/${R}/${KEY}.png`);
});
test('same key same bytes arrives as the SAME immutable record (model test)',async()=>{
 const c=build();await c.route(post());await c.route(post());
 assert.equal(c.memory.size,1);assert.equal(c.usage.reserve,2);
});
test('same key different image must not produce a second record',async()=>{
 const c=build();await c.route(post());const changed=Uint8Array.from([...png,9]);
 const res=await c.route(post({},changed));assert.equal(res.status,503);assert.equal(c.memory.size,1);
});
test('missing key rejected before actor/DB and body read',async()=>{
 const c=build();const h={...hdr};delete h['idempotency-key'];
 const res=await c.route(new Request(url,{method:'POST',headers:h,body:png}));
 assert.equal(res.status,400);assert.equal(c.usage.auth,0);assert.equal(c.usage.reserve,0);
});
test('release gate closed: R93U rejects without building downstream deps',async()=>{
 const c=build({gate:false});const res=await c.route(post());assert.equal(res.status,503);
 assert.equal(c.usage.auth,0);assert.equal(c.usage.reserve,0);
});
test('revoked actor rejected without durable reserve',async()=>{
 const c=build({actor:{...ACTOR,verified:false}});const res=await c.route(post());
 assert.equal(res.status,401);assert.equal(c.usage.reserve,0);
});
test('wrong origin fails preflight before authentication or DB',async()=>{
 const c=build();const res=await c.route(post({origin:'https://evil.example.test'}));
 assert.equal(res.status,403);assert.equal(c.usage.reserve,0);
});
test('5MiB plus one rejected at isolated outer route without authentication',async()=>{
 const c=build();const big=new Uint8Array(5*1024*1024+1);big.set(png);
 const res=await c.route(post({},big));assert.equal(res.status,413);assert.equal(c.usage.auth,0);
});
test('unsupported fake image is rejected before durable reserve',async()=>{
 const c=build();const res=await c.route(post({},Uint8Array.from([1,2,3,4,5,6,7,8])));
 assert.equal(res.status,503);assert.equal(c.usage.reserve,0);
});
test('OPTIONS from browser passes CORS with key header without DB',async()=>{
 const c=build();const res=await c.route(new Request(url,{method:'OPTIONS',headers:{origin:ORIGIN,
  'access-control-request-method':'POST','access-control-request-headers':'authorization, content-type, idempotency-key'}}));
 assert.equal(res.status,204);assert.equal(c.usage.reserve,0);assert.equal(c.usage.auth,0);
});
test('business API remains a separate 32KiB path and never creates an upload',async()=>{
 const c=build();const target=`${ORIGIN}/functions/v1/dpro-car02-stage/api/car02`;
 const b=new Uint8Array(32769);const res=await c.route(new Request(target,{method:'POST',headers:{'content-type':'application/json'},body:b}));
 assert.equal(res.status,413);assert.equal(c.usage.business,0);assert.equal(c.usage.reserve,0);
});
test('legacy photo viewer cannot accidentally be interpreted as an upload',async()=>{
 const c=build();const res=await c.route(post({},png,`${ORIGIN}/functions/v1/dpro-car02-stage/api/car02/photos/${O}`));
 assert.equal(res.status,404);assert.equal(c.usage.reserve,0);
});
console.log('R93W_ISOLATED_HTTP_TO_DURABLE_PORT_PASS');
