/**
 * DPRO CAR02 V4.49 — READ-ONLY post-COMMIT ambiguity reconciliation (OFFLINE QA).
 * REVIEW BRANCH ONLY / RELEASE BLOCKED / NEVER DEPLOY.
 * V4.48 loses the phase-1 or phase-2 COMMIT acknowledgement: it MUST NOT
 * interpret a transport error as rollback and MUST NOT mint a fresh fence.
 * This observer reads only a consistent PostgreSQL snapshot on a NEW acquired
 * client, returning observed state (which may become stale immediately).
 *
 * It cannot mutate membership, create a fence, reactivate, authenticate,
 * dispatch messages, or prove provider sessions. `scope` and authorization
 * MUST be furnished by a server-owned operator; never let callers supply nonce,
 * expected version, shop or SQL. The synthetic DB function is NOT production.
 */
export const CAR02_V449_RELEASE_LOCK=true;
export const CAR02_V449_READ_SQL =
 'SELECT phase,observed_version FROM v449_private.qa_reconcile_cutover($1::text,$2::uuid,$3::integer,$4::uuid)';
const SNAPSHOT_SQL='BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHOP=/^[A-Za-z0-9_-]{1,64}$/;
const deny=()=>{const e=Error('CAR02_UNAUTHORIZED');e.code='CAR02_UNAUTHORIZED';e.status=401;throw e;};
const isPlain=x=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
function validateScope(x){
 if(!isPlain(x)||Object.keys(x).sort().join(',')!=='expectedVersion,generationNonce,shopCode,userSub'||
  typeof x.shopCode!=='string'||!SHOP.test(x.shopCode)||
  typeof x.userSub!=='string'||!UUID.test(x.userSub)||
  typeof x.generationNonce!=='string'||!UUID.test(x.generationNonce)||
  !Number.isSafeInteger(x.expectedVersion)||x.expectedVersion<1||x.expectedVersion>=2147483646)
  throw Error('CAR02_V449_SERVER_SCOPE_REQUIRED');
 return Object.freeze({...x});
}
const status = (observation, extra={})=>Object.freeze({observation,...extra});
/**
 * Read-only inspection, NEVER an authorization grant or a durable COMMIT ACK.
 * Caller must revalidate and lock its own trusted session before a later mutation.
 */
export function createCar02OfflineCutoverReconcilerR449({pool,authorizeOperator,scope}={}){
 if(CAR02_V449_RELEASE_LOCK!==true||typeof pool?.connect!=='function'||
  typeof authorizeOperator!=='function')throw Error('CAR02_V449_CONFIG_REQUIRED');
 const bound=validateScope(scope);
 async function inspect({request}={}){
   try{
     const op=await authorizeOperator({request});
     if(!op||op.verified!==true||op.mode!=='isolated_qa'||
       op.shopCode!==bound.shopCode)deny();
   }catch{deny();}
   let client,started=false,finished=false,discard=false,observation='indeterminate';
   try{
     client=await pool.connect();
     if(!client||typeof client.query!=='function'||typeof client.release!=='function')
       throw Error('BAD_READ_CLIENT');
     await client.query(SNAPSHOT_SQL);started=true;
     await client.query("SET LOCAL statement_timeout = '15s'");
     await client.query("SET LOCAL lock_timeout = '2s'");
     const r=await client.query(CAR02_V449_READ_SQL,
       [bound.shopCode,bound.userSub,bound.expectedVersion,bound.generationNonce]);
     if(!Array.isArray(r?.rows)||r.rows.length!==1)throw Error('UNTRUSTED_SNAPSHOT');
     const row=r.rows[0];
     if(!row||typeof row!=='object'||typeof row.phase!=='string'||
       !Number.isSafeInteger(row.observed_version)||row.observed_version<1)
       throw Error('UNTRUSTED_ROW');
     const gen=row.observed_version;
     if(row.phase==='prior_generation'&&gen===bound.expectedVersion)
       observation='observed_prior_generation';
     else if(row.phase==='committed_unfenced'&&gen===bound.expectedVersion+1)
       observation='observed_cutover_unfenced';
     else if(row.phase==='fenced'&&gen===bound.expectedVersion+1)
       observation='observed_fenced';
     else if(row.phase==='superseded')observation='observed_superseded';
     else throw Error('UNTRUSTED_PHASE');
     // Explicitly end a READ ONLY snapshot; no extra writes or second-stage fence.
     await client.query('ROLLBACK');started=false;finished=true;
   }catch{
     discard=true;
     if(started&&client?.query)try{await client.query('ROLLBACK');started=false}catch{}
     observation='indeterminate';
   }finally{
     if(client?.release)try{client.release(discard||!finished?new Error('CAR02_DISCARD_INCOMPLETE_READ'):undefined)}catch{}
   }
   // None of these responses is a live authorization capability.
   return status(observation);
 }
 return Object.freeze({inspect});
}
