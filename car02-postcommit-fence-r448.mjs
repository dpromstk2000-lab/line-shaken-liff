/**
 * DPRO CAR02 V4.48 — REVIEW-ONLY TWO-CONNECTION POST-COMMIT FENCE PROTOTYPE.
 * DO NOT DEPLOY; no real Supabase auth.sessions, credentials, real DB, or Worker.
 * A trusted OFFLINE fixture operator must authorize a cutover; the factory never
 * accepts caller-selected SQL, nonce or target shop. R44/R46/R50/R52 unchanged.
 * Phase 1: CAS reactivates only a SUSPENDED member, clears fence, COMMIT ACK.
 * Phase 2: a DIFFERENT PG connection may establish a database-clock fence ONLY
 * after phase-1 COMMIT ACK; the row must still match that generation+nonce.
 * COMMIT transport ambiguity -> indeterminate, NEVER assert success or retry.
 * This does NOT prove provider-owned auth.sessions created_at clock consistency,
 * real operator identity, commit proof across infrastructure, or release safety.
 */
import {randomUUID} from 'node:crypto';
export const CAR02_V448_RELEASE_LOCK = true;
export const CAR02_V448_CUTOVER_SQL = 'SELECT new_version,generation_nonce FROM v448_private.qa_cutover($1::text,$2::uuid,$3::integer,$4::uuid)';
export const CAR02_V448_FENCE_SQL = 'SELECT established FROM v448_private.qa_establish_fence($1::text,$2::uuid,$3::integer,$4::uuid)';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHOP=/^[A-Za-z0-9_-]{1,64}$/;
const isId=v=>typeof v==='string'&&UUID.test(v);
const isVersion=v=>Number.isSafeInteger(v)&&v>=1&&v<2147483646;
const deny=()=>{const e=Error('CAR02_UNAUTHORIZED');e.code='CAR02_UNAUTHORIZED';e.status=401;throw e;};
const result=(status,extra={})=>Object.freeze({status,...extra});
/** `authorizeOperator` is a SYNTHETIC server-owned adapter, not real IAM. */
export function createCar02PostCommitFenceR448({pool,authorizeOperator,generateNonce=randomUUID}={}) {
 if(CAR02_V448_RELEASE_LOCK!==true||typeof pool?.connect!=='function'||
    typeof authorizeOperator!=='function'||typeof generateNonce!=='function')
    throw Error('CAR02_V448_OFFLINE_CONFIG_REQUIRED');
 async function cutover({request,userSub,expectedVersion}={}) {
   let shopCode,nonce;
   try {
     const op=await authorizeOperator({request});
     if(!op||op.verified!==true||op.mode!=='isolated_qa'||
        typeof op.shopCode!=='string'||!SHOP.test(op.shopCode)||
        !isId(userSub)||!isVersion(expectedVersion))deny();
     shopCode=op.shopCode;
     nonce=generateNonce();
     if(!isId(nonce))deny();
   }catch{deny();}
   let first,firstOpen=false,firstCommitAttempted=false,firstAck=false,version;
   try {
     first=await pool.connect();
     if(!first||typeof first.query!=='function'||typeof first.release!=='function')throw Error('BAD_POOL_CLIENT');
     await first.query('BEGIN');firstOpen=true;
     await first.query("SET LOCAL lock_timeout = '2s'");
     await first.query("SET LOCAL statement_timeout = '15s'");
     const r=await first.query(CAR02_V448_CUTOVER_SQL,[shopCode,userSub,expectedVersion,nonce]);
     if(!Array.isArray(r?.rows)||r.rows.length!==1||r.rows[0]?.new_version!==expectedVersion+1||
        r.rows[0]?.generation_nonce!==nonce)throw Error('CUTOVER_CAS_REJECTED');
     version=expectedVersion+1;
     firstCommitAttempted=true;
     await first.query('COMMIT');firstOpen=false;firstAck=true;
   }catch {
     if(firstOpen&&!firstCommitAttempted&&first?.query)try{await first.query('ROLLBACK')}catch{}
     return result(firstCommitAttempted?'indeterminate_commit':'rejected');
   }finally{
     if(first?.release)try{first.release(!firstAck?new Error('CAR02_DISCARD_UNVERIFIED_COMMIT'):undefined)}catch{}
   }
   // No second connection or fence is ever opened after an uncertain phase-1 COMMIT.
   if(!firstAck)return result('indeterminate_commit');
   let second,secondOpen=false,secondCommitAttempted=false,secondAck=false;
   try {
     second=await pool.connect();
     if(!second||second===first||typeof second.query!=='function'||
        typeof second.release!=='function')throw Error('SEPARATE_CLIENT_REQUIRED');
     await second.query('BEGIN');secondOpen=true;
     await second.query("SET LOCAL lock_timeout = '2s'");
     await second.query("SET LOCAL statement_timeout = '15s'");
     const r=await second.query(CAR02_V448_FENCE_SQL,[shopCode,userSub,version,nonce]);
     if(!Array.isArray(r?.rows)||r.rows.length!==1||r.rows[0]?.established!==true)
       throw Error('FENCE_GENERATION_MISMATCH');
     secondCommitAttempted=true;
     await second.query('COMMIT');secondOpen=false;secondAck=true;
     return result('fenced_review_only',{generation:version});
   }catch {
     if(secondOpen&&!secondCommitAttempted&&second?.query)try{await second.query('ROLLBACK')}catch{}
     // Phase 1 already committed. Even explicit stage-2 failure MUST NOT claim rollback.
     return result('indeterminate_fence');
   }finally {
     if(second?.release)try{second.release(!secondAck?new Error('CAR02_DISCARD_UNVERIFIED_FENCE'):undefined)}catch{}
   }
 }
 return Object.freeze({cutover});
}
