import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createR93KIsolatedR83RepositoryBridge,R93K_CONTRACT} from './car02-r93k-r83-repository-bridge-isolated.mjs';
const SHOP='street_house_kitsuki', O='22222222-2222-4222-8222-222222222222',R='33333333-3333-4333-8333-333333333333',I='44444444-4444-4444-8444-444444444444',J='55555555-5555-4555-8555-555555555555';
const bucket='ksh-car02-private-photos', path=`${SHOP}/${O}/${R}/77777777-7777-4777-8777-777777777777.jpg`;
const actor={verified:true,shopCode:SHOP,role:'staff',subject:'staff:'+I};
const meta=()=>({actor,shopCode:SHOP,orderId:O,reportId:R,bucket,path,mimeType:'image/jpeg',byteSize:10,sha256:createHash('sha256').update('abcdefg').digest('hex')});
const key=()=>({actor,shopCode:SHOP,photoId:I,orderId:O,reportId:R,bucket,path,expectedState:'pending'});
const invalid=(fn,err)=>assert.rejects(fn,e=>e?.message===err);
function fixture({badRow='',badReserve='',badReady='',badCompensation='',noPending=false,throwAt=''}={}){
 const calls=[],db={state:'none'},makeErr=s=>{if(throwAt===s)throw Error('SECRET_DATABASE_SERVICE_ROLE_SHOULD_NOT_LEAK');};
 const r83={
  async reserve(x){calls.push(['reserve',x]);makeErr('reserve');db.state='pending';db.meta={...x};return {id:badReserve==='id'?J:I};},
  async getPending(x){calls.push(['getPending',x]);makeErr('getPending');if(noPending||db.state!=='pending')throw Error('CAR02_R83_PHOTO_NOT_PENDING');
   const row={id:I,storage_bucket:bucket,storage_path:path,mime_type:'image/jpeg',byte_size:10,sha256:meta().sha256,upload_state:'pending'};
   if(badRow==='path')row.storage_path='other/secret.jpg';
   if(badRow==='bucket')row.storage_bucket='public';
   if(badRow==='digest')row.sha256='0'.repeat(64);
   if(badRow==='mime')row.mime_type='image/png';
   if(badRow==='bytes')row.byte_size=123;
   return row;
  },
  async markReady(x){calls.push(['markReady',x]);makeErr('markReady');db.state='ready';return {id:badReady==='id'?J:I,state:badReady==='state'?'pending':'ready'};},
  async cancel(){calls.push(['FORBIDDEN_CANCEL']);throw Error('CANCEL_WAS_CALLED');}
 };
 const compensator={async tombstoneAndEnqueue(x){calls.push(['tombstoneAndEnqueue',x]);makeErr('tombstoneAndEnqueue');
   db.state='deleted';db.jobCount=1;
   const result={photoId:I,shopCode:SHOP,storagePath:path,state:'deleted',cleanupState:'queued',jobId:randomUUID(),atomicCommit:true};
   if(badCompensation==='photo')result.photoId=J;
   if(badCompensation==='path')result.storagePath='other/secret.jpg';
   if(badCompensation==='commit')result.atomicCommit=false;
   if(badCompensation==='job')result.jobId='bad';
   if(badCompensation==='state')result.state='ready';
   if(badCompensation==='cleanup')result.cleanupState='none';
   return result;
 }};
 return {bridge:createR93KIsolatedR83RepositoryBridge({environment:'isolated_qa',dbName:'car02_r93k_qa_fixture',r83Port:r83,atomicCompensationPort:compensator}),calls,db};
}
const count=(f,name)=>f.calls.filter(([s])=>s===name).length;
test('R93K explicit unfinished DB migration and NO_GO HOLD',()=>{
 assert.equal(R93K_CONTRACT.productionReady,false);
 assert.equal(R93K_CONTRACT.liveWiring,false);
 assert.equal(R93K_CONTRACT.transactionalAdapterNotYetImplemented,true);
 assert.equal(R93K_CONTRACT.r83AndR93hDatabaseNamesCurrentlyIncompatible,true);
 assert.equal(R93K_CONTRACT.releaseDecision,'NO_GO');assert.equal(R93K_CONTRACT.migrationDecision,'HOLD');
});
for(const [name,patch] of [ ['production',{environment:'production'}],['db',{dbName:'postgres'}],['live',{dbName:'liff-salon-reserve'}],['unverified',{environment:'isolated_qa ',dbName:'car02_r93k_qa_fixture'}],['port',{r83Port:{}}],['compensator',{atomicCompensationPort:{}}]]){
 test('constructor rejects '+name,()=>assert.throws(()=>{
  const fx=fixture();return createR93KIsolatedR83RepositoryBridge({environment:'isolated_qa',dbName:'car02_r93k_qa_fixture',r83Port:{reserve(){},getPending(){},markReady(){}},atomicCompensationPort:{tombstoneAndEnqueue(){}},...patch});
 },/R93K_ISOLATED_DEPENDENCIES_REQUIRED/));
}
test('R83 reserve id maps to R93H photoId pending while preserving exact scoped args',async()=>{
 const f=fixture(),v=await f.bridge.reserve(meta());assert.deepEqual(v,{photoId:I,state:'pending'});
 assert.equal(count(f,'reserve'),1);assert.equal(count(f,'getPending'),1);assert.equal(f.calls[0][1].shop,SHOP);
 assert.equal(f.calls[1][1].photoId,I);assert.equal(f.calls[0][1].sha256,meta().sha256);
 assert.equal(f.calls[0][1].path,path);assert.equal(Object.isFrozen(v),true);
});
for(const row of ['path','bucket','digest','mime','bytes'])test('reserve refuses mismatched persisted '+row,async()=>{
 const f=fixture({badRow:row});await assert.rejects(()=>f.bridge.reserve(meta()),e=>['R93K_RESERVED_METADATA_MISMATCH','R93K_PENDING_IDENTITY_MISMATCH'].includes(e?.message));
 assert.equal(count(f,'tombstoneAndEnqueue'),0);
});
test('wrong reserve id rejected before upload',async()=>{
 const f=fixture({badReserve:'id'});await invalid(()=>f.bridge.reserve(meta()),'R93K_PENDING_IDENTITY_MISMATCH');
});
for(const patch of [x=>x.shopCode='other_shop',x=>x.actor={...actor,shopCode:'other_shop'},x=>x.actor={...actor,verified:false},x=>x.path='other/secret.jpg',x=>x.byteSize=5242881,x=>x.mimeType='image/gif',x=>x.sha256='bad',x=>x.reportId='no',x=>x.bucket='public'])test('reserve fails closed with unsafe metadata '+patch.toString().slice(0,45),async()=>{
 const f=fixture(),x=meta();patch(x);await invalid(()=>f.bridge.reserve(x),'R93K_UNVERIFIED_SCOPE');assert.equal(count(f,'reserve'),0);
});
test('R83 markReady {id,state} adapts to R93H boolean',async()=>{
 const f=fixture();await f.bridge.reserve(meta());assert.equal(await f.bridge.markReady(key()),true);
 assert.equal(f.db.state,'ready');assert.equal(count(f,'markReady'),1);
 assert.deepEqual(f.calls.find(([k])=>k==='markReady')[1],{actor,shop:SHOP,photoId:I,expectedState:'pending'});
});
for(const bad of ['id','state'])test('R83 markReady unexpected '+bad+' becomes false',async()=>{
 const f=fixture({badReady:bad});await f.bridge.reserve(meta());assert.equal(await f.bridge.markReady(key()),false);
});
for(const patch of [x=>x.photoId=J,x=>x.path='other/secret.jpg',x=>x.shopCode='other_shop',x=>x.expectedState='ready',x=>x.bucket='public']) test('R83 markReady blocks forged identity '+patch.toString().slice(0,45),async()=>{
 const f=fixture(),x=key();patch(x);await assert.rejects(()=>f.bridge.markReady(x),e=>['R93K_UNVERIFIED_SCOPE','R93K_PENDING_IDENTITY_MISMATCH','CAR02_R83_PHOTO_NOT_PENDING'].includes(e?.message));
 // regardless of error category, no write should have happened
 assert.equal(count(f,'markReady'),0);
});
test('atomic tombstone and outbox return verified boolean; R83.cancel is never called',async()=>{
 const f=fixture();await f.bridge.reserve(meta());assert.equal(await f.bridge.tombstoneAndEnqueue({...key(),reason:'UPLOAD_UNCERTAIN'}),true);
 assert.equal(f.db.state,'deleted');assert.equal(f.db.jobCount,1);assert.equal(count(f,'FORBIDDEN_CANCEL'),0);
 assert.equal(count(f,'tombstoneAndEnqueue'),1);
});
for(const bad of ['photo','path','commit','job','state','cleanup'])test('reject unverified atomic compensation receipt '+bad,async()=>{
 const f=fixture({badCompensation:bad});await f.bridge.reserve(meta());await invalid(()=>f.bridge.tombstoneAndEnqueue({...key(),reason:'UPLOAD_UNCERTAIN'}),'R93K_ATOMIC_RECEIPT_UNVERIFIED');
});
test('refuse compensation for wrong reason, do not mutate',async()=>{
 const f=fixture();await invalid(()=>f.bridge.tombstoneAndEnqueue({...key(),reason:'USER_REQUEST'}),'R93K_UNVERIFIED_REASON');assert.equal(count(f,'tombstoneAndEnqueue'),0);
});
for(const throwAt of ['reserve','getPending','markReady','tombstoneAndEnqueue'])test('port failure '+throwAt+' cannot fabricate success',async()=>{
 const f=fixture({throwAt});if(throwAt==='reserve'||throwAt==='getPending')await assert.rejects(()=>f.bridge.reserve(meta()));
 else{await f.bridge.reserve(meta());if(throwAt==='markReady')await assert.rejects(()=>f.bridge.markReady(key()));
 else await assert.rejects(()=>f.bridge.tombstoneAndEnqueue({...key(),reason:'UPLOAD_UNCERTAIN'}));}
 assert.equal(count(f,'FORBIDDEN_CANCEL'),0);
});
test('write acknowledgement lost after commit is never reported as true by adapter',async()=>{
 const f=fixture({throwAt:'markReady'});await f.bridge.reserve(meta());await assert.rejects(()=>f.bridge.markReady(key()));
 assert.equal(count(f,'FORBIDDEN_CANCEL'),0);
});
