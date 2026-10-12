// R105 candidate: durable monotonically increasing claim generation in disposable PG17.
// NOT a live worker. Does NOT call real Storage and does NOT authorize deployment.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {assertR103SafeJob} from './car02-r103-recovery-worker-isolated.mjs';
const DB='car02_r93q_qa_ci', S='car02_r93q_qa';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const fail=(name)=>{throw Object.assign(new Error(name),{code:name})};
export const R105_CONTRACT=Object.freeze({mode:'isolated_qa',database:DB,
  liveStorageDeleteAllowed:false,productionReady:false,releaseDecision:'NO_GO',
  migrationDecision:'HOLD',notIntegratedWithLiveR103R104:true});
export function assertR105Environment(env){
 for(const [k,v] of Object.entries({R105_DISPOSABLE_GENERATION_QA:'yes',PGHOST:'127.0.0.1',
  PGPORT:'5432',PGUSER:'postgres',PGPASSWORD:'disposable-r93s-ci-only',PGDATABASE:DB}))
  assert.equal(env?.[k],v,`R105_DISPOSABLE_ONLY_${k}`);
}
export function assertR105Identity(row){
 assert.equal(row?.db,DB,'R105_WRONG_DB');
 assert.ok(Number.isInteger(row.pg)&&row.pg>=170000&&row.pg<180000,'R105_PG17_ONLY');
 assert.equal(row.no_live,true,'R105_LIVE_TABLE_PRESENT');
 assert.equal(row.generation_table,true,'R105_GENERATION_TABLE_MISSING');
}
export function validateR105Proof(claim,proof){
 if(proof?.kind!=='r105_in_process_private_storage' || proof.testOnly!==true ||
  proof.storagePath!==claim?.storagePath || proof.privateBucket!==true ||
  !((proof.deleted===true&&proof.definitivelyMissing===false)||
    (proof.deleted===false&&proof.definitivelyMissing===true)))fail('R105_UNTRUSTED_DELETE_PROOF');
 return proof.deleted?'deleted':'missing';
}
export function createR105GenerationLease({environment,dbName,pool,shopCode,reviewGate}={}){
 if(environment!=='isolated_qa'||dbName!==DB||!SHOP.test(shopCode||'')||
  typeof pool?.connect!=='function'||typeof pool?.query!=='function'||
  typeof reviewGate!=='function')fail('R105_ISOLATION_REQUIRED');
 async function gated(){let ok=false;try{ok=(await reviewGate())===true}catch{}if(!ok)fail('R105_GATE_LOCKED')}
 async function identity(p){
  const {rows}=await p.query(`SELECT current_database() AS db,
   current_setting('server_version_num')::int AS pg,
   to_regclass('public.ksh_car02_photos') IS NULL AS no_live,
   to_regclass('${S}.r105_generation_claims') IS NOT NULL AS generation_table`);
  assert.equal(rows.length,1,'R105_IDENTITY_MISSING');assertR105Identity(rows[0]);
 }
 async function claim(jobId){
  if(!UUID.test(jobId||''))fail('R105_INVALID_JOB');
  await gated();
  const c=await pool.connect();let begun=false;
  try{
   await identity(c);
   await c.query('BEGIN');begun=true;
   await c.query("SET LOCAL lock_timeout='2s'");
   const {rows}=await c.query(`SELECT j.job_id,j.shop_code,j.photo_id,j.storage_path,j.state,
    p.shop_code AS photo_shop,p.storage_path AS photo_path,p.upload_state,
    i.shop_code AS intent_shop,i.storage_path AS intent_path,i.photo_id AS intent_photo_id
    FROM ${S}.cleanup_jobs j JOIN ${S}.photos p ON p.id=j.photo_id AND p.shop_code=j.shop_code
    JOIN ${S}.upload_intents i ON i.photo_id=j.photo_id AND i.shop_code=j.shop_code
    WHERE j.job_id=$1 AND j.shop_code=$2 FOR UPDATE OF j`,[jobId,shopCode]);
   if(rows.length!==1){await c.query('ROLLBACK');begun=false;return {status:'unavailable'}};
   const job=rows[0];assertR103SafeJob(job,shopCode);
   const token=randomUUID();
   const result=await c.query(`INSERT INTO ${S}.r105_generation_claims
    (job_id,shop_code,photo_id,storage_path,generation,token,state,lease_until)
    VALUES($1,$2,$3,$4,1,$5,'claimed',clock_timestamp()+interval '60 seconds')
    ON CONFLICT(job_id) DO UPDATE SET
    generation=${S}.r105_generation_claims.generation+1,token=EXCLUDED.token,
    state='claimed',lease_until=clock_timestamp()+interval '60 seconds',
    completed_at=NULL,storage_proof=NULL
    WHERE ${S}.r105_generation_claims.shop_code=EXCLUDED.shop_code
      AND ${S}.r105_generation_claims.photo_id=EXCLUDED.photo_id
      AND ${S}.r105_generation_claims.storage_path=EXCLUDED.storage_path
      AND ${S}.r105_generation_claims.generation<1000000
      AND (${S}.r105_generation_claims.state='retry' OR
           (${S}.r105_generation_claims.state='claimed' AND
            ${S}.r105_generation_claims.lease_until<clock_timestamp()))
    RETURNING generation,token`,[jobId,shopCode,job.photo_id,job.storage_path,token]);
   await c.query('COMMIT');begun=false;
   if(result.rows.length!==1)return {status:'busy_or_done'};
   const generation=Number(result.rows[0].generation);
   assert.ok(Number.isSafeInteger(generation)&&generation>=1,'R105_BAD_GENERATION');
   return Object.freeze({status:'claimed',jobId,shopCode,storagePath:job.storage_path,
     generation,token});
  }catch(e){if(begun)try{await c.query('ROLLBACK')}catch{};throw e}
  finally{c.release()}
 }
 async function settle(claim,kind,proof){
  if(!claim||claim.status!=='claimed'||!UUID.test(claim.jobId||'')||
   claim.shopCode!==shopCode||!UUID.test(claim.token||'')||
   !Number.isSafeInteger(claim.generation)||claim.generation<1||
   !/^[a-z0-9][a-z0-9_-]{1,63}\//.test(claim.storagePath||''))fail('R105_INVALID_CLAIM');
  if(!['done','retry'].includes(kind))fail('R105_INVALID_TRANSITION');
  await gated();
  const outcome=kind==='done'?validateR105Proof(claim,proof):null;
  await identity(pool);
  const sql=kind==='done'?`UPDATE ${S}.r105_generation_claims SET state='done',
   lease_until=NULL,completed_at=clock_timestamp(),storage_proof=$6
   WHERE job_id=$1 AND shop_code=$2 AND storage_path=$3 AND generation=$4 AND token=$5
    AND state='claimed' AND lease_until>clock_timestamp() RETURNING job_id`:
   `UPDATE ${S}.r105_generation_claims SET state='retry',lease_until=NULL
   WHERE job_id=$1 AND shop_code=$2 AND storage_path=$3 AND generation=$4 AND token=$5
    AND state='claimed' AND lease_until>clock_timestamp() RETURNING job_id`;
  const {rows}=await pool.query(sql,kind==='done'?
   [claim.jobId,shopCode,claim.storagePath,claim.generation,claim.token,outcome]:
   [claim.jobId,shopCode,claim.storagePath,claim.generation,claim.token]);
  if(rows.length!==1)fail('R105_STALE_GENERATION_FAIL_CLOSED');
  return Object.freeze({status:kind,generation:claim.generation});
 }
 return Object.freeze({claim,settle});
}
