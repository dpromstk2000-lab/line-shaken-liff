// DPRO CAR02 R103: durable cleanup receipt candidate, ONLY for a disposable PG17 fixture.
// No production SQL, no Supabase, no Cloudflare, no HTTP requests, no real Storage DELETE.
// In-process fake deletion shows the recovery algorithm; live deletion is NOT authorized.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const DB='car02_r93q_qa_ci';
const SCHEMA='car02_r93q_qa';
const BUCKET='ksh-car02-private-photos';
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const UUID='[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}';
const PATH=new RegExp(`^([a-z0-9][a-z0-9_-]{1,63})/${UUID}/${UUID}/${UUID}\\.(jpg|png|webp)$`,'i');
const fail=(c)=>{throw Object.assign(new Error(c),{code:c});};
export const R103_CONTRACT=Object.freeze({dbName:DB,mode:'isolated_qa',storage:'in_process_only',
  productionReady:false,liveStorageDeleteAllowed:false,productionSqlAuthorized:false,
  releaseDecision:'NO_GO',migrationDecision:'HOLD',existingR47R50R51R52Unchanged:true});
export function assertR103Env(env){
 for(const [k,v] of Object.entries({R103_DISPOSABLE_RECOVERY_QA:'yes',PGHOST:'127.0.0.1',
  PGPORT:'5432',PGUSER:'postgres',PGPASSWORD:'disposable-r93s-ci-only',PGDATABASE:DB}))
  assert.equal(env?.[k],v,'R103_DISPOSABLE_ENV_'+k);
 return true;
}
export function assertR103SafeJob(row,shop){
 assert.ok(row && SHOP.test(shop),'R103_INVALID_SHOP');
 assert.ok(typeof row.job_id==='string' && new RegExp('^'+UUID+'$','i').test(row.job_id),'R103_INVALID_JOB');
 assert.equal(row.shop_code,shop,'R103_CROSS_TENANT_JOB');
 assert.equal(row.photo_shop,shop,'R103_CROSS_TENANT_PHOTO');
 assert.equal(row.intent_shop,shop,'R103_CROSS_TENANT_INTENT');
 assert.equal(row.upload_state,'deleted','R103_READY_OBJECT_DELETE_DENIED');
 assert.equal(row.state,'queued','R103_NONQUEUED_JOB');
 assert.equal(row.storage_path,row.photo_path,'R103_PATH_PHOTO_MISMATCH');
 assert.equal(row.storage_path,row.intent_path,'R103_PATH_INTENT_MISMATCH');
 assert.equal(row.photo_id,row.intent_photo_id,'R103_PHOTO_INTENT_MISMATCH');
 assert.ok(typeof row.storage_path==='string'&&row.storage_path.length<=300&&
  PATH.test(row.storage_path)&&row.storage_path.startsWith(shop+'/'),'R103_UNSAFE_STORAGE_PATH');
 return true;
}
export function createR103MockPrivateStorage({objects=[],failPaths=[]}={}){
 if(!Array.isArray(objects)||!Array.isArray(failPaths)||
  [...objects,...failPaths].some(x=>typeof x!=='string'||!PATH.test(x)))fail('R103_MOCK_PATH_INVALID');
 const remaining=new Set(objects),once=new Set(failPaths),deletes=[];
 return Object.freeze({kind:'r103_in_process_private_delete',testOnly:true,transport:'no_network',
  get deletes(){return deletes.length;},get calls(){return [...deletes];},has:(p)=>remaining.has(p),
  async verifyPrivateBucket({bucket}){
   if(bucket!==BUCKET)fail('R103_BUCKET_DENIED');return {id:BUCKET,public:false};
  },
  async deleteObject({bucket,path}){
   if(bucket!==BUCKET||!PATH.test(path))fail('R103_STORAGE_DELETE_SCOPE_DENIED');
   deletes.push(path);
   if(once.delete(path))fail('R103_MOCK_STORAGE_UNAVAILABLE');
   if(!remaining.has(path))return {definitivelyMissing:true,deleted:false};
   remaining.delete(path);return {definitivelyMissing:false,deleted:true};
  }
 });
}
export function createR103IsolatedRecoveryWorker({environment,dbName,pool,shopCode,storage,reviewGate}={}){
 if(environment!=='isolated_qa'||dbName!==DB||!SHOP.test(shopCode||'')||
  typeof pool?.connect!=='function'||typeof pool?.query!=='function'||
  typeof reviewGate!=='function'||storage?.kind!=='r103_in_process_private_delete'||
  storage.testOnly!==true||storage.transport!=='no_network'||
  typeof storage.verifyPrivateBucket!=='function'||typeof storage.deleteObject!=='function')
  fail('R103_ISOLATED_DEPENDENCIES_REQUIRED');
 async function checkDb(){
  const {rows}=await pool.query(`SELECT current_database() AS db,
   current_setting('server_version_num')::int AS pg,
   to_regclass('public.ksh_car02_photos') IS NULL AS no_live,
   to_regclass('car02_r93q_qa.r103_cleanup_receipts') IS NOT NULL AS receipts_ok`);
  assert.equal(rows.length,1);assert.equal(rows[0].db,DB,'R103_DB_IDENTITY');
  assert.ok(rows[0].pg>=170000&&rows[0].pg<180000,'R103_PG17_ONLY');
  assert.equal(rows[0].no_live,true,'R103_LIVE_TABLE_PRESENT');
  assert.equal(rows[0].receipts_ok,true,'R103_RECEIPTS_NOT_INSTALLED');
 }
 async function acquire(jobId){
  const client=await pool.connect();let began=false;
  try{
   await client.query('BEGIN');began=true;
   await client.query("SET LOCAL lock_timeout='2s'");
   const {rows}=await client.query(`SELECT j.job_id,j.shop_code,j.photo_id,j.storage_path,j.state,
    p.shop_code AS photo_shop,p.storage_path AS photo_path,p.upload_state,
    i.shop_code AS intent_shop,i.storage_path AS intent_path,i.photo_id AS intent_photo_id
    FROM ${SCHEMA}.cleanup_jobs AS j
    JOIN ${SCHEMA}.photos AS p ON p.id=j.photo_id AND p.shop_code=j.shop_code
    JOIN ${SCHEMA}.upload_intents AS i ON i.photo_id=j.photo_id AND i.shop_code=j.shop_code
    WHERE j.job_id=$1 AND j.shop_code=$2 FOR UPDATE OF j SKIP LOCKED`,[jobId,shopCode]);
   if(rows.length!==1){await client.query('ROLLBACK');began=false;return {status:'unavailable'};}
   const job=rows[0];assertR103SafeJob(job,shopCode);
   const token=randomUUID();
   const result=await client.query(`INSERT INTO ${SCHEMA}.r103_cleanup_receipts
    (job_id,shop_code,photo_id,storage_path,state,lease_token,lease_until,attempts)
    VALUES ($1,$2,$3,$4,'claimed',$5,clock_timestamp()+interval '60 seconds',1)
    ON CONFLICT (job_id) DO UPDATE SET
     state='claimed', lease_token=EXCLUDED.lease_token,
     lease_until=clock_timestamp()+interval '60 seconds',
     attempts=${SCHEMA}.r103_cleanup_receipts.attempts+1
    WHERE ${SCHEMA}.r103_cleanup_receipts.shop_code=EXCLUDED.shop_code
      AND ${SCHEMA}.r103_cleanup_receipts.photo_id=EXCLUDED.photo_id
      AND ${SCHEMA}.r103_cleanup_receipts.storage_path=EXCLUDED.storage_path
      AND ${SCHEMA}.r103_cleanup_receipts.attempts<5
      AND (${SCHEMA}.r103_cleanup_receipts.state='retry' OR
       (${SCHEMA}.r103_cleanup_receipts.state='claimed' AND
        ${SCHEMA}.r103_cleanup_receipts.lease_until<clock_timestamp()))
    RETURNING lease_token,attempts`,[job.job_id,shopCode,job.photo_id,job.storage_path,token]);
   await client.query('COMMIT');began=false;
   return result.rows.length===1?{status:'claimed',job,token,attempts:result.rows[0].attempts}: {status:'busy_or_done'};
  }catch(e){if(began)try{await client.query('ROLLBACK')}catch{};throw e}
  finally{client.release()}
 }
 async function transition(jobId,token,state){
  const query=state==='done'?`UPDATE ${SCHEMA}.r103_cleanup_receipts SET
   state='done',lease_until=NULL,completed_at=clock_timestamp()
   WHERE job_id=$1 AND shop_code=$2 AND lease_token=$3 AND state='claimed'
    AND lease_until>clock_timestamp() RETURNING job_id`:
   `UPDATE ${SCHEMA}.r103_cleanup_receipts SET state='retry',lease_until=NULL
    WHERE job_id=$1 AND shop_code=$2 AND lease_token=$3 AND state='claimed'
     AND lease_until>clock_timestamp() RETURNING job_id`;
  const {rows}=await pool.query(query,[jobId,shopCode,token]);
  assert.equal(rows.length,1,'R103_LOST_LEASE_FAIL_CLOSED');
 }
 return Object.freeze({async run(jobId,{simulateCrashAfterDelete=false}={}){
   if(!new RegExp('^'+UUID+'$','i').test(jobId||''))fail('R103_INVALID_JOB_ID');
   let gate=false;try{gate=await reviewGate()===true}catch{}
   if(!gate)fail('R103_REVIEW_GATE_CLOSED');
   await checkDb();
   const privateBucket=await storage.verifyPrivateBucket({bucket:BUCKET});
   if(privateBucket?.id!==BUCKET||privateBucket.public!==false)fail('R103_NOT_PRIVATE');
   const lease=await acquire(jobId);
   if(lease.status!=='claimed')return {status:lease.status};
   let result;
   try{
    result=await storage.deleteObject({bucket:BUCKET,path:lease.job.storage_path});
    if(result?.deleted!==true&&result?.definitivelyMissing!==true)fail('R103_DELETE_AMBIGUOUS');
    if(simulateCrashAfterDelete)fail('R103_SIMULATED_CRASH_AFTER_DELETE');
   }catch(e){
    if(e?.code==='R103_SIMULATED_CRASH_AFTER_DELETE')throw e;
    await transition(jobId,lease.token,'retry');
    throw Object.assign(new Error('R103_STORAGE_UNCERTAIN_RETRY_QUEUED'),{code:'R103_STORAGE_UNCERTAIN_RETRY_QUEUED'});
   }
   await transition(jobId,lease.token,'done');
   return {status:'done',deleted:result.deleted===true,alreadyMissing:result.definitivelyMissing===true};
  }});
}
