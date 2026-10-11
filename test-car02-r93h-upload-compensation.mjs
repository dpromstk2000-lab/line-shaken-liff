import test from 'node:test';
import assert from 'node:assert/strict';
import {createR93HIsolatedUploadCompensation,R93H_CONTRACT} from './car02-r93h-upload-compensation-isolated.mjs';
const I='44444444-4444-4444-8444-444444444444';
const O='22222222-2222-4222-8222-222222222222';
const R='33333333-3333-4333-8333-333333333333';
const SHOP='street_house_kitsuki';
const JPEG=Uint8Array.from([255,216,255,225,2,3,4,5,255,217]);
const PNG=Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3,4]);
const WEBP=Uint8Array.from([82,73,70,70,2,0,0,0,87,69,66,80,1]);
const actor=()=>({verified:true,role:'staff',shopCode:SHOP,subject:`staff:${I}`});
const request=(bytes=JPEG,mimeType='image/jpeg')=>({actor:actor(),shopCode:SHOP,orderId:O,reportId:R,mimeType,bytes});
const asError=async(f,code)=>{await assert.rejects(f,e=>e?.message===code)};
function fixture({putStatus=201,fail='',badRead=false,tombstone=true,ready=true,bucketPublic=false,
  reservedId=I,reservedState='pending',tombstoneThrow=false}={}){
 const calls=[];const blobs=new Map();let reserved;
 const observe=(k,v)=>{calls.push([k,v]);if(fail===k)throw Error('INTERNAL_SECRET_SERVICE_ROLE_DATABASE_STRING');};
 const repository={
  async reserve(x){observe('reserve',x);reserved={...x,id:reservedId,state:reservedState};return {photoId:reservedId,state:reservedState};},
  async markReady(x){observe('markReady',x);return ready;},
  async tombstoneAndEnqueue(x){observe('tombstoneAndEnqueue',x);if(tombstoneThrow)throw Error('INTERNAL_SECRET_SERVICE_ROLE_DATABASE_STRING');return tombstone;}
 };
 const storage={
  async verifyPrivateBucket(x){observe('verifyPrivateBucket',x);return {id:'ksh-car02-private-photos',public:bucketPublic};},
  async postObject(x){ // Even on lost response, a remote object may exist!
   calls.push(['postObject',x]);blobs.set(x.path,Uint8Array.from(x.bytes));
   if(fail==='postObject')throw Error('INTERNAL_SECRET_SERVICE_ROLE_DATABASE_STRING');
   return {status:putStatus};
  },
  async inspectObject(x){observe('inspectObject',x);const raw=blobs.get(x.path);return {private:true,mimeType:reserved.mimeType,
    bytes:badRead?Uint8Array.from([255,216,255,0]):raw};}
 };
 const service=createR93HIsolatedUploadCompensation({environment:'isolated_qa',dbName:'car02_r93h_qa_ephemeral',repository,storage});
 return {service,calls,blobs};
}
const callsOf=(fx,n)=>fx.calls.filter(x=>x[0]===n).length;

test('only offline, NO_GO and HOLD with durable cleanup required',()=>{
 assert.equal(R93H_CONTRACT.liveWiring,false);
 assert.equal(R93H_CONTRACT.productionReady,false);
 assert.equal(R93H_CONTRACT.neverImmediateDelete,true);
 assert.equal(R93H_CONTRACT.requiresAtomicPendingTombstoneAndOutbox,true);
});
for(const environment of [undefined,'production','stage','isolated_qa ',null])test('reject environment '+String(environment),()=>{
 assert.throws(()=>createR93HIsolatedUploadCompensation({environment,dbName:'car02_r93h_qa_ephemeral'}),/R93H_ISOLATED/);
});
for(const dbName of ['postgres','liff-salon-reserve','car02_r93h_qa','car02_r93h_qa_../live',undefined,'CAR02_R93H_QA_A'])
 test('reject DB '+String(dbName),()=>assert.throws(()=>createR93HIsolatedUploadCompensation({environment:'isolated_qa',dbName}),/R93H_ISOLATED/));
for(const [bytes,mime] of [[JPEG,'image/jpeg'],[PNG,'image/png'],[WEBP,'image/webp']])
 test('valid '+mime+' upload only after verified private readback, no cleanup',async()=>{
  const fx=fixture();const r=await fx.service.upload(request(bytes,mime));
  assert.equal(r.state,'ready');assert.equal(r.productionReady,false);
  assert.equal(callsOf(fx,'tombstoneAndEnqueue'),0);
  assert.deepEqual(fx.calls.map(x=>x[0]),['verifyPrivateBucket','reserve','postObject','inspectObject','markReady']);
  const row=fx.calls.find(x=>x[0]==='reserve')[1];
  assert.equal(row.bucket,'ksh-car02-private-photos');
  assert.equal(row.byteSize,bytes.byteLength);
  assert.match(row.path,new RegExp(`^${SHOP}/${O}/${R}/[0-9a-f-]{36}\\.${mime==='image/jpeg'?'jpg':mime==='image/png'?'png':'webp'}$`));
  assert.equal(JSON.stringify(r).includes(row.path),false);
  assert.equal(JSON.stringify(r).includes('sha256'),false);
 });
for(const change of [
 ['bad actor',q=>q.actor.verified=false],['other tenant',q=>q.actor.shopCode='other_shop'],
 ['staff role forgery',q=>q.actor.role='admin'],['line actor',q=>q.actor.subject='line:myprofile'],
 ['short ID',q=>q.orderId='1'],['bad report',q=>q.reportId='../secret'],
 ['invalid shop',q=>q.shopCode='../shop'],['bad MIME',q=>q.mimeType='image/svg+xml'],
 ['JPEG spoofing',q=>q.bytes=Uint8Array.from([1,2,3,4])],
 ['zero bytes',q=>q.bytes=new Uint8Array(0)],
 ['oversized',q=>q.bytes=new Uint8Array(5242881)],
 ['text instead of bytes',q=>q.bytes='unsafe'],
 ['extra actor role',q=>q.actor.role='manager']
 ])test('invalid request '+change[0]+' rejected before adapter use',async()=>{
 const q=request();change[1](q);const fx=fixture();await asError(()=>fx.service.upload(q),'R93H_INVALID_AUTH_OR_IMAGE');
 assert.equal(fx.calls.length,0);
 });
for(const cfg of [{bucketPublic:true},{fail:'verifyPrivateBucket'}])test('unverified/private-bucket failure refuses reservation '+JSON.stringify(cfg),async()=>{
 const fx=fixture(cfg);await asError(()=>fx.service.upload(request()),'R93H_PRIVATE_BUCKET_UNVERIFIED');
 assert.equal(callsOf(fx,'reserve'),0);assert.equal(callsOf(fx,'postObject'),0);
 });
for(const cfg of [{fail:'reserve'},{reservedId:'not-a-uuid'},{reservedState:'ready'}])
 test('uncertain reservation never starts Storage write '+JSON.stringify(cfg),async()=>{
 const fx=fixture(cfg);await asError(()=>fx.service.upload(request()),'R93H_RESERVATION_UNCERTAIN');
 assert.equal(callsOf(fx,'postObject'),0);
 });
for(const cfg of [{fail:'postObject'},{putStatus:500},{putStatus:409},{fail:'inspectObject'},
 {badRead:true},{fail:'markReady'},{ready:false}])
 test('post uncertainty '+JSON.stringify(cfg)+' queues recovery instead of direct delete',async()=>{
 const fx=fixture(cfg);await asError(()=>fx.service.upload(request()),'R93H_UPLOAD_FAILED_RECOVERY_QUEUED');
 assert.equal(callsOf(fx,'postObject'),1);
 assert.equal(callsOf(fx,'tombstoneAndEnqueue'),1);
 assert.equal(fx.blobs.size,1); // Object may still exist until future authorized cleanup
 const scope=fx.calls.find(x=>x[0]==='tombstoneAndEnqueue')[1];
 const original=fx.calls.find(x=>x[0]==='reserve')[1];
 assert.equal(scope.path,original.path);assert.equal(scope.shopCode,original.shopCode);
 assert.equal(scope.photoId,I);assert.equal(scope.expectedState,'pending');
 assert.equal(scope.reason,'UPLOAD_UNCERTAIN');
 assert.equal(fx.calls.some(x=>x[0]==='deleteObject'),false);
 });
for(const cfg of [{fail:'postObject',tombstone:false},{fail:'postObject',tombstoneThrow:true},
 {putStatus:503,tombstone:false},{ready:false,tombstone:false}])
 test('missing durable compensation must never claim cleanup '+JSON.stringify(cfg),async()=>{
 const fx=fixture(cfg);await asError(()=>fx.service.upload(request()),'R93H_COMPENSATION_UNCONFIRMED');
 assert.equal(callsOf(fx,'postObject'),1);assert.equal(fx.blobs.size,1);
 });
test('compensation error never leaks DB or Storage secrets',async()=>{
 const fx=fixture({fail:'postObject',tombstoneThrow:true});await asError(()=>fx.service.upload(request()),'R93H_COMPENSATION_UNCONFIRMED');
});
test('each upload reservation generates a unique private path, no upsert',async()=>{
 const fx=fixture();await fx.service.upload(request());await fx.service.upload(request());
 const paths=fx.calls.filter(x=>x[0]==='postObject').map(x=>x[1]);
 assert.notEqual(paths[0].path,paths[1].path);
 assert.equal(paths[0].upsert,false);assert.equal(paths[1].upsert,false);
});
