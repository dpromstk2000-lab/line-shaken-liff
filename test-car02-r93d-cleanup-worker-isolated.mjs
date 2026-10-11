import test from 'node:test';
import assert from 'node:assert/strict';
import {createR93DIsolatedCleanupWorker,R93D_ISOLATION} from './car02-r93d-cleanup-worker-isolated.mjs';
const uuid=n=>`${n.repeat(8)}-${n.repeat(4)}-${n.repeat(4)}-${n.repeat(4)}-${n.repeat(12)}`;
const SHOP='street_house_kitsuki';const PHOTO=uuid('4');const ORDER=uuid('2');const REPORT=uuid('3');
const JOB=uuid('5');const LEASE=uuid('6');const NOW=Date.parse('2026-10-11T15:00:00.000Z');
const good=()=>({jobId:JOB,leaseId:LEASE,leasedUntilMs:NOW+30000,attempts:0,shopCode:SHOP,
  photoId:PHOTO,orderId:ORDER,reportId:REPORT,storageBucket:'ksh-car02-private-photos',
  storagePath:`${SHOP}/${ORDER}/${REPORT}/${uuid('7')}.jpg`,photoCreatedAt:new Date(NOW-7200000).toISOString(),uploadState:'deleted'});
function setup({job=good(),deleteStatus=204,probeStatus=404,confirm=true,failAt='',clock=NOW}={}){
 let calls=[],leased=false;
 const act=async(name,arg)=>{calls.push({name,arg});if(failAt===name)throw Error('SECRET_DSN_SHOULD_NOT_LEAK');return true};
 const ledger={
  async claim(){if(leased)return null;leased=true;await act('claim');return job},
  async confirmTombstone(x){await act('confirmTombstone',x);return confirm},
  async markVerified(x){return act('markVerified',x)},
  async reschedule(x){return act('reschedule',x)},
  async escalate(x){return act('escalate',x)}
 };
 const storage={async remove(x){await act('remove',x);return {status:deleteStatus}},
  async probe(x){await act('probe',x);return {status:probeStatus}}};
 const worker=createR93DIsolatedCleanupWorker({environment:'isolated_qa',dbName:'car02_r93d_qa_tmp',ledger,storage,clock:()=>clock});
 return {worker,calls};
}
const action=async(cfg)=>{const o=setup(cfg);return {result:await o.worker.one(),calls:o.calls}};
const seen=(calls,n)=>calls.filter(x=>x.name===n).length;

test('R93D can operate only in explicitly isolated environment',()=>{
 const s=setup();assert.equal(R93D_ISOLATION.live,false);assert.equal(typeof s.worker.one,'function');
});
for(const env of [undefined,'production','stage','isolated_qa ',null])
 test('reject environment '+String(env),()=>assert.throws(()=>createR93DIsolatedCleanupWorker({environment:env,dbName:'car02_r93d_qa_x',ledger:{},storage:{}}),/R93D_INVALID/));
for(const dbName of ['postgres','liff-salon-reserve','car02_r93d_qa','car02_r93d_qa_../prod','CAR02_R93D_QA_X'])
 test('reject database name '+dbName,()=>assert.throws(()=>createR93DIsolatedCleanupWorker({environment:'isolated_qa',dbName,ledger:{},storage:{}}),/R93D_INVALID/));
test('normal 204+404 requires tombstone check and immutable verification proof',async()=>{
 const {result,calls}=await action({});assert.equal(result.action,'VERIFIED_GONE');
 assert.deepEqual(calls.map(x=>x.name),['claim','confirmTombstone','remove','probe','markVerified']);
 assert.deepEqual(calls.at(-1).arg,{jobId:JOB,leaseId:LEASE,shopCode:SHOP,proof:'PRIVATE_OBJECT_PROBE_404'});
 assert.ok(calls.every(x=>!JSON.stringify(x).includes('secret')));
 assert.equal(result.productionReady,false);assert.equal(result.releaseDecision,'NO_GO');assert.equal(result.migrationDecision,'HOLD');
});
for(const status of [200,202,204,404])test('delete ack '+status+' followed by probe 404 can verify',async()=>{
 const {result,calls}=await action({deleteStatus:status});assert.equal(result.action,'VERIFIED_GONE');assert.equal(seen(calls,'markVerified'),1);
});
for(const status of [200,206,304,500])test('probe '+status+' cannot confirm cleanup',async()=>{
 const {result,calls}=await action({probeStatus:status});assert.equal(result.action,'RETRY_SCHEDULED');assert.equal(seen(calls,'markVerified'),0);
});
for(const status of [401,403])test('delete auth '+status+' escalates without probe',async()=>{
 const {result,calls}=await action({deleteStatus:status});assert.equal(result.action,'ESCALATED');assert.equal(seen(calls,'probe'),0);
});
for(const status of [400,422])test('invalid delete status '+status+' escalates without probe',async()=>{
 const {result,calls}=await action({deleteStatus:status});assert.equal(result.action,'ESCALATED');assert.equal(seen(calls,'probe'),0);
});
for(const status of [408,409,425,429,500,503])test('retryable delete '+status+' is deferred',async()=>{
 const {result,calls}=await action({deleteStatus:status});assert.equal(result.action,'RETRY_SCHEDULED');assert.equal(seen(calls,'probe'),0);
});
for(const status of [401,403])test('probe auth '+status+' escalates without verification',async()=>{
 const {result,calls}=await action({probeStatus:status});assert.equal(result.action,'ESCALATED');assert.equal(seen(calls,'markVerified'),0);
});
for(const failAt of ['claim','confirmTombstone','remove','probe','markVerified','reschedule','escalate'])
 test('adapter error sanitized '+failAt,async()=>{
 const opts={failAt};if(failAt==='reschedule')opts.probeStatus=200;
 if(failAt==='escalate')opts.job={...good(),uploadState:'pending'};
 const {result,calls}=await action(opts);assert.doesNotMatch(JSON.stringify(result),/SECRET_DSN|SHOULD_NOT_LEAK/);
 assert.notEqual(result.action,'VERIFIED_GONE');if(failAt==='remove'||failAt==='probe')assert.equal(seen(calls,'markVerified'),0);
});
for(const changed of [
 {uploadState:'ready'},{uploadState:'pending'},{storageBucket:'public'},
 {shopCode:'other_shop'},{storagePath:'../secret'},{storagePath:'other_shop/nope.jpg'},
 {photoId:'bad'},{photoCreatedAt:'yesterday'},{attempts:-1},
 {leaseId:'invalid'},{leasedUntilMs:NOW-1},{leasedUntilMs:NOW+61000},
 {attempts:9},{jobId:'bad'}
])test('untrusted or not-deleted job must not touch Storage '+JSON.stringify(changed),async()=>{
 const {result,calls}=await action({job:{...good(),...changed}});
 assert.equal(seen(calls,'remove'),0);assert.equal(seen(calls,'probe'),0);
 assert.equal(seen(calls,'markVerified'),0);assert.notEqual(result.action,'VERIFIED_GONE');
});
test('confirmed tombstone failure prevents delete',async()=>{
 const {result,calls}=await action({confirm:false});assert.equal(result.action,'ESCALATED');assert.equal(seen(calls,'remove'),0);
});
test('fresh tombstone waits rather than removes',async()=>{
 const job={...good(),photoCreatedAt:new Date(NOW-500).toISOString()};const {result,calls}=await action({job});
 assert.equal(result.action,'RETRY_SCHEDULED');assert.equal(result.reason,'UPLOAD_GRACE');assert.equal(seen(calls,'remove'),0);
});
test('exhausted retries require manual operator and no object access',async()=>{
 const {result,calls}=await action({job:{...good(),attempts:8}});
 assert.equal(result.action,'ESCALATED');assert.equal(seen(calls,'remove'),0);
});
test('replay of same lease does not cause second delete in atomic ledger mock',async()=>{
 const o=setup();const first=await o.worker.one(),second=await o.worker.one();assert.equal(first.action,'VERIFIED_GONE');assert.equal(second.action,'IDLE');assert.equal(seen(o.calls,'remove'),1);
});
test('unsafe current time is rejected before any DB/storage call',async()=>{
 const {result,calls}=await action({clock:NaN});assert.equal(result.action,'UNSAFE_CLOCK');assert.equal(calls.length,0);
});
test('eighth delete attempt requires human review rather than unbounded retry',async()=>{
 const {result,calls}=await action({probeStatus:200,job:{...good(),attempts:7}});
 assert.equal(result.action,'ESCALATED');assert.equal(result.reason,'ESCALATE_MANUAL_REVIEW');assert.equal(seen(calls,'markVerified'),0);
});
test('seventh delete attempt is durably rescheduled within 24-hour limit',async()=>{
 const {result,calls}=await action({probeStatus:200,job:{...good(),attempts:6}});
 assert.equal(result.action,'RETRY_SCHEDULED');assert.ok(result.delayMs>0&&result.delayMs<=86400000);assert.equal(seen(calls,'markVerified'),0);
});
