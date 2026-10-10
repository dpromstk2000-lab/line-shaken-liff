import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCar02PrivatePhotoViewR48,createCar02PhotoHttpR48} from './car02-private-photo-view-r48.mjs';
import {createCar02PgPhotoViewR48} from './car02-pg-photo-view-r48.mjs';
const ID='11111111-1111-4111-8111-111111111111';
const ORDER='22222222-2222-4222-8222-222222222222';
const REPORT='33333333-3333-4333-8333-333333333333';
const FILE='44444444-4444-4444-8444-444444444444';
const SHOP='street_house_kitsuki';
const actor={verified:true,shopCode:SHOP,role:'staff',subject:'staff:verified'};
const customer={verified:true,shopCode:SHOP,role:'customer',subject:'line:verified',customerId:ORDER};
const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0,2,3,4]);
const digest=createHash('sha256').update(png).digest('hex');
const meta=()=>({id:ID,orderId:ORDER,reportId:REPORT,shop:SHOP,bucket:'ksh-car02-private-photos',path:`${SHOP}/${ORDER}/${REPORT}/${FILE}.png`,mime:'image/png',bytes:png.length,sha256:digest});
const key='server-only-key-never-to-be-exposed-12345';
function fixture({released=true,metadata=meta(),image=png,responseType='image/png',status=200}={}){
 const seen=[]; const repo={async findReady(p){seen.push(['db',p]);return metadata}};
 const fetchImpl=async(url,opts)=>{seen.push(['storage',url,opts]);return new Response(image,{status,headers:{'content-type':responseType}})};
 const viewer=createCar02PrivatePhotoViewR48({repository:repo,releaseEnabled:async()=>released,baseUrl:'https://example-ref.supabase.co',serviceRoleKey:key,fetchImpl});
 return {viewer,seen,repo,fetchImpl};
}
const get=(f,over={})=>f.viewer.download({actor,shop:SHOP,photoId:ID,...over});
test('R48 photo read: authorized staff gets verified image without signed URL',async()=>{
 const f=fixture();const out=await get(f);assert.equal(out.mimeType,'image/png');assert.deepEqual(out.bytes,png);
 assert.equal(f.seen.filter(x=>x[0]==='db').length,1);
 assert.equal(f.seen.filter(x=>x[0]==='storage').length,1);
 assert.ok(f.seen[1][1].includes('/object/authenticated/ksh-car02-private-photos/'));
 assert.ok(!JSON.stringify(out).includes(key));
});
test('R48 photo read: verified customer actor may retrieve only a DB-allowed photo',async()=>{
 const f=fixture();assert.deepEqual((await get(f,{actor:customer})).bytes,png);
 assert.equal(f.seen[0][1].actor.customerId,ORDER);
});
test('R48 photo read: no release means no auth, DB or storage access',async()=>{
 const f=fixture({released:false});await assert.rejects(get(f),/NOT_RELEASED/);assert.equal(f.seen.length,0);
});
test('R48 photo read: unverified actor or other shop denied before I/O',async()=>{
 const f=fixture();await assert.rejects(get(f,{actor:{...actor,verified:false}}),/ACCESS_DENIED/);
 await assert.rejects(get(f,{shop:'other_shop'}),/ACCESS_DENIED/);assert.equal(f.seen.length,0);
});
test('R48 photo read: rejects forged metadata path and wrong bucket before storage',async()=>{
 const f=fixture({metadata:{...meta(),path:'../../other/private.jpg'}});
 await assert.rejects(get(f),/UNAVAILABLE/);assert.equal(f.seen.filter(x=>x[0]==='storage').length,0);
 const g=fixture({metadata:{...meta(),bucket:'some-other-bucket'}});
 await assert.rejects(get(g),/UNAVAILABLE/);assert.equal(g.seen.filter(x=>x[0]==='storage').length,0);
});
test('R48 photo read: wrong content type or stored digest fails',async()=>{
 const f=fixture({responseType:'application/octet-stream'});await assert.rejects(get(f),/UNAVAILABLE/);
 const g=fixture({metadata:{...meta(),sha256:'f'.repeat(64)}});await assert.rejects(get(g),/INTEGRITY_FAILED/);
});
test('R48 photo read: byte mismatch or oversize is denied',async()=>{
 const f=fixture({image:new Uint8Array([1,2,3,4])});await assert.rejects(get(f),/INTEGRITY_FAILED/);
 const g=fixture({image:new Uint8Array(5*1024*1024+1)});await assert.rejects(get(g),/UNAVAILABLE/);
});
test('R48 photo read: missing configuration or HTTP storage failure is fail-closed',async()=>{
 assert.throws(()=>createCar02PrivatePhotoViewR48({repository:{findReady:async()=>meta()},releaseEnabled:()=>true,baseUrl:'http://example-ref.supabase.co',serviceRoleKey:key}),/CONFIG_INVALID/);
 const f=fixture({status:403});await assert.rejects(get(f),/UNAVAILABLE/);
});
function dbFixture({rows=[{...meta(),id:ID,shop_code:SHOP,customer_id:ORDER,order_id:ORDER,report_id:REPORT,upload_state:'ready',storage_bucket:'ksh-car02-private-photos',storage_path:meta().path,mime_type:'image/png',byte_size:png.length,sha256:digest}]}={}){
 const calls=[];const pool={async query(sql,params){calls.push({sql,params});return{rows}}};return {repo:createCar02PgPhotoViewR48({pool}),calls};
}
test('R48 PG: customer query filters shop/customer and snapshot of latest presented quote',async()=>{
 const f=dbFixture();const m=await f.repo.findReady({actor:customer,shop:SHOP,photoId:ID});assert.equal(m.id,ID);
 assert.deepEqual(f.calls[0].params,[ID,SHOP,true,ORDER]);
 assert.match(f.calls[0].sql,/o\.customer_id=\$4::uuid/);assert.match(f.calls[0].sql,/photos_snapshot @> jsonb_build_array/);
 assert.match(f.calls[0].sql,/max\(q2\.revision\)/);
});
test('R48 PG: staff is scoped to shop and records must be READY',async()=>{
 const f=dbFixture();await f.repo.findReady({actor,shop:SHOP,photoId:ID});
 assert.deepEqual(f.calls[0].params,[ID,SHOP,false,null]);assert.match(f.calls[0].sql,/upload_state='ready'/);
});
test('R48 PG: missing, multiple, or wrong-tenant records are denied',async()=>{
 const a=dbFixture({rows:[]});await assert.rejects(a.repo.findReady({actor,shop:SHOP,photoId:ID}),/ACCESS_DENIED/);
 const b=dbFixture({rows:[{...meta()},{...meta()}]});await assert.rejects(b.repo.findReady({actor,shop:SHOP,photoId:ID}),/ACCESS_DENIED/);
 const c=dbFixture({rows:[{...meta(),id:ID,shop_code:'foreign_shop',upload_state:'ready'}]});await assert.rejects(c.repo.findReady({actor,shop:SHOP,photoId:ID}),/ACCESS_DENIED/);
});
test('R48 PG: missing customerId rejected before SQL',async()=>{
 const f=dbFixture();await assert.rejects(f.repo.findReady({actor:{...customer,customerId:null},shop:SHOP,photoId:ID}),/ACCESS_DENIED/);
 assert.equal(f.calls.length,0);
});
function httpFixture({released=true,identity=actor,authError=false}={}){
 const photo=fixture();const calls={auth:0,view:0};
 const http=createCar02PhotoHttpR48({viewer:{async download(i){calls.view++;return photo.viewer.download(i)}},authenticate:async()=>{calls.auth++;if(authError)throw Error('private');return identity},releaseEnabled:async()=>released,allowedOrigins:['https://dpromstk2000-lab.github.io']});
 const request=(method='GET',headers={},url=`https://api.invalid/api/car02/photos/${ID}`)=>http(new Request(url,{method,headers}));
 return {request,calls,photo};
}
test('R48 HTTP: image served private with no-cache and no credential metadata',async()=>{
 const f=httpFixture();const r=await f.request('GET',{'Origin':'https://dpromstk2000-lab.github.io'});
 assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/png');assert.match(r.headers.get('cache-control'),/no-store/);
 assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(new Uint8Array(await r.arrayBuffer()),png);
 assert.equal(r.headers.get('access-control-allow-origin'),'https://dpromstk2000-lab.github.io');
 assert.equal(r.headers.get('location'),null);assert.equal(f.calls.view,1);
});
test('R48 HTTP: release gate blocks before authentication or storage',async()=>{
 const f=httpFixture({released:false});const r=await f.request();assert.equal(r.status,503);assert.deepEqual(f.calls,{auth:0,view:0});
});
test('R48 HTTP: unauthenticated denied before storage',async()=>{
 const f=httpFixture({authError:true});const r=await f.request();assert.equal(r.status,401);assert.deepEqual(f.calls,{auth:1,view:0});
});
test('R48 HTTP: bad origin, query, and POST denied without auth',async()=>{
 const f=httpFixture();assert.equal((await f.request('GET',{'Origin':'https://evil.test'})).status,403);
 assert.equal((await f.request('GET',{},`https://api.invalid/api/car02/photos/${ID}?shop=other_shop`)).status,404);
 assert.equal((await f.request('POST')).status,405);assert.deepEqual(f.calls,{auth:0,view:0});
});
test('R48 HTTP: allowed preflight GET has no DB, token or keys',async()=>{
 const f=httpFixture();const r=await f.request('OPTIONS',{'Origin':'https://dpromstk2000-lab.github.io'});
 assert.equal(r.status,204);assert.deepEqual(f.calls,{auth:0,view:0});
 assert.equal(r.headers.get('access-control-allow-headers'),'Authorization,X-Line-ID-Token');
});
test('R48 HTTP: storage failures return generic error, no internals',async()=>{
 const f=httpFixture();f.photo.repo.findReady=async()=>({...meta(),sha256:'0'.repeat(64)});
 const r=await f.request();assert.equal(r.status,404);const txt=await r.text();
 assert.ok(!txt.includes(key));assert.ok(!txt.includes('/storage/'));assert.match(txt,/CAR02_PHOTO_UNAVAILABLE/);
});
