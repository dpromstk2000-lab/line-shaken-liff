/**
 * DPRO CAR02 V4.55: review-only dual-person manual case attestation.
 * Runs only against disposable PG17 with synthetic reviewer IAM. NEVER DEPLOY.
 * Sources: V453 pending event -> V454 single claim -> manual_review quarantine.
 * Review results NEVER equal provider acceptance, LINE send, delivery or retry.
 * Two independent server-owned reviewer identities are needed to record final
 * 'closed_without_delivery_assertion'; this is an administrative note ONLY.
 * Real reviewer IAM, customer evidence/WORM storage, business authorization,
 * production Supabase/Workers/LINE remain unavailable, release lock stays TRUE.
 */
export const CAR02_V455_RELEASE_LOCK=true;
export const CAR02_V455_REVIEW_SQL =
 'SELECT stage,case_id FROM v455_private.qa_review_attest($1::text,$2::uuid,$3::uuid,$4::text,$5::text)';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHOP=/^[A-Za-z0-9_-]{1,64}$/;
const HEX=/^[a-f0-9]{64}$/;
const deny=()=>{const e=Error('CAR02_REVIEW_UNAUTHORIZED');e.code='CAR02_REVIEW_UNAUTHORIZED';e.status=401;throw e;};
const response=(status)=>Object.freeze({status});
/** authorizeReviewer MUST be server-owned; never infer reviewer from browser fields.
 * store MUST only bind to disposable DB. Neither adapter exists in production.
 */
export function createCar02OfflineDualReviewR455({store,authorizeReviewer}={}){
 if(CAR02_V455_RELEASE_LOCK!==true||typeof store?.query!=='function'||
    typeof authorizeReviewer!=='function')throw Error('CAR02_V455_OFFLINE_SERVER_ADAPTER_REQUIRED');
 async function submit({request,eventId,evidenceSha256}={}){
  let reviewer,action,expected;
  try{
   if(typeof eventId!=='string'||!UUID.test(eventId)||
      typeof evidenceSha256!=='string'||!HEX.test(evidenceSha256)||
      evidenceSha256==='0'.repeat(64))deny();
   reviewer=await authorizeReviewer({request});
   if(reviewer?.verified!==true||reviewer.mode!=='isolated_qa'||
      typeof reviewer.shopCode!=='string'||!SHOP.test(reviewer.shopCode)||
      typeof reviewer.userSub!=='string'||!UUID.test(reviewer.userSub)||
      !['investigator','supervisor'].includes(reviewer.reviewRole))deny();
   action=reviewer.reviewRole==='investigator'?'investigate':'close_no_delivery_claim';
   expected=reviewer.reviewRole==='investigator'?'awaiting_independent_signoff':'closed_without_delivery_assertion';
  }catch{deny();}
  try{
   const r=await store.query(CAR02_V455_REVIEW_SQL,
     [reviewer.shopCode,eventId,reviewer.userSub,action,evidenceSha256]);
   if(!Array.isArray(r?.rows)||r.rows.length!==1||
      r.rows[0]?.case_id!==eventId||r.rows[0]?.stage!==expected)return response('indeterminate');
   return response(expected);
  }catch{return response('indeterminate');}
 }
 return Object.freeze({submit});
}
