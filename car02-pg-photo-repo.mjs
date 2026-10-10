// CAR02 R43 R13-specific private photo metadata repository (Node PG connection).
// Does not create buckets or issue signed URLs; call through trusted PhotoFlow only.
import { Car02Error } from './car02-core.mjs';
const err=(code,status=409)=>{throw new Car02Error(code,status)};
export function createCar02PgPhotoRepository(pool){
 if(!pool||typeof pool.connect!=='function')throw Error('CAR02_PG_POOL_REQUIRED');
 async function inTx(fn){const c=await pool.connect();let active=false;
  try{await c.query('BEGIN');active=true;const out=await fn(c);await c.query('COMMIT');active=false;return out}
  catch(e){if(active)await c.query('ROLLBACK');throw e}
  finally{c.release()}
 }
 async function scopedPhoto(c,{shop,photoId,lock=false}){
  const r=await c.query(`SELECT p.id,p.storage_bucket,p.storage_path,p.mime_type,p.byte_size,
    p.sha256,p.upload_state,o.status AS order_status
    FROM public.ksh_car02_photos p
    JOIN public.ksh_car02_reports r ON r.id=p.report_id
    JOIN public.ksh_car02_work_orders o ON o.id=r.work_order_id
    WHERE p.id=$1 AND o.shop_code=$2 ${lock?'FOR UPDATE OF o,p':''}`,[photoId,shop]);
  return r.rows[0]||null;
 }
 return {
  async reserve({shop,orderId,reportId,mimeType,byteSize,sha256,bucket,path}){
   return inTx(async c=>{
    const r=await c.query(`SELECT o.id,o.status FROM public.ksh_car02_work_orders o
      JOIN public.ksh_car02_reports r ON r.work_order_id=o.id
      WHERE o.id=$1 AND o.shop_code=$2 AND r.id=$3 FOR UPDATE OF o,r`,[orderId,shop,reportId]);
    if(r.rows[0]?.status!=='draft')err('CAR02_PHOTO_REPORT_NOT_DRAFT',409);
    const inserted=await c.query(`INSERT INTO public.ksh_car02_photos
      (report_id,storage_bucket,storage_path,mime_type,byte_size,sha256,upload_state)
      VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING id`,
      [reportId,bucket,path,mimeType,byteSize,sha256]);
    return inserted.rows[0];
   });
  },
  async getPending({shop,photoId}){
   const c=await pool.connect();try{return await scopedPhoto(c,{shop,photoId})}finally{c.release()}
  },
  async markReady({shop,photoId}){
   return inTx(async c=>{
    const photo=await scopedPhoto(c,{shop,photoId,lock:true});
    if(!photo||photo.order_status!=='draft'||photo.upload_state!=='pending')err('CAR02_PHOTO_NOT_PENDING',409);
    const r=await c.query(`UPDATE public.ksh_car02_photos SET upload_state='ready'
      WHERE id=$1 AND upload_state='pending' RETURNING id`,[photoId]);
    if(r.rows.length!==1)err('CAR02_PHOTO_STATE_CONFLICT',409);
    return r.rows[0];
   });
  },
  async cancel({shop,photoId}){
   return inTx(async c=>{
    const photo=await scopedPhoto(c,{shop,photoId,lock:true});
    if(!photo||photo.order_status!=='draft'||photo.upload_state!=='pending')return false;
    await c.query(`UPDATE public.ksh_car02_photos SET upload_state='deleted'
      WHERE id=$1 AND upload_state='pending'`,[photoId]);
    return true;
   });
  }
 };
}
