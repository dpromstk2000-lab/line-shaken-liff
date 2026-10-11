import test from 'node:test';
import assert from 'node:assert/strict';
import {createR93JIsolatedHttpMemoryPipeline,R93J_QA_TOKENS,R93J_CONTRACT} from './car02-r93j-http-memory-pipeline-isolated.mjs';
const shop='street_house_kitsuki',order='22222222-2222-4222-8222-222222222222',report='33333333-3333-4333-8333-333333333333';
const url=`https://api.car02.invalid/api/car02/uploads/${order}/${report}`;
const origin='https://car02.qa.invalid';
const jpeg=()=>Uint8Array.from([255,216,255,224,10,20,30,255,217]);
const png=()=>Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3]);
const webp=()=>Uint8Array.from([82,73,70,70,2,0,0,0,87,69,66,80,4]);
const options=(patch={})=>({environment:'isolated_qa',dbName:'car02_r93j_qa_disposable',shopCode:shop,allowedOrigins:[origin],qaEnabled:true,...patch});
const create=(patch={})=>createR93JIsolatedHttpMemoryPipeline(options(patch));
const req=({mime='image/jpeg',bytes=jpeg(),token=R93J_QA_TOKENS.staff,method='POST',extra={},target=url,site=origin}={})=>new Request(target,{method,
 headers:{origin:site,authorization:`Bearer ${token}`,'content-type':mime,...extra},
 ...(method==='POST'?{body:bytes}:{})});
const read=async r=>({status:r.status,data:await r.json()});
const ok=async fx=>{const r=await read(await fx.handle(req()));assert.equal(r.status,201);assert.equal(r.data.ok,true);return r.data};

test('R93J contract proves no production wiring or DB access',()=>{
 assert.equal(R93J_CONTRACT.productionReady,false);assert.equal(R93J_CONTRACT.networkAccess,false);
 assert.equal(R93J_CONTRACT.dbAccess,false);assert.equal(R93J_CONTRACT.liveWiring,false);
 assert.equal(R93J_CONTRACT.releaseDecision,'NO_GO');assert.equal(R93J_CONTRACT.migrationDecision,'HOLD');
});
for(const [label,patch] of [
 ['production',{environment:'production'}],['unknown db',{dbName:'postgres'}],['shared db',{dbName:'liff-salon-reserve'}],
 ['blank qa db',{dbName:'car02_r93j_qa_'}],['non-qa URL',{allowedOrigins:['https://www.example.com']}],
 ['http URL',{allowedOrigins:['http://car02.qa.invalid']}],['empty origins',{allowedOrigins:[]}],
 ['fake shop',{shopCode:'../another'}],['unknown post fault',{faults:{post:'unsupported'}}],
 ['unexpected fault key',{faults:{fetch:'live'}}],['null faults',{faults:null}],['nonboolean gate',{qaEnabled:1}]
 ])test('R93J rejects unsafe composition '+label,()=>assert.throws(()=>create(patch),/R93J_ISOLATED_LOCAL_TEST_ONLY/));
for(const [mime,data] of [['image/jpeg',jpeg],['image/png',png],['image/webp',webp]]){
 test('R82 -> R93I -> R93H saves '+mime+' with only minimal HTTP receipt',async()=>{
  const fx=create();const response=await read(await fx.handle(req({mime,bytes:data()})));
  assert.equal(response.status,201);assert.deepEqual(Object.keys(response.data).sort(),['byteSize','mimeType','ok','photoId','state']);
  assert.equal(response.data.byteSize,data().length);assert.equal(response.data.mimeType,mime);
  const state=fx.inspectForQA();assert.equal(state.rows[0].state,'ready');assert.equal(state.queued.length,0);
  assert.equal(state.blobCount,1);
  assert.deepEqual(state.events,['verifyPrivateBucket','reserve','postObject','inspectObject','markReady']);
  assert.equal(JSON.stringify(response).includes('sha256'),false);
 });
}
test('QA starts closed unless explicitly enabled',async()=>{
 const fx=create({qaEnabled:false});const r=await read(await fx.handle(req()));
 assert.deepEqual(r,{status:503,data:{ok:false,code:'CAR02_NOT_RELEASED'}});
 assert.deepEqual(fx.inspectForQA().events,[]);
});
test('OPTIONS approved origin returns preflight without any storage call',async()=>{
 const fx=create();const r=await fx.handle(req({method:'OPTIONS',extra:{'access-control-request-method':'POST','access-control-request-headers':'Authorization, Content-Type'}}));
 assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),origin);
 assert.deepEqual(fx.inspectForQA().events,[]);
});
for(const [label,change,status,code] of [
 ['cross origin',{site:'https://forged.qa.invalid'},403,'CAR02_ORIGIN_DENIED'],
 ['bad token',{token:'FORGED_TOKEN_12345'},403,'CAR02_STAFF_REQUIRED'],
 ['no bearer',{extra:{authorization:'not-a-bearer'}},401,'CAR02_UNAUTHORIZED'],
 ['bad mime',{mime:'image/svg+xml'},415,'CAR02_IMAGE_TYPE_DENIED'],
 ['oversized',{bytes:new Uint8Array(5242881)},413,'CAR02_IMAGE_TOO_LARGE'],
 ['spoof jpg',{bytes:new Uint8Array([1,2,3,4,5])},503,'CAR02_PHOTO_UPLOAD_UNAVAILABLE'],
 ['other path',{target:url+'/extra'},404,'CAR02_NOT_FOUND'],
 ['search',{target:url+'?shop=evil'},404,'CAR02_NOT_FOUND'],
 ['lying length',{extra:{'content-length':'5000'}},400,'CAR02_BAD_LENGTH']
 ])test('HTTP denies '+label+' without unsafe side effects',async()=>{
 const fx=create();const res=await read(await fx.handle(req(change)));assert.equal(res.status,status);assert.equal(res.data.code,code);
 assert.equal(fx.inspectForQA().blobCount,0);
 assert.equal(fx.inspectForQA().queued.length,0);
});
test('owner is authorized only through trusted in-memory identity',async()=>{
 const fx=create();const r=await read(await fx.handle(req({token:R93J_QA_TOKENS.owner})));
 assert.equal(r.status,201);assert.equal(fx.inspectForQA().rows[0].state,'ready');
});
for(const [label,faults] of [
 ['server accepted upload but ACK lost',{post:'lost_ack'}],
 ['post returns HTTP 503',{post:'rejected'}],
 ['readback is corrupt',{readback:'corrupt'}],
 ['readback throws',{readback:'throw'}],
 ['DB refuses ready',{markReady:'reject'}]
 ])test('uncertain '+label+' queues immutable cleanup, not direct delete',async()=>{
 const fx=create({faults});const res=await read(await fx.handle(req()));
 assert.deepEqual(res,{status:503,data:{ok:false,code:'CAR02_PHOTO_UPLOAD_UNAVAILABLE'}});
 const state=fx.inspectForQA();assert.equal(state.rows[0].state,'deleted');assert.equal(state.queued.length,1);
 assert.ok(state.events.includes('tombstoneAndEnqueue'));
 assert.equal(state.events.includes('deleteObject'),false);
});
test('outbox write failure does not claim a compensated upload',async()=>{
 const fx=create({faults:{post:'lost_ack',outbox:'reject'}});
 const r=await read(await fx.handle(req()));assert.equal(r.status,503);
 const state=fx.inspectForQA();assert.equal(state.rows[0].state,'pending');assert.equal(state.queued.length,0);
 assert.equal(state.blobCount,1);
});
test('readiness acknowledgement loss never tombstones a ready photo',async()=>{
 const fx=create({faults:{markReady:'committed_ack_lost'}});const r=await read(await fx.handle(req()));
 assert.equal(r.status,503);const state=fx.inspectForQA();assert.equal(state.rows[0].state,'ready');
 assert.equal(state.queued.length,0);assert.equal(state.blobCount,1);
});
test('public bucket is denied before DB reservation',async()=>{
 const fx=create({faults:{bucket:'public'}});const r=await read(await fx.handle(req()));
 assert.equal(r.status,503);assert.deepEqual(fx.inspectForQA().events,['verifyPrivateBucket']);
});
test('max 3 photos same report prevents fourth registration in QA memory',async()=>{
 const fx=create();for(let i=0;i<3;i++)assert.equal((await read(await fx.handle(req()))).status,201);
 const fourth=await read(await fx.handle(req()));assert.equal(fourth.status,503);
 const state=fx.inspectForQA();assert.equal(state.rows.length,3);assert.equal(state.blobCount,3);
});
test('each independent pipeline has no shared memory or network activity',async()=>{
 const a=create(),b=create();await ok(a);assert.equal(b.inspectForQA().rows.length,0);
 assert.equal(b.inspectForQA().blobCount,0);
});
