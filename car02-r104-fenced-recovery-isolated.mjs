// DPRO CAR02 R104: disposable PG17 advisory-lock wrapper for R103 cleanup candidates.
// NEVER live/production: no production credentials, network or real Storage DELETE.
// Session advisory lock remains held through the simulated Storage call and receipt transition.
import assert from 'node:assert/strict';
import {createR103IsolatedRecoveryWorker} from './car02-r103-recovery-worker-isolated.mjs';
const DB='car02_r93q_qa_ci';
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const SQL_LOCK="SELECT pg_try_advisory_lock(hashtext('DPRO_CAR02_R104'),hashtext($1)) AS acquired";
const SQL_UNLOCK="SELECT pg_advisory_unlock(hashtext('DPRO_CAR02_R104'),hashtext($1)) AS released";
export const R104_CONTRACT=Object.freeze({environment:'isolated_qa',dbName:DB,
  advisoryLock:'session_held_through_storage_and_receipt',productionReady:false,
  liveStorageDeleteAllowed:false,releaseDecision:'NO_GO',migrationDecision:'HOLD',
  r47r50r51r52Unchanged:true});
export function assertR104Environment(env){
 for(const [k,v] of Object.entries({R104_DISPOSABLE_FENCE_QA:'yes',PGHOST:'127.0.0.1',
  PGPORT:'5432',PGUSER:'postgres',PGPASSWORD:'disposable-r93s-ci-only',PGDATABASE:DB}))
   assert.equal(env?.[k],v,'R104_DISPOSABLE_ONLY_'+k);
 return true;
}
export function assertR104DbIdentity(row){
 assert.equal(row?.db,DB,'R104_WRONG_DATABASE');
 assert.ok(Number.isInteger(row.pg)&&row.pg>=170000&&row.pg<180000,'R104_PG17_ONLY');
 assert.equal(row.no_live,true,'R104_LIVE_TABLE_PRESENT');
 assert.equal(row.receipts_ok,true,'R104_RECEIPTS_MISSING');
}
export function createR104FencedRecoveryWorker({environment,dbName,pool,shopCode,storage,reviewGate}={}){
 if(environment!=='isolated_qa'||dbName!==DB||!pool||typeof pool.connect!=='function'||
  typeof pool.query!=='function'||typeof shopCode!=='string'||
  typeof reviewGate!=='function'||storage?.kind!=='r103_in_process_private_delete'||
  storage.testOnly!==true||storage.transport!=='no_network')throw Error('R104_ISOLATION_REQUIRED');
 const base=createR103IsolatedRecoveryWorker({environment,dbName,pool,shopCode,storage,reviewGate});
 return Object.freeze({async run(jobId,options={}){
  if(!UUID.test(jobId||''))throw Error('R104_BAD_JOB_ID');
  // No DB or Storage operation when an independent server-injected review gate is closed.
  let allowed=false;try{allowed=await reviewGate()===true}catch{}
  if(!allowed)throw Error('R104_REVIEW_LOCK_CLOSED');
  const client=await pool.connect();
  let locked=false,primary=null,answer,destroyClient=false;
  try{
   const {rows:id}=await client.query(`SELECT current_database() AS db,
    current_setting('server_version_num')::integer AS pg,
    to_regclass('public.ksh_car02_photos') IS NULL AS no_live,
    to_regclass('car02_r93q_qa.r103_cleanup_receipts') IS NOT NULL AS receipts_ok`);
   assert.equal(id.length,1,'R104_DB_IDENTITY_MISSING');assertR104DbIdentity(id[0]);
   const lock=await client.query(SQL_LOCK,[jobId]);
   assert.equal(lock.rows.length,1,'R104_LOCK_RESULT_INVALID');
   assert.equal(typeof lock.rows[0].acquired,'boolean','R104_LOCK_TYPE_INVALID');
   if(!lock.rows[0].acquired)return {status:'busy_fenced'};
   locked=true;
   // This call may suspend during simulated Storage deletion, but the same DB
   // session holds the advisory lock until receipt completion or failure.
   answer=await base.run(jobId,options);
  }catch(e){primary=e}
  finally{
   try{
    if(locked){const unlocked=await client.query(SQL_UNLOCK,[jobId]);
     if(unlocked.rows.length!==1||unlocked.rows[0].released!==true)
      throw Error('R104_ADVISORY_UNLOCK_NOT_CONFIRMED');}
   }catch(e){primary=e;answer=undefined;destroyClient=true}
   finally{client.release(destroyClient)}
  }
  if(primary)throw primary;
  return answer;
 }});
}
