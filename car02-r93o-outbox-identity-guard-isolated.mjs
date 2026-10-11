// DPRO CAR02 R93O - lost-ACK ready proof with photo-ID-wide outbox veto.
// ISOLATED QA ONLY: never import into R47/R50/R51/R52 or production runtimes.
// A cleanup job referring to the same photo ID MUST invalidate ready-proof,
// even when its shop/path metadata is inconsistent. Do not repair it in-place.
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const DB=/^car02_r93o_qa_[a-z0-9_]{1,32}$/;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const SHA=/^[0-9a-f]{64}$/;
const MIME=Object.freeze({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'});
const BUCKET='ksh-car02-private-photos';
const OWN=Symbol('R93O_TRUSTED_ERROR');
function fail(code){const e=Object.assign(new Error(code),{code});e[OWN]=true;throw e}
function errorSafe(e){return e?.[OWN]?e:Object.assign(new Error('R93O_PROOF_UNAVAILABLE'),{code:'R93O_PROOF_UNAVAILABLE'})}
function exact(rows){return Array.isArray(rows)&&rows.length===1?rows[0]:null}
function valid(x,shop){
 if(!x||x.shopCode!==shop||!UUID.test(x.photoId||'')||!UUID.test(x.orderId||'')||!UUID.test(x.reportId||'')||
    x.bucket!==BUCKET||!Object.hasOwn(MIME,x.mimeType)||!Number.isSafeInteger(x.byteSize)||
    x.byteSize<4||x.byteSize>5242880||!SHA.test(x.sha256||''))return false;
 const a=x.actor;
 if(a?.verified!==true||a.shopCode!==shop||!['staff','owner'].includes(a.role)||
    typeof a.subject!=='string'||!/^staff:[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(a.subject))return false;
 const base=`${shop}/${x.orderId}/${x.reportId}/`;
 if(typeof x.path!=='string'||x.path.length>300||!x.path.startsWith(base))return false;
 const leaf=x.path.slice(base.length),ext=MIME[x.mimeType];
 return UUID.test(leaf.slice(0,36))&&leaf===`${leaf.slice(0,36)}.${ext}`;
}
export function createR93OIsolatedOutboxIdentityGuard({environment,dbName,shopCode,pool,reviewGate}={}){
 if(environment!=='isolated_qa'||!DB.test(dbName||'')||!SHOP.test(shopCode||'')||
   typeof pool?.connect!=='function'||typeof reviewGate!=='function')fail('R93O_ISOLATION_REQUIRED');
 return Object.freeze({
  async proveCommittedReady(x){
   if(!valid(x,shopCode))fail('R93O_INVALID_SCOPE');
   let gate=false;try{gate=(await reviewGate())===true}catch{}
   if(!gate)fail('R93O_GATE_CLOSED');
   let c,inTx=false;
   try{
    c=await pool.connect();
    if(typeof c?.query!=='function'||typeof c?.release!=='function')fail('R93O_CLIENT_INVALID');
    await c.query('BEGIN');inTx=true;
    await c.query("SET LOCAL lock_timeout = '2s'");
    await c.query("SET LOCAL statement_timeout = '10s'");
    const schema=exact((await c.query(`SELECT current_database() AS db,
      to_regclass('car02_r93o_qa.staff') IS NOT NULL AS staff_table,
      to_regclass('car02_r93o_qa.photos') IS NOT NULL AS photo_table,
      to_regclass('car02_r93o_qa.cleanup_jobs') IS NOT NULL AS jobs_table,
      to_regclass('public.ksh_car02_photos') IS NULL AS no_live_photos`)).rows);
    if(schema?.db!==dbName||schema.staff_table!==true||schema.photo_table!==true||
       schema.jobs_table!==true||schema.no_live_photos!==true)fail('R93O_DISPOSABLE_DB_REQUIRED');
    const member=exact((await c.query(`SELECT role,active FROM car02_r93o_qa.staff
      WHERE shop_code=$1 AND staff_id=$2 FOR UPDATE`,[shopCode,x.actor.subject.slice(6).toLowerCase()])).rows);
    if(member?.active!==true||member.role!==x.actor.role)fail('R93O_STAFF_DENIED');
    const row=exact((await c.query(`SELECT p.id,p.shop_code,p.order_id,p.report_id,p.storage_bucket,
      p.storage_path,p.mime_type,p.byte_size,p.sha256,p.upload_state,o.status AS order_status
      FROM car02_r93o_qa.photos p
      JOIN car02_r93o_qa.reports r ON r.id=p.report_id AND r.shop_code=p.shop_code
      JOIN car02_r93o_qa.work_orders o ON o.id=r.order_id AND o.shop_code=p.shop_code
      WHERE p.id=$1 AND p.shop_code=$2 AND p.order_id=$3 AND p.report_id=$4 AND o.id=$3
      FOR UPDATE OF p,r,o`,[x.photoId,shopCode,x.orderId,x.reportId])).rows);
    if(!row||row.id!==x.photoId||row.shop_code!==shopCode||row.order_id!==x.orderId||
       row.report_id!==x.reportId||row.storage_bucket!==BUCKET||row.storage_path!==x.path||
       row.mime_type!==x.mimeType||Number(row.byte_size)!==x.byteSize||row.sha256!==x.sha256||
       row.upload_state!=='ready'||row.order_status!=='draft')fail('R93O_READY_PROOF_FAILED');
    // Read by PHOTO ID ONLY. A bad shop/path on the outbox is evidence of
    // conflict, not evidence that no cleanup exists.
    const jobs=exact((await c.query(`SELECT count(*)::integer AS n
      FROM car02_r93o_qa.cleanup_jobs WHERE photo_id=$1`,[x.photoId])).rows);
    if(!Number.isSafeInteger(jobs?.n)||jobs.n!==0)fail('R93O_OUTBOX_CONFLICT');
    await c.query('COMMIT');inTx=false;
    return Object.freeze({ready:true,photoId:x.photoId,productionReady:false,releaseDecision:'NO_GO',migrationDecision:'HOLD'});
   }catch(e){if(inTx&&c)try{await c.query('ROLLBACK')}catch{};throw errorSafe(e)}
   finally{try{c?.release()}catch{}}
  }
 });
}
export const R93O_CONTRACT=Object.freeze({mode:'isolated_qa',productionReady:false,liveWiring:false,
 releaseDecision:'NO_GO',migrationDecision:'HOLD',anyOutboxRowForPhotoBlocksReady:true,
 photoAndStaffLockedInSameTransaction:true,requiresFreshTransaction:true,
 noProductionSecrets:true,noStorageDeletion:true,noProductionMigration:true});
