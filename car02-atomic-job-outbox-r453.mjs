/**
 * DPRO CAR02 V4.53 — review-only atomic job CAS + durable receipt + OUTBOX INSERT.
 * The outbox is a synthetically queued DB event, NOT a LINE delivery receipt.
 * No dispatcher, LINE credentials, live Auth, Supabase DB, Worker, or real users.
 * All three writes happen inside a single disposable PG17 function/transaction.
 * On a lost database ACK, status is INDETERMINATE and this helper never retries.
 * Production R44/R46/R50/R52 are unchanged; CAR02_RELEASE_LOCK remains TRUE.
 */
export const CAR02_V453_RELEASE_LOCK = true;
export const CAR02_V453_ATOMIC_SQL =
 'SELECT applied,new_version,event_id,dispatch_state FROM v453_private.qa_touch_and_queue($1::text,$2::uuid,$3::uuid,$4::uuid,$5::integer,$6::uuid)';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHOP=/^[A-Za-z0-9_-]{1,64}$/;
const validId=x=>typeof x==='string'&&UUID.test(x);
const deny=()=>{const e=new Error('CAR02_UNAUTHORIZED');e.code='CAR02_UNAUTHORIZED';e.status=401;throw e;};
const outcome=(status,extra={})=>Object.freeze({status,...extra});
function bearer(request){
 const h=request?.headers,token=h?.get?.('authorization');
 if(typeof token!=='string'||!/^Bearer [^\s]{12,8192}$/.test(token)||h.get('x-line-id-token')!==null)deny();
 return token.slice(7);
}
/** verifyJwt, authorizeShop and store MUST be trusted, server-owned adapters.
 * This prototype never creates these adapters or grants production access.
 */
export function createCar02OfflineAtomicJobOutboxR453({store,verifyJwt,authorizeShop,expectedIssuer,nowMs=()=>Date.now()}={}){
 if(CAR02_V453_RELEASE_LOCK!==true||typeof store?.query!=='function'||
    typeof verifyJwt!=='function'||typeof authorizeShop!=='function'||typeof nowMs!=='function'||
    typeof expectedIssuer!=='string'||!/^https:\/\/[a-z0-9-]+\.supabase\.co\/auth\/v1$/.test(expectedIssuer))
   throw Error('CAR02_V453_TRUSTED_OFFLINE_ADAPTERS_REQUIRED');
 async function touchAndQueue({request,jobId,expectedVersion,requestId}={}){
  let shop,verified;
  try{
   if(!validId(jobId)||!validId(requestId)||!Number.isSafeInteger(expectedVersion)||
      expectedVersion<1||expectedVersion>=2147483647)deny();
   const raw=bearer(request),now=nowMs();
   if(!Number.isSafeInteger(now)||now<=0)deny();
   const bound=await authorizeShop({request});
   if(bound?.verified!==true||bound.mode!=='isolated_qa'||
      typeof bound.shopCode!=='string'||!SHOP.test(bound.shopCode))deny();
   shop=bound.shopCode;
   verified=await verifyJwt({accessToken:raw,expectedIssuer});
   if(verified?.verified!==true||!validId(verified.sub)||!validId(verified.sessionId)||
      verified.issuer!==expectedIssuer||verified.audience!=='authenticated'||
      verified.role!=='authenticated'||!Number.isSafeInteger(verified.expMs)||
      verified.expMs<=now)deny();
  }catch{deny();}
  // No browser-supplied actor role, shop, status, event ID, provider session, payload.
  // The DB function is authoritative; the event ID is the request UUID.
  try{
   const result=await store.query(CAR02_V453_ATOMIC_SQL,
     [shop,verified.sub,verified.sessionId,jobId,expectedVersion,requestId]);
   if(!Array.isArray(result?.rows)||result.rows.length!==1)return outcome('indeterminate');
   const row=result.rows[0];
   if(typeof row?.applied!=='boolean'||row.new_version!==expectedVersion+1||
      row.event_id!==requestId||row.dispatch_state!=='pending')return outcome('indeterminate');
   return outcome(row.applied?'queued_review_only':'duplicate_queued_review_only',
       {newVersion:row.new_version,eventId:requestId});
  }catch{
   // A transport error can happen after durable COMMIT. Never replay automatically.
   return outcome('indeterminate');
  }
 }
 return Object.freeze({touchAndQueue});
}
