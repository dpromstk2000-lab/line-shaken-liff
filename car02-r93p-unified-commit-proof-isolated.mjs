// DPRO CAR02 R93P — unified R93N + R93O committed-ready proof, DISPOSABLE QA ONLY.
// This is not a production replacement. Uses a fresh, scoped PostgreSQL read
// after R93M markReady yielded an uncertain result. Never marks a row ready,
// never modifies metadata or invokes Storage DELETE. Released workflow remains NO_GO.
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const DB=/^car02_r93p_qa_[a-z0-9_]{1,32}$/;
const SHA=/^[a-f0-9]{64}$/;
const EXT=Object.freeze({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'});
const BUCKET='ksh-car02-private-photos';
const BRAND=Symbol('R93P_OWN_ERROR');
function fail(code){let e=Object.assign(new Error(code),{code});e[BRAND]=true;throw e}
const safe=e=>e?.[BRAND]===true?e:Object.assign(new Error('R93P_RECONCILIATION_UNAVAILABLE'),{code:'R93P_RECONCILIATION_UNAVAILABLE'});
const exact=x=>Array.isArray(x)&&x.length===1?x[0]:null;
const validId=x=>typeof x==='string'&&UUID.test(x);
function validActor(a,shop){return a?.verified===true&&a.shopCode===shop&&['staff','owner'].includes(a.role)&&
 typeof a.subject==='string'&&a.subject.startsWith('staff:')&&validId(a.subject.slice(6));}
function validPath(x,shop){
 if(typeof x.path!=='string'||x.path.length>300||!Object.hasOwn(EXT,x.mimeType))return false;
 const head=`${shop}/${x.orderId}/${x.reportId}/`;
 if(!x.path.startsWith(head))return false;
 const leaf=x.path.slice(head.length),uuid=leaf.slice(0,36);
 return validId(uuid)&&leaf===uuid+'.'+EXT[x.mimeType];
}
function validReserve(x,shop){return x?.shopCode===shop&&validActor(x.actor,shop)&&validId(x.orderId)&&
 validId(x.reportId)&&validPath(x,shop)&&x.bucket===BUCKET&&Number.isSafeInteger(x.byteSize)&&
 x.byteSize>=4&&x.byteSize<=5242880&&SHA.test(x.sha256||'');}
function sameActor(a,b){return a?.verified===true&&a?.subject===b?.subject&&a?.role===b?.role&&a?.shopCode===b?.shopCode;}
export function createR93PIsolatedReadyAckReconciler({environment,dbName,shopCode,pool,repository,reviewGate}={}){
 if(environment!=='isolated_qa'||!DB.test(dbName||'')||!SHOP.test(shopCode||'')||
 typeof pool?.connect!=='function'||typeof reviewGate!=='function'||
 !['reserve','markReady','tombstoneAndEnqueue'].every(k=>typeof repository?.[k]==='function'))fail('R93P_ISOLATION_REQUIRED');
 const reservations=new Map();
 async function proveReady(x,saved){
  let permit=false;try{permit=(await reviewGate())===true}catch{}
  if(!permit)fail('R93P_GATE_CLOSED');
  let client,started=false;
  try{
   client=await pool.connect();
   if(typeof client?.query!=='function'||typeof client?.release!=='function')fail('R93P_CLIENT_INVALID');
   await client.query('BEGIN');started=true;
   await client.query("SET LOCAL lock_timeout = '2s'");
   await client.query("SET LOCAL statement_timeout = '10s'");
   const status=exact((await client.query(`SELECT current_database() AS db,
    to_regclass('car02_r93p_qa.photos') IS NOT NULL AS photos_present,
    to_regclass('car02_r93p_qa.staff') IS NOT NULL AS staff_present,
    to_regclass('car02_r93p_qa.cleanup_jobs') IS NOT NULL AS jobs_present,
    to_regclass('public.ksh_car02_photos') IS NULL AS no_live_photos`)).rows);
   if(status?.db!==dbName||status.photos_present!==true||status.staff_present!==true||
      status.jobs_present!==true||status.no_live_photos!==true)fail('R93P_DISPOSABLE_DB_REQUIRED');
   const staff=exact((await client.query(`SELECT role,active FROM car02_r93p_qa.staff
     WHERE shop_code=$1 AND staff_id=$2 FOR UPDATE`,[shopCode,x.actor.subject.slice(6).toLowerCase()])).rows);
   if(staff?.active!==true||staff.role!==x.actor.role)fail('R93P_STAFF_REVOKED');
   const row=exact((await client.query(`SELECT p.id,p.shop_code,p.order_id,p.report_id,p.storage_bucket,
    p.storage_path,p.mime_type,p.byte_size,p.sha256,p.upload_state,o.status AS order_status
    FROM car02_r93p_qa.photos p
    JOIN car02_r93p_qa.reports r ON r.id=p.report_id AND r.shop_code=p.shop_code
    JOIN car02_r93p_qa.work_orders o ON o.id=r.order_id AND o.shop_code=p.shop_code
    WHERE p.id=$1 AND p.shop_code=$2 AND p.order_id=$3 AND p.report_id=$4 AND o.id=$3
    FOR UPDATE OF p,r,o`,[x.photoId,shopCode,x.orderId,x.reportId])).rows);
   if(!row||row.id!==x.photoId||row.shop_code!==shopCode||row.order_id!==saved.orderId||
    row.report_id!==saved.reportId||row.storage_bucket!==BUCKET||row.storage_path!==saved.path||
    row.mime_type!==saved.mimeType||Number(row.byte_size)!==saved.byteSize||row.sha256!==saved.sha256||
    row.upload_state!=='ready'||row.order_status!=='draft')fail('R93P_READY_PROOF_FAILED');
   const n=exact((await client.query(`SELECT count(*)::integer AS n FROM car02_r93p_qa.cleanup_jobs
    WHERE photo_id=$1`,[x.photoId])).rows);
   if(n?.n!==0)fail('R93P_OUTBOX_CONFLICT');
   await client.query('COMMIT');started=false;
   return true;
  }catch(e){if(started&&client)try{await client.query('ROLLBACK')}catch{};throw safe(e)}
  finally{try{client?.release()}catch{}}
 }
 return Object.freeze({
  async reserve(x){
   if(!validReserve(x,shopCode))fail('R93P_RESERVATION_SCOPE_INVALID');
   const answer=await repository.reserve(x);
   if(!validId(answer?.photoId)||answer.state!=='pending')fail('R93P_RESERVATION_UNVERIFIED');
   if(reservations.has(answer.photoId))fail('R93P_DUPLICATE_RESERVATION');
   reservations.set(answer.photoId,Object.freeze({shopCode,actor:x.actor,orderId:x.orderId,
    reportId:x.reportId,bucket:BUCKET,path:x.path,mimeType:x.mimeType,byteSize:x.byteSize,sha256:x.sha256}));
   return answer;
  },
  async markReady(x){
   const saved=reservations.get(x?.photoId);
   if(!saved||!sameActor(x?.actor,saved.actor)||x.shopCode!==shopCode||x.bucket!==BUCKET||
      x.path!==saved.path||x.orderId!==saved.orderId||x.reportId!==saved.reportId||
      x.expectedState!=='pending')fail('R93P_READY_SCOPE_INVALID');
   try{
    const accepted=await repository.markReady(x);
    // Normal ACK is not sufficient: check the committed photo and global outbox.
    // This intentionally performs a second transaction even on success.
    if(accepted===true)return proveReady(x,saved);
   }catch{}
   // An ACK was lost or a non-boolean result was returned. Never guess success.
   // The second transaction proves only an already-committed ready record.
   return proveReady(x,saved);
  },
  async tombstoneAndEnqueue(x){
   const saved=reservations.get(x?.photoId);
   if(!saved||!sameActor(x?.actor,saved.actor)||x.shopCode!==shopCode||x.bucket!==BUCKET||
     x.path!==saved.path||x.orderId!==saved.orderId||x.reportId!==saved.reportId||
     x.expectedState!=='pending'||x.reason!=='UPLOAD_UNCERTAIN')fail('R93P_COMPENSATION_SCOPE_INVALID');
   return repository.tombstoneAndEnqueue(x);
  }
 });
}
export const R93P_CONTRACT=Object.freeze({environment:'isolated_qa',productionReady:false,liveWiring:false,
 releaseDecision:'NO_GO',migrationDecision:'HOLD',requiresFreshTransaction:true,
 checksReadyRowAndActiveStaff:true,blocksCleanupJobCollision:true,
 anyOutboxRowForPhotoBlocksReady:true,proofRequiredAfterNormalAndLostAck:true,neverCallsStorageDelete:true,
 requiresCurrentRequestReservation:true,requiresOriginalR93MConnectionInFuture:true,
 handlesMarkReadyLostAckOnly:true,noProductionCredentials:true});
