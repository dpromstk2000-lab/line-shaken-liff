import test from 'node:test';
import assert from 'node:assert/strict';
import {createR93EIsolatedTombstoneGate,R93E_CONTRACT} from './car02-r93e-tombstone-binding-isolated.mjs';
import {createR93DIsolatedCleanupWorker} from './car02-r93d-cleanup-worker-isolated.mjs';
const uuid=n=>`${n.repeat(8)}-${n.repeat(4)}-${n.repeat(4)}-${n.repeat(4)}-${n.repeat(12)}`;
const NOW=Date.parse('2026-10-11T15:00:00.000Z');
const shop='street_house_kitsuki',photoId=uuid('4'),orderId=uuid('2'),reportId=uuid('3'),blobId=uuid('7');
const jobId=uuid('5'),leaseId=uuid('6');
const path=`${shop}/${orderId}/${reportId}/${blobId}.jpg`;
const createdAt=new Date(NOW-7200000).toISOString();
const req=()=>({jobId,leaseId,shopCode:shop,photoId,storagePath:path});
const lease=()=>({jobId,leaseId,shopCode:shop,photoId,orderId,reportId,storageBucket:'ksh-car02-private-photos',
 storagePath:path,photoCreatedAt:createdAt,photoState:'deleted',state:'leased',leaseExpiresMs:NOW+30000});
const photo=()=>({id:photoId,shopCode:shop,orderId,reportId,storageBucket:'ksh-car02-private-photos',
 storagePath:path,uploadState:'deleted',createdAt});
function setup({l=lease(),p=photo(),at=NOW,jobError=false,photoError=false}={}){
 const calls=[];
 const gate=createR93EIsolatedTombstoneGate({environment:'isolated_qa',dbName:'car02_r93e_qa_ephemeral',
  readLeasedJob:async x=>{calls.push(['job',x]);if(jobError)throw Error('secret_DB_KEY');return l;},
  readPhotoRecord:async x=>{calls.push(['photo',x]);if(photoError)throw Error('secret_SERVICE_ROLE');return p;},
  clock:()=>at});
 return {gate,calls};
}
test('R93E accepts one matching private tombstone with a distinct blob UUID',async()=>{
 const {gate,calls}=setup();assert.notEqual(blobId,photoId);assert.equal(await gate.confirmTombstone(req()),true);
 assert.deepEqual(calls.map(x=>x[0]),['job','photo']);
 assert.deepEqual(calls[0][1],{jobId,leaseId,shopCode:shop});
 assert.deepEqual(calls[1][1],{photoId,shopCode:shop});
});
test('R93E is offline-only and never approves a production release',()=>{
 assert.equal(R93E_CONTRACT.liveWiring,false);assert.equal(R93E_CONTRACT.productionReady,false);
 assert.equal(R93E_CONTRACT.releaseDecision,'NO_GO');assert.equal(R93E_CONTRACT.migrationDecision,'HOLD');
});
for(const environment of [undefined,'production','stage','isolated_qa ',null])test('environment is rejected '+String(environment),()=>{
 assert.throws(()=>createR93EIsolatedTombstoneGate({environment,dbName:'car02_r93e_qa_ephemeral',readLeasedJob:async()=>{},readPhotoRecord:async()=>{}}),/R93E_ISOLATED_CONFIG_REQUIRED/);
});
for(const dbName of [undefined,'postgres','liff-salon-reserve','car02_r93e_qa','car02_r93e_qa_../prod','CAR02_R93E_QA_A'])test('database name is rejected '+String(dbName),()=>{
 assert.throws(()=>createR93EIsolatedTombstoneGate({environment:'isolated_qa',dbName,readLeasedJob:async()=>{},readPhotoRecord:async()=>{}}),/R93E_ISOLATED_CONFIG_REQUIRED/);
});
for(const [name,change] of [
 ['shop', x=>x.shopCode='other_shop'],['photo ID',x=>x.id=uuid('8')],
 ['order',x=>x.orderId=uuid('8')],['report',x=>x.reportId=uuid('8')],
 ['bucket',x=>x.storageBucket='public'],['path',x=>x.storagePath=`${shop}/${orderId}/${reportId}/${uuid('8')}.jpg`],
 ['state ready',x=>x.uploadState='ready'],['state pending',x=>x.uploadState='pending'],
 ['createdAt',x=>x.createdAt=new Date(NOW-8000000).toISOString()],
 ['malformed createdAt',x=>x.createdAt='2026-99-99T99:99:99.999Z'],
 ['extra property',x=>x.actorRole='owner'],['missing property',x=>delete x.reportId]
 ])test('R93E rejects tampered trusted photo row: '+name,async()=>{
 const p=photo();change(p);const {gate}=setup({p});assert.equal(await gate.confirmTombstone(req()),false);
});
for(const [name,change] of [
 ['lease ID',x=>x.leaseId=uuid('8')],['job ID',x=>x.jobId=uuid('8')],
 ['shop',x=>x.shopCode='other_shop'],['photo ID',x=>x.photoId=uuid('8')],
 ['order',x=>x.orderId=uuid('8')],['report',x=>x.reportId=uuid('8')],
 ['bucket',x=>x.storageBucket='public'],['path',x=>x.storagePath=`${shop}/${orderId}/${reportId}/${uuid('8')}.jpg`],
 ['state queued',x=>x.state='queued'],['state verified',x=>x.state='verified'],
 ['photo still ready',x=>x.photoState='ready'],['photo pending',x=>x.photoState='pending'],
 ['expiry past',x=>x.leaseExpiresMs=NOW-1],['lease too long',x=>x.leaseExpiresMs=NOW+60001],
 ['createdAt',x=>x.photoCreatedAt=new Date(NOW-8000000).toISOString()],
 ['extra property',x=>x.temporaryRole='admin'],['missing property',x=>delete x.photoId]
 ])test('R93E rejects mismatched leased job: '+name,async()=>{
 const l=lease();change(l);const {gate}=setup({l});assert.equal(await gate.confirmTombstone(req()),false);
});
for(const [name,change] of [
 ['fake job',x=>x.jobId=uuid('8')],['stale lease token',x=>x.leaseId=uuid('8')],
 ['other shop',x=>x.shopCode='other_shop'],['other photo',x=>x.photoId=uuid('8')],
 ['other blob in same report',x=>x.storagePath=`${shop}/${orderId}/${reportId}/${uuid('8')}.jpg`],
 ['traversal',x=>x.storagePath='../secret.jpg'],['encoded path',x=>x.storagePath=path.replace('/', '%2F')],
 ['extra user role',x=>x.role='owner'],['missing path',x=>delete x.storagePath]
 ])test('R93E rejects forged R93D request: '+name,async()=>{
 const q=req();change(q);const {gate}=setup();assert.equal(await gate.confirmTombstone(q),false);
});
for(const [name,options] of [
 ['job reader failure',{jobError:true}],['photo reader failure',{photoError:true}],
 ['missing job',{l:null}],['missing photo',{p:null}],['bad clock',{at:NaN}],
 ['expired lease',{at:NOW+30000}]
 ])test('R93E fails closed and leaks no error for '+name,async()=>{
 const {gate}=setup(options);let r=await gate.confirmTombstone(req());assert.equal(r,false);
});
test('R93E prevents R93D from touching Storage when its photo path is swapped inside the same report',async()=>{
 const l=lease(),p=photo();p.storagePath=`${shop}/${orderId}/${reportId}/${uuid('8')}.jpg`;
 const {gate}=setup({l,p});const calls=[];let consumed=false;
 const ledger={
  async claim(){calls.push('claim');if(consumed)return null;consumed=true;return {
   jobId,leaseId,leasedUntilMs:NOW+30000,attempts:0,shopCode:shop,photoId,orderId,reportId,
   storageBucket:'ksh-car02-private-photos',storagePath:path,photoCreatedAt:createdAt,uploadState:'deleted'
  }},
  confirmTombstone:gate.confirmTombstone,
  async markVerified(){calls.push('markVerified');return true},
  async reschedule(){calls.push('reschedule');return true},
  async escalate(){calls.push('escalate');return true}
 };
 const storage={async remove(){calls.push('remove');return {status:204}},async probe(){calls.push('probe');return {status:404}}};
 const worker=createR93DIsolatedCleanupWorker({environment:'isolated_qa',dbName:'car02_r93d_qa_fixture',
 ledger,storage,clock:()=>NOW});
 const r=await worker.one();assert.equal(r.action,'ESCALATED');
 assert.deepEqual(calls,['claim','escalate']);assert.equal(r.releaseDecision,'NO_GO');
});
test('R93E permits R93D clean delete and 404 verification only after entire tuple matches',async()=>{
 const {gate}=setup();const calls=[];let claimed=false;
 const ledger={
  async claim(){if(claimed)return null;claimed=true;calls.push('claim');return {
   jobId,leaseId,leasedUntilMs:NOW+30000,attempts:0,shopCode:shop,photoId,orderId,reportId,
   storageBucket:'ksh-car02-private-photos',storagePath:path,photoCreatedAt:createdAt,uploadState:'deleted'
  }},
  confirmTombstone:gate.confirmTombstone,
  async markVerified(){calls.push('markVerified');return true},
  async reschedule(){calls.push('reschedule');return true},
  async escalate(){calls.push('escalate');return true}
 };
 const storage={async remove(){calls.push('remove');return {status:204}},async probe(){calls.push('probe');return {status:404}}};
 const worker=createR93DIsolatedCleanupWorker({environment:'isolated_qa',dbName:'car02_r93d_qa_fixture',ledger,storage,clock:()=>NOW});
 assert.equal((await worker.one()).action,'VERIFIED_GONE');assert.deepEqual(calls,['claim','remove','probe','markVerified']);
});
