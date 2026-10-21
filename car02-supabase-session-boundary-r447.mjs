/**
 * DPRO CAR02 V4.47 — OFFLINE SUPABASE SESSION-ROW BOUNDARY CANDIDATE.
 * RELEASE BLOCKED. No live Supabase, no real auth.sessions read, no production SQL.
 *
 * Supabase JWTs include session_id. Unlike a refreshed JWT's new iat, the
 * provider-owned session CREATED timestamp cannot be advanced just by refreshing
 * that same session. The candidate requires the persisted session to exist and
 * have started strictly AFTER a separately established POST-COMMIT fence.
 *
 * IMPORTANT: an UPDATE's clock_timestamp() is NOT its commit timestamp. The
 * fence must be independently established AFTER the membership transaction's
 * COMMIT has been acknowledged, by a trusted server-only process. This module
 * cannot construct or prove that fence; PG17 QA uses synthetic timestamps.
 *
 * `verifyJwt` must validate crypto signature, issuer, audience, expiry, role.
 * The store must be privileged, read-only to caller, and backed by provider-
 * owned sessions and a trusted membership/fence table. Neither adapter exists
 * in production here. No browser-supplied session, role, shop or user metadata
 * may count as proof. R44/R46/R50/R52 are untouched. NEVER DEPLOY.
 */
export const CAR02_V447_RELEASE_LOCK = true;
export const CAR02_V447_READ_SQL =
  'SELECT staff_role,auth_version,generation_nonce,session_created_ms,postcommit_fence_ms FROM v447_private.qa_live_session($1::text,$2::uuid,$3::uuid)';
export const CAR02_V447_LOCK_SQL =
  'SELECT staff_role,auth_version,generation_nonce,session_created_ms,postcommit_fence_ms FROM v447_private.qa_lock_live_session($1::text,$2::uuid,$3::uuid)';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHOP=/^[A-Za-z0-9_-]{1,64}$/;
const validUUID=x=>typeof x==='string'&&UUID.test(x);
const deny=()=>{const e=new Error('CAR02_UNAUTHORIZED');e.code='CAR02_UNAUTHORIZED';e.status=401;throw e;};
const validRow=x=>x&&['staff','owner'].includes(x.staff_role)&&
  Number.isSafeInteger(x.auth_version)&&x.auth_version>0&&
  validUUID(x.generation_nonce)&&Number.isSafeInteger(x.session_created_ms)&&
  Number.isSafeInteger(x.postcommit_fence_ms)&&x.postcommit_fence_ms>0&&
  x.session_created_ms>x.postcommit_fence_ms;
const rowMatches=(r,a)=>validRow(r)&&r.staff_role===a.role&&
  r.auth_version===a.authVersion&&r.generation_nonce===a.generationNonce&&
  r.postcommit_fence_ms===a.postcommitFenceMs&&r.session_created_ms===a.sessionCreatedMs;
const singleRow=o=>Array.isArray(o?.rows)&&o.rows.length===1?o.rows[0]:null;
function bearer(request){
 const h=request?.headers;
 const s=h?.get?.('authorization');
 if(typeof s!=='string'||!/^Bearer [^\s]{12,8192}$/.test(s)||
    h.get('x-line-id-token')!==null)deny();
 return s.slice(7);
}
/** Offline adapter. `store.query` must NOT be a caller-supplied SQL client. */
export function createCar02SupabaseSessionBoundaryR447({
 verifyJwt,store,expectedIssuer,nowMs=()=>Date.now()
}={}){
 if(CAR02_V447_RELEASE_LOCK!==true||typeof verifyJwt!=='function'||
    typeof store?.query!=='function'||typeof nowMs!=='function'||
    typeof expectedIssuer!=='string'||!/^https:\/\/[a-z0-9-]+\.supabase\.co\/auth\/v1$/.test(expectedIssuer))
   throw new Error('CAR02_V447_TRUSTED_SERVER_ADAPTERS_REQUIRED');
 const issued=new WeakSet();
 const claimsOK=(c,t)=>c?.verified===true&&validUUID(c.sub)&&validUUID(c.sessionId)&&
   c.issuer===expectedIssuer&&c.audience==='authenticated'&&c.role==='authenticated'&&
   Number.isSafeInteger(c.expMs)&&c.expMs>t;
 async function authenticate(request,shopCode){
  try{
   if(typeof shopCode!=='string'||!SHOP.test(shopCode))deny();
   const token=bearer(request),now=nowMs();
   if(!Number.isSafeInteger(now)||now<=0)deny();
   const claims=await verifyJwt({accessToken:token,expectedIssuer});
   if(!claimsOK(claims,now))deny();
   const out=await store.query(CAR02_V447_READ_SQL,[shopCode,claims.sub,claims.sessionId]);
   const r=singleRow(out);
   if(!validRow(r))deny();
   const actor=Object.freeze({verified:true,shopCode,userSub:claims.sub,
     sessionId:claims.sessionId,role:r.staff_role,authVersion:r.auth_version,
     generationNonce:r.generation_nonce,sessionCreatedMs:r.session_created_ms,
     postcommitFenceMs:r.postcommit_fence_ms,expiresAtMs:claims.expMs});
   issued.add(actor);return actor;
  }catch{deny();}
 }
 /** Assert AGAIN within the SAME DB transaction and connection as a business write.
  * The caller is responsible for enforcing BEGIN/COMMIT and rejecting stale actor.
  */
 async function assertMutation({actor,shopCode,transactionClient}={}){
  try{
   const now=nowMs();
   if(!actor||typeof actor!=='object'||!issued.has(actor)||!Object.isFrozen(actor)||
      !SHOP.test(shopCode)||actor.shopCode!==shopCode||
      !transactionClient||typeof transactionClient.query!=='function'||
      !Number.isSafeInteger(now)||now>=actor.expiresAtMs)deny();
   const out=await transactionClient.query(CAR02_V447_LOCK_SQL,
     [shopCode,actor.userSub,actor.sessionId]);
   if(!rowMatches(singleRow(out),actor))deny();
   if(!Number.isSafeInteger(nowMs())||nowMs()>=actor.expiresAtMs)deny();
   return true;
  }catch{deny();}
 }
 return Object.freeze({authenticate,assertMutation});
}
