import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createCar02PhotoUploadHttpR82} from './car02-private-photo-upload-http-r82.mjs';
import {createR93IIsolatedR47SafeBridge} from './car02-r93i-r47-safe-bridge-isolated.mjs';
import {createR93KIsolatedR83RepositoryBridge} from './car02-r93k-r83-repository-bridge-isolated.mjs';
const SHOP='street_house_kitsuki',O='22222222-2222-4222-8222-222222222222',R='33333333-3333-4333-8333-333333333333',I='44444444-4444-4444-8444-444444444444';
const ORIGIN='https://qa.example.invalid',BUCKET='ksh-car02-private-photos';
const TOKEN='QA_R93K_STAFF_BEARER_WITH_NO_REAL_SECRETS';
const BODIES={'image/jpeg':Uint8Array.from([255,216,255,224,1,2,3,255,217]),'image/png':Uint8Array.from([137,80,78,71,13,10,26,10,9,8,7]),'image/webp':Uint8Array.from([82,73,70,70,2,0,0,0,87,69,66,80,5,4,3])};
function fixture({post='ok',readback='ok',mark='ok',outbox='ok',bucket='private',gate=true}={}){
 const rows=new Map(),objects=new Map(),jobs=new Map(),events=[];
 const r83={
   async reserve(x){events.push('reserve');const id=randomUUID();rows.set(id,{id,meta:x,state:'pending'});return {id}},
   async getPending({photoId}){events.push('getPending');const row=rows.get(photoId);if(row?.state!=='pending')throw Error('CAR02_R83_PHOTO_NOT_PENDING');return {id:row.id,storage_bucket:BUCKET,storage_path:row.meta.path,mime_type:row.meta.mimeType,byte_size:row.meta.byteSize,sha256:row.meta.sha256,upload_state:'pending'}},
   async markReady({photoId}){events.push('markReady');const row=rows.get(photoId);if(mark==='reject')return null;if(!row||row.state!=='pending')throw Error('CAR02_R83_PHOTO_NOT_PENDING');row.state='ready';if(mark==='lost_ack')throw Error('QA_COMMITTED_BUT_ACK_LOST');return {id:row.id,state:'ready'}},
   async cancel(){events.push('DANGEROUS_LEGACY_CANCEL');throw Error('FORBIDDEN')}
 };
 const compensation={async tombstoneAndEnqueue({photoId,path,shop}){
   events.push('atomicCompensation');if(outbox==='reject')throw Error('QUEUED_TX_ABORTED');
   const row=rows.get(photoId);if(!row||row.state!=='pending'||row.meta.path!==path||row.meta.shop!==shop)throw Error('STATE_OR_SCOPE_CONFLICT');
   row.state='deleted';jobs.set(photoId,{path,shop});return {photoId,shopCode:shop,storagePath:path,jobId:randomUUID(),state:'deleted',cleanupState:'queued',atomicCommit:true};
 }};
 const storage={
   async verifyPrivateBucket(){events.push('verifyPrivateBucket');return {id:BUCKET,public:bucket!=='private'}},
   async postObject({path,mimeType,bytes}){events.push('postObject');if(post==='reject')return {status:503};objects.set(path,{mimeType,bytes:Uint8Array.from(bytes)});if(post==='lost_ack')throw Error('REMOTE_WROTE_OBJECT_ACK_LOST');return {status:201}},
   async inspectObject({path}){events.push('inspectObject');if(readback==='error')throw Error('READBACK_TIMEOUT');const v=objects.get(path);if(!v)return null;return {private:true,mimeType:v.mimeType,bytes:readback==='corrupt'?new Uint8Array([1,2,3,4]):Uint8Array.from(v.bytes)}}
 };
 const bridge=createR93KIsolatedR83RepositoryBridge({environment:'isolated_qa',dbName:'car02_r93k_qa_memory',r83Port:r83,atomicCompensationPort:compensation});
 const releaseEnabled=async()=>gate===true;
 const uploadService=createR93IIsolatedR47SafeBridge({environment:'isolated_qa',dbName:'car02_r93i_qa_r93k',releaseEnabled,repository:bridge,storage});
 const authenticate=async req=>req.headers.get('authorization')==='Bearer '+TOKEN?{verified:true,shopCode:SHOP,role:'staff',subject:'staff:'+I}:null;
 const route=createCar02PhotoUploadHttpR82({shopCode:SHOP,releaseEnabled,authenticate,uploadService,allowedOrigins:[ORIGIN]});
 return {route,rows,objects,jobs,events};
}
const request=({mime='image/png',headers={},bytes=BODIES[mime],url=`https://api.qa.invalid/api/car02/uploads/${O}/${R}`,method='POST'}={})=>new Request(url,{method,headers:{origin:ORIGIN,authorization:'Bearer '+TOKEN,'content-type':mime,...headers},...(['POST','PUT'].includes(method)?{body:bytes}:{})});
for(const mime of Object.keys(BODIES))test('R82→R93I→R93H→R93K→R83-port '+mime+' success',async()=>{
 const f=fixture(),res=await f.route(request({mime}));assert.equal(res.status,201);const j=await res.json();
 assert.equal(j.ok,true);assert.equal(j.state,'ready');assert.equal(j.mimeType,mime);
 assert.equal(f.rows.size,1);assert.equal([...f.rows.values()][0].state,'ready');assert.equal(f.jobs.size,0);assert.equal(f.objects.size,1);
 assert.equal(f.events.includes('DANGEROUS_LEGACY_CANCEL'),false);
});
for(const fmode of [{post:'lost_ack'},{post:'reject'},{readback:'error'},{readback:'corrupt'},{mark:'reject'}])
 test('uncertain upload '+JSON.stringify(fmode)+' -> private 503 and durable queued job',async()=>{
  const f=fixture(fmode),res=await f.route(request());assert.equal(res.status,503);
  assert.deepEqual(await res.json(),{ok:false,code:'CAR02_PHOTO_UPLOAD_UNAVAILABLE'});
  assert.equal(f.jobs.size,1);assert.equal([...f.rows.values()][0].state,'deleted');
  assert.equal(f.events.includes('DANGEROUS_LEGACY_CANCEL'),false);
 });
test('lost markReady ACK after actual commit cannot tombstone a ready photo',async()=>{
 const f=fixture({mark:'lost_ack'}),res=await f.route(request());assert.equal(res.status,503);
 assert.equal([...f.rows.values()][0].state,'ready');assert.equal(f.jobs.size,0);
});
test('durable compensation failure never claims cleanup',async()=>{
 const f=fixture({post:'lost_ack',outbox:'reject'}),res=await f.route(request());assert.equal(res.status,503);
 assert.equal([...f.rows.values()][0].state,'pending');assert.equal(f.jobs.size,0);
 assert.equal(f.events.includes('DANGEROUS_LEGACY_CANCEL'),false);
});
test('non-private Storage bucket prevents any photo reservation or upload',async()=>{
 const f=fixture({bucket:'public'}),res=await f.route(request());assert.equal(res.status,503);assert.equal(f.rows.size,0);assert.equal(f.objects.size,0);
});
test('release gate refuses before touching database',async()=>{
 const f=fixture({gate:false}),res=await f.route(request());assert.equal(res.status,503);assert.equal(f.events.length,0);
});
for(const headers of [{authorization:'Bearer forged-token'},{origin:'https://other.example.invalid'},{'x-line-id-token':'pretend'},{'content-type':'image/svg+xml'}])
test('deny untrusted request '+JSON.stringify(headers),async()=>{
 const f=fixture(),res=await f.route(request({headers}));assert.ok(res.status>=400);assert.equal(f.rows.size,0);assert.equal(f.objects.size,0);
});
test('reject over 5 MiB before touching any repository',async()=>{
 const f=fixture(),big=new Uint8Array(5*1024*1024+1);big.set(BODIES['image/png']);const res=await f.route(request({bytes:big}));assert.equal(res.status,413);assert.equal(f.events.length,0);
});
test('normal path does not expose private blob path or SHA to HTTP caller',async()=>{
 const f=fixture(),res=await f.route(request());const str=await res.text();assert.equal(res.status,201);assert.equal(str.includes('storage'),false);assert.equal(str.includes('sha256'),false);assert.equal(str.includes('serviceRole'),false);
});
