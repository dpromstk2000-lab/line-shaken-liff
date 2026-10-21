/**
 * CAR02 V4.67 — disposable-PostgreSQL proof of same-transaction auth fence + CAS.
 * NO commercial auth, actual reservations, LINE, Supabase or business operations.
 * All identities and job intents are TEST DOUBLES. Even a successful SQL UPDATE
 * is immediately ROLLED BACK by this adapter. NEVER DEPLOY OR REMOVE R52 LOCK.
 */
export const CAR02_V467_RELEASE_LOCK=true;
export const CAR02_V467_DRYRUN_SQL='SELECT outcome,next_version FROM v467_private.qa_atomic_dryrun($1::text,$2::uuid,$3::uuid,$4::uuid,$5::integer,$6::bigint)';
const BEGIN='BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED';
const UUID=/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const OUTCOMES=new Set(['synthetic_cas_advanced','session_rejected','membership_rejected','generation_rejected','version_conflict']);
const id=x=>typeof x==='string'&&UUID.test(x);
const epoch=x=>Number.isSafeInteger(x)&&x>0&&x<2147483647;
const noGo=(reason,transactionRolledBack=false)=>Object.freeze({status:'no_go',reason,releasePermitted:false,
  businessWriteAllowed:false,lineDispatchAllowed:false,transactionRolledBack,
  realSupabaseSessionVerified:false});
/**
 * These FOUR callbacks must come from INJECTED, server-owned disposable fixtures.
 * Any live provider tokens/production pool invalidate the conceptual boundary.
 */
export function createCar02OfflineAtomicSessionCasR467({pool,authorizeQaOperator,
 inspectIsolation,getMockSession,getSyntheticJobIntent,nowSeconds=()=>Math.floor(Date.now()/1000)}={}){
 if(CAR02_V467_RELEASE_LOCK!==true||typeof pool?.connect!=='function'||
   ![authorizeQaOperator,inspectIsolation,getMockSession,getSyntheticJobIntent,nowSeconds]
    .every(x=>typeof x==='function'))throw Error('CAR02_V467_DISPOSABLE_ADAPTERS_REQUIRED');
 async function inspect({request}={}){
  let shop,sub,session,job,version,now;
  try{
   // Do not accept any tenant, subject, session or business entity from request args.
   const [a,env,auth,intent]=await Promise.all([authorizeQaOperator({request}),
      inspectIsolation(),getMockSession({request}),getSyntheticJobIntent({request})]);
   if(a?.verified!==true||a.mode!=='isolated_qa'||a.role!=='cas_tester'||
      typeof a.shopCode!=='string'||!SHOP.test(a.shopCode)||
      env?.verified!==true||env.environment!=='disposable_pg17'||
      env.database!=='car02_v466_disposable'||env.testOnly!==true||
      auth?.verified!==true||auth.source!=='isolated_mock'||!id(auth.subject)||
      !id(auth.sessionId)||!epoch(auth.expiresAtSec)||
      intent?.source!=='isolated_job_fixture'||intent.verified!==true||
      intent.shopCode!==a.shopCode||!id(intent.jobId)||
      !Number.isSafeInteger(intent.expectedVersion)||intent.expectedVersion<0||intent.expectedVersion>1000000)
      return noGo('isolation_identity_or_intent_unverified');
   now=nowSeconds();if(!epoch(now)||auth.expiresAtSec<=now)return noGo('expired_or_invalid_clock');
   shop=a.shopCode;sub=auth.subject;session=auth.sessionId;
   job=intent.jobId;version=intent.expectedVersion;
  }catch{return noGo('isolation_identity_or_intent_unverified');}
  let db,started=false,rolledBack=false;
  try{
   db=await pool.connect();
   if(typeof db?.query!=='function'||typeof db?.release!=='function')throw Error('CAR02_V467_DB_INVALID');
   await db.query(BEGIN);started=true;
   await db.query("SET LOCAL statement_timeout = '5s'");
   await db.query("SET LOCAL lock_timeout = '1s'");
   const reply=await db.query(CAR02_V467_DRYRUN_SQL,[shop,sub,session,job,version,now]);
   if(!Array.isArray(reply?.rows)||reply.rows.length!==1)throw Error('CAR02_V467_DB_RESULT_INVALID');
   const r=reply.rows[0];
   if(!r||typeof r!=='object'||Array.isArray(r)||!OUTCOMES.has(r.outcome)||
      (r.outcome==='synthetic_cas_advanced'&&r.next_version!==version+1)||
      (r.outcome!=='synthetic_cas_advanced'&&r.next_version!==null))
      throw Error('CAR02_V467_DB_RESULT_INVALID');
   // ROLLBACK is MANDATORY, including successful synthetic UPDATE.
   await db.query('ROLLBACK');started=false;rolledBack=true;
   return noGo(r.outcome==='synthetic_cas_advanced'?'synthetic_cas_rolled_back_no_go':r.outcome,true);
  }catch{
   if(started&&typeof db?.query==='function')try{
     await db.query('ROLLBACK');rolledBack=true;
   }catch{}
   return noGo('atomic_snapshot_untrusted',rolledBack);
  }finally{
   if(typeof db?.release==='function')try{
     db.release(rolledBack?undefined:new Error('CAR02_V467_DISCARD_FAILED_ROLLBACK'));
   }catch{}
  }
 }
 return Object.freeze({inspect});
}
