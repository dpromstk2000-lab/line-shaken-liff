import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createR93PIsolatedReadyAckReconciler} from './car02-r93p-unified-commit-proof-isolated.mjs';
import {createR93HIsolatedUploadCompensation} from './car02-r93h-upload-compensation-isolated.mjs';
const shop='street_house_kitsuki',order='22222222-2222-4222-8222-222222222222';
const report='33333333-3333-4333-8333-333333333333',photo='44444444-4444-4444-8444-444444444444';
const staff='11111111-1111-4111-8111-111111111111';
const actor=Object.freeze({verified:true,shopCode:shop,role:'staff',subject:'staff:'+staff});
const bytes=Uint8Array.from([255,216,255,1,2,3,4,5,6]);
const sha=createHash('sha256').update(bytes).digest('hex');
function setup(mode='ack_lost_committed'){
 let meta=null,postObject=false,stage='none',cleanups=0,reads=0,revoked=false;
 const repository={
 async reserve(x){meta=x;stage='pending';return {photoId:photo,state:'pending'}},
 async markReady(){if(mode==='pending_ack_lost')throw Error('lost before commit');stage='ready';throw Error('lost after commit')},
 async tombstoneAndEnqueue(){cleanups++;if(stage!=='pending')return false;stage='deleted';return true}
 };
 const pool={async connect(){return {async query(q){
  if(q==='BEGIN'||q==='COMMIT'||q==='ROLLBACK'||q.startsWith('SET LOCAL'))return {rows:[]};
  if(q.includes('current_database()'))return {rows:[{db:'car02_r93p_qa_ci',staff_present:true,photos_present:true,jobs_present:true,no_live_photos:true}]};
  if(q.includes('SELECT role,active'))return {rows:[{role:'staff',active:!revoked}]};
  if(q.includes('SELECT p.id,p.shop_code'))return {rows:[{id:photo,shop_code:shop,order_id:order,
   report_id:report,storage_bucket:meta.bucket,storage_path:meta.path,mime_type:'image/jpeg',
   byte_size:meta.byteSize,sha256:mode==='bad_checksum'?'f'.repeat(64):sha,upload_state:stage,order_status:'draft'}]};
  if(q.includes('count(*)::integer')){if(!/WHERE photo_id=\$1/.test(q)||/shop_code=|storage_path=/.test(q))throw Error('unsafe outbox query');return {rows:[{n:mode==='mislabelled_outbox'?1:0}]};}
  throw Error('unknown query '+q);
 },release(){}}}};
 const rec=createR93PIsolatedReadyAckReconciler({environment:'isolated_qa',dbName:'car02_r93p_qa_ci',
  shopCode:shop,pool,repository,reviewGate:async()=>true});
 const storage={async verifyPrivateBucket(){return {id:'ksh-car02-private-photos',public:false}},
 async postObject(){postObject=true;return {status:201}},
 async inspectObject(){reads++;return {private:true,mimeType:'image/jpeg',bytes:Uint8Array.from(bytes)}}};
 const upstream=createR93HIsolatedUploadCompensation({environment:'isolated_qa',dbName:'car02_r93h_qa_ci',
  repository:rec,storage});
 return {upload:()=>upstream.upload({actor,shopCode:shop,orderId:order,reportId:report,mimeType:'image/jpeg',bytes}),
  get state(){return stage},get attempts(){return cleanups},get readbacks(){return reads},get sent(){return postObject},revoke(){revoked=true}};
}
test('R93H full upload succeeds after R93P verifies READY committed despite lost ACK',async()=>{
 const t=setup();const r=await t.upload();assert.equal(r.state,'ready');assert.equal(r.photoId,photo);
 assert.equal(t.state,'ready');assert.equal(t.attempts,0);assert.equal(t.readbacks,1);assert.ok(t.sent);
});
test('R93H upload lost DB ACK before commit safely tombstones and enqueues',async()=>{
 const t=setup('pending_ack_lost');await assert.rejects(t.upload(),{code:'R93H_UPLOAD_FAILED_RECOVERY_QUEUED'});
 assert.equal(t.state,'deleted');assert.equal(t.attempts,1);
});
test('R93P reject altered checksum after uncertain commit; never tombstone ready photo',async()=>{
 const t=setup('bad_checksum');await assert.rejects(t.upload(),{code:'R93H_COMPENSATION_UNCONFIRMED'});
 assert.equal(t.state,'ready');assert.equal(t.attempts,1); // compensation attempted but refused; READY unchanged
});
test('R93P lost-ACK proof verifies staff is still active',async()=>{
 const t=setup();t.revoke();await assert.rejects(t.upload(),{code:'R93H_COMPENSATION_UNCONFIRMED'});
 assert.equal(t.state,'ready');assert.equal(t.attempts,1); // refused for already READY
});

test('R93P + R93H integration refuses lost ACK when any mismatched outbox job belongs to photo',async()=>{
 const t=setup('mislabelled_outbox');
 await assert.rejects(t.upload(),{code:'R93H_COMPENSATION_UNCONFIRMED'});
 assert.equal(t.state,'ready'); // never switch READY to deleted
 assert.equal(t.attempts,1);
});
