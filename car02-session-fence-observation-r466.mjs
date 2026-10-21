/**
 * CAR02 V4.66 - DISPOSABLE PG17 synthetic session/fence observational gate.
 * This is a dry-run of the future R46 -> authenticated session -> business CAS seam.
 * It is NOT Supabase Auth, real JWT signature verification, a real session revocation
 * check, a permission check, an authorization, a migration, or a live adapter.
 * Server-only provider attestations and role checks are INJECTED TEST DOUBLES.
 * Never wire to R52, a Worker, LINE, or a live database; NO_GO in every branch.
 */
export const CAR02_V466_RELEASE_LOCK = true;
export const CAR02_V466_QUERY =
  'SELECT proof_state,session_seen,membership_seen,fence_verified FROM v466_private.qa_fence_observe($1::text,$2::uuid,$3::uuid,$4::bigint)';
const TX='BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const STATES=new Set(['eligible_for_review_only','session_rejected','membership_rejected','generation_rejected']);
const isUuid=x=>typeof x==='string'&&UUID.test(x);
const epoch=x=>Number.isSafeInteger(x)&&x>0&&x<2147483647;
const noGo=(reason,observed=0)=>Object.freeze({status:'no_go',reason,checksObserved:observed,
  releasePermitted:false,businessWriteAllowed:false,lineDispatchAllowed:false,realProviderSessionVerified:false});
/** Inspectors are server-owned fixtures; request-supplied shop/subject/session are NEVER trusted. */
export function createCar02OfflineSessionFenceR466({pool,authorizeInspector,inspectIsolation,
  getSignedSessionObservation,nowSeconds=()=>Math.floor(Date.now()/1000)}={}){
 if(CAR02_V466_RELEASE_LOCK!==true||typeof pool?.connect!=='function'||
   ![authorizeInspector,inspectIsolation,getSignedSessionObservation,nowSeconds].every(x=>typeof x==='function'))
   throw Error('CAR02_V466_DISPOSABLE_ADAPTERS_REQUIRED');
 async function inspect({request}={}){
  let shop,subject,sessionId,now;
  try{
   const [identity,environment,attestation]=await Promise.all([
     authorizeInspector({request}),inspectIsolation(),getSignedSessionObservation({request})
   ]);
   if(identity?.verified!==true||identity.mode!=='isolated_qa'||identity.role!=='session_auditor'||
      !SHOP.test(identity.shopCode)||environment?.verified!==true||
      environment.environment!=='disposable_pg17'||environment.database!=='car02_v466_disposable'||
      environment.testOnly!==true)return noGo('untrusted_isolation');
   // Explicitly require a synthetic source. This never accepts real provider credentials.
   if(attestation?.source!=='isolated_mock'||attestation.verified!==true||
      !isUuid(attestation.subject)||!isUuid(attestation.sessionId)||
      attestation.audience!=='authenticated'||attestation.role!=='authenticated'||
      !epoch(attestation.expiresAtSec))return noGo('untrusted_attestation');
   now=nowSeconds();if(!epoch(now)||attestation.expiresAtSec<=now)return noGo('expired_or_invalid_clock');
   shop=identity.shopCode;subject=attestation.subject;sessionId=attestation.sessionId;
  }catch{return noGo('untrusted_isolation_or_attestation');}
  let db,started=false,closed=false;
  try{
   db=await pool.connect();if(typeof db?.query!=='function'||typeof db?.release!=='function')
    throw Error('CAR02_V466_BAD_DB_CLIENT');
   await db.query(TX);started=true;
   await db.query("SET LOCAL statement_timeout = '5s'");
   await db.query("SET LOCAL lock_timeout = '1s'");
   const result=await db.query(CAR02_V466_QUERY,[shop,subject,sessionId,now]);
   if(!Array.isArray(result?.rows)||result.rows.length!==1)throw Error('CAR02_V466_BAD_DB_RESULT');
   const row=result.rows[0];
   if(!row||typeof row!=='object'||Array.isArray(row)||!STATES.has(row.proof_state)||
      !['session_seen','membership_seen','fence_verified'].every(k=>typeof row[k]==='boolean'))
     throw Error('CAR02_V466_BAD_DB_RESULT');
   // Fail closed on inconsistent privileged SQL projections.
   if(row.proof_state==='eligible_for_review_only'&&
      !(row.session_seen&&row.membership_seen&&row.fence_verified))
      throw Error('CAR02_V466_INCONSISTENT_EVIDENCE');
   if(row.proof_state==='session_rejected'&&row.session_seen)throw Error('CAR02_V466_INCONSISTENT_EVIDENCE');
   if(row.proof_state==='membership_rejected'&&(!row.session_seen||row.membership_seen))
      throw Error('CAR02_V466_INCONSISTENT_EVIDENCE');
   if(row.proof_state==='generation_rejected'&&(!row.session_seen||!row.membership_seen||row.fence_verified))
      throw Error('CAR02_V466_INCONSISTENT_EVIDENCE');
   await db.query('ROLLBACK');started=false;closed=true;
   return noGo(row.proof_state==='eligible_for_review_only'?
     'synthetic_session_and_fence_consistent_still_no_go':row.proof_state,
       Number(row.session_seen)+Number(row.membership_seen)+Number(row.fence_verified));
  }catch{
   if(started&&typeof db?.query==='function')try{await db.query('ROLLBACK')}catch{}
   return noGo('untrusted_snapshot_or_database');
  }finally{
   if(typeof db?.release==='function')try{
      db.release(closed?undefined:new Error('CAR02_V466_DISCARD_UNVERIFIED_SNAPSHOT'));
   }catch{}
  }
 }
 return Object.freeze({inspect});
}
