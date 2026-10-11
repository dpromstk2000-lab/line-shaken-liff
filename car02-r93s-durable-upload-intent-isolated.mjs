// DPRO CAR02 R93S: durable upload intent, isolated QA only.
// Design objective: a process restart or lost reserve ACK must not create an
// additional pending photo. This is NOT wired into R47/R50/R51/R52.
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const HASH=/^[a-f0-9]{64}$/;
const MIME=Object.freeze({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'});
const BUCKET='ksh-car02-private-photos';
const QA_DB='car02_r93q_qa_ci';
const OWN=Symbol('R93S_OWN_ERROR');
const fail=code=>{const error=Object.assign(new Error(code),{code});error[OWN]=true;throw error;};
const sanitize=e=>e?.[OWN]===true?e:Object.assign(new Error('R93S_DATABASE_UNAVAILABLE'),{code:'R93S_DATABASE_UNAVAILABLE'});
const one=r=>Array.isArray(r)&&r.length===1?r[0]:null;
const uuid=x=>typeof x==='string'&&UUID.test(x);
function validate(x,shop){
 if(!x||x.shopCode!==shop||!uuid(x.orderId)||!uuid(x.reportId)||!uuid(x.intentKey)||
    x.bucket!==BUCKET||!Object.hasOwn(MIME,x.mimeType)||!Number.isSafeInteger(x.byteSize)||
    x.byteSize<4||x.byteSize>5*1024*1024||!HASH.test(x.sha256||''))fail('R93S_INVALID_INTENT');
 if(x.actor?.verified!==true||x.actor.shopCode!==shop||!['staff','owner'].includes(x.actor.role)||
    typeof x.actor.subject!=='string'||!x.actor.subject.startsWith('staff:')||
    !uuid(x.actor.subject.slice(6)))fail('R93S_STAFF_REQUIRED');
 const prefix=`${shop}/${x.orderId}/${x.reportId}/`;
 if(typeof x.path!=='string'||x.path.length>300||!x.path.startsWith(prefix)||
    !uuid(x.path.slice(prefix.length,prefix.length+36))||
    x.path!==prefix+x.path.slice(prefix.length,prefix.length+36)+'.'+MIME[x.mimeType])
   fail('R93S_STORAGE_PATH_INVALID');
 return x.actor.subject.slice(6).toLowerCase();
}
function matches(row,x,actorId,shop){
 return row.shop_code===shop&&row.order_id===x.orderId&&row.report_id===x.reportId&&
  row.staff_id===actorId&&row.role===x.actor.role&&row.storage_bucket===BUCKET&&
  row.storage_path===x.path&&row.mime_type===x.mimeType&&
  Number(row.byte_size)===x.byteSize&&row.sha256===x.sha256;
}
export function createR93SDurableUploadIntentQA({environment,dbName,shopCode,pool,reviewGate}={}){
 if(environment!=='isolated_qa'||dbName!==QA_DB||!SHOP.test(shopCode||'')||
    typeof pool?.connect!=='function'||typeof reviewGate!=='function')fail('R93S_ISOLATION_REQUIRED');
 async function transaction(x,job){
  const staffId=validate(x,shopCode);
  let allowed=false;try{allowed=(await reviewGate())===true}catch{}
  if(!allowed)fail('R93S_GATE_CLOSED');
  let client,active=false;
  try{
   client=await pool.connect();
   if(typeof client?.query!=='function'||typeof client?.release!=='function')fail('R93S_CLIENT_REQUIRED');
   await client.query('BEGIN');active=true;
   await client.query("SET LOCAL lock_timeout='2s'");
   await client.query("SET LOCAL statement_timeout='12s'");
   const db=one((await client.query(`SELECT current_database() AS db,
     to_regclass('car02_r93q_qa.photos') IS NOT NULL AS photos_ok,
     to_regclass('car02_r93q_qa.upload_intents') IS NOT NULL AS intent_ok,
     to_regclass('car02_r93q_qa.cleanup_jobs') IS NOT NULL AS outbox_ok,
     to_regclass('public.ksh_car02_photos') IS NULL AS no_live_photos`)).rows);
   if(db?.db!==QA_DB||db.photos_ok!==true||db.intent_ok!==true||
      db.outbox_ok!==true||db.no_live_photos!==true)fail('R93S_DISPOSABLE_DB_REQUIRED');
   const staff=one((await client.query(`SELECT role,active FROM car02_r93q_qa.staff
      WHERE shop_code=$1 AND staff_id=$2 FOR UPDATE`,[shopCode,staffId])).rows);
   if(staff?.active!==true||staff.role!==x.actor.role)fail('R93S_STAFF_REVOKED');
   // Lock the work order to serialize all photos/intents within this order.
   const scope=one((await client.query(`SELECT o.id AS order_id,r.id AS report_id,o.status AS status
      FROM car02_r93q_qa.work_orders o
      JOIN car02_r93q_qa.reports r ON r.order_id=o.id AND r.shop_code=o.shop_code
      WHERE o.id=$1 AND o.shop_code=$2 AND r.id=$3 FOR UPDATE OF o,r`,
      [x.orderId,shopCode,x.reportId])).rows);
   if(scope?.order_id!==x.orderId||scope.report_id!==x.reportId||scope.status!=='draft')
     fail('R93S_DRAFT_SCOPE_REQUIRED');
   const result=await job(client,staffId);
   await client.query('COMMIT');active=false;
   return result;
  }catch(e){if(active&&client)try{await client.query('ROLLBACK')}catch{};throw sanitize(e);}
  finally{try{client?.release()}catch{}}
 }
 async function lookup(client,x,staffId){
  const row=one((await client.query(`SELECT i.shop_code,i.order_id,i.report_id,i.staff_id,i.role,
      i.storage_bucket,i.storage_path,i.mime_type,i.byte_size,i.sha256,
      p.id AS photo_id,p.upload_state AS state,
      p.shop_code AS photo_shop,p.order_id AS photo_order,p.report_id AS photo_report,
      p.storage_bucket AS photo_bucket,p.storage_path AS photo_path,
      p.mime_type AS photo_mime,p.byte_size AS photo_size,p.sha256 AS photo_hash
      FROM car02_r93q_qa.upload_intents i
      JOIN car02_r93q_qa.photos p ON p.id=i.photo_id
      WHERE i.shop_code=$1 AND i.intent_key=$2 FOR UPDATE OF i,p`,[shopCode,x.intentKey])).rows);
  if(!row)return null;
  if(!matches(row,x,staffId,shopCode)||!uuid(row.photo_id))fail('R93S_INTENT_REUSE_CONFLICT');
  // Verify the linked photo row separately. An intent row alone is NOT proof.
  if(row.photo_shop!==shopCode||row.photo_order!==x.orderId||row.photo_report!==x.reportId||
     row.photo_bucket!==BUCKET||row.photo_path!==x.path||row.photo_mime!==x.mimeType||
     Number(row.photo_size)!==x.byteSize||row.photo_hash!==x.sha256)
    fail('R93S_PHOTO_BINDING_MISMATCH');
  // Any outbox job for this photo ID vetoes READY, even if its shop/path are corrupted.
  const collisions=one((await client.query(`SELECT count(*)::integer AS n FROM car02_r93q_qa.cleanup_jobs
      WHERE photo_id=$1`,[row.photo_id])).rows);
  if(!Number.isInteger(collisions?.n)||collisions.n!==0)fail('R93S_OUTBOX_CONFLICT');
  if(!['pending','ready'].includes(row.state))fail('R93S_TERMINAL_PHOTO');
  return Object.freeze({photoId:row.photo_id,state:row.state,
     action:row.state==='ready'?'DO_NOT_REUPLOAD':'VERIFY_STORAGE_OR_COMPENSATE'});
 }
 return Object.freeze({
  async reserve(x){return transaction(x,async(client,staffId)=>{
   const existing=await lookup(client,x,staffId);
   if(existing)return existing; // Retry does NOT count toward three-photo limit.
   const count=one((await client.query(`SELECT count(*)::integer AS n FROM car02_r93q_qa.photos
      WHERE shop_code=$1 AND report_id=$2 AND upload_state IN ('pending','ready')`,
      [shopCode,x.reportId])).rows);
   if(!Number.isInteger(count?.n)||count.n<0)fail('R93S_CAPACITY_UNVERIFIED');
   if(count.n>=3)fail('R93S_THREE_PHOTO_LIMIT');
   const created=one((await client.query(`INSERT INTO car02_r93q_qa.photos
      (shop_code,order_id,report_id,storage_bucket,storage_path,mime_type,byte_size,sha256,upload_state)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending') RETURNING id,upload_state`,
      [shopCode,x.orderId,x.reportId,BUCKET,x.path,x.mimeType,x.byteSize,x.sha256])).rows);
   if(!uuid(created?.id)||created.upload_state!=='pending')fail('R93S_RESERVE_UNVERIFIED');
   const intent=one((await client.query(`INSERT INTO car02_r93q_qa.upload_intents
      (shop_code,intent_key,photo_id,order_id,report_id,staff_id,role,storage_bucket,storage_path,mime_type,byte_size,sha256)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING photo_id`,
      [shopCode,x.intentKey,created.id,x.orderId,x.reportId,staffId,x.actor.role,
       BUCKET,x.path,x.mimeType,x.byteSize,x.sha256])).rows);
   if(intent?.photo_id!==created.id)fail('R93S_INTENT_NOT_DURABLE');
   return Object.freeze({photoId:created.id,state:'pending',action:'VERIFY_STORAGE_OR_COMPENSATE'});
  });},
  async resume(x){return transaction(x,async(c,id)=>{
    const result=await lookup(c,x,id);
    if(!result)fail('R93S_INTENT_NOT_FOUND');
    return result;
  });}
 });
}
export const R93S_CONTRACT=Object.freeze({environment:'isolated_qa',productionReady:false,liveWiring:false,
 releaseDecision:'NO_GO',migrationDecision:'HOLD',usesDurableIntentTable:true,
 idempotentAcrossProcessRestart:true,sameIntentKeyCannotChangeIdentity:true,
 noStorageUploadOrDelete:true,requiresIndependentPgDriverVerification:true,
 pendingIsNotPermissionToReupload:true,noProductionCredentials:true});
