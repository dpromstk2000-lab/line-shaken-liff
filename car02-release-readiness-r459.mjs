/**
 * DPRO CAR02 V4.59 — FAIL-CLOSED COMMERCIAL READINESS INVENTORY (OFFLINE QA).
 * It is deliberately impossible for this isolated prototype to return GO.
 * Each seven-point control must be independently evidenced in a later real,
 * separately authorized integration. Synthetic PG17 and GitHub PASS are NOT it.
 * No Supabase, Worker, LINE, WORM, real IAM or production DB connections.
 * No mutations, no deployment, no authorization or secret access. NEVER DEPLOY.
 * Original R52 hard release lock remains true; do not loosen in test code.
 */
export const CAR02_V459_RELEASE_LOCK=true;
export const CAR02_V459_READ_SQL=
  'SELECT control_code,evidence_source,review_state FROM v459_private.qa_release_controls($1::text)';
export const CAR02_V459_MANDATORY_CONTROLS=Object.freeze([
 'actual_supabase_auth_sessions',
 'trusted_operator_and_worker_iam',
 'postcommit_auth_generation_fence',
 'real_line_delivery_ambiguity',
 'external_immutable_evidence_store',
 'independent_signing_key_custody',
 'staging_end_to_end_integration'
]);
const CODE=/^[a-z][a-z0-9_]{2,63}$/;
const SHOP=/^[A-Za-z0-9_-]{1,64}$/;
const SNAP='BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY';
const fail=()=>{const e=Error('CAR02_RELEASE_AUDIT_UNAUTHORIZED');e.code='CAR02_RELEASE_AUDIT_UNAUTHORIZED';e.status=401;throw e;};
const frozen=(status,reason,controls=[])=>Object.freeze({status,releasePermitted:false,reason,
 pendingControls:Object.freeze(controls)});
/** The only accepted external interface is a synthetic review-bound connection. */
export function createCar02OfflineReleaseReadinessR459({pool,authorizeAuditor}={}){
 if(typeof pool?.connect!=='function'||typeof authorizeAuditor!=='function'||CAR02_V459_RELEASE_LOCK!==true)
  throw Error('CAR02_V459_ISOLATED_ADAPTERS_REQUIRED');
 async function inspect({request}={}){
   let shop;
   try{
     const op=await authorizeAuditor({request});
     if(op?.verified!==true||op.mode!=='isolated_qa'||op.role!=='auditor'||
       typeof op.shopCode!=='string'||!SHOP.test(op.shopCode))fail();
     shop=op.shopCode;
   }catch{fail();}
   let client,started=false,finished=false,discard=false;
   try{
     client=await pool.connect();
     if(typeof client?.query!=='function'||typeof client?.release!=='function')
       throw Error('V459_BAD_READ_CLIENT');
     await client.query(SNAP);started=true;
     await client.query("SET LOCAL statement_timeout = '15s'");
     await client.query("SET LOCAL lock_timeout = '2s'");
     const res=await client.query(CAR02_V459_READ_SQL,[shop]);
     if(!Array.isArray(res?.rows)||res.rows.length!==CAR02_V459_MANDATORY_CONTROLS.length)
       throw Error('V459_INCOMPLETE_CONTROL_SET');
     const seen=new Map();
     for(const row of res.rows){
       if(!row||typeof row!=='object'||typeof row.control_code!=='string'||
         !CODE.test(row.control_code)||!CAR02_V459_MANDATORY_CONTROLS.includes(row.control_code)||
         seen.has(row.control_code)||typeof row.evidence_source!=='string'||
         !['synthetic_fixture','external_claim'].includes(row.evidence_source)||
         typeof row.review_state!=='string'||!['pending','observed'].includes(row.review_state))
         throw Error('V459_MALFORMED_CONTROL');
       seen.set(row.control_code,row);
     }
     if(seen.size!==CAR02_V459_MANDATORY_CONTROLS.length)throw Error('V459_MISSING_CONTROL');
     // Even if a malicious fixture claims ALL controls observed externally,
     // this isolated code has NO way to validate that claim. It must stay NO_GO.
     const pending=CAR02_V459_MANDATORY_CONTROLS.filter(c=>{
       const row=seen.get(c);
       return row.evidence_source!=='external_claim'||row.review_state!=='observed';
     });
     await client.query('ROLLBACK');started=false;finished=true;
     return frozen('no_go',pending.length?'external_validation_missing':'external_claims_not_independently_verified',
         CAR02_V459_MANDATORY_CONTROLS.slice());
   }catch{
     discard=true;
     if(started&&typeof client?.query==='function')try{await client.query('ROLLBACK')}catch{}
     return frozen('no_go','incomplete_or_untrusted_audit');
   }finally{
     if(typeof client?.release==='function')try{client.release(discard||!finished?new Error('V459_DISCARD_UNVERIFIED_READ'):undefined)}catch{}
   }
 }
 return Object.freeze({inspect});
}
