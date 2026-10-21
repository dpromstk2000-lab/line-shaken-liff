/**
 * DPRO CAR02 V4.41 — REVIEW ONLY / OFFLINE manual notification investigation ledger.
 * No real Supabase, Worker, LINE or production schema. Never deploy or wire to R44/R46/R50/R52.
 * This module cannot send, resend, mark delivered, reopen, close or mutate the outbox status.
 * Evidence is a sha256 DIGEST only, not a claim that provider delivery was verified.
 * There is no live identity adapter; verifyReviewer MUST be independently implemented
 * server-side and validated before considering deployment. No implicit fallback.
 */
export const CAR02_V441_RELEASE_LOCK = true;
export const CAR02_V441_AUDIT_SQL = 'SELECT stored,review_count FROM public.v441_qa_record_review($1::text,$2::uuid,$3::uuid,$4::text,$5::text)';
export const CAR02_V441_SUMMARY_SQL = 'SELECT review_count,status FROM public.v441_qa_review_summary($1::text,$2::uuid)';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const shopOK = x => typeof x==='string' && /^[a-zA-Z0-9_-]{1,64}$/.test(x);
const uuid = x => typeof x==='string' && UUID.test(x);
const allowedDisposition = new Set(['investigated','escalated']);
const deny = () => {const e=Error('CAR02_UNAUTHORIZED');e.code='CAR02_UNAUTHORIZED';e.status=401;throw e;};
const validateReviewer = (actor,shop) => actor && actor.verified===true && actor.active===true &&
  actor.shopCode===shop && actor.role==='owner' && uuid(actor.userSub) &&
  Number.isSafeInteger(actor.authVersion) && actor.authVersion>0;
export function createCar02OfflineManualReviewR441({store,verifyReviewer}={}){
 if(CAR02_V441_RELEASE_LOCK!==true || typeof store?.query!=='function'||typeof verifyReviewer!=='function')
   throw Error('CAR02_V441_REVIEW_CONFIG_REQUIRED');
 const issued = new WeakSet();
 // External route adapters must bind `shopCode` server-side; NEVER take tenant from request.
 async function authenticateReviewer(request,shopCode){
  try{
   if(!shopOK(shopCode)||request?.headers?.get?.('x-line-id-token'))deny();
   const verified=await verifyReviewer({request,shopCode});
   if(!validateReviewer(verified,shopCode))deny();
   const actor=Object.freeze({verified:true,active:true,shopCode,role:'owner',
     userSub:verified.userSub,authVersion:verified.authVersion});
   issued.add(actor);return actor;
  }catch{deny();}
 }
 async function recordReview({actor,shopCode,eventId,evidenceSha256,disposition}={}){
  if(!actor||!issued.has(actor)||!Object.isFrozen(actor)||!validateReviewer(actor,shopCode)||
     !shopOK(shopCode)||!uuid(eventId)||typeof evidenceSha256!=='string'||
     !SHA256.test(evidenceSha256)||!allowedDisposition.has(disposition))deny();
  try{
   // This function only appends an audit row; it NEVER changes the outbox state.
   const r=await store.query(CAR02_V441_AUDIT_SQL,[shopCode,eventId,actor.userSub,evidenceSha256,disposition]);
   if(r?.rows?.length!==1)deny();
   const row=r.rows[0];
   if(typeof row.stored!=='boolean'||!Number.isSafeInteger(Number(row.review_count))||
      Number(row.review_count)<0||Number(row.review_count)>2)deny();
   return Object.freeze({status:row.stored?'recorded':'duplicate',reviewCount:Number(row.review_count),eventId});
  }catch{deny();}
 }
 async function summary({actor,shopCode,eventId}={}){
  if(!actor||!issued.has(actor)||!Object.isFrozen(actor)||!validateReviewer(actor,shopCode)||!uuid(eventId))deny();
  try{
   const r=await store.query(CAR02_V441_SUMMARY_SQL,[shopCode,eventId]);
   if(r?.rows?.length!==1||r.rows[0]?.status!=='manual_review')deny();
   const count=Number(r.rows[0].review_count);
   if(!Number.isSafeInteger(count)||count<0||count>2)deny();
   return Object.freeze({status:'manual_review',reviewCount:count,eventId});
  }catch{deny();}
 }
 return Object.freeze({authenticateReviewer,recordReview,summary});
}
