// DPRO CAR02 R83 — tenant-scoped private photo metadata repository.
// ISOLATED, DISPOSABLE POSTGRESQL QA ONLY. NEVER attach to R50/R52 or live Supabase.
// This module does not create tables, storage buckets, credentials or signed URLs.
// Even a mistakenly permissive release callback cannot bypass DB-name isolation.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const SHA=/^[a-f0-9]{64}$/;
const BUCKET='ksh-car02-private-photos';
const QA_DB=/^car02_r83_qa_[a-z0-9_]{1,48}$/;
const MIME=Object.freeze({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'});
const LIMIT=5*1024*1024;
const fail=c=>{throw Error('CAR02_R83_'+c)};
const validUuid=x=>typeof x==='string'&&UUID.test(x);
const safeError=e=>{
  if(typeof e?.message==='string' && /^CAR02_R83_[A-Z_]+$/.test(e.message))return e;
  return Error('CAR02_R83_REPOSITORY_UNAVAILABLE');
};
const cleanId=x=>x.toLowerCase();
function requireActor(actor,shop,serverShop){
  if(!actor||actor.verified!==true||!['staff','owner'].includes(actor.role)||
     actor.shopCode!==serverShop||shop!==serverShop||
     typeof actor.subject!=='string'||!actor.subject.startsWith('staff:')||
     !validUuid(actor.subject.slice(6)))fail('STAFF_REQUIRED');
  return cleanId(actor.subject.slice(6));
}
function validPath(path,shop,orderId,reportId,mime){
  if(typeof path!=='string'||path.length>300)return false;
  const head=shop+'/'+orderId+'/'+reportId+'/';
  if(!path.startsWith(head))return false;
  const leaf=path.slice(head.length);
  return leaf.length===36+1+MIME[mime].length && validUuid(leaf.slice(0,36)) && leaf.slice(36)==='.'+MIME[mime];
}
function identityRow(rows,role){
  return Array.isArray(rows)&&rows.length===1&&rows[0].active===true&&rows[0].staff_role===role;
}
export function createCar02PgPhotoRepositoryR83({pool,shopCode,releaseEnabled,maxPhotos=3}={}){
  if(!pool||typeof pool.connect!=='function'||typeof shopCode!=='string'||!SHOP.test(shopCode)||
     typeof releaseEnabled!=='function'||maxPhotos!==3)fail('CONFIG_INVALID');
  async function approved(){
    let okay=false;
    try{okay=await releaseEnabled()===true}catch{}
    if(!okay)fail('NOT_RELEASED');
  }
  async function tx(fn){
    let client,active=false;
    try{
      client=await pool.connect();
      if(!client||typeof client.query!=='function'||typeof client.release!=='function')fail('CONNECTION_INVALID');
      await client.query('BEGIN');active=true;
      await client.query("SET LOCAL lock_timeout = '2s'");
      await client.query("SET LOCAL statement_timeout = '20s'");
      const db=await client.query('SELECT current_database() AS name');
      if(db.rows?.length!==1||typeof db.rows[0]?.name!=='string'||!QA_DB.test(db.rows[0].name))
        fail('ISOLATION_REQUIRED');
      const result=await fn(client);
      await client.query('COMMIT');active=false;
      return result;
    }catch(e){
      if(active&&client){try{await client.query('ROLLBACK')}catch{}}
      throw safeError(e);
    }finally{try{client?.release()}catch{}}
  }
  async function verifyMembership(c,sub,role){
    const result=await c.query(`SELECT staff_role,active FROM public.ksh_car02_staff_access
      WHERE shop_code=$1 AND user_sub=$2 FOR UPDATE`,[shopCode,sub]);
    if(!identityRow(result.rows,role))fail('STAFF_REQUIRED');
  }
  async function findPhoto(c,{photoId,lock=true}){
    const r=await c.query(`SELECT p.id,p.storage_bucket,p.storage_path,p.mime_type,p.byte_size,p.sha256,p.upload_state,
      o.id AS order_id,o.shop_code,o.status AS order_status,r.id AS report_id
      FROM public.ksh_car02_work_orders o
      JOIN public.ksh_car02_reports r ON r.work_order_id=o.id
      JOIN public.ksh_car02_photos p ON p.report_id=r.id
      WHERE p.id=$1 AND o.shop_code=$2 ${lock?'FOR UPDATE OF o,r,p':''}`,[photoId,shopCode]);
    if(r.rows?.length!==1||r.rows[0]?.id!==photoId||r.rows[0]?.shop_code!==shopCode)fail('PHOTO_NOT_FOUND');
    return r.rows[0];
  }
  return Object.freeze({
    async reserve({actor,shop,orderId,reportId,mimeType,byteSize,sha256,bucket,path}={}){
      await approved();
      const sub=requireActor(actor,shop,shopCode);
      if(!validUuid(orderId)||!validUuid(reportId)||!Object.hasOwn(MIME,mimeType)||
         !Number.isSafeInteger(byteSize)||byteSize<4||byteSize>LIMIT||
         typeof sha256!=='string'||!SHA.test(sha256)||bucket!==BUCKET||
         !validPath(path,shopCode,orderId,reportId,mimeType))fail('METADATA_INVALID');
      return tx(async c=>{
        await verifyMembership(c,sub,actor.role);
        // Locks BOTH order and report to serialize reservations on the same report.
        const scoped=await c.query(`SELECT o.id AS order_id,r.id AS report_id,o.status AS order_status
          FROM public.ksh_car02_work_orders o
          JOIN public.ksh_car02_reports r ON r.work_order_id=o.id
          WHERE o.id=$1 AND o.shop_code=$2 AND r.id=$3 FOR UPDATE OF o,r`,[orderId,shopCode,reportId]);
        if(scoped.rows?.length!==1||scoped.rows[0]?.order_id!==orderId||
           scoped.rows[0]?.report_id!==reportId||scoped.rows[0]?.order_status!=='draft')
          fail('DRAFT_SCOPE_REQUIRED');
        const count=await c.query(`SELECT count(*)::integer AS n FROM public.ksh_car02_photos
          WHERE report_id=$1 AND upload_state IN ('pending','ready')`,[reportId]);
        if(count.rows?.length!==1||!Number.isInteger(count.rows[0]?.n)||count.rows[0].n<0)
          fail('CAPACITY_UNVERIFIED');
        if(count.rows[0].n>=3)fail('PHOTO_LIMIT_REACHED');
        const result=await c.query(`INSERT INTO public.ksh_car02_photos
          (report_id,storage_bucket,storage_path,mime_type,byte_size,sha256,upload_state)
          VALUES($1,$2,$3,$4,$5,$6,'pending') RETURNING id,upload_state`,
          [reportId,BUCKET,path,mimeType,byteSize,sha256]);
        const row=result.rows?.[0];
        if(result.rows?.length!==1||!validUuid(row?.id)||row?.upload_state!=='pending')fail('INSERT_UNVERIFIED');
        return Object.freeze({id:row.id});
      });
    },
    async markReady({actor,shop,photoId,expectedState}={}){
      await approved();
      const sub=requireActor(actor,shop,shopCode);
      if(!validUuid(photoId)||expectedState!=='pending')fail('METADATA_INVALID');
      return tx(async c=>{
        await verifyMembership(c,sub,actor.role);
        const p=await findPhoto(c,{photoId});
        if(p.order_status!=='draft'||p.upload_state!=='pending'||p.storage_bucket!==BUCKET)
          fail('PHOTO_NOT_PENDING');
        const r=await c.query(`UPDATE public.ksh_car02_photos SET upload_state='ready'
          WHERE id=$1 AND upload_state='pending' RETURNING id,upload_state`,[photoId]);
        if(r.rows?.length!==1||r.rows[0].id!==photoId||r.rows[0].upload_state!=='ready')fail('STATE_CONFLICT');
        return Object.freeze({id:photoId,state:'ready'});
      });
    },
    async cancel({actor,shop,photoId}={}){
      await approved();
      const sub=requireActor(actor,shop,shopCode);
      if(!validUuid(photoId))fail('METADATA_INVALID');
      return tx(async c=>{
        await verifyMembership(c,sub,actor.role);
        const p=await findPhoto(c,{photoId});
        // Cleanup is allowed even if work order advanced while Storage failed.
        // Never cancel 'ready' evidence which a customer may already see.
        if(p.upload_state!=='pending')return false;
        const r=await c.query(`UPDATE public.ksh_car02_photos SET upload_state='deleted'
          WHERE id=$1 AND upload_state='pending' RETURNING id,upload_state`,[photoId]);
        if(r.rows?.length!==1||r.rows[0].id!==photoId||r.rows[0].upload_state!=='deleted')fail('STATE_CONFLICT');
        return true;
      });
    },
    async getPending({actor,shop,photoId}={}){
      await approved();
      const sub=requireActor(actor,shop,shopCode);
      if(!validUuid(photoId))fail('METADATA_INVALID');
      return tx(async c=>{
        await verifyMembership(c,sub,actor.role);
        const p=await findPhoto(c,{photoId});
        if(p.upload_state!=='pending'||p.storage_bucket!==BUCKET)fail('PHOTO_NOT_PENDING');
        return Object.freeze({id:p.id,storage_bucket:p.storage_bucket,storage_path:p.storage_path,
          mime_type:p.mime_type,byte_size:p.byte_size,sha256:p.sha256,upload_state:p.upload_state});
      });
    }
  });
}
