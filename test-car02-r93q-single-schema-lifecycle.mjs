import test from 'node:test';
import assert from 'node:assert/strict';
import {createR93QIsolatedPgPhotoLifecycle,R93Q_CONTRACT} from './car02-r93q-single-schema-lifecycle-isolated.mjs';
const shop='street_house_kitsuki',db='car02_r93q_qa_ci';
const staff='11111111-1111-4111-8111-111111111111';
const photo='44444444-4444-4444-8444-444444444444';
const order='22222222-2222-4222-8222-222222222222';
const report='33333333-3333-4333-8333-333333333333';
const path=`${shop}/${order}/${report}/77777777-7777-4777-8777-777777777777.jpg`;
const actor={verified:true,role:'staff',subject:`staff:${staff}`,shopCode:shop};
const meta={actor,shopCode:shop,orderId:order,reportId:report,bucket:'ksh-car02-private-photos',path,mimeType:'image/jpeg',byteSize:777,sha256:'a'.repeat(64)};
const key={actor,shopCode:shop,photoId:photo,orderId:order,reportId:report,bucket:meta.bucket,path,expectedState:'pending'};
function rig(fault={}){
 let row=null, jobs=[],tx=0,releases=0,queries=[],commitCount=0,revoked=false,gate=true,rolledBack=0;
 const pool={async connect(){if(fault.noConnection)throw Error('DATABASE_UNAVAILABLE');return{
  async query(q,p=[]){queries.push([q,p]);
   if(q==='BEGIN'){tx++;return {rows:[]}}
   if(q.startsWith('SET LOCAL'))return {rows:[]};
   if(q==='COMMIT'){commitCount++;tx--; if(fault.lateOutboxAfterReadyCommit&&commitCount===2)jobs.push({photo_id:photo,shop_code:'other_shop',storage_path:'other/path'}); if(fault.lostCommitAck&&commitCount===fault.lostCommitAck)throw Error('COMMIT_ACK_LOST');return {rows:[]}}
   if(q==='ROLLBACK'){rolledBack++;tx=Math.max(0,tx-1);return {rows:[]}}
   if(q.includes('current_database()'))return {rows:[{db:fault.badDb?'some_live_db':db,staff_table:true,photo_table:true,outbox_table:true,no_live_photos:true}]};
   if(q.includes('SELECT role,active'))return {rows:[{role:fault.badRole?'owner':'staff',active:!revoked&&!fault.revoked}]};
   if(q.includes('SELECT o.id AS order_id'))return {rows:[{order_id:order,report_id:report,order_status:fault.closedOrder?'completed':'draft'}]};
   if(q.includes('FROM car02_r93q_qa.photos')&&q.includes('count(*)::integer'))return {rows:[{n:fault.maxPhotos?3:row?.upload_state==='pending'||row?.upload_state==='ready'?1:0}]};
   if(q.includes('INSERT INTO car02_r93q_qa.photos')){row={id:photo,shop_code:shop,order_id:order,report_id:report,storage_bucket:meta.bucket,storage_path:path,mime_type:'image/jpeg',byte_size:777,sha256:meta.sha256,upload_state:'pending',order_status:'draft'};return {rows:[{id:photo,upload_state:'pending'}]};}
   if(q.includes('SELECT p.id,p.shop_code'))return {rows:row?[{...row,sha256:fault.tamperedSha?'b'.repeat(64):row.sha256,storage_path:fault.tamperedPath?'other/path.jpg':row.storage_path,order_status:fault.closedOrder?'closed':'draft'}]:[]};
   if(q.includes('FROM car02_r93q_qa.cleanup_jobs')&&q.includes('count(*)::integer')){
     assert.match(q,/WHERE photo_id=\$1/);assert.doesNotMatch(q,/shop_code=|storage_path=/);
     return {rows:[{n:jobs.filter(j=>j.photo_id===p[0]).length}]};
   }
   if(q.includes('UPDATE car02_r93q_qa.photos SET upload_state')){
    if(!row||row.upload_state!=='pending')return {rows:[]};
    row.upload_state=q.includes("='ready'")?'ready':'deleted';
    return {rows:[{id:photo,upload_state:row.upload_state}]};
   }
   if(q.includes('INSERT INTO car02_r93q_qa.cleanup_jobs')){
    if(fault.outboxFailure)throw Error('OUTBOX_INSERT_FAILED');
    jobs.push({photo_id:p[0],shop_code:p[1],storage_path:p[2]});
    return {rows:[{job_id:'99999999-9999-4999-8999-999999999999',state:'queued'}]};
   }
   throw Error(`unexpected_sql ${q}`);
  },release(){releases++}
 }}};
 const service=createR93QIsolatedPgPhotoLifecycle({environment:'isolated_qa',dbName:db,shopCode:shop,pool,reviewGate:async()=>gate});
 return {service,pool,get row(){return row},get jobs(){return jobs},get queries(){return queries},get commits(){return commitCount},get releases(){return releases},get rollbacks(){return rolledBack},revoke(){revoked=true},closeGate(){gate=false},queueOutbox(){jobs.push({photo_id:photo,shop_code:'other_shop',storage_path:'wrong/path'})}};
}
for(const [name,config] of [['production',{environment:'production'}],['live database',{dbName:'postgres'}],['wrong shop',{shopCode:'wrong shop'}],['without pool',{pool:null}],['missing gate',{reviewGate:undefined}]])
 test('constructor denies '+name,()=>{const fake={environment:'isolated_qa',dbName:db,shopCode:shop,pool:{connect:async()=>{}},reviewGate:async()=>true};assert.throws(()=>createR93QIsolatedPgPhotoLifecycle({...fake,...config}),{code:'R93Q_ISOLATION_REQUIRED'});});
test('reserve → markReady → fresh proof works on one PG schema',async()=>{
 const r=rig();assert.deepEqual(await r.service.reserve(meta),{photoId:photo,state:'pending'});
 assert.equal(await r.service.markReady(key),true);assert.equal(r.row.upload_state,'ready');
 assert.equal(r.commits,3);assert.equal(r.releases,3);
 const starts=r.queries.map(x=>x[0]).filter(q=>q==='BEGIN').length;assert.equal(starts,3);
});
test('the committed READY record can be verified when commit ACK vanishes',async()=>{
 const r=rig({lostCommitAck:2});await r.service.reserve(meta);assert.equal(await r.service.markReady(key),true);
 assert.equal(r.row.upload_state,'ready');assert.ok(r.commits>=3);
});
for(const [name,fault,code] of [
 ['closed order',{closedOrder:true},'R93Q_DRAFT_SCOPE_REQUIRED'],
 ['photo limit',{maxPhotos:true},'R93Q_THREE_PHOTO_LIMIT'],
 ['revoked staff',{revoked:true},'R93Q_STAFF_DENIED'],
 ['incorrect DB',{badDb:true},'R93Q_NOT_DISPOSABLE_DB'],
 ['wrong role',{badRole:true},'R93Q_STAFF_DENIED']
]) test('reserve fails closed on '+name,async()=>{const r=rig(fault);await assert.rejects(r.service.reserve(meta),{code});assert.equal(r.row,null);});
for(const [name,kind,code] of [
 ['different photo ID',{photoId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},'R93Q_RECEIPT_MISMATCH'],
 ['changed actor',{actor:{...actor,role:'owner'}},'R93Q_RECEIPT_MISMATCH'],
 ['changed order ID',{orderId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},'R93Q_RECEIPT_MISMATCH'],
 ['wrong path',{path:'wrong.jpg'},'R93Q_RECEIPT_MISMATCH'],
 ['changed expected state',{expectedState:'ready'},'R93Q_RECEIPT_MISMATCH'],
 ['public bucket',{bucket:'public'},'R93Q_RECEIPT_MISMATCH'],
]) test('markReady denies '+name,async()=>{const r=rig();await r.service.reserve(meta);await assert.rejects(r.service.markReady({...key,...kind}),{code});assert.equal(r.row.upload_state,'pending');});
for(const [name,fault,afterReserve,code] of [
 ['photo-id outbox veto',{},r=>r.queueOutbox(),'R93Q_OUTBOX_CONFLICT'],
 ['staff loses authorization',{},r=>r.revoke(),'R93Q_STAFF_DENIED'],
 ['check fails after commit',{tamperedSha:true},()=>{},'R93Q_NOT_PENDING'],
 ['path changed',{tamperedPath:true},()=>{},'R93Q_PHOTO_SCOPE_MISMATCH'],
 ['gate closes',{},r=>r.closeGate(),'R93Q_GATE_CLOSED']
]) test('markReady rejects '+name,async()=>{const r=rig(fault);await r.service.reserve(meta);afterReserve(r);await assert.rejects(r.service.markReady(key),{code});});
test('recheck rejects cleanup job added after READY commit but before fresh proof',async()=>{
 const r=rig({lateOutboxAfterReadyCommit:true});await r.service.reserve(meta);
 await assert.rejects(r.service.markReady(key),{code:'R93Q_OUTBOX_CONFLICT'});
 assert.equal(r.row.upload_state,'ready');assert.equal(r.jobs.length,1);
});
test('pending upload can be tombstoned and queued without deleting Storage',async()=>{
 const r=rig();await r.service.reserve(meta);
 assert.equal(await r.service.tombstoneAndEnqueue({...key,reason:'UPLOAD_UNCERTAIN'}),true);
 assert.equal(r.row.upload_state,'deleted');assert.equal(r.jobs.length,1);
});
test('ready photo never becomes deleted during compensation',async()=>{
 const r=rig();await r.service.reserve(meta);await r.service.markReady(key);
 await assert.rejects(r.service.tombstoneAndEnqueue({...key,reason:'UPLOAD_UNCERTAIN'}),{code:'R93Q_NOT_PENDING'});
 assert.equal(r.row.upload_state,'ready');assert.equal(r.jobs.length,0);
});
for(const [name,value] of [['wrong reason','UNKNOWN'],['empty reason',undefined]])test('invalid compensation '+name,async()=>{
 const r=rig();await r.service.reserve(meta);await assert.rejects(r.service.tombstoneAndEnqueue({...key,reason:value}),{code:'R93Q_SCOPE_INVALID'});
});
test('contract never represents staging QA as production-ready',()=>{
 for(const k of ['productionReady','liveWiring','productionMigrationApproved'])assert.equal(R93Q_CONTRACT[k],false);
 assert.equal(R93Q_CONTRACT.releaseDecision,'NO_GO');assert.equal(R93Q_CONTRACT.migrationDecision,'HOLD');
 assert.equal(R93Q_CONTRACT.sameQASchemaForLifecycleAndProof,true);
 assert.equal(R93Q_CONTRACT.ephemeralReceiptCacheOnly,true);
});
