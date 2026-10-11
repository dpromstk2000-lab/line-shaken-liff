// DPRO CAR02 R93Q — unified R83 metadata + R93L atomic cleanup lifecycle.
// ISOLATED POSTGRESQL QA ONLY. No connection strings, secrets, production HTTP or Storage.
// Do not import from R47/R50/R51/R52. Database/table existence and the exact QA DB
// name are rechecked INSIDE every transaction, even after a positive review callback.
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const DB=/^car02_r93q_qa_[a-z0-9_]{1,32}$/;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const SHA=/^[a-f0-9]{64}$/;
const MIME=Object.freeze({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'});
const BUCKET='ksh-car02-private-photos';
const BRAND=Symbol('CAR02_R93Q_ERROR');
const fail=code=>{const e=Object.assign(new Error(code),{code});e[BRAND]=true;throw e};
const sanitize=e=>e?.[BRAND]===true?e:Object.assign(new Error('R93Q_DATABASE_UNAVAILABLE'),{code:'R93Q_DATABASE_UNAVAILABLE'});
const exact=(rows)=>Array.isArray(rows)&&rows.length===1?rows[0]:null;
const validId=x=>typeof x==='string'&&UUID.test(x);
function identity(actor,shop){
 if(actor?.verified!==true||actor.shopCode!==shop||!['staff','owner'].includes(actor.role)||
    typeof actor.subject!=='string'||!/^staff:[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(actor.subject))
   fail('R93Q_STAFF_REQUIRED');
 return actor.subject.slice(6).toLowerCase();
}
function validPath(x,shop){
 if(typeof x.path!=='string'||x.path.length>300||!Object.hasOwn(MIME,x.mimeType))return false;
 const prefix=`${shop}/${x.orderId}/${x.reportId}/`;
 if(!x.path.startsWith(prefix))return false;
 const leaf=x.path.slice(prefix.length);
 return validId(leaf.slice(0,36))&&leaf===`${leaf.slice(0,36)}.${MIME[x.mimeType]}`;
}
function scoped(x,shop){
 if(!x||x.shopCode!==shop||!validId(x.orderId)||!validId(x.reportId)||!validPath(x,shop))
   fail('R93Q_SCOPE_INVALID');
 return identity(x.actor,shop);
}
function key(x,shop){
 const sub=scoped(x,shop);
 if(!validId(x.photoId)||x.bucket!==BUCKET||x.expectedState!=='pending')fail('R93Q_SCOPE_INVALID');
 return sub;
}
export function createR93QIsolatedPgPhotoLifecycle({environment,dbName,shopCode,pool,reviewGate}={}){
 if(environment!=='isolated_qa'||!DB.test(dbName||'')||!SHOP.test(shopCode||'')||
    typeof pool?.connect!=='function'||typeof reviewGate!=='function')fail('R93Q_ISOLATION_REQUIRED');
 async function tx(actor,sub,job){
  let reviewed=false;
  try{reviewed=(await reviewGate())===true}catch{}
  if(!reviewed)fail('R93Q_GATE_CLOSED');
  let client,active=false;
  try{
   client=await pool.connect();
   if(typeof client?.query!=='function'||typeof client?.release!=='function')fail('R93Q_DB_CLIENT_INVALID');
   await client.query('BEGIN');active=true;
   await client.query("SET LOCAL lock_timeout = '2s'");
   await client.query("SET LOCAL statement_timeout = '20s'");
   const db=exact((await client.query(`SELECT current_database() AS db,
     to_regclass('car02_r93q_qa.staff') IS NOT NULL AS staff_table,
     to_regclass('car02_r93q_qa.photos') IS NOT NULL AS photo_table,
     to_regclass('car02_r93q_qa.cleanup_jobs') IS NOT NULL AS outbox_table,
     to_regclass('public.ksh_car02_photos') IS NULL AS no_live_photos`)).rows);
   if(db?.db!==dbName||db.staff_table!==true||db.photo_table!==true||db.outbox_table!==true||db.no_live_photos!==true)
     fail('R93Q_NOT_DISPOSABLE_DB');
   const staff=exact((await client.query(`SELECT role,active FROM car02_r93q_qa.staff
     WHERE shop_code=$1 AND staff_id=$2 FOR UPDATE`,[shopCode,sub])).rows);
   if(staff?.active!==true||staff.role!==actor.role)fail('R93Q_STAFF_DENIED');
   const result=await job(client);
   await client.query('COMMIT');active=false;
   return result;
  }catch(e){if(active&&client)try{await client.query('ROLLBACK')}catch{};throw sanitize(e)}
  finally{try{client?.release()}catch{}}
 }
 const receipts=new Map(); // staging instance only; persistence is a separate pre-release gate.
 async function scopedPhoto(client,x){
  const row=exact((await client.query(`SELECT p.id,p.shop_code,p.order_id,p.report_id,p.storage_bucket,
    p.storage_path,p.mime_type,p.byte_size,p.sha256,p.upload_state,o.status AS order_status
    FROM car02_r93q_qa.photos p
    JOIN car02_r93q_qa.reports r ON r.id=p.report_id AND r.shop_code=p.shop_code
    JOIN car02_r93q_qa.work_orders o ON o.id=r.order_id AND o.shop_code=p.shop_code
    WHERE p.id=$1 AND p.shop_code=$2 AND p.order_id=$3 AND p.report_id=$4
      AND o.id=$3 FOR UPDATE OF p,r,o`,[x.photoId,shopCode,x.orderId,x.reportId])).rows);
  if(!row||row.id!==x.photoId||row.shop_code!==shopCode||row.order_id!==x.orderId||
    row.report_id!==x.reportId||row.storage_bucket!==BUCKET||row.storage_path!==x.path||
    row.mime_type!==x.mimeType)fail('R93Q_PHOTO_SCOPE_MISMATCH');
  return row;
 }
 async function proveCommitted(x,receipt){
  const sub=key({...x,mimeType:receipt.mimeType},shopCode);
  return tx(x.actor,sub,async c=>{
   const photo=await scopedPhoto(c,{...x,mimeType:receipt.mimeType});
   if(photo.upload_state!=='ready'||photo.order_status!=='draft'||
       Number(photo.byte_size)!==receipt.byteSize||photo.sha256!==receipt.sha256)
       fail('R93Q_READY_PROOF_FAILED');
   const conflict=exact((await c.query(`SELECT count(*)::integer AS n
     FROM car02_r93q_qa.cleanup_jobs WHERE photo_id=$1`,[x.photoId])).rows);
   if(!Number.isSafeInteger(conflict?.n)||conflict.n!==0)fail('R93Q_OUTBOX_CONFLICT');
   return true;
  });
 }
 function requireReceipt(x){
  const meta=receipts.get(x?.photoId);
  if(!meta||x.actor?.verified!==true||x.actor?.subject!==meta.actor.subject||
     x.actor?.role!==meta.actor.role||x.actor?.shopCode!==meta.actor.shopCode||
     x.shopCode!==shopCode||x.bucket!==BUCKET||x.path!==meta.path||
     x.orderId!==meta.orderId||x.reportId!==meta.reportId||x.expectedState!=='pending')
     fail('R93Q_RECEIPT_MISMATCH');
  return meta;
 }
 return Object.freeze({
  async reserve(x){
   const sub=scoped(x,shopCode);
   if(x.bucket!==BUCKET||!Number.isSafeInteger(x.byteSize)||x.byteSize<4||x.byteSize>5242880||!SHA.test(x.sha256||''))
     fail('R93Q_METADATA_INVALID');
   const result=await tx(x.actor,sub,async c=>{
    const order=exact((await c.query(`SELECT o.id AS order_id,r.id AS report_id,o.status AS order_status
      FROM car02_r93q_qa.work_orders o JOIN car02_r93q_qa.reports r ON r.order_id=o.id
      WHERE o.id=$1 AND o.shop_code=$2 AND r.id=$3 AND r.shop_code=$2
      FOR UPDATE OF o,r`,[x.orderId,shopCode,x.reportId])).rows);
    if(order?.order_id!==x.orderId||order.report_id!==x.reportId||order.order_status!=='draft')
      fail('R93Q_DRAFT_SCOPE_REQUIRED');
    const count=exact((await c.query(`SELECT count(*)::integer AS n FROM car02_r93q_qa.photos
      WHERE shop_code=$1 AND report_id=$2 AND upload_state IN ('pending','ready')`,[shopCode,x.reportId])).rows);
    if(!Number.isInteger(count?.n)||count.n<0)fail('R93Q_CAPACITY_UNVERIFIED');
    if(count.n>=3)fail('R93Q_THREE_PHOTO_LIMIT');
    const inserted=exact((await c.query(`INSERT INTO car02_r93q_qa.photos
      (shop_code,order_id,report_id,storage_bucket,storage_path,mime_type,byte_size,sha256,upload_state)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending') RETURNING id,upload_state`,
      [shopCode,x.orderId,x.reportId,BUCKET,x.path,x.mimeType,x.byteSize,x.sha256])).rows);
    if(!validId(inserted?.id)||inserted.upload_state!=='pending')fail('R93Q_RESERVATION_UNVERIFIED');
    return Object.freeze({photoId:inserted.id,state:'pending'});
   });
   if(receipts.has(result.photoId))fail('R93Q_DUPLICATE_RESERVATION');
   receipts.set(result.photoId,Object.freeze({actor:Object.freeze({verified:true,shopCode,role:x.actor.role,subject:x.actor.subject}),orderId:x.orderId,reportId:x.reportId,
     path:x.path,mimeType:x.mimeType,byteSize:x.byteSize,sha256:x.sha256}));
   return result;
  },
  async markReady(x){
   const receipt=requireReceipt(x);
   // R93H requests only photoId/path, so MIME must be derived from the path extension.
   const suffix=typeof x?.path==='string'?x.path.split('.').at(-1):null;
   const mimeType=Object.keys(MIME).find(k=>MIME[k]===suffix);
   if(!mimeType)fail('R93Q_SCOPE_INVALID');
   const y={...x,mimeType};const sub=key(y,shopCode);
   try{await tx(x.actor,sub,async c=>{
    const photo=await scopedPhoto(c,y);
    if(photo.upload_state!=='pending'||photo.order_status!=='draft'||
       Number(photo.byte_size)!==receipt.byteSize||photo.sha256!==receipt.sha256)fail('R93Q_NOT_PENDING');
    const clash=exact((await c.query(`SELECT count(*)::integer AS n FROM car02_r93q_qa.cleanup_jobs
      WHERE photo_id=$1`,[x.photoId])).rows);
    if(clash?.n!==0)fail('R93Q_OUTBOX_CONFLICT');
    const changed=exact((await c.query(`UPDATE car02_r93q_qa.photos SET upload_state='ready'
      WHERE id=$1 AND shop_code=$2 AND order_id=$3 AND report_id=$4 AND storage_path=$5
      AND upload_state='pending' RETURNING id,upload_state`,
      [x.photoId,shopCode,x.orderId,x.reportId,x.path])).rows);
    if(changed?.id!==x.photoId||changed.upload_state!=='ready')fail('R93Q_READY_UNVERIFIED');
    return true;
   });}catch(e){
    // A deterministic rejection is not an ACK-loss problem; never downgrade it.
    // Only an unknown DB error might be an acknowledged COMMIT with lost reply.
    if(e?.code!=='R93Q_DATABASE_UNAVAILABLE')throw e;
   }
   // A normal ACK is NOT a sufficient proof. Re-open a separate DB transaction.
   // When ambiguous, this can recover ONLY an already-committed READY photo.
   return proveCommitted(x,receipt);
  },
  async tombstoneAndEnqueue(x){
   requireReceipt(x);
   const suffix=typeof x?.path==='string'?x.path.split('.').at(-1):null;
   const mimeType=Object.keys(MIME).find(k=>MIME[k]===suffix);
   if(!mimeType||x?.reason!=='UPLOAD_UNCERTAIN')fail('R93Q_SCOPE_INVALID');
   const y={...x,mimeType};const sub=key(y,shopCode);
   return tx(x.actor,sub,async c=>{
    const photo=await scopedPhoto(c,y);
    // A ready record must NOT be tombstoned even if its last ACK was lost.
    if(photo.upload_state!=='pending')fail('R93Q_NOT_PENDING');
    const changed=exact((await c.query(`UPDATE car02_r93q_qa.photos SET upload_state='deleted'
      WHERE id=$1 AND shop_code=$2 AND order_id=$3 AND report_id=$4 AND storage_path=$5
      AND upload_state='pending' RETURNING id,upload_state`,
      [x.photoId,shopCode,x.orderId,x.reportId,x.path])).rows);
    if(changed?.id!==x.photoId||changed.upload_state!=='deleted')fail('R93Q_TOMBSTONE_UNVERIFIED');
    const queued=exact((await c.query(`INSERT INTO car02_r93q_qa.cleanup_jobs
      (photo_id,shop_code,storage_path,state,reason)
      VALUES($1,$2,$3,'queued','UPLOAD_UNCERTAIN') RETURNING job_id,state`,
      [x.photoId,shopCode,x.path])).rows);
    if(!validId(queued?.job_id)||queued.state!=='queued')fail('R93Q_OUTBOX_UNVERIFIED');
    // Not successful until COMMIT has acknowledged both changes.
    return true;
   });
  }
 });
}
export const R93Q_CONTRACT=Object.freeze({mode:'isolated_qa',productionReady:false,liveWiring:false,
 releaseDecision:'NO_GO',migrationDecision:'HOLD',realPgPoolRequired:true,qaDbGuardEveryTransaction:true,
 reserveAndReadyAndAtomicOutbox:true,doesNotUseR83LiveSchema:true,neverCallsStorageDelete:true,
 sameQASchemaForLifecycleAndProof:true,proofInFreshTransaction:true,anyOutboxPhotoIdVeto:true,
 normalAndLostAckRechecked:true,ephemeralReceiptCacheOnly:true,productionMigrationApproved:false});
