// R104 concurrent recovery verification. Disposable PG17 and in-process fake Storage ONLY.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createR99QARig,createR99QARequest,R99_DB,R99_SHOP} from './car02-r99-disposable-upload-boundary-qa.mjs';
import {createR103MockPrivateStorage} from './car02-r103-recovery-worker-isolated.mjs';
import {createR104FencedRecoveryWorker,assertR104Environment} from './car02-r104-fenced-recovery-isolated.mjs';
const BUCKET='ksh-car02-private-photos';
export async function runR104Pg17(pool){
 const paths=[];
 for(const n of [1401,1402]){
  const {handle}=createR99QARig({pool,config:{postFailure:true}});
  assert.equal((await handle(createR99QARequest({intent:n}))).status,503);
 }
 const {rows:jobs}=await pool.query(`SELECT j.job_id,j.storage_path FROM car02_r93q_qa.cleanup_jobs j
   JOIN car02_r93q_qa.upload_intents i ON i.photo_id=j.photo_id ORDER BY i.intent_key`);
 assert.equal(jobs.length,2);paths.push(...jobs.map(x=>x.storage_path));
 const base=createR103MockPrivateStorage({objects:paths,failPaths:[jobs[1].storage_path]});
 let entered, release;
 const enteredPromise=new Promise(resolve=>{entered=resolve});
 const releasePromise=new Promise(resolve=>{release=resolve});
 let waits=0;
 const storage=Object.freeze({kind:'r103_in_process_private_delete',testOnly:true,transport:'no_network',
  verifyPrivateBucket:input=>base.verifyPrivateBucket(input),
  async deleteObject(input){
   if(input.path===jobs[0].storage_path){waits++;entered();await releasePromise;}
   return base.deleteObject(input);
  }});
 const options={environment:'isolated_qa',dbName:R99_DB,pool,shopCode:R99_SHOP,
  storage,reviewGate:async()=>true};
 const worker1=createR104FencedRecoveryWorker(options);
 const worker2=createR104FencedRecoveryWorker(options);
 const ongoing=worker1.run(jobs[0].job_id);
 // No delay or timing guess: the barrier fires only after the first invocation
 // is inside Storage and the DB session advisory lock must still be held.
 await enteredPromise;
 try{
  const concurrent=await worker2.run(jobs[0].job_id);
  assert.deepEqual(concurrent,{status:'busy_fenced'});
  assert.equal(base.deletes,0,'R104_PARALLEL_DELETE_DETECTED');
  console.log('R104_CONCURRENT_DELETE_SESSION_FENCE_PASS');
 }finally{release()}
 assert.deepEqual(await ongoing,{status:'done',deleted:true,alreadyMissing:false});
 assert.equal(waits,1);assert.equal(base.deletes,1);
 const again=await worker2.run(jobs[0].job_id);
 assert.equal(again.status,'busy_or_done');
 assert.equal(base.deletes,1,'R104_DUPLICATE_DELETE_AFTER_COMPLETE');
 console.log('R104_AFTER_DONE_NO_DOUBLE_DELETE_PASS');
 // Failure releases advisory lock, leaving the R103 receipt retryable.
 await assert.rejects(()=>worker1.run(jobs[1].job_id),/R103_STORAGE_UNCERTAIN_RETRY_QUEUED/);
 const afterFail=await pool.query(`SELECT state,attempts FROM car02_r93q_qa.r103_cleanup_receipts WHERE job_id=$1`,[jobs[1].job_id]);
 assert.equal(afterFail.rows[0].state,'retry');assert.equal(afterFail.rows[0].attempts,1);
 assert.equal((await worker2.run(jobs[1].job_id)).status,'done');
 assert.equal(base.has(jobs[1].storage_path),false);
 console.log('R104_FAILURE_UNLOCK_AND_RETRY_PASS');
 const {rows:receipts}=await pool.query('SELECT state,attempts FROM car02_r93q_qa.r103_cleanup_receipts ORDER BY job_id');
 assert.equal(receipts.length,2);assert.ok(receipts.every(x=>x.state==='done'));
 assert.deepEqual(receipts.map(x=>x.attempts).sort(),[1,2]);
 console.log('R104_DISPOSABLE_ADVISORY_FENCING_PASS');
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 assertR104Environment(process.env);
 const {default:pg}=await import('pg');
 const pool=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',password:'disposable-r93s-ci-only',
  database:R99_DB,max:8,connectionTimeoutMillis:3000,idleTimeoutMillis:1000,
  application_name:'car02_r104_disposable_fence_only'});
 try{await runR104Pg17(pool)}finally{await pool.end()}
}
