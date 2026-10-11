import test from 'node:test';
import assert from 'node:assert/strict';
import {createCar02R93UIsolatedStagingRouter,R93U_CONTRACT} from './car02-r93u-staging-upload-route-isolated.mjs';
const ORDER='22222222-2222-4222-8222-222222222222';
const REPORT='33333333-3333-4333-8333-333333333333';
const BASE='https://stage.example.test/functions/v1/dpro-car02-stage';
const UP=`${BASE}/api/car02/uploads/${ORDER}/${REPORT}`;
const SHOP='street_house_kitsuki';
const DB='car02_r93q_qa_ci';
function fixture({open=false,upload,business}={}){
 const calls={gate:0,upload:0,business:0,seen:[]};
 const create=(method,handler)=>async()=>{calls[method]++;return handler||(async(req)=>{
  const bytes=method==='upload'&&req.method==='POST'?new Uint8Array(await req.arrayBuffer()):new Uint8Array(0);
  calls.seen.push({method,url:new URL(req.url).pathname,length:bytes.length,verb:req.method});
  return new Response(JSON.stringify({ok:true}),{status:200});
 });};
 const route=createCar02R93UIsolatedStagingRouter({environment:'isolated_qa',dbName:DB,
  reviewGate:async()=>{calls.gate++;return open;},createUploadHandler:create('upload',upload),
  createBusinessHandler:create('business',business)});
 return {route,calls};
}
const request=(url,method='GET',body,headers={})=>new Request(url,{method,headers,...(body===undefined?{}:{body})});
const body=n=>new Uint8Array(n).fill(13);
const post=(url,bytes,headers={})=>request(url,'POST',bytes,headers);
test('R93U factory rejects missing QA DB, live mode and missing factories',()=>{
 for(const v of [{environment:'production',dbName:DB},{environment:'isolated_qa',dbName:'postgres'},{environment:'isolated_qa',dbName:DB}])
  assert.throws(()=>createCar02R93UIsolatedStagingRouter(v),/R93U_DISPOSABLE_ISOLATION_REQUIRED/);
});
test('R93U contract explicitly stays NO_GO/HOLD and does not claim production wiring',()=>{
 assert.equal(R93U_CONTRACT.productionReady,false);
 assert.equal(R93U_CONTRACT.releaseDecision,'NO_GO');
 assert.equal(R93U_CONTRACT.migrationDecision,'HOLD');
 assert.equal(R93U_CONTRACT.r82DurableIntentNotYetWired,true);
 assert.equal(R93U_CONTRACT.businessPostBytes,32768);
 assert.equal(R93U_CONTRACT.uploadPostBytes,5242880);
});
test('closed gate blocks upload without touching any handler or request body',async()=>{
 const {route,calls}=fixture();
 const r=await route(post(UP,body(100)));
 assert.equal(r.status,503);assert.equal(calls.upload,0);assert.equal(calls.business,0);
});
test('closed gate blocks business without invoking any handler',async()=>{
 const {route,calls}=fixture();assert.equal((await route(post(`${BASE}/api/car02`,body(12)))).status,503);
 assert.equal(calls.business,0);assert.equal(calls.upload,0);
});
test('upload route only works with exact prefix and UUID pair',async()=>{
 const {route,calls}=fixture({open:true});
 for(const url of [UP.replace('/functions/v1',''),UP+'/',UP+'/extra',UP.replace(ORDER,'123'),
  UP.replace('/api/car02/uploads/','/api/car02/UPloads-not/'),
  UP+'?shop=other',UP+'#fragment',UP.replace('dpro-car02-stage','dpro-car02-stage-bad')]){
  const res=await route(request(url));
  if(url===UP.replace('/functions/v1',''))assert.equal(res.status,405);
  else assert.equal(res.status,404,url);
 }
 assert.equal(calls.upload,0);
});
test('max 5MiB payload reaches selected upload handler without reaching business',async()=>{
 const {route,calls}=fixture({open:true});const result=await route(post(UP,body(5*1024*1024)));
 assert.equal(result.status,200);assert.equal(calls.upload,1);assert.equal(calls.business,0);
 assert.equal(calls.seen[0].length,5*1024*1024);
 assert.equal(calls.seen[0].url,`/api/car02/uploads/${ORDER}/${REPORT}`);
});
test('over 5MiB rejected before handler',async()=>{
 const {route,calls}=fixture({open:true});const r=await route(post(UP,body(5*1024*1024+1)));
 assert.equal(r.status,413);assert.equal(calls.upload,0);
});
test('content length over upload cap rejected before reading body',async()=>{
 const {route,calls}=fixture({open:true});const r=await route(post(UP,body(8),{'content-length':'5242881'}));
 assert.equal(r.status,413);assert.equal(calls.upload,0);
});
test('wrong content length, malformed length rejected before handler',async()=>{
 const {route,calls}=fixture({open:true});
 for(const value of ['9','x','-1','9999999999999999999','01']){
  const status=(await route(post(UP,body(8),{'content-length':value}))).status;
  assert.equal(status,400,value);
 }assert.equal(calls.upload,0);
});
test('business request stays limited to 32KiB independent of image cap',async()=>{
 const {route,calls}=fixture({open:true});
 const good=await route(post(`${BASE}/api/car02`,body(32768)));
 const bad=await route(post(`${BASE}/api/car02`,body(32769)));
 assert.equal(good.status,200);assert.equal(bad.status,413);
 assert.equal(calls.business,1);assert.equal(calls.upload,0);
});
test('malformed or unknown CAR02 routes denied and cannot reach business fallback',async()=>{
 const {route,calls}=fixture({open:true});
 for(const path of ['/api/car02/uploads','/api/car02/uploads/not-uuid/not-uuid',
  `/api/car02/photos/${ORDER}`, '/api/car02legacy', '/api/line/webhook',
  `/api/car02/${ORDER}/unexpected`]){
  assert.equal((await route(request(BASE+path))).status,404,path);
 }assert.equal(calls.business,0);assert.equal(calls.upload,0);
});
test('upload OPTIONS reaches only upload handler, without body access',async()=>{
 const {route,calls}=fixture({open:true});const r=await route(request(UP,'OPTIONS'));
 assert.equal(r.status,200);assert.equal(calls.upload,1);assert.equal(calls.business,0);
 assert.equal(calls.seen[0].verb,'OPTIONS');
});
test('upload GET, PUT, DELETE denied before handler creation',async()=>{
 const {route,calls}=fixture({open:true});
 for(const method of ['GET','PUT','DELETE'])assert.equal((await route(request(UP,method))).status,405);
 assert.equal(calls.upload,0);
});
test('business route GET is preserved but never passes unrelated routes',async()=>{
 const {route,calls}=fixture({open:true});
 assert.equal((await route(request(`${BASE}/api/car02`))).status,200);
 assert.equal((await route(request(`${BASE}/api/car02/${ORDER}/report`))).status,200);
 assert.equal(calls.business,2);
});
test('prefix /dpro-car02-stage also maps to canonical inner upload route',async()=>{
 const {route,calls}=fixture({open:true});
 const path=UP.replace('/functions/v1','');const r=await route(post(path,body(13)));
 assert.equal(r.status,200);assert.equal(calls.upload,1);
});
test('review gate exception fails closed',async()=>{
 let n=0;const route=createCar02R93UIsolatedStagingRouter({environment:'isolated_qa',dbName:DB,
  reviewGate:async()=>{throw Error('offline')},createUploadHandler:async()=>{n++;return async()=>new Response('bad')},
  createBusinessHandler:async()=>{n++;return async()=>new Response('bad')}});
 assert.equal((await route(post(UP,body(10)))).status,503);assert.equal(n,0);
});
test('upload handler factory exception fails closed',async()=>{
 const {route}=fixture({open:true,upload:undefined});
 const broken=createCar02R93UIsolatedStagingRouter({environment:'isolated_qa',dbName:DB,
  reviewGate:async()=>true,createUploadHandler:async()=>{throw Error('unavailable')},
  createBusinessHandler:async()=>{throw Error('unavailable')}});
 assert.equal((await broken(post(UP,body(10)))).status,503);
 assert.equal((await route(post(UP,body(10)))).status,200);
});
test('query strings and unsafe unprefixed paths remain 404 before review gate',async()=>{
 const {route,calls}=fixture({open:true});
 assert.equal((await route(request('https://stage.example.test/api/car02'))).status,404);
 assert.equal((await route(request(UP+'?token=not-allowed'))).status,404);
 assert.equal(calls.gate,0);
});
