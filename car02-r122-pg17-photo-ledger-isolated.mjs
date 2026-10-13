// R122: disposable PostgreSQL 17 tenant-isolated bridge for the R121 offline adapter.
// NOT FOR PRODUCTION. No Storage calls, network endpoints, secrets or real customer data.
const DB='car02_r122_qa_ci';
const T='car02_r122_qa.photo_intents';
const TENANTS=Object.freeze({car02_r122_a_ci:'street_house_demo',car02_r122_b_ci:'other_demo'});
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const MIME={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
const reasons=new Set(['UPLOAD_ACK_OR_READBACK_UNCERTAIN','READBACK_MISMATCH','READY_ACK_UNCERTAIN','RETRY_UNCERTAIN']);
const fail=(s)=>{throw Object.assign(new Error('R122_'+s),{code:'R122_'+s})};
const safe=(m,shop)=>{
 if(!m || m.shop!==shop || !UUID.test(m.intentKey||'') || !UUID.test(m.orderId||'') ||
    !UUID.test(m.reportId||'') || !SHA.test(m.sha256||'') || !Object.hasOwn(MIME,m.mime) ||
    !Number.isSafeInteger(m.size)||m.size<4||m.size>5242880 ||
    !['staff','owner'].includes(m.role) || !m.actor?.startsWith('staff:') ||
    !UUID.test(m.actor.slice(6)) || m.bucket!=='ksh-car02-private-photos' ||
    m.path!==`${shop}/${m.orderId}/${m.reportId}/${m.intentKey}.${MIME[m.mime]}`)
   fail('SCOPE_INVALID');
 return m;
};
function exact(r,m){
 return r && r.shop_code===m.shop && r.intent_key===m.intentKey && r.order_id===m.orderId &&
 r.report_id===m.reportId && r.staff_subject===m.actor && r.staff_role===m.role &&
 r.bucket===m.bucket && r.storage_path===m.path && r.mime_type===m.mime &&
 Number(r.byte_size)===m.size && r.sha256===m.sha256;
}
function format(r,existing){
 if(!r)return null;
 return {shop:r.shop_code,intentKey:r.intent_key,orderId:r.order_id,reportId:r.report_id,
 actor:r.staff_subject,role:r.staff_role,bucket:r.bucket,path:r.storage_path,mime:r.mime_type,
 size:Number(r.byte_size),sha256:r.sha256,state:r.state,existing};
}
export const R122_CONTRACT=Object.freeze({productionReady:false,realSupabaseTested:false,
 realStorageTested:false,releaseDecision:'NO_GO',migrationDecision:'HOLD',
 disposablePg17Only:true,doesNotWireR47:true,noStorageDelete:true,
 dbIdentityGuardEveryTransaction:true,quarantineNeverPromotesReady:true});
export function createR122DisposablePgPhotoLedger({environment,dbName,expectedUser,pool}={}){
 if(environment!=='isolated_qa'||dbName!==DB||!Object.hasOwn(TENANTS,expectedUser)||
    typeof pool?.connect!=='function')fail('DISPOSABLE_ONLY');
 const shop=TENANTS[expectedUser];
 async function tx(m,job){
   safe(m,shop);
   let c,started=false,discard=false;
   try{
    c=await pool.connect();await c.query('BEGIN');started=true;
    await c.query("SET LOCAL lock_timeout='4s'");
    await c.query("SET LOCAL statement_timeout='15s'");
    const id=await c.query(`SELECT current_database() AS db, current_setting('server_version_num')::int AS pg,
      session_user AS sess,current_user AS cur,rolsuper AS super,rolbypassrls AS bypass,
      rolinherit AS inherit,to_regclass('public.ksh_car02_photos') IS NULL AS no_live
      FROM pg_roles WHERE rolname=current_user`);
    const r=id.rows[0];
    if(id.rowCount!==1||r.db!==DB||r.pg<170000||r.pg>=180000||r.sess!==expectedUser||
      r.cur!==expectedUser||r.super||r.bypass||r.inherit||!r.no_live)fail('DB_ROLE_GUARD');
    const result=await job(c);
    await c.query('COMMIT');started=false;return result;
   }catch(e){if(started&&c)try{await c.query('ROLLBACK')}catch{discard=true};throw e;}
   finally{try{c?.release(discard)}catch{}}
 }
 async function row(c,m){const q=await c.query(`SELECT * FROM ${T} WHERE shop_code=$1 AND intent_key=$2`,[shop,m.intentKey]);
   if(q.rowCount>1)fail('ROW_COUNT');return q.rows[0]||null;}
 async function requireExact(c,m){const found=await row(c,m);
   if(found&&!exact(found,m))fail('INTENT_REBIND_DENIED');return found;}
 return Object.freeze({
  async reserve(m){return tx(m,async c=>{
    // Serialize every reservation for a report before enforcing the max-three-photo cap.
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[shop+'/'+m.reportId]);
    const scope=await c.query(`SELECT 1 FROM car02_r122_qa.report_scope
       WHERE shop_code=$1 AND report_id=$2 AND order_id=$3`,[shop,m.reportId,m.orderId]);
    if(scope.rowCount!==1)fail('REPORT_SCOPE');
    const found=await requireExact(c,m);
    if(found)return format(found,true);
    const count=await c.query(`SELECT count(*)::int AS n FROM ${T} WHERE shop_code=$1 AND report_id=$2`,[shop,m.reportId]);
    if(count.rows[0].n>=3)fail('THREE_PHOTO_LIMIT');
    const inserted=await c.query(`INSERT INTO ${T}
       (shop_code,intent_key,order_id,report_id,staff_subject,staff_role,bucket,storage_path,mime_type,byte_size,sha256)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING RETURNING *`,
      [shop,m.intentKey,m.orderId,m.reportId,m.actor,m.role,m.bucket,m.path,m.mime,m.size,m.sha256]);
    if(inserted.rowCount===1)return format(inserted.rows[0],false);
    const after=await requireExact(c,m);
    if(after)return format(after,true);
    fail('UNIQUE_PATH_CONFLICT');
  });},
  async inspect(m){return tx(m,async c=>format(await requireExact(c,m),true));},
  async markReady(m){return tx(m,async c=>{
    const before=await requireExact(c,m);
    if(!before||before.state!=='PENDING')fail('NOT_PENDING');
    const upd=await c.query(`UPDATE ${T} SET state='READY'
      WHERE shop_code=$1 AND intent_key=$2 AND state='PENDING' RETURNING *`,[shop,m.intentKey]);
    if(upd.rowCount!==1||!exact(upd.rows[0],m))fail('READY_UNCONFIRMED');
    return format(upd.rows[0],true);
  });},
  async quarantine(m,reason){return tx(m,async c=>{
    if(!reasons.has(reason))fail('QUARANTINE_REASON');
    const before=await requireExact(c,m);
    if(!before)fail('INTENT_MISSING');
    // Never turn an already-confirmed READY photo into quarantine.
    if(before.state==='READY'||before.state==='QUARANTINED')return format(before,true);
    const upd=await c.query(`UPDATE ${T} SET state='QUARANTINED',quarantine_reason=$3
      WHERE shop_code=$1 AND intent_key=$2 AND state='PENDING' RETURNING *`,[shop,m.intentKey,reason]);
    if(upd.rowCount!==1||!exact(upd.rows[0],m))fail('QUARANTINE_UNCONFIRMED');
    return format(upd.rows[0],true);
  });}
 });
}
