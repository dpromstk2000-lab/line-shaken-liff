// R103 live PG17 proof, disposable DB + in-process Storage only; never production.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createR99QARig,createR99QARequest,readR99State,R99_DB,R99_SHOP} from './car02-r99-disposable-upload-boundary-qa.mjs';
import {assertR103Env,createR103MockPrivateStorage,createR103IsolatedRecoveryWorker} from './car02-r103-recovery-worker-isolated.mjs';
export async function runR103Pg17(pool){
 assert.deepEqual(await readR99State(pool),{photos:[],intents:[],outbox:[]});
 for(const n of [1301,1302,1303]){
  const {handle}=createR99QARig({pool,config:{postFailure:true}});
  assert.equal((await handle(createR99QARequest({intent:n}))).status,503,'R103_SEED_UNCERTAIN');
 }
 const {handle}=createR99QARig({pool});
 assert.equal((await handle(createR99QARequest({intent:1310}))).status,201,'R103_READY_SEED');
 const seeded=await readR99State(pool);
 assert.equal(seeded.photos.length,4);assert.equal(seeded.outbox.length,3);
 assert.equal(seeded.photos.filter(x=>x.upload_state==='ready').length,1);
 const {rows:jobs}=await pool.query(`SELECT j.job_id,j.storage_path,j.photo_id FROM car02_r93q_qa.cleanup_jobs j
   JOIN car02_r93q_qa.upload_intents i ON i.photo_id=j.photo_id ORDER BY i.intent_key`);
 assert.equal(jobs.length,3);const [a,b,c]=jobs;
 const storage=createR103MockPrivateStorage({objects:jobs.map(x=>x.storage_path),failPaths:[b.storage_path]});
 const worker=createR103IsolatedRecoveryWorker({environment:'isolated_qa',dbName:R99_DB,pool,
  shopCode:R99_SHOP,storage,reviewGate:async()=>true});
 assert.deepEqual(await worker.run(a.job_id),{status:'done',deleted:true,alreadyMissing:false});
 assert.equal(storage.has(a.storage_path),false);
 assert.equal((await worker.run(a.job_id)).status,'busy_or_done');
 const deletedOnce=storage.deletes;
 assert.equal(storage.deletes,deletedOnce,'R103_DUPLICATE_DELETE');
 await assert.rejects(()=>worker.run(b.job_id),/R103_STORAGE_UNCERTAIN_RETRY_QUEUED/);
 const {rows:retry}=await pool.query('SELECT state,attempts FROM car02_r93q_qa.r103_cleanup_receipts WHERE job_id=$1',[b.job_id]);
 assert.equal(retry[0].state,'retry');assert.equal(retry[0].attempts,1);
 assert.equal((await worker.run(b.job_id)).status,'done');assert.equal(storage.has(b.storage_path),false);
 await assert.rejects(()=>worker.run(c.job_id,{simulateCrashAfterDelete:true}),/R103_SIMULATED_CRASH_AFTER_DELETE/);
 assert.equal(storage.has(c.storage_path),false);
 assert.equal((await worker.run(c.job_id)).status,'busy_or_done','R103_CRASH_LEASE_NOT_ENFORCED');
 // Force lease expiry ONLY inside disposable PG17 to emulate a worker crash + recovery delay.
 const expired=await pool.query(`UPDATE car02_r93q_qa.r103_cleanup_receipts
   SET lease_until=clock_timestamp()-interval '1 second' WHERE job_id=$1 AND state='claimed'`,[c.job_id]);
 assert.equal(expired.rowCount,1);
 assert.deepEqual(await worker.run(c.job_id),{status:'done',deleted:false,alreadyMissing:true});
 const {rows:receipt}=await pool.query(`SELECT job_id,state,attempts,completed_at FROM car02_r93q_qa.r103_cleanup_receipts ORDER BY job_id`);
 assert.equal(receipt.length,3);assert.ok(receipt.every(x=>x.state==='done'&&x.completed_at));
 assert.deepEqual(receipt.map(x=>x.attempts).sort(),[1,2,2]);
 const end=await readR99State(pool);
 assert.deepEqual(end,seeded,'R103_EXISTING_RECEIPTS_OR_PHOTOS_MUTATED');
 assert.equal(storage.has(a.storage_path)||storage.has(b.storage_path)||storage.has(c.storage_path),false);
 console.log('R103_CLAIM_AND_TOMBSTONE_SCOPE_PASS');
 console.log('R103_DUPLICATE_AND_RETRY_SAFETY_PASS');
 console.log('R103_CRASH_AFTER_DELETE_IDEMPOTENT_RECOVERY_PASS');
 console.log('R103_IMMUTABLE_READY_AND_OUTBOX_PASS');
 console.log('R103_DISPOSABLE_RECOVERY_QA_PASS');
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 assertR103Env(process.env);
 const {default:pg}=await import('pg');
 const pool=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',password:'disposable-r93s-ci-only',
  database:R99_DB,max:4,connectionTimeoutMillis:3000,idleTimeoutMillis:1000,
  application_name:'car02_r103_disposable_recovery_only'});
 try{await runR103Pg17(pool)}finally{await pool.end()}
}
