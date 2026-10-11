import test from 'node:test';
import assert from 'node:assert/strict';
import {createCar02R93VIsolatedIdempotencyBridge as create,R93V_CONTRACT} from './car02-r93v-idempotency-http-bridge-isolated.mjs';
const O='22222222-2222-4222-8222-222222222222';
const R='33333333-3333-4333-8333-333333333333';
const K='44444444-4444-4444-8444-444444444444';
const K2='55555555-5555-4555-8555-555555555555';
const PHOTO='77777777-7777-4777-8777-777777777777';
const SHOP='street_house_kitsuki';
const ORIGIN='https://qa.example.test';
const URL=`${ORIGIN}/api/car02/uploads/${O}/${R}`;
const png=new Uint8Array([137,80,78,71,13,10,26,10,9,8,7,6]);
const actor={verified:true,shopCode:SHOP,role:'staff',subject:'staff:11111111-1111-4111-8111-111111111111'};
const headers=(key=K, extra={})=>({origin:ORIGIN,'content-type':'image/png',
 authorization:'Bearer isolated-qa-test-not-live','idempotency-key':key,...extra});
function fixture({released=true,authenticated=actor,portResult={photoId:PHOTO,state:'ready',mimeType:'image/png',byteSize:png.length},portFn}={}){
 const count={gate:0,authenticate:0,upload:0}; const received=[];
 const handler=create({environment:'isolated_qa',dbName:'car02_r93q_qa_ci',shopCode:SHOP,
  origins:[ORIGIN],releaseEnabled:async()=>{count.gate++;return released;},
  authenticate:async()=>{count.authenticate++;return authenticated;},
  durableUpload:{upload:async x=>{count.upload++;received.push(x);return portFn?portFn(x):portResult;}}});
 return {handler,count,received};
}
const post=(handler,key=K,extra={})=>handler(new Request(URL,{method:'POST',headers:headers(key,extra),body:png}));
test('contract never enables production or includes live credentials',()=>{
 assert.equal(R93V_CONTRACT.productionReady,false);
 assert.equal(R93V_CONTRACT.deployAuthorized,false);
 assert.equal(R93V_CONTRACT.sourceR82Unchanged,true);
 assert.equal(R93V_CONTRACT.releaseDecision,'NO_GO');
 assert.equal(R93V_CONTRACT.migrationDecision,'HOLD');
});
test('invalid configuration rejects non-QA DB and missing dependencies',()=>{
 for(const change of [{environment:'production'}, {dbName:'postgres'}, {shopCode:'bad shop'},
  {durableUpload:null},{origins:['http://not-https.example.test']},{origins:[ORIGIN,ORIGIN]}]){
  const defaults={environment:'isolated_qa',dbName:'car02_r93q_qa_ci',shopCode:SHOP,
    origins:[ORIGIN],releaseEnabled:async()=>false,authenticate:async()=>actor,durableUpload:{upload:async()=>{}}};
  assert.throws(()=>create({...defaults,...change}));
 }
});
test('normal POST supplies exact validated key and verified actor to durable port',async()=>{
 const f=fixture();const res=await post(f.handler);assert.equal(res.status,201);
 const data=await res.json();assert.equal(data.photoId,PHOTO);assert.equal(data.state,'ready');
 assert.equal(f.count.authenticate,1);assert.equal(f.count.upload,1);
 const x=f.received[0];assert.equal(x.intentKey,K);assert.equal(x.shop,SHOP);
 assert.equal(x.orderId,O);assert.equal(x.reportId,R);assert.equal(x.actor.verified,true);
 assert.deepEqual(x.bytes,png);assert.equal(x.mimeType,'image/png');
 assert.equal(Object.isFrozen(x.actor),true);
});
test('uppercase idempotency key normalizes to canonical lowercase',async()=>{
 const f=fixture();assert.equal((await post(f.handler,K.toUpperCase())).status,201);
 assert.equal(f.received[0].intentKey,K);
});
test('two simultaneous requests cannot mix their actor-to-key associations',async()=>{
 const barrier=[];
 const f=fixture({portFn:async x=>{await new Promise(resolve=>setTimeout(resolve,2));return {...{photoId:PHOTO,state:'ready',mimeType:'image/png',byteSize:png.length}};}});
 const results=await Promise.all([post(f.handler,K),post(f.handler,K2)]);
 assert.deepEqual(results.map(r=>r.status),[201,201]);
 assert.deepEqual(new Set(f.received.map(x=>x.intentKey)),new Set([K,K2]));
});
test('R82 leaves upload incomplete when durable port returns pending',async()=>{
 const f=fixture({portResult:{photoId:PHOTO,state:'pending',mimeType:'image/png',byteSize:png.length}});
 const r=await post(f.handler);assert.equal(r.status,503);assert.equal(f.count.upload,1);
 assert.equal((await r.json()).ok,false);
});
test('durable conflict returns fail-closed generic R82 response, not success',async()=>{
 const f=fixture({portFn:async()=>{throw Error('R93S_INTENT_REUSE_CONFLICT');}});
 const r=await post(f.handler);assert.equal(r.status,503);
 const text=await r.text();assert.equal(text.includes('R93S_'),false);
});
test('missing and malformed keys blocked before authenticate, body or durable port',async()=>{
 for(const k of ['', 'abc',K+', '+K, 'x'.repeat(100), K+'\\n', '00000000-0000-0000-0000-000000000000extra']){
  const f=fixture();const r=await post(f.handler,k);assert.equal(r.status,400,k);
  assert.equal(f.count.authenticate,0);assert.equal(f.count.upload,0);
 }
 const f=fixture();const h=headers();delete h['idempotency-key'];
 const r=await f.handler(new Request(URL,{method:'POST',headers:h,body:png}));assert.equal(r.status,400);
 assert.equal(f.count.upload,0);
});
test('release gate blocks before actor, storage and reading body',async()=>{
 const f=fixture({released:false});
 const stream=new ReadableStream({start(c){c.enqueue(png);c.close();}});
 const req=new Request(URL,{method:'POST',headers:headers(),body:stream,duplex:'half'});
 const r=await f.handler(req);assert.equal(r.status,503);
 assert.equal(f.count.authenticate,0);assert.equal(f.count.upload,0);
 assert.equal(req.bodyUsed,false);
});
test('wrong origin and unknown route are rejected before authenticate',async()=>{
 const f=fixture();
 const badOrigin=await f.handler(new Request(URL,{method:'POST',headers:headers(K,{origin:'https://no.example.test'}),body:png}));
 assert.equal(badOrigin.status,403);
 const shadow=await f.handler(new Request(URL+'?x=1',{method:'POST',headers:headers(),body:png}));
 assert.equal(shadow.status,404);
 const prefixed=await f.handler(new Request(URL.replace('/api/car02/','/api/other/'),{method:'POST',headers:headers(),body:png}));
 assert.equal(prefixed.status,404);assert.equal(f.count.authenticate,0);assert.equal(f.count.upload,0);
});
test('verified identity cannot be forged via header or body',async()=>{
 for(const authenticated of [{...actor,verified:false},{...actor,shopCode:'other_shop'},{...actor,role:'viewer'},
  {...actor,subject:'actor:unverified'},null]){
  const f=fixture({authenticated});const r=await post(f.handler);assert.notEqual(r.status,201);
  assert.equal(f.count.upload,0);
 }
});
test('bearer auth, MIME and 5MiB cap still enforced by unchanged R82',async()=>{
 const f=fixture();
 for(const extra of [{authorization:'invalid'},{'content-type':'image/svg+xml'}, {'content-length':'5242881'}]){
  const r=await post(f.handler,K,extra);assert.notEqual(r.status,201);
 }
 assert.equal(f.count.upload,0);
});
test('preflight returns approved three headers without touching auth or port',async()=>{
 const f=fixture();const req=new Request(URL,{method:'OPTIONS',headers:{origin:ORIGIN,
  'access-control-request-method':'POST',
  'access-control-request-headers':'Authorization, Content-Type, Idempotency-Key'}});
 const r=await f.handler(req);assert.equal(r.status,204);
 assert.equal(r.headers.get('access-control-allow-headers'),'Authorization, Content-Type, Idempotency-Key');
 assert.equal(f.count.authenticate,0);assert.equal(f.count.upload,0);
});
test('preflight rejects extra headers, duplicate, missing, GET method, wrong origin',async()=>{
 const cases=[['POST','Authorization, Content-Type, X-Unsafe'],
  ['POST','Authorization, Content-Type, Idempotency-Key, X-Unsafe'],
  ['POST','Authorization, Content-Type'],
  ['POST','Authorization, Content-Type, Authorization'],
  ['GET','Authorization, Content-Type, Idempotency-Key']];
 const f=fixture();for(const [method,requested] of cases){
  const r=await f.handler(new Request(URL,{method:'OPTIONS',headers:{origin:ORIGIN,
   'access-control-request-method':method,'access-control-request-headers':requested}}));
  assert.equal(r.status,403,requested);
 }
 const outside=await f.handler(new Request(URL,{method:'OPTIONS',headers:{origin:'https://wrong.example.test',
  'access-control-request-method':'POST','access-control-request-headers':'Authorization, Content-Type, Idempotency-Key'}}));
 assert.equal(outside.status,403);assert.equal(f.count.authenticate,0);assert.equal(f.count.upload,0);
});
test('preflight also fails closed while locked',async()=>{
 const f=fixture({released:false});const r=await f.handler(new Request(URL,{method:'OPTIONS',headers:{origin:ORIGIN,
  'access-control-request-method':'POST','access-control-request-headers':'Authorization, Content-Type, Idempotency-Key'}}));
 assert.equal(r.status,503);assert.equal(f.count.authenticate,0);
});
test('methods other than POST/OPTIONS denied',async()=>{
 const f=fixture();const r=await f.handler(new Request(URL,{method:'GET',headers:headers()}));
 assert.equal(r.status,405);assert.equal(f.count.upload,0);
});
