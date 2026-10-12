// R106 disposable PostgreSQL17 + in-process versioned storage verification.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {R99_DB,R99_SHOP,createR99QARig,createR99QARequest} from './car02-r99-disposable-upload-boundary-qa.mjs';
import {assertR106Env,createR106MockVersionedPrivateStore,createR106VersionBoundCleanup}
 from './car02-r106-versioned-object-delete-isolated.mjs';
export async function runR106Pg17(pool){
 for(const intent of [1601,1602,1603]){
  const fixture=createR99QARig({pool,config:{postFailure:true}});
  assert.equal((await fixture.handle(createR99QARequest({intent}))).status,503,'R106_SEED_FAILED');
 }
 await pool.query(`INSERT INTO car02_r93q_qa.r106_object_pins
  (job_id,shop_code,photo_id,storage_path,bucket,sha256,object_version)
  SELECT j.job_id,j.shop_code,j.photo_id,j.storage_path,p.storage_bucket,p.sha256,'v001'
  FROM car02_r93q_qa.cleanup_jobs j JOIN car02_r93q_qa.photos p
   ON p.id=j.photo_id AND p.shop_code=j.shop_code`);
 const {rows:pins}=await pool.query(`SELECT x.job_id,x.storage_path AS path,x.sha256,x.object_version AS version
  FROM car02_r93q_qa.r106_object_pins x JOIN car02_r93q_qa.upload_intents i
  ON i.photo_id=x.photo_id ORDER BY i.intent_key`);
 assert.equal(pins.length,3,'R106_FIXTURE_COUNT');
 let racePath=pins[1].path;let raced=false;
 const store=createR106MockVersionedPrivateStore({objects:pins,ackLostPaths:[pins[2].path],
  beforeConditionalDelete:async({path,replace})=>{
   if(path===racePath&&!raced){replace(path,'v002','f'.repeat(64));raced=true;}
  }});
 const make=(shopCode=R99_SHOP,reviewGate=async()=>true)=>createR106VersionBoundCleanup({
  environment:'isolated_qa',dbName:R99_DB,pool,shopCode,storage:store,reviewGate});
 const worker=make();
 await assert.rejects(()=>make('other_shop').run(pins[0].job_id),/R106_PIN_MISSING/);
 const locked=make(R99_SHOP,async()=>false);
 await assert.rejects(()=>locked.run(pins[0].job_id),/R106_GATE_LOCKED/);
 assert.equal(store.deleteCalls,0,'R106_LOCKED_DELETE');
 console.log('R106_TENANT_AND_RELEASE_GATE_FAIL_CLOSED_PASS');
 const normal=await worker.run(pins[0].job_id);
 assert.equal(normal.status,'done');assert.equal(normal.deleted,true);
 assert.equal(store.deleteCalls,1);
 const repeat=await worker.run(pins[0].job_id);
 assert.equal(repeat.status,'busy_or_done');assert.equal(store.deleteCalls,1);
 console.log('R106_VERSION_BOUND_NORMAL_DELETE_PASS');
 await assert.rejects(()=>worker.run(pins[1].job_id),/R106_ATOMIC_PRECONDITION_FAILED/);
 assert.equal(raced,true);
 const existing=await store.head({bucket:'ksh-car02-private-photos',path:pins[1].path});
 assert.equal(existing.exists,true);assert.equal(existing.version,'v002');
 const {rows:retry}=await pool.query('SELECT state,generation FROM car02_r93q_qa.r105_generation_claims WHERE job_id=$1',[pins[1].job_id]);
 assert.equal(retry[0].state,'retry');assert.equal(Number(retry[0].generation),1);
 await assert.rejects(()=>worker.run(pins[1].job_id),/R106_OBJECT_REPLACED_OR_UNVERIFIED/);
 assert.equal(store.deleteCalls,2,'R106_NO_SECOND_DELETE_ON_REPLACEMENT');
 console.log('R106_REPLACED_OBJECT_ATOMIC_DELETE_DENIED_PASS');
 await assert.rejects(()=>worker.run(pins[2].job_id),/R106_SIMULATED_ACK_LOST/);
 const missing=await store.head({bucket:'ksh-car02-private-photos',path:pins[2].path});
 assert.equal(missing.definitivelyMissing,true);
 const recovered=await worker.run(pins[2].job_id);
 assert.equal(recovered.status,'done');assert.equal(recovered.alreadyMissing,true);
 assert.equal(store.deleteCalls,3,'R106_ACK_LOST_RETRIED_DELETE');
 console.log('R106_LOST_ACK_VERIFIED_MISSING_RECOVERY_PASS');
 const {rows:all}=await pool.query('SELECT job_id,state,generation FROM car02_r93q_qa.r105_generation_claims ORDER BY job_id');
 assert.equal(all.length,3);
 assert.equal(all.filter(x=>x.state==='done').length,2);
 assert.equal(all.filter(x=>x.state==='retry').length,1);
 const {rows:photos}=await pool.query('SELECT upload_state FROM car02_r93q_qa.photos');
 assert.equal(photos.length,3);assert.ok(photos.every(x=>x.upload_state==='deleted'));
 console.log('R106_DISPOSABLE_CONDITIONAL_DELETE_QA_PASS');
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 assertR106Env(process.env);
 const {default:pg}=await import('pg');
 const pool=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',password:'disposable-r93s-ci-only',
  database:R99_DB,max:8,connectionTimeoutMillis:3000,idleTimeoutMillis:1000,
  application_name:'r106_disposable_pg17_only'});
 try{await runR106Pg17(pool)}finally{await pool.end()}
}
