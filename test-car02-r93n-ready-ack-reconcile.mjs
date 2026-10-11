import test from 'node:test';
import assert from 'node:assert/strict';
import {createR93NIsolatedReadyAckReconciler,R93N_CONTRACT} from './car02-r93n-ready-ack-reconcile-isolated.mjs';
const shop='street_house_kitsuki';
const ids={staff:'11111111-1111-4111-8111-111111111111',order:'22222222-2222-4222-8222-222222222222',
 report:'33333333-3333-4333-8333-333333333333',photo:'44444444-4444-4444-8444-444444444444',file:'77777777-7777-4777-8777-777777777777'};
const db='car02_r93n_qa_ci';
const path=`${shop}/${ids.order}/${ids.report}/${ids.file}.jpg`;
const actor=Object.freeze({verified:true,shopCode:shop,role:'staff',subject:`staff:${ids.staff}`});
const receipt=Object.freeze({actor,shopCode:shop,orderId:ids.order,reportId:ids.report,bucket:'ksh-car02-private-photos',path,mimeType:'image/jpeg',byteSize:777,sha256:'a'.repeat(64)});
const ready=Object.freeze({actor,shopCode:shop,photoId:ids.photo,orderId:ids.order,reportId:ids.report,bucket:receipt.bucket,path,expectedState:'pending'});
function rig(fault={}){
 const calls=[];let photoState=fault.state||'ready';
 let reserveCount=0,cleanup=0;
 const pool={async connect(){calls.push('connect');if(fault.connectionFails)throw Error('pool unavailable');
 return {async query(q,params=[]){calls.push([q,params]);
 if(fault.queryFail && q.includes(fault.queryFail))throw Error('DB offline');
 if(q==='BEGIN'||q.startsWith('SET LOCAL')||q==='COMMIT'||q==='ROLLBACK')return {rows:[]};
 if(q.includes('SELECT current_database()'))return {rows:[{db:fault.dbName||db,photos_present:fault.tableMissing!==true,staff_present:true,jobs_present:true,no_live_photos:fault.liveTable!==true}]};
 if(q.includes('SELECT role,active FROM car02_r93n_qa.staff'))return {rows:[{role:fault.role||'staff',active:fault.active!==false}]};
 if(q.includes('SELECT p.id,p.shop_code'))return {rows:fault.missingPhoto?[]:[{
 id:ids.photo,shop_code:fault.wrongShop?'other_shop':shop,order_id:ids.order,report_id:ids.report,
 storage_bucket:fault.publicBucket?'public_images':receipt.bucket,
 storage_path:fault.wrongPath?'other/'+ids.file+'.jpg':path,
 mime_type:fault.wrongMime?'image/png':'image/jpeg',byte_size:fault.badBytes?999:777,
 sha256:fault.badHash?'b'.repeat(64):receipt.sha256,upload_state:photoState,order_status:fault.notDraft?'completed':'draft'}]};
 if(q.includes('SELECT count(*)::integer AS n FROM car02_r93n_qa.cleanup_jobs'))return {rows:[{n:fault.hasCleanup?1:0}]};
 throw Error('Unexpected SQL: '+q);
 },release(){calls.push('release')}};
 }};
 const repository={
 async reserve(x){reserveCount++;calls.push('reserve');return fault.badReserve?{photoId:'wrong',state:'pending'}:{photoId:ids.photo,state:'pending'};},
 async markReady(x){calls.push('markReady');if(fault.markResult==='throw'){if(fault.pendingAfterError)photoState='pending';throw Error('ACK_LOST')}
 if(fault.markResult==='false')return false;
 photoState='ready';return true;},
 async tombstoneAndEnqueue(x){calls.push('tombstoneAndEnqueue');cleanup++;return true}
 };
 const config={environment:'isolated_qa',dbName:db,shopCode:shop,pool,repository,reviewGate:async()=>fault.gateOpen!==false};
 const service=createR93NIsolatedReadyAckReconciler(config);
 return {service,calls,repository,config,get cleanup(){return cleanup},get reserves(){return reserveCount}};
}
test('R93N normal reserve and successful ready acknowledgement do not query recovery DB',async()=>{
 const r=rig();await r.service.reserve(receipt);assert.equal(await r.service.markReady(ready),true);
 assert.equal(r.calls.some(x=>x==='connect'),false);assert.equal(r.cleanup,0);
});
test('R93N lost ACK after commit re-verifies exact ready row in a NEW transaction',async()=>{
 const r=rig({markResult:'throw'});await r.service.reserve(receipt);assert.equal(await r.service.markReady(ready),true);
 const names=r.calls.map(v=>typeof v==='string'?v:v[0]);
 assert.ok(names.includes('BEGIN')&&names.includes('COMMIT')&&names.includes('release'));
 assert.equal(names.includes('ROLLBACK'),false);
 assert.equal(r.cleanup,0);
});
test('R93N non-boolean ready response invokes verification',async()=>{
 const r=rig({markResult:'false'});await r.service.reserve(receipt);assert.equal(await r.service.markReady(ready),true);
 assert.equal(r.calls.includes('connect'),true);
});
for(const [title,fault,code] of [
 ['pending after lost ACK',{markResult:'throw',pendingAfterError:true},'R93N_READY_PROOF_FAILED'],
 ['wrong tenant',{markResult:'throw',wrongShop:true},'R93N_READY_PROOF_FAILED'],
 ['wrong photo path',{markResult:'throw',wrongPath:true},'R93N_READY_PROOF_FAILED'],
 ['public bucket',{markResult:'throw',publicBucket:true},'R93N_READY_PROOF_FAILED'],
 ['wrong media type',{markResult:'throw',wrongMime:true},'R93N_READY_PROOF_FAILED'],
 ['wrong byte size',{markResult:'throw',badBytes:true},'R93N_READY_PROOF_FAILED'],
 ['wrong sha256',{markResult:'throw',badHash:true},'R93N_READY_PROOF_FAILED'],
 ['missing photo',{markResult:'throw',missingPhoto:true},'R93N_READY_PROOF_FAILED'],
 ['completed order',{markResult:'throw',notDraft:true},'R93N_READY_PROOF_FAILED'],
 ['inactive staff',{markResult:'throw',active:false},'R93N_STAFF_REVOKED'],
 ['wrong staff role',{markResult:'throw',role:'owner'},'R93N_STAFF_REVOKED'],
 ['queued cleanup collision',{markResult:'throw',hasCleanup:true},'R93N_OUTBOX_CONFLICT'],
 ['incorrect QA database',{markResult:'throw',dbName:'production'},'R93N_DISPOSABLE_DB_REQUIRED'],
 ['live public photos table',{markResult:'throw',liveTable:true},'R93N_DISPOSABLE_DB_REQUIRED'],
 ['missing QA table',{markResult:'throw',tableMissing:true},'R93N_DISPOSABLE_DB_REQUIRED'],
 ['review gate closed',{markResult:'throw',gateOpen:false},'R93N_GATE_CLOSED'],
 ['db temporarily unavailable',{markResult:'throw',connectionFails:true},'R93N_RECONCILIATION_UNAVAILABLE'],
 ['staff SQL failure',{markResult:'throw',queryFail:'SELECT role,active'},'R93N_RECONCILIATION_UNAVAILABLE'],
 ['metadata query SQL failure',{markResult:'throw',queryFail:'SELECT p.id,p.shop_code'},'R93N_RECONCILIATION_UNAVAILABLE']
])test('lost ack fail-closed: '+title,async()=>{
 const r=rig(fault);await r.service.reserve(receipt);
 await assert.rejects(r.service.markReady(ready),{code});
 assert.equal(r.cleanup,0);
 const names=r.calls.map(v=>typeof v==='string'?v:v[0]);
 if(names.includes('BEGIN'))assert.ok(names.includes('ROLLBACK'));
});
for(const x of [
 {environment:'production'}, {dbName:'prod'}, {dbName:'car02_r93m_qa_ci'},
 {shopCode:'Other Shop'}, {pool:null}, {repository:null}, {reviewGate:null},
 {environment:undefined}, {dbName:'car02_r93n_qa_../../prod'}, {shopCode:'x'}
])test('constructor rejects unsafe config '+JSON.stringify(x),()=>{
 const good=rig().config;assert.throws(()=>createR93NIsolatedReadyAckReconciler({...good,...x}),{code:'R93N_ISOLATION_REQUIRED'});
});
for(const [name,invalid] of [
 ['other shop',{shopCode:'other_shop'}],['not verified',{actor:{...actor,verified:false}}],
 ['invalid subject',{actor:{...actor,subject:'any'}}],['wrong bucket',{bucket:'public'}],
 ['wrong path',{path:'other/x.jpg'}],['wrong mime',{mimeType:'image/gif'}],
 ['wrong SHA',{sha256:'ff'}],['negative bytes',{byteSize:-1}],['size too large',{byteSize:5242881}],
 ['invalid UUID',{orderId:'invalid'}],['bad report',{reportId:'../'}],['bad shop',{shopCode:''}]
])test('reservation rejects '+name,async()=>{
 const r=rig();await assert.rejects(r.service.reserve({...receipt,...invalid}),{code:'R93N_RESERVATION_SCOPE_INVALID'});
 assert.equal(r.reserves,0);
});
for(const [name,invalid] of [
 ['wrong actor',{actor:{...actor,role:'owner'}}],['wrong subject',{actor:{...actor,subject:'staff:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'}}],
 ['wrong report',{reportId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}],
 ['wrong order',{orderId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}],
 ['wrong state',{expectedState:'ready'}],['wrong bucket',{bucket:'other'}],
 ['wrong path',{path:'other/path.jpg'}],['wrong shop',{shopCode:'other_shop'}],
 ['wrong photo',{photoId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}]
])test('markReady rejects '+name+' before any DB effects',async()=>{
 const r=rig({markResult:'throw'});await r.service.reserve(receipt);
 await assert.rejects(r.service.markReady({...ready,...invalid}),{code:'R93N_READY_SCOPE_INVALID'});
 assert.equal(r.calls.includes('connect'),false);
});
test('unreserved photo cannot markReady',async()=>{
 const r=rig();await assert.rejects(r.service.markReady(ready),{code:'R93N_READY_SCOPE_INVALID'});
});
test('double reservation with same photo id is rejected',async()=>{
 const r=rig();await r.service.reserve(receipt);await assert.rejects(r.service.reserve(receipt),{code:'R93N_DUPLICATE_RESERVATION'});
});
test('an invalid repository receipt never enters the local reservation cache',async()=>{
 const r=rig({badReserve:true});await assert.rejects(r.service.reserve(receipt),{code:'R93N_RESERVATION_UNVERIFIED'});
 await assert.rejects(r.service.markReady(ready),{code:'R93N_READY_SCOPE_INVALID'});
});
for(const [name,invalid] of [['reason',{reason:'OTHER'}],['actor',{actor:{...actor,role:'owner'}}],['path',{path:'other'}],['state',{expectedState:'ready'}]])
 test('compensation requires exact original reservation '+name,async()=>{
  const r=rig();await r.service.reserve(receipt);await assert.rejects(r.service.tombstoneAndEnqueue({...ready,reason:'UPLOAD_UNCERTAIN',...invalid}),{code:'R93N_COMPENSATION_SCOPE_INVALID'});
  assert.equal(r.cleanup,0);
 });
test('valid uncertain compensation calls existing repository unchanged',async()=>{
 const r=rig();await r.service.reserve(receipt);
 assert.equal(await r.service.tombstoneAndEnqueue({...ready,reason:'UPLOAD_UNCERTAIN'}),true);
 assert.equal(r.cleanup,1);assert.equal(r.calls.includes('connect'),false);
});
test('contract documents remaining deployment hold and no direct deletion',()=>{
 assert.equal(R93N_CONTRACT.productionReady,false);assert.equal(R93N_CONTRACT.liveWiring,false);
 assert.equal(R93N_CONTRACT.releaseDecision,'NO_GO');assert.equal(R93N_CONTRACT.migrationDecision,'HOLD');
 assert.equal(R93N_CONTRACT.neverCallsStorageDelete,true);
 assert.equal(R93N_CONTRACT.requiresOriginalR93MConnectionInFuture,true);
});
