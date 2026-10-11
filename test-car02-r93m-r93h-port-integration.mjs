import test from 'node:test';
import assert from 'node:assert/strict';
import {createR93MIsolatedPgPhotoLifecycle} from './car02-r93m-pg-photo-lifecycle-isolated.mjs';
import {createR93HIsolatedUploadCompensation} from './car02-r93h-upload-compensation-isolated.mjs';
const S='street_house_kitsuki', O='22222222-2222-4222-8222-222222222222',R='33333333-3333-4333-8333-333333333333';
const PHOTO='44444444-4444-4444-8444-444444444444',USER='11111111-1111-4111-8111-111111111111',JOB='55555555-5555-4555-8555-555555555555';
const actor=()=>({verified:true,shopCode:S,role:'staff',subject:`staff:${USER}`});
const JPG=Uint8Array.from([255,216,255,225,4,5,6,7,255,217]);
function build({lostPost=false,failOutbox=false,readyCommitAckLost=false,gate=true}={}){
 const shared={photo:null,jobs:[]},objects=new Map(),calls=[];
 const copy=v=>JSON.parse(JSON.stringify(v));
 const pool={async connect(){let staged,tx=false;
  return {async query(q,args=[]){
   q=q.trim();
   if(q==='BEGIN'){staged=copy(shared);tx=true;calls.push('BEGIN');return {rows:[]}}
   if(q==='COMMIT'){Object.assign(shared,copy(staged));tx=false;calls.push('COMMIT');
     if(readyCommitAckLost&&staged.photo?.upload_state==='ready')throw Error('DB_COMMIT_ACK_LOST');return {rows:[]}}
   if(q==='ROLLBACK'){calls.push('ROLLBACK');tx=false;return {rows:[]}}
   if(q.startsWith('SET LOCAL'))return {rows:[]};
   if(!tx)throw Error('QUERY_NOT_TRANSACTIONAL');
   if(q.includes('current_database() AS db'))return {rows:[{db:'car02_r93m_qa_ci',staff_table:true,photo_table:true,outbox_table:true,no_live_photos:true}]};
   if(q.includes('FROM car02_r93m_qa.staff'))return {rows:[{role:'staff',active:true}]};
   if(q.includes('FROM car02_r93m_qa.work_orders o JOIN'))return {rows:[{order_id:O,report_id:R,order_status:'draft'}]};
   if(q.includes('count(*)::integer'))return {rows:[{n:staged.photo?.upload_state!=='deleted'&&staged.photo?1:0}]};
   if(q.startsWith('INSERT INTO car02_r93m_qa.photos')){
     staged.photo={id:PHOTO,shop_code:S,order_id:O,report_id:R,storage_bucket:args[3],storage_path:args[4],mime_type:args[5],byte_size:args[6],sha256:args[7],upload_state:'pending'};
     return {rows:[{id:PHOTO,upload_state:'pending'}]};}
   if(q.includes('FROM car02_r93m_qa.photos p'))return {rows:staged.photo?.id===args[0]?[{...staged.photo,order_status:'draft'}]:[]};
   if(q.startsWith('UPDATE car02_r93m_qa.photos')){
     if(staged.photo?.upload_state!=='pending')return {rows:[]};
     staged.photo.upload_state=q.includes("upload_state='ready'")?'ready':'deleted';
     return {rows:[{id:PHOTO,upload_state:staged.photo.upload_state}]};}
   if(q.startsWith('INSERT INTO car02_r93m_qa.cleanup_jobs')){
     if(failOutbox)throw Error('DB_UNAVAILABLE_SECRETS');
     staged.jobs.push({job_id:JOB,photo_id:args[0],storage_path:args[2],state:'queued'});
     return {rows:[{job_id:JOB,state:'queued'}]};}
   throw Error('UNEXPECTED_QUERY');
  },release(){calls.push('release')}};
 }};
 const repository=createR93MIsolatedPgPhotoLifecycle({environment:'isolated_qa',dbName:'car02_r93m_qa_ci',shopCode:S,pool,reviewGate:async()=>gate});
 const storage={
  async verifyPrivateBucket(){return {id:'ksh-car02-private-photos',public:false}},
  async postObject({path,bytes}){calls.push('POST');objects.set(path,Uint8Array.from(bytes));if(lostPost)throw Error('STORAGE_SECRET_ACK_LOST');return {status:201}},
  async inspectObject({path,mimeType}){return {private:true,mimeType:'image/jpeg',bytes:objects.get(path)}}
 };
 const service=createR93HIsolatedUploadCompensation({environment:'isolated_qa',dbName:'car02_r93h_qa_ci',repository,storage});
 const request=()=>({actor:actor(),shopCode:S,orderId:O,reportId:R,mimeType:'image/jpeg',bytes:JPG});
 return {service,shared,objects,calls,request};
}
test('real R93H integrates with R93M port: pending -> ready, no outbox',async()=>{
 const f=build();const result=await f.service.upload(f.request());
 assert.equal(result.state,'ready');assert.equal(result.photoId,PHOTO);assert.equal(result.productionReady,false);
 assert.equal(f.shared.photo.upload_state,'ready');assert.equal(f.shared.jobs.length,0);
 assert.equal(f.objects.size,1);assert.equal(f.calls.includes('COMMIT'),true);
});
test('lost Storage POST reply queues same-path cleanup atomically, never calls DELETE',async()=>{
 const f=build({lostPost:true});
 await assert.rejects(()=>f.service.upload(f.request()),/R93H_UPLOAD_FAILED_RECOVERY_QUEUED/);
 assert.equal(f.shared.photo.upload_state,'deleted');assert.equal(f.shared.jobs.length,1);
 assert.equal(f.shared.jobs[0].storage_path,f.shared.photo.storage_path);
 assert.equal(f.objects.size,1);assert.equal(f.calls.includes('DELETE'),false);
});
test('outbox write failure rolls back tombstone; recovery must not be claimed',async()=>{
 const f=build({lostPost:true,failOutbox:true});
 await assert.rejects(()=>f.service.upload(f.request()),/R93H_COMPENSATION_UNCONFIRMED/);
 assert.equal(f.shared.photo.upload_state,'pending');assert.equal(f.shared.jobs.length,0);
 assert.equal(f.calls.includes('ROLLBACK'),true);
});
test('lost COMMIT acknowledgement after ready cannot tombstone completed photo',async()=>{
 const f=build({readyCommitAckLost:true});
 await assert.rejects(()=>f.service.upload(f.request()),/R93H_COMPENSATION_UNCONFIRMED/);
 assert.equal(f.shared.photo.upload_state,'ready');assert.equal(f.shared.jobs.length,0);
});
test('closed QA review gate stops R93H before any Storage POST',async()=>{
 const f=build({gate:false});await assert.rejects(()=>f.service.upload(f.request()),/R93H_RESERVATION_UNCERTAIN/);
 assert.equal(f.objects.size,0);assert.equal(f.shared.photo,null);
});
