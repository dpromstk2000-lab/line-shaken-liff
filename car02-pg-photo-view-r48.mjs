// DPRO CAR02 R48 - privileged PostgreSQL metadata lookup for private photo delivery.
// NEVER expose this query or a service-role connection to a browser.
// Caller actor must come from the verified R46 server authenticator, not request JSON.
const ID=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const reject=()=>{throw new Error('CAR02_PHOTO_ACCESS_DENIED')};
export function createCar02PgPhotoViewR48({pool}={}) {
 if(!pool || typeof pool.query!=='function')throw Error('CAR02_PG_POOL_REQUIRED');
 return {
  async findReady({actor,shop,photoId}={}) {
   if(!actor||actor.verified!==true||actor.shopCode!==shop||!actor.subject||
      !['owner','staff','customer'].includes(actor.role)||!SHOP.test(shop)||!ID.test(photoId))reject();
   const customer=actor.role==='customer';
   if(customer&&!ID.test(actor.customerId))reject();
   // The customer may ONLY view evidence explicitly included in the latest
   // presented quote for THEIR work order, not another customer's or draft evidence.
   // A customer cannot nominate customerId via query, body or path.
   const sql=`SELECT p.id,p.upload_state,p.storage_bucket,p.storage_path,p.mime_type,p.byte_size,p.sha256,
      r.id AS report_id,o.id AS order_id,o.shop_code,o.customer_id
     FROM public.ksh_car02_photos p
     JOIN public.ksh_car02_reports r ON r.id=p.report_id
     JOIN public.ksh_car02_work_orders o ON o.id=r.work_order_id
     WHERE p.id=$1 AND o.shop_code=$2 AND p.upload_state='ready'
       AND ($3::boolean=FALSE OR (
         o.customer_id=$4::uuid AND EXISTS (
          SELECT 1 FROM public.ksh_car02_quotes q
          WHERE q.work_order_id=o.id AND q.report_id=r.id
            AND q.quote_state IN ('pending','approved','declined')
            AND q.photos_snapshot @> jsonb_build_array(p.id::text)
            AND q.revision=(SELECT max(q2.revision) FROM public.ksh_car02_quotes q2
             WHERE q2.work_order_id=o.id AND q2.quote_state IN ('pending','approved','declined'))
         )
       )) LIMIT 2`;
   const rows=(await pool.query(sql,[photoId,shop,customer,customer?actor.customerId:null]))?.rows;
   if(!Array.isArray(rows)||rows.length!==1)reject();
   const m=rows[0];
   if(m.id!==photoId||m.shop_code!==shop||m.upload_state!=='ready'||
      (customer&&m.customer_id!==actor.customerId))reject();
   return {id:m.id,orderId:m.order_id,reportId:m.report_id,shop:m.shop_code,
    bucket:m.storage_bucket,path:m.storage_path,mime:m.mime_type,
    bytes:Number(m.byte_size),sha256:m.sha256};
  }
 };
}
