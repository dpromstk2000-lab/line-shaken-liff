import test from 'node:test';
import assert from 'node:assert/strict';
import {createCar02BrowserClientR49,Car02ClientError} from './car02-browser-client-r49.mjs';
const id='11111111-1111-4111-8111-111111111111';
const customerId='22222222-2222-4222-8222-222222222222';
const photoId='33333333-3333-4333-8333-333333333333';
const uuid='aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const ok=()=>json({ok:true,data:{id,version:2}});
let counter=0;
function build({kind='staff',enabled=true,fetchImpl=async()=>ok(),credentials}={}){
 return createCar02BrowserClientR49({apiOrigin:'https://car02-stage.invalid/',connectionEnabled:enabled,
  credentials:credentials??(async()=>({kind,token:'test-fake-token'})),fetchImpl,
  cryptoImpl:{randomUUID:()=>`${String(++counter).padStart(8,'0')}-2222-4222-8222-222222222222`}});
}
async function rejects(p,code){await assert.rejects(p,e=>e instanceof Car02ClientError&&e.code===code)}
test('R49 defaults CLOSED with no fetch or credentials access',async()=>{
 let n=0;const c=build({enabled:false,credentials:()=>{n++;throw Error('auth');},fetchImpl:()=>{n++;throw Error('fetch')}});
 await rejects(c.get(id),'CAR02_BROWSER_CONNECTION_CLOSED');assert.equal(n,0);
});
test('R49 HTTPS origin only; reject URL user info / query / path / hash',()=>{
 for(const apiOrigin of ['http://example.com','https://user:pw@example.com','https://example.com/path','https://example.com/?key=123','https://example.com/#secret'])assert.throws(()=>createCar02BrowserClientR49({apiOrigin,credentials:()=>({kind:'staff',token:'test-fake-token'})}));
});
test('R49 staff uses only Authorization, never stores or transmits a LINE token',async()=>{
 let captures=[];const c=build({fetchImpl:async(u,o)=>{captures.push([u,o]);return ok()}});
 await c.get(id);assert.equal(captures[0][0],`https://car02-stage.invalid/api/car02/${id}`);
 assert.equal(captures[0][1].headers.get('Authorization'),'Bearer test-fake-token');
 assert.equal(captures[0][1].headers.get('X-Line-ID-Token'),null);
 assert.equal(captures[0][1].credentials,'omit');assert.equal(captures[0][1].redirect,'error');assert.equal(captures[0][1].cache,'no-store');
});
test('R49 customer uses only X-Line-ID-Token',async()=>{
 let opts;const c=build({kind:'customer',fetchImpl:async(u,o)=>{opts=o;return ok()}});
 await c.get(id);assert.equal(opts.headers.get('Authorization'),null);assert.equal(opts.headers.get('X-Line-ID-Token'),'test-fake-token');
});
test('R49 auth missing, invalid or mixed kinds reject before fetch',async()=>{
 let called=0;for(const cred of [undefined,null,{kind:'admin',token:'test-fake-token'},{kind:'staff',token:'bad token'},{kind:'customer',token:''}]){
  const c=build({credentials:()=>cred,fetchImpl:async()=>{called++;return ok()}});
  await rejects(c.get(id),'CAR02_IDENTITY_REQUIRED');
 }assert.equal(called,0);
});
test('R49 GET history and GET item path exact and query free',async()=>{
 let paths=[];const c=build({fetchImpl:async(u)=>{paths.push(new URL(u).pathname);return ok()}});
 await c.get(id);await c.history(id);assert.deepEqual(paths,[`/api/car02/${id}`,`/api/car02/${id}/history`]);
});
test('R49 idempotency header is generated for mutations, and caller can retry with same key',async()=>{
 let calls=[];const c=build({fetchImpl:async(u,o)=>{calls.push({method:o.method,key:o.headers.get('Idempotency-Key'),body:JSON.parse(o.body)});return ok()}});
 const data={customerId:id,vehicleId:customerId};await c.create(data,'car02-explicit-unique-key');await c.create(data,'car02-explicit-unique-key');
 assert.equal(calls.length,2);assert.equal(calls[0].key,'car02-explicit-unique-key');assert.equal(calls[1].key,calls[0].key);
});
test('R49 reject invalid mutation fields and forged shop role before any I/O',async()=>{
 let called=0;const c=build({fetchImpl:async()=>{called++;return ok()}});
 await rejects(c.create({customerId:id,vehicleId:customerId,shopCode:'other-shop'}),'CAR02_INPUT_INVALID');
 await rejects(c.saveReport(id,{observation:'ok',photos:[],expectedVersion:1,role:'owner'}),'CAR02_INPUT_INVALID');
 await rejects(c.presentQuote(id,{items:[{name:'work',price:10,role:'owner'}],expectedVersion:2}),'CAR02_QUOTE_INVALID');
 assert.equal(called,0);
});
test('R49 decline requires reason, valid version, cannot impersonate',async()=>{
 const c=build();await rejects(c.decision(id,{decision:'declined',reason:'',expectedVersion:3}),'CAR02_DECISION_INVALID');
 await rejects(c.complete(id,{expectedVersion:0}),'CAR02_VERSION_REQUIRED');
});
test('R49 submits report quote decision complete payloads on exact API route',async()=>{
 const routes=[];const c=build({kind:'customer',fetchImpl:async(u,o)=>{routes.push({route:new URL(u).pathname,body:JSON.parse(o.body)});return ok()}});
 await c.saveReport(id,{observation:'点検済み',photos:[],expectedVersion:1});
 await c.presentQuote(id,{items:[{name:'点検',price:500}],expectedVersion:2});
 await c.decision(id,{decision:'approved',reason:'',expectedVersion:3});
 await c.complete(id,{expectedVersion:4});
 assert.deepEqual(routes.map(x=>x.route),['report','quote','decision','complete'].map(s=>`/api/car02/${id}/${s}`));
});
test('R49 server 401 code is sanitized and exposed without PII',async()=>{
 const c=build({fetchImpl:async()=>json({ok:false,code:'CAR02_UNAUTHORIZED',message:'VERY SECRET DB ERROR'},401)});
 await rejects(c.get(id),'CAR02_UNAUTHORIZED');
});
test('R49 unknown server error code never displayed',async()=>{
 const c=build({fetchImpl:async()=>json({ok:false,code:'TOKEN=secret'},500)});await rejects(c.get(id),'CAR02_HTTP_ERROR');
});
test('R49 rejects HTTP 200 failure envelope, wrong content type and oversize JSON',async()=>{
 await rejects(build({fetchImpl:async()=>json({ok:false,code:'CAR02_NOT_RELEASED'},200)}).get(id),'CAR02_NOT_RELEASED');
 await rejects(build({fetchImpl:async()=>new Response('OK',{headers:{'content-type':'text/plain'}})}).get(id),'CAR02_RESPONSE_INVALID');
 await rejects(build({fetchImpl:async()=>json({ok:true,data:'x'.repeat(256_001)})}).get(id),'CAR02_RESPONSE_TOO_LARGE');
});
test('R49 no automatic redirect following or credentials cookies',async()=>{
 let received;await build({fetchImpl:async(_,o)=>{received=o;return ok()}}).get(id);
 assert.equal(received.redirect,'error');assert.equal(received.credentials,'omit');assert.equal(received.referrerPolicy,'no-referrer');
});
test('R49 invalid order ids fail before fetching',async()=>{
 let n=0;const c=build({fetchImpl:async()=>{n++;return ok()}});await rejects(c.get('../thing'),'CAR02_ID_INVALID');await rejects(c.photo('bad-id'),'CAR02_ID_INVALID');assert.equal(n,0);
});
test('R49 private photo GET validates MIME and magic signature',async()=>{
 const png=new Uint8Array([137,80,78,71,13,10,26,10,12,34]);
 const c=build({kind:'customer',fetchImpl:async(u,o)=>{assert.equal(new URL(u).pathname,`/api/car02/photos/${photoId}`);assert.equal(o.headers.get('X-Line-ID-Token'),'test-fake-token');return new Response(png,{headers:{'content-type':'image/png','content-length':String(png.length)}})}});
 const result=await c.photo(photoId);assert.equal(result.mimeType,'image/png');assert.deepEqual(result.bytes,png);
});
test('R49 private photo invalid content refused',async()=>{
 const c=build({fetchImpl:async()=>new Response(new Uint8Array([1,2,3,4,5,6,7,8]),{headers:{'content-type':'image/png'}})});
 await rejects(c.photo(photoId),'CAR02_PHOTO_INVALID');
});
test('R49 private photo too-large content refused',async()=>{
 const c=build({fetchImpl:async()=>new Response(new Uint8Array(5*1024*1024+1),{headers:{'content-type':'image/png'}})});
 await rejects(c.photo(photoId),'CAR02_PHOTO_TOO_LARGE');
});
test('R49 failed fetch and authentication provider leak no internal error',async()=>{
 await rejects(build({fetchImpl:async()=>{throw Error('secret api key')}}).get(id),'CAR02_CONNECTION_FAILED');
 await rejects(build({credentials:async()=>{throw Error('secret auth')}}).get(id),'CAR02_IDENTITY_REQUIRED');
});
