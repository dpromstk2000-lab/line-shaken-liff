/**
 * DPRO CAR02 V4.52: isolated, durable request receipt + least-privilege job CAS.
 * NEVER DEPLOY. Synthetic sessions, operator/shop adapter and disposable PG17 only.
 * A receipt is NOT delivery evidence or authorization to access future requests.
 * It is stored in the SAME transaction as the job CAS and cannot be forged via JWT claims.
 * A lost COMMIT ACK is INDETERMINATE; no automatic retries or grant is returned.
 * Live Supabase auth.sessions, provider-owned session proof, real JWT verification,
 * real after-COMMIT fence and production R44/R46/R50/R52 integration remain missing.
 */
export const CAR02_V452_RELEASE_LOCK = true;
export const CAR02_V452_TOUCH_SQL = 'SELECT applied,new_version FROM v452_private.qa_receipted_job_cas($1::text,$2::uuid,$3::uuid,$4::uuid,$5::integer,$6::uuid)';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHOP=/^[A-Za-z0-9_-]{1,64}$/;
const validId=x=>typeof x==='string'&&UUID.test(x);
const invalid=()=>{const e=new Error('CAR02_UNAUTHORIZED');e.code='CAR02_UNAUTHORIZED';e.status=401;throw e;};
const result=(status,extra={})=>Object.freeze({status,...extra});
function getBearer(req){
 const h=req?.headers, auth=h?.get?.('authorization');
 if(typeof auth!=='string'||!/^Bearer [^\s]{12,8192}$/.test(auth)||
    h.get('x-line-id-token')!==null)invalid();
 return auth.slice(7);
}
/** verifyJwt and authorizeShop MUST be independently trusted server-only adapters. */
export function createCar02OfflineJobIdempotencyR452({store,verifyJwt,authorizeShop,expectedIssuer,nowMs=()=>Date.now()}={}){
 if(!CAR02_V452_RELEASE_LOCK||typeof store?.query!=='function'||
    typeof verifyJwt!=='function'||typeof authorizeShop!=='function'||
    typeof nowMs!=='function'||typeof expectedIssuer!=='string'||
    !/^https:\/\/[a-z0-9-]+\.supabase\.co\/auth\/v1$/.test(expectedIssuer))
   throw Error('CAR02_V452_TRUSTED_OFFLINE_ADAPTERS_REQUIRED');
 async function touchJob({request,jobId,expectedVersion,requestId}={}){
  let shop,claims;
  try{
   if(!validId(jobId)||!validId(requestId)||!Number.isSafeInteger(expectedVersion)||
      expectedVersion<1||expectedVersion>=2147483647)invalid();
   const token=getBearer(request),clock=nowMs();
   if(!Number.isSafeInteger(clock)||clock<=0)invalid();
   const bound=await authorizeShop({request});
   if(bound?.verified!==true||bound.mode!=='isolated_qa'||
      typeof bound.shopCode!=='string'||!SHOP.test(bound.shopCode))invalid();
   shop=bound.shopCode;
   claims=await verifyJwt({accessToken:token,expectedIssuer});
   if(claims?.verified!==true||!validId(claims.sub)||!validId(claims.sessionId)||
      claims.issuer!==expectedIssuer||claims.role!=='authenticated'||
      claims.audience!=='authenticated'||!Number.isSafeInteger(claims.expMs)||
      claims.expMs<=clock)invalid();
  }catch{invalid();}
  try{
   const db=await store.query(CAR02_V452_TOUCH_SQL,
     [shop,claims.sub,claims.sessionId,jobId,expectedVersion,requestId]);
   if(db?.rows?.length!==1)return result('indeterminate');
   const row=db.rows[0];
   if(typeof row?.applied!=='boolean'||row.new_version!==expectedVersion+1)
     return result('indeterminate');
   return result(row.applied?'applied_review_only':'duplicate_review_only',
     {newVersion:row.new_version});
  }catch{return result('indeterminate');}
 }
 return Object.freeze({touchJob});
}
