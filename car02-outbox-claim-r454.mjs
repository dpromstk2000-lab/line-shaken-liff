/**
 * DPRO CAR02 V4.54 — ISOLATED V453 OUTBOX SINGLE-CLAIM / MANUAL REVIEW.
 * NO LINE SENDING. NO DELIVERY RECEIPT. NEVER DEPLOY.
 * V453 stores an immutable pending notification in the same transaction as a
 * job update and operation receipt. This disposable candidate makes the first
 * claim of that event single-use and irreversible; only a review flag may follow.
 * Any lost response is INDETERMINATE. A caller MUST NOT retry or auto-dispatch.
 * AuthorizeWorker and store are synthetic injected test adapters, NOT real IAM.
 * The SQL checks an actual V453 pending event in a disposable PostgreSQL 17 DB.
 * Worker IDs and claim tokens MUST NOT be exposed as browser/public permissions.
 * R44/R46/R50/R52 and ALL production services stay unchanged and locked.
 */
export const CAR02_V454_RELEASE_LOCK=true;
export const CAR02_V454_CLAIM_SQL='SELECT event_id,claim_token,state FROM v454_private.qa_claim_outbox($1::text,$2::uuid,$3::uuid)';
export const CAR02_V454_QUARANTINE_SQL='SELECT quarantined FROM v454_private.qa_quarantine_claim($1::text,$2::uuid,$3::uuid,$4::uuid,$5::text)';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHOP=/^[A-Za-z0-9_-]{1,64}$/;
const REASONS=new Set(['send_unknown','provider_no_receipt','worker_crash']);
const isId=s=>typeof s==='string'&&UUID.test(s);
const deny=()=>{const e=Error('CAR02_DISPATCH_UNAUTHORIZED');e.code='CAR02_DISPATCH_UNAUTHORIZED';e.status=401;throw e;};
const outcome=(status,extra={})=>Object.freeze({status,...extra});
/** No browser credential, actual provider call, database secrets or dispatch here.
 * `authorizeWorker` MUST derive tenant+worker from verified server-owned identity.
 * `store` is an injected isolated fixture and MUST fail closed on DB errors.
 */
export function createCar02OfflineOutboxClaimR454({store,authorizeWorker}={}){
 if(CAR02_V454_RELEASE_LOCK!==true||typeof store?.query!=='function'||typeof authorizeWorker!=='function')
  throw Error('CAR02_V454_SERVER_ADAPTERS_REQUIRED');
 async function scopeOf(request){
   const w=await authorizeWorker({request});
   if(w?.verified!==true||w.mode!=='isolated_qa'||w.role!=='dispatcher'||
      typeof w.shopCode!=='string'||!SHOP.test(w.shopCode)||!isId(w.workerId))deny();
   return Object.freeze({shopCode:w.shopCode,workerId:w.workerId});
 }
 async function claim({request,eventId}={}){
  let scope;
  try{if(!isId(eventId))deny();scope=await scopeOf(request)}catch{deny()}
  try{
   const r=await store.query(CAR02_V454_CLAIM_SQL,[scope.shopCode,eventId,scope.workerId]);
   if(!Array.isArray(r?.rows)||r.rows.length!==1)return outcome('indeterminate');
   const row=r.rows[0];
   if(row?.event_id!==eventId||!isId(row?.claim_token)||row?.state!=='claimed')return outcome('indeterminate');
   // Sensitive claim token remains within trusted worker-to-storage boundary.
   return outcome('claimed_review_only',{claimToken:row.claim_token});
  }catch{return outcome('indeterminate')}
 }
 async function quarantine({request,eventId,claimToken,reason}={}){
  let scope;
  try{
   if(!isId(eventId)||!isId(claimToken)||!REASONS.has(reason))deny();
   scope=await scopeOf(request);
  }catch{deny()}
  try{
   const r=await store.query(CAR02_V454_QUARANTINE_SQL,[scope.shopCode,eventId,scope.workerId,claimToken,reason]);
   if(!Array.isArray(r?.rows)||r.rows.length!==1||r.rows[0]?.quarantined!==true)
    return outcome('indeterminate');
   return outcome('manual_review_required');
  }catch{return outcome('indeterminate')}
 }
 return Object.freeze({claim,quarantine});
}
