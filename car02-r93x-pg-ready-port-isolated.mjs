// DPRO CAR02 R93X: PostgreSQL READY + recovery outbox port. ISOLATED QA ONLY.
// No network/storage calls. Designed for R93S's disposable schema and pg Pool.
const DB='car02_r93q_qa_ci',SCHEMA='car02_r93q_qa';
const BUCKET='ksh-car02-private-photos';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const OWN=Symbol('R93X_ERROR');
function deny(code){const e=Object.assign(new Error(code),{code});e[OWN]=true;throw e;}
const protect=e=>e?.[OWN]?e:Object.assign(new Error('R93X_DB_UNAVAILABLE'),{code:'R93X_DB_UNAVAILABLE'});
const one=rows=>Array.isArray(rows)&&rows.length===1?rows[0]:null;
const id=x=>typeof x==='string'&&UUID.test(x);
function validate(x,photoId,shop){
 if(!x||x.shopCode!==shop||!id(x.orderId)||!id(x.reportId)||!id(x.intentKey)||!id(photoId)||
    x.bucket!==BUCKET||typeof x.path!=='string'||x.path.length>300||
    !x.path.startsWith(`${shop}/${x.orderId}/${x.reportId}/`)||
    !['image/jpeg','image/png','image/webp'].includes(x.mimeType)||
    !Number.isSafeInteger(x.byteSize)||x.byteSize<4||x.byteSize>5242880||
    !/^[a-f0-9]{64}$/.test(x.sha256||'')||
    x.actor?.verified!==true||x.actor.shopCode!==shop||
    !['owner','staff'].includes(x.actor.role)||typeof x.actor.subject!=='string'||
    !/^staff:[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(x.actor.subject))deny('R93X_SCOPE_INVALID');
 return x.actor.subject.slice(6).toLowerCase();
}
export function createR93XIsolatedPgReadyPort({environment,dbName,shopCode,pool,reviewGate}={}){
 if(environment!=='isolated_qa'||dbName!==DB||typeof shopCode!=='string'||
    !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(shopCode)||
    typeof pool?.connect!=='function'||typeof reviewGate!=='function')deny('R93X_DISPOSABLE_REQUIRED');
 async function tx(envelope,photoId,action){
  const staffId=validate(envelope,photoId,shopCode);
  let permitted=false;try{permitted=(await reviewGate())===true}catch{}
  if(!permitted)deny('R93X_GATE_CLOSED');
  let c,started=false;
  try{
   c=await pool.connect();
   if(typeof c?.query!=='function'||typeof c?.release!=='function')deny('R93X_CLIENT_INVALID');
   await c.query('BEGIN');started=true;
   await c.query("SET LOCAL lock_timeout='2s'");
   await c.query("SET LOCAL statement_timeout='12s'");
   const scope=one((await c.query(`SELECT current_database() AS db,
     to_regclass('${SCHEMA}.photos') IS NOT NULL AS photo_ok,
     to_regclass('${SCHEMA}.upload_intents') IS NOT NULL AS intents_ok,
     to_regclass('${SCHEMA}.cleanup_jobs') IS NOT NULL AS jobs_ok,
     to_regclass('public.ksh_car02_photos') IS NULL AS no_live_photos`)).rows);
   if(scope?.db!==DB||scope.photo_ok!==true||scope.intents_ok!==true||
      scope.jobs_ok!==true||scope.no_live_photos!==true)deny('R93X_NOT_DISPOSABLE_DB');
   const staff=one((await c.query(`SELECT role,active FROM ${SCHEMA}.staff
     WHERE shop_code=$1 AND staff_id=$2 FOR UPDATE`,[shopCode,staffId])).rows);
   if(staff?.role!==envelope.actor.role||staff.active!==true)deny('R93X_STAFF_DENIED');
   const order=one((await c.query(`SELECT o.status,r.id AS report_id
     FROM ${SCHEMA}.work_orders o JOIN ${SCHEMA}.reports r
      ON r.order_id=o.id AND r.shop_code=o.shop_code
     WHERE o.id=$1 AND o.shop_code=$2 AND r.id=$3 FOR UPDATE OF o,r`,
     [envelope.orderId,shopCode,envelope.reportId])).rows);
   if(order?.status!=='draft'||order.report_id!==envelope.reportId)deny('R93X_ORDER_NOT_DRAFT');
   const row=one((await c.query(`SELECT p.id,p.shop_code,p.order_id,p.report_id,
     p.storage_bucket,p.storage_path,p.mime_type,p.byte_size,p.sha256,p.upload_state,
     i.intent_key,i.staff_id,i.role AS intent_role
     FROM ${SCHEMA}.photos p JOIN ${SCHEMA}.upload_intents i
       ON i.photo_id=p.id AND i.shop_code=p.shop_code
     WHERE p.id=$1 AND p.shop_code=$2 AND i.intent_key=$3 FOR UPDATE OF p,i`,
     [photoId,shopCode,envelope.intentKey])).rows);
   if(!row||row.id!==photoId||row.shop_code!==shopCode||
      row.order_id!==envelope.orderId||row.report_id!==envelope.reportId||
      row.storage_bucket!==BUCKET||row.storage_path!==envelope.path||
      row.mime_type!==envelope.mimeType||Number(row.byte_size)!==envelope.byteSize||
      row.sha256!==envelope.sha256||row.staff_id!==staffId||
      row.intent_role!==envelope.actor.role)deny('R93X_PHOTO_INTENT_MISMATCH');
   const jobs=one((await c.query(`SELECT count(*)::integer AS n FROM ${SCHEMA}.cleanup_jobs
     WHERE photo_id=$1`,[photoId])).rows);
   if(!Number.isSafeInteger(jobs?.n))deny('R93X_OUTBOX_UNVERIFIED');
   const result=await action(c,row,jobs.n);
   await c.query('COMMIT');started=false;
   return result;
  }catch(e){if(started&&c)try{await c.query('ROLLBACK')}catch{};throw protect(e)}
  finally{try{c?.release()}catch{}}
 }
 return Object.freeze({
  async markReady(env,photoId){return tx(env,photoId,async(c,row,n)=>{
   if(n!==0)deny('R93X_OUTBOX_COLLISION');
   if(row.upload_state==='ready')return true;
   if(row.upload_state!=='pending')deny('R93X_NOT_PENDING');
   const updated=one((await c.query(`UPDATE ${SCHEMA}.photos SET upload_state='ready'
      WHERE id=$1 AND shop_code=$2 AND upload_state='pending'
      RETURNING id,upload_state`,[photoId,shopCode])).rows);
   if(updated?.id!==photoId||updated.upload_state!=='ready')deny('R93X_READY_NOT_WRITTEN');
   return true;
  });},
  async proveReady(env,photoId){return tx(env,photoId,async(_c,row,n)=>{
   if(n!==0)deny('R93X_OUTBOX_COLLISION');
   if(row.upload_state!=='ready')deny('R93X_NOT_READY');
   return true;
  });},
  async enqueueUncertain(env,photoId){return tx(env,photoId,async(c,row,n)=>{
   if(row.upload_state!=='pending'||n!==0)deny('R93X_CANNOT_TOMBSTONE');
   const update=one((await c.query(`UPDATE ${SCHEMA}.photos SET upload_state='deleted'
     WHERE id=$1 AND shop_code=$2 AND upload_state='pending'
     RETURNING id,upload_state`,[photoId,shopCode])).rows);
   if(update?.id!==photoId||update.upload_state!=='deleted')deny('R93X_TOMBSTONE_UNVERIFIED');
   const queued=one((await c.query(`INSERT INTO ${SCHEMA}.cleanup_jobs
     (photo_id,shop_code,storage_path,state,reason)
     VALUES($1,$2,$3,'queued','UPLOAD_UNCERTAIN') RETURNING job_id,state`,
     [photoId,shopCode,env.path])).rows);
   if(!id(queued?.job_id)||queued.state!=='queued')deny('R93X_OUTBOX_NOT_DURABLE');
   return true;
  });}
 });
}
export const R93X_PG_CONTRACT=Object.freeze({mode:'isolated_qa',database:DB,
 productionReady:false,releaseDecision:'NO_GO',migrationDecision:'HOLD',
 usesPgTransactions:true,atomicCleanupOutbox:true,neverDeletesStorageObject:true});
