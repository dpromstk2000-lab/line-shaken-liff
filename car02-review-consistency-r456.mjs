/**
 * CAR02 V4.56 — isolated READ ONLY four-ledger manual-review consistency auditor.
 * V453 outbox and receipt -> V454 claim/quarantine -> V455 independent dual signoff.
 * This audit CANNOT prove actual LINE send or delivery, actual provider evidence,
 * external immutable/WORM storage, real operator IAM or an actual authorization.
 * It is a momentary snapshot of a disposable synthetic PG17 database ONLY.
 * No worker actions, notification retries or privileged production imports.
 * R44/R46/R50/R52 untouched and locked. NEVER DEPLOY.
 */
export const CAR02_V456_RELEASE_LOCK=true;
export const CAR02_V456_READ_SQL='SELECT integrity_state,event_id,review_stage,audit_steps FROM v456_private.qa_review_consistency($1::text,$2::uuid)';
const BEGIN_SQL='BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHOP=/^[A-Za-z0-9_-]{1,64}$/;
const deny=()=>{const e=Error('CAR02_AUDIT_UNAUTHORIZED');e.code='CAR02_AUDIT_UNAUTHORIZED';e.status=401;throw e;};
const result=(state)=>Object.freeze({status:state});
/** authorizeAuditor is a hypothetical trusted SERVER-ONLY adapter.
 * pool MUST point to a disposable PG17 fixture. No provider IAM exists here.
 */
export function createCar02OfflineReviewConsistencyR456({pool,authorizeAuditor}={}){
 if(CAR02_V456_RELEASE_LOCK!==true||typeof pool?.connect!=='function'||
   typeof authorizeAuditor!=='function')throw Error('CAR02_V456_SERVER_ADAPTERS_REQUIRED');
 async function inspect({request,eventId}={}){
  let scope;
  try{
   if(typeof eventId!=='string'||!UUID.test(eventId))deny();
   const x=await authorizeAuditor({request});
   if(x?.verified!==true||x.mode!=='isolated_qa'||x.role!=='auditor'||
     typeof x.shopCode!=='string'||!SHOP.test(x.shopCode))deny();
   scope=Object.freeze({shopCode:x.shopCode});
  }catch{deny();}
  let client,started=false,clean=false,discard=false,out='indeterminate';
  try{
   client=await pool.connect();
   if(!client||typeof client.query!=='function'||typeof client.release!=='function')
     throw Error('INVALID_AUDIT_CLIENT');
   await client.query(BEGIN_SQL);started=true;
   await client.query("SET LOCAL statement_timeout = '12s'");
   await client.query("SET LOCAL lock_timeout = '2s'");
   const r=await client.query(CAR02_V456_READ_SQL,[scope.shopCode,eventId]);
   if(!Array.isArray(r?.rows)||r.rows.length!==1)throw Error('INVALID_AUDIT_RESULT');
   const row=r.rows[0];
   if(!row||row.event_id!==eventId||!Number.isSafeInteger(row.audit_steps)||
      !['consistent_closed','consistent_awaiting','inconsistent'].includes(row.integrity_state)||
      !['closed_without_delivery_assertion','awaiting_independent_signoff'].includes(row.review_stage))
     throw Error('INVALID_AUDIT_ROW');
   if(row.integrity_state==='consistent_closed'&&
      row.review_stage==='closed_without_delivery_assertion'&&row.audit_steps===2)
     out='reviewed_without_delivery_proof';
   else if(row.integrity_state==='consistent_awaiting'&&
      row.review_stage==='awaiting_independent_signoff'&&row.audit_steps===1)
     out='awaiting_independent_signoff';
   await client.query('ROLLBACK');started=false;clean=true;
  }catch{
   discard=true;
   if(started&&client?.query)try{await client.query('ROLLBACK')}catch{}
   out='indeterminate';
  }finally{
   if(client?.release)try{client.release(discard||!clean?Error('AUDIT_SNAPSHOT_NOT_CLEAN'):undefined)}catch{}
  }
  // Never say "delivered", "sent", "authorized", or expose evidence or identity.
  return result(out);
 }
 return Object.freeze({inspect});
}
