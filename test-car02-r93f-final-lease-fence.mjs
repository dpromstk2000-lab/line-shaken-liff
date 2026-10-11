import test from 'node:test';
import assert from 'node:assert/strict';
import {createR93FIsolatedFinalLeaseFence,R93F_CONTRACT} from './car02-r93f-final-lease-fence-isolated.mjs';
import {createR93DIsolatedCleanupWorker} from './car02-r93d-cleanup-worker-isolated.mjs';
const uuid=n=>`${n.repeat(8)}-${n.repeat(4)}-${n.repeat(4)}-${n.repeat(4)}-${n.repeat(12)}`;
const NOW=Date.parse('2026-10-11T15:00:00.000Z');
const S='street_house_kitsuki',JOB=uuid('5'),LEASE=uuid('6'),PHOTO=uuid('4'),ORDER=uuid('2'),REPORT=uuid('3');
const BUCKET='ksh-car02-private-photos';
const path=`${S}/${ORDER}/${REPORT}/${uuid('7')}.jpg`;
const createdAt=new Date(NOW-7200000).toISOString();
const baseJob=()=>({jobId:JOB,leaseId:LEASE,shopCode:S,photoId:PHOTO,orderId:ORDER,reportId:REPORT,storageBucket:BUCKET,
  storagePath:path,photoCreatedAt:createdAt,photoState:'deleted',state:'leased',leaseExpiresMs:NOW+30000});
const basePhoto=()=>({id:PHOTO,shopCode:S,orderId:ORDER,reportId:REPORT,storageBucket:BUCKET,
  storagePath:path,uploadState:'deleted',createdAt});
const receipt=()=>({jobId:JOB,leaseId:LEASE,shopCode:S,proof:'PRIVATE_OBJECT_PROBE_404'});
function fixture({job=baseJob(),photo=basePhoto(),probe={status:404},commit=true,time=()=>NOW,
  fail='',afterProbe=()=>{}}={}) {
 const calls=[];let committed=false;
 const wrap=async(type,fn)=>{calls.push(type);if(fail===type)throw Error('SECRET_DATABASE_DSN');return fn()};
 const adapter={
   readLeasedJob:async()=>wrap('readJob',()=>job),
   readPhotoRecord:async()=>wrap('readPhoto',()=>photo),
   trustedProbe:async scoped=>wrap('probe',()=>{afterProbe();return typeof probe==='function'?probe(scoped):probe}),
   commitVerified:async x=>wrap('commit',()=>{
     if(!commit||committed||!job||!photo||job.state!=='leased'||job.leaseExpiresMs<=x.atMs||
        job.jobId!==x.jobId||job.leaseId!==x.leaseId||job.shopCode!==x.shopCode||
        photo.id!==x.photoId||photo.storagePath!==x.storagePath||photo.uploadState!=='deleted'||
        job.photoId!==photo.id||job.storagePath!==photo.storagePath)return false;
     committed=true;job.state='verified';return true;
   })
 };
 const final=createR93FIsolatedFinalLeaseFence({environment:'isolated_qa',dbName:'car02_r93f_qa_disposable',...adapter,clock:time});
 return {final,calls,job,photo};
}

test('R93F does not enable release or real Storage',()=>{
 assert.equal(R93F_CONTRACT.productionReady,false);assert.equal(R93F_CONTRACT.liveWiring,false);
 assert.equal(R93F_CONTRACT.releaseDecision,'NO_GO');assert.equal(R93F_CONTRACT.migrationDecision,'HOLD');
 assert.equal(R93F_CONTRACT.canProveRealProductionDurability,false);
});
for(const env of [undefined,'production','stage','isolated_qa ',null])test('invalid environment is rejected: '+String(env),()=>{
 assert.throws(()=>createR93FIsolatedFinalLeaseFence({environment:env,dbName:'car02_r93f_qa_x'}),/R93F_ISOLATED/);
});
for(const dbName of ['postgres','liff-salon-reserve','car02_r93f_qa','car02_r93f_qa_../x','CAR02_R93F_QA',null])
 test('invalid database is rejected: '+String(dbName),()=>assert.throws(()=>createR93FIsolatedFinalLeaseFence({environment:'isolated_qa',dbName}),/R93F_ISOLATED/));
test('clean trusted double 404 can commit only once using exact lease tuple',async()=>{
 const x=fixture();assert.equal(await x.final.markVerified(receipt()),true);
 assert.equal(x.calls.filter(a=>a==='probe').length,1);assert.equal(x.calls.filter(a=>a==='commit').length,1);
 assert.equal(await x.final.markVerified(receipt()),false);assert.equal(x.job.state,'verified');
});
for(const field of ['jobId','leaseId','shopCode','proof'])test('missing field '+field+' rejected before DB',async()=>{
 const x=fixture(),r=receipt();delete r[field];assert.equal(await x.final.markVerified(r),false);assert.deepEqual(x.calls,[]);
});
for(const [field,value] of [['jobId',uuid('8')],['leaseId',uuid('8')],['shopCode','other_shop'],['proof','PROBE_200']])
 test('falsified '+field+' fails closed',async()=>{const x=fixture();assert.equal(await x.final.markVerified({...receipt(),[field]:value}),false);assert.equal(x.calls.includes('commit'),false)});
test('extra request property denied',async()=>{let x=fixture();assert.equal(await x.final.markVerified({...receipt(),actorRole:'owner'}),false);assert.deepEqual(x.calls,[])});
for(const probe of [{status:200},{status:403},{status:500},{status:404,public:true},null,()=>undefined])
 test('unverified final probe '+JSON.stringify(probe)+' cannot mark verified',async()=>{
   const x=fixture({probe});assert.equal(await x.final.markVerified(receipt()),false);assert.equal(x.calls.includes('commit'),false);
 });
for(const property of ['photoId','shopCode','storagePath','reportId','orderId','photoState','leaseId','leaseExpiresMs'])
 test('mismatched DB lease property '+property+' rejects',async()=>{
   const job=baseJob();job[property]=property==='leaseExpiresMs'?NOW-1:property==='photoState'?'ready':property==='shopCode'?'other_shop':property==='storagePath'?'evil':uuid('8');
   const x=fixture({job});assert.equal(await x.final.markVerified(receipt()),false);assert.equal(x.calls.includes('commit'),false);
 });
for(const property of ['id','shopCode','storagePath','reportId','orderId','uploadState','storageBucket','createdAt'])
 test('mismatched DB photo property '+property+' rejects',async()=>{
   const photo=basePhoto();photo[property]=property==='uploadState'?'ready':property==='shopCode'?'other_shop':property==='storageBucket'?'public':property==='createdAt'?new Date(NOW-8500000).toISOString():property==='storagePath'?'evil':uuid('8');
   const x=fixture({photo});assert.equal(await x.final.markVerified(receipt()),false);assert.equal(x.calls.includes('commit'),false);
 });
for(const phase of ['readJob','readPhoto','probe','commit'])test('adapter failure '+phase+' sanitized fail closed',async()=>{
 const x=fixture({fail:phase});let value=await x.final.markVerified(receipt());assert.equal(value,false);assert.ok(!JSON.stringify(value).includes('SECRET'));
});
test('lease expiration during object probe prevents final write',async()=>{
 const j=baseJob();const x=fixture({job:j,afterProbe:()=>{j.leaseExpiresMs=NOW-1}});
 assert.equal(await x.final.markVerified(receipt()),false);assert.equal(x.calls.includes('commit'),false);
});
test('photo becomes ready during object probe prevents final write',async()=>{
 const p=basePhoto();const x=fixture({photo:p,afterProbe:()=>{p.uploadState='ready'}});
 assert.equal(await x.final.markVerified(receipt()),false);assert.equal(x.calls.includes('commit'),false);
});
test('commit rejects a concurrent DB lease turnover after second read',async()=>{
 const x=fixture({commit:false});assert.equal(await x.final.markVerified(receipt()),false);assert.equal(x.calls.filter(s=>s==='commit').length,1);
});
test('final 404 string alone is insufficient if trusted probe errors',async()=>{
 const x=fixture({fail:'probe'});assert.equal(await x.final.markVerified(receipt()),false);assert.equal(x.calls.includes('commit'),false);
});
test('R93D integration double-probes and never reports verified on a revoked lease',async()=>{
 const j=baseJob(),p=basePhoto(),now=NOW,calls=[];let claimed=false;
 const final=fixture({job:j,photo:p,afterProbe:()=>{p.uploadState='ready'}}).final;
 const ledger={claim:async()=>{
   if(claimed)return null;claimed=true;return {jobId:JOB,leaseId:LEASE,shopCode:S,photoId:PHOTO,
     orderId:ORDER,reportId:REPORT,storageBucket:BUCKET,storagePath:path,photoCreatedAt:createdAt,
     uploadState:'deleted',leasedUntilMs:NOW+30000,attempts:0};
 },confirmTombstone:async()=>true,markVerified:final.markVerified,
 reschedule:async()=>true,escalate:async()=>true};
 const storage={remove:async()=>{calls.push('remove');return {status:204}},probe:async()=>{calls.push('probe');return {status:404}}};
 const worker=createR93DIsolatedCleanupWorker({environment:'isolated_qa',dbName:'car02_r93d_qa_disposable',ledger,storage,clock:()=>now});
 const result=await worker.one();assert.equal(result.action,'LEDGER_WRITE_UNCERTAIN');assert.deepEqual(calls,['remove','probe']);
 assert.equal(p.uploadState,'ready');
});
