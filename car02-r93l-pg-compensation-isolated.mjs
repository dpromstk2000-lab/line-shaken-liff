// DPRO CAR02 R93L — scoped PostgreSQL compensating transaction, QA ONLY.
// No connection string, no DB creation, no secrets, no HTTP, no live imports.
// Requires a caller-provided pg-compatible pool and an already isolated QA database.
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const DB=/^car02_r93l_qa_[a-z0-9_]{1,32}$/;
const BUCKET='ksh-car02-private-photos';
const BRAND=Symbol('R93L_OWN_ERROR');
const fail=code=>{const e=Object.assign(new Error(code),{code});e[BRAND]=true;throw e};
const safe=e=>e?.[BRAND]===true?e:Object.assign(new Error('R93L_COMPENSATION_UNAVAILABLE'),{code:'R93L_COMPENSATION_UNAVAILABLE'});
const subject=actor=>{
 if(actor?.verified!==true||!['staff','owner'].includes(actor.role)||
 typeof actor.subject!=='string'||!actor.subject.startsWith('staff:')||
 !UUID.test(actor.subject.slice(6)))fail('R93L_IDENTITY_INVALID');
 return actor.subject.slice(6).toLowerCase();
};
function checkInput(x,shopCode){
 if(!x||x.shop!==shopCode||x.actor?.shopCode!==shopCode||
 !UUID.test(x.photoId||'')||!UUID.test(x.orderId||'')||!UUID.test(x.reportId||'')||
 x.bucket!==BUCKET||x.expectedState!=='pending'||x.reason!=='UPLOAD_UNCERTAIN'||
 typeof x.path!=='string'||x.path.length>300||
 !new RegExp(`^${shopCode}/${x.orderId}/${x.reportId}/[0-9a-f-]{36}\\.(?:jpg|png|webp)$`,'i').test(x.path)||
 !UUID.test(x.path.split('/').at(-1).split('.')[0]))fail('R93L_SCOPE_INVALID');
 return subject(x.actor);
}
function exactlyOne(rows){return Array.isArray(rows)&&rows.length===1?rows[0]:null}
export function createR93LAtomicPgCompensationIsolated({environment,dbName,shopCode,pool,reviewGate}={}) {
 if(environment!=='isolated_qa'||!DB.test(dbName||'')||!SHOP.test(shopCode||'')||
 typeof pool?.connect!=='function'||typeof reviewGate!=='function')fail('R93L_ISOLATION_REQUIRED');
 return Object.freeze({
  async tombstoneAndEnqueue(x){
   const sub=checkInput(x,shopCode);let allowed=false;
   try{allowed=(await reviewGate())===true}catch{}
   if(!allowed)fail('R93L_REVIEW_GATE_CLOSED');
   let client,started=false;
   try {
    client=await pool.connect();
    if(typeof client?.query!=='function'||typeof client?.release!=='function')fail('R93L_DB_CLIENT_INVALID');
    await client.query('BEGIN');started=true;
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    const check=exactlyOne((await client.query(`SELECT current_database() AS db,
      to_regclass('car02_r93l_qa.photos') IS NOT NULL AS photo_table,
      to_regclass('car02_r93l_qa.cleanup_jobs') IS NOT NULL AS outbox_table,
      to_regclass('public.ksh_car02_photos') IS NULL AS no_live_photos`)).rows);
    if(check?.db!==dbName||check.photo_table!==true||check.outbox_table!==true||check.no_live_photos!==true)
      fail('R93L_NOT_DISPOSABLE_DB');
    const identity=exactlyOne((await client.query(`SELECT role,active FROM car02_r93l_qa.staff
      WHERE shop_code=$1 AND staff_id=$2 FOR UPDATE`,[shopCode,sub])).rows);
    if(!identity||identity.active!==true||identity.role!==x.actor.role)fail('R93L_STAFF_DENIED');
    const row=exactlyOne((await client.query(`SELECT p.id,p.upload_state,p.shop_code,p.order_id,p.report_id,
      p.storage_bucket,p.storage_path FROM car02_r93l_qa.photos p
      JOIN car02_r93l_qa.reports r ON r.id=p.report_id AND r.shop_code=p.shop_code
      JOIN car02_r93l_qa.work_orders o ON o.id=r.order_id AND o.shop_code=p.shop_code
      WHERE p.id=$1 AND p.shop_code=$2 AND p.order_id=$3 AND p.report_id=$4
      AND o.id=$3 FOR UPDATE OF p,r,o`,[x.photoId,shopCode,x.orderId,x.reportId])).rows);
    if(!row||row.id!==x.photoId||row.upload_state!=='pending'||
       row.storage_bucket!==BUCKET||row.storage_path!==x.path)
      fail('R93L_PHOTO_NOT_PENDING_OR_SCOPE_MISMATCH');
    const changed=exactlyOne((await client.query(`UPDATE car02_r93l_qa.photos SET upload_state='deleted'
      WHERE id=$1 AND shop_code=$2 AND order_id=$3 AND report_id=$4
      AND storage_bucket=$5 AND storage_path=$6 AND upload_state='pending'
      RETURNING id,upload_state`,[x.photoId,shopCode,x.orderId,x.reportId,BUCKET,x.path])).rows);
    if(changed?.id!==x.photoId||changed.upload_state!=='deleted')fail('R93L_UPDATE_CONFLICT');
    const job=exactlyOne((await client.query(`INSERT INTO car02_r93l_qa.cleanup_jobs
      (photo_id,shop_code,storage_path,state,reason)
      VALUES($1,$2,$3,'queued','UPLOAD_UNCERTAIN') RETURNING job_id,state`,[x.photoId,shopCode,x.path])).rows);
    if(!UUID.test(job?.job_id||'')||job.state!=='queued')fail('R93L_OUTBOX_UNVERIFIED');
    await client.query('COMMIT');started=false;
    return Object.freeze({photoId:x.photoId,state:'deleted',cleanupState:'queued',
      shopCode,storagePath:x.path,jobId:job.job_id,atomicCommit:true});
   }catch(e){if(started&&client)try{await client.query('ROLLBACK')}catch{};throw safe(e)}
   finally{try{client?.release()}catch{}}
  }
 });
}
export const R93L_CONTRACT=Object.freeze({mode:'isolated_qa',productionReady:false,liveWiring:false,
 releaseDecision:'NO_GO',migrationDecision:'HOLD',noConnectionString:true,
 requiresExactDbName:true,atomicSqlTransaction:true,checksStaffInsideTransaction:true,
 returnsReceiptAfterCommit:true,requiresDedicatedQaSchema:true,
 cannotMigrateProduction:true,fullR83R93HLiveIntegrationComplete:false});
