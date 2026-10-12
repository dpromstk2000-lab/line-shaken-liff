// R105: real disposable PostgreSQL17 lease generation and stale worker acceptance QA.
// All Storage calls use an in-memory fixture; never a production store.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createR99QARig,createR99QARequest,R99_DB,R99_SHOP}
 from './car02-r99-disposable-upload-boundary-qa.mjs';
import {createR103MockPrivateStorage} from './car02-r103-recovery-worker-isolated.mjs';
import {assertR105Environment,createR105GenerationLease} from './car02-r105-generation-lease-isolated.mjs';
const proof=(claim,result)=>({kind:'r105_in_process_private_storage',testOnly:true,
 storagePath:claim.storagePath,privateBucket:true,deleted:result.deleted===true,
 definitivelyMissing:result.definitivelyMissing===true});
export async function runR105Pg17(pool){
 for(const intent of [1501,1502]){
  const fixture=createR99QARig({pool,config:{postFailure:true}});
  assert.equal((await fixture.handle(createR99QARequest({intent}))).status,503,'R105_SEED_TOMBSTONE');
 }
 const {rows:jobs}=await pool.query(`SELECT j.job_id,j.storage_path FROM car02_r93q_qa.cleanup_jobs j
 JOIN car02_r93q_qa.upload_intents i ON i.photo_id=j.photo_id ORDER BY i.intent_key`);
 assert.equal(jobs.length,2,'R105_EXPECT_TWO_JOBS');
 const opts={environment:'isolated_qa',dbName:R99_DB,pool,shopCode:R99_SHOP,reviewGate:async()=>true};
 const a=createR105GenerationLease(opts),b=createR105GenerationLease(opts);
 const [x,y]=await Promise.all([a.claim(jobs[0].job_id),b.claim(jobs[0].job_id)]);
 const active=[x,y].find(z=>z.status==='claimed');
 assert.ok(active);assert.equal(active.generation,1);
 assert.deepEqual([x.status,y.status].sort(),['busy_or_done','claimed']);
 assert.equal((await pool.query(`SELECT generation FROM car02_r93q_qa.r105_generation_claims WHERE job_id=$1`,
  [jobs[0].job_id])).rows[0].generation,'1');
 console.log('R105_PARALLEL_CLAIM_SINGLE_OWNER_PASS');
 const foreign=createR105GenerationLease({...opts,shopCode:'other_shop'});
 assert.deepEqual(await foreign.claim(jobs[0].job_id),{status:'unavailable'});
 const forged={...active,shopCode:'other_shop'};
 await assert.rejects(()=>b.settle(forged,'done',proof(active,{deleted:true,definitivelyMissing:false})),/R105_INVALID_CLAIM/);
 const forgedToken={...active,token:'ffffffff-ffff-4fff-8fff-ffffffffffff'};
 await assert.rejects(()=>b.settle(forgedToken,'retry'),/R105_STALE_GENERATION_FAIL_CLOSED/);
 console.log('R105_TENANT_AND_TOKEN_FORGERY_DENIED_PASS');
 // CI-only simulation: the first worker loses its deadline while a second takes over.
 await pool.query(`UPDATE car02_r93q_qa.r105_generation_claims
  SET lease_until=clock_timestamp()-interval '1 second' WHERE job_id=$1`,[active.jobId]);
 const newer=await b.claim(jobs[0].job_id);
 assert.equal(newer.status,'claimed');assert.equal(newer.generation,2);
 assert.notEqual(newer.token,active.token);
 await assert.rejects(()=>a.settle(active,'retry'),/R105_STALE_GENERATION_FAIL_CLOSED/);
 await assert.rejects(()=>a.settle(active,'done',proof(active,{deleted:true,definitivelyMissing:false})),/R105_STALE_GENERATION_FAIL_CLOSED/);
 const row=(await pool.query(`SELECT generation,state FROM car02_r93q_qa.r105_generation_claims WHERE job_id=$1`,[active.jobId])).rows[0];
 assert.equal(Number(row.generation),2);assert.equal(row.state,'claimed');
 console.log('R105_EXPIRED_OLD_WORKER_CANNOT_OVERWRITE_PASS');
 await assert.rejects(()=>b.settle(newer,'done',{kind:'live_storage',testOnly:false}),/R105_UNTRUSTED_DELETE_PROOF/);
 assert.deepEqual(await b.settle(newer,'retry'),{status:'retry',generation:2});
 const finalClaim=await a.claim(jobs[0].job_id);
 assert.equal(finalClaim.generation,3);
 const storage=createR103MockPrivateStorage({objects:[jobs[0].storage_path]});
 assert.equal((await storage.verifyPrivateBucket({bucket:'ksh-car02-private-photos'})).public,false);
 const result=await storage.deleteObject({bucket:'ksh-car02-private-photos',path:jobs[0].storage_path});
 assert.deepEqual(await a.settle(finalClaim,'done',proof(finalClaim,result)),{status:'done',generation:3});
 await assert.rejects(()=>a.settle(finalClaim,'done',proof(finalClaim,result)),/R105_STALE_GENERATION_FAIL_CLOSED/);
 assert.equal((await b.claim(jobs[0].job_id)).status,'busy_or_done');
 assert.equal(storage.deletes,1,'R105_DUPLICATE_STORAGE_CALL');
 console.log('R105_RETRY_TO_TERMINAL_DONE_PASS');
 // Missing object is an idempotent verified completion, not evidence of an unsafe delete.
 const j2=await a.claim(jobs[1].job_id);
 assert.equal(j2.generation,1);
 await pool.query(`UPDATE car02_r93q_qa.r105_generation_claims
  SET lease_until=clock_timestamp()-interval '1 second' WHERE job_id=$1`,[j2.jobId]);
 await assert.rejects(()=>a.settle(j2,'retry'),/R105_STALE_GENERATION_FAIL_CLOSED/);
 const recovered=await b.claim(jobs[1].job_id);assert.equal(recovered.generation,2);
 const missed=await storage.deleteObject({bucket:'ksh-car02-private-photos',path:jobs[1].storage_path});
 assert.equal(missed.definitivelyMissing,true);
 await b.settle(recovered,'done',proof(recovered,missed));
 const {rows:final}=await pool.query(`SELECT job_id,shop_code,generation,state,storage_proof
 FROM car02_r93q_qa.r105_generation_claims ORDER BY job_id`);
 assert.equal(final.length,2);assert.ok(final.every(r=>r.state==='done'&&r.shop_code===R99_SHOP));
 assert.deepEqual(final.map(x=>Number(x.generation)).sort(),[2,3]);
 assert.deepEqual(final.map(x=>x.storage_proof).sort(),['deleted','missing']);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM car02_r93q_qa.r103_cleanup_receipts')).rows[0].n,0);
 const {rows:photos}=await pool.query('SELECT upload_state FROM car02_r93q_qa.photos');
 assert.equal(photos.length,2);assert.ok(photos.every(x=>x.upload_state==='deleted'));
 console.log('R105_MISSING_OBJECT_IDEMPOTENT_RECOVERY_PASS');
 console.log('R105_DISPOSABLE_GENERATION_LEASE_QA_PASS');
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 assertR105Environment(process.env);
 const {default:pg}=await import('pg');
 const pool=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',
  password:'disposable-r93s-ci-only',database:R99_DB,max:8,
  connectionTimeoutMillis:3000,idleTimeoutMillis:1000,application_name:'r105_disposable_pg17_only'});
 try{await runR105Pg17(pool)}finally{await pool.end()}
}
