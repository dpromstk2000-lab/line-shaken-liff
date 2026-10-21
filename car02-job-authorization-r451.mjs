/**
 * DPRO CAR02 V4.51 — isolated OWNER/ASSIGNED STAFF role-scoped atomic job CAS.
 * NOT DEPLOYABLE. Synthetic provider sessions, private schema, disposable PG17.
 * R44/R46/R50/R52 unchanged. NEVER use production Supabase, Worker or LINE.
 * The actual authority to edit a job is decided exclusively by a locked
 * database membership row, session row and an atomic job UPDATE predicate.
 * Staff: explicitly assigned, unlocked and non-archived jobs only.
 * Owner: any non-archived job within the SAME shop. No client-provided role,
 * assignment, tenant, session id, provider evidence, or authorization flags.
 * Missing response/COMMIT ambiguity => INDETERMINATE; never auto retry.
 * Production provider session origin, JWT verifier and post-COMMIT fence
 * remain UNPROVEN. This does not grant any real business privileges.
 */
export const CAR02_V451_RELEASE_LOCK = true;
export const CAR02_V451_ATOMIC_SQL = 'SELECT applied,new_version FROM v451_private.qa_role_bound_job_cas($1::text,$2::uuid,$3::uuid,$4::uuid,$5::integer)';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHOP=/^[A-Za-z0-9_-]{1,64}$/;
const validUUID=x=>typeof x==='string'&&UUID.test(x);
const unauthorized=()=>{const e=Error('CAR02_UNAUTHORIZED');e.code='CAR02_UNAUTHORIZED';e.status=401;throw e;};
const result=(status,other={})=>Object.freeze({status,...other});
function tokenOf(request){
 const h=request?.headers;const a=h?.get?.('authorization');
 if(typeof a!=='string'||!/^Bearer [^\s]{12,8192}$/.test(a)||h.get('x-line-id-token')!==null)unauthorized();
 return a.slice(7);
}
/** Trusted adapters MUST be independently implemented server side. */
export function createCar02OfflineJobAuthorizationR451({store,verifyJwt,authorizeShop,expectedIssuer,nowMs=()=>Date.now()}={}){
 if(!CAR02_V451_RELEASE_LOCK||typeof store?.query!=='function'||typeof verifyJwt!=='function'||
   typeof authorizeShop!=='function'||typeof nowMs!=='function'||
   typeof expectedIssuer!=='string'||!/^https:\/\/[a-z0-9-]+\.supabase\.co\/auth\/v1$/.test(expectedIssuer))
   throw Error('CAR02_V451_TRUSTED_OFFLINE_ADAPTERS_REQUIRED');
 async function touchJob({request,jobId,expectedVersion}={}){
   let shop,actor;
   try{
     if(!validUUID(jobId)||!Number.isSafeInteger(expectedVersion)||expectedVersion<1||expectedVersion>=2147483647)unauthorized();
     const raw=tokenOf(request),clock=nowMs();
     if(!Number.isSafeInteger(clock)||clock<=0)unauthorized();
     const verifiedShop=await authorizeShop({request});
     if(verifiedShop?.verified!==true||verifiedShop.mode!=='isolated_qa'||
        typeof verifiedShop.shopCode!=='string'||!SHOP.test(verifiedShop.shopCode))unauthorized();
     shop=verifiedShop.shopCode;
     actor=await verifyJwt({accessToken:raw,expectedIssuer});
     if(actor?.verified!==true||!validUUID(actor.sub)||!validUUID(actor.sessionId)||
        actor.issuer!==expectedIssuer||actor.audience!=='authenticated'||
        actor.role!=='authenticated'||!Number.isSafeInteger(actor.expMs)||actor.expMs<=clock)unauthorized();
   }catch{unauthorized();}
   try{
     const r=await store.query(CAR02_V451_ATOMIC_SQL,[shop,actor.sub,actor.sessionId,jobId,expectedVersion]);
     if(!Array.isArray(r?.rows)||r.rows.length!==1||r.rows[0]?.applied!==true||
        r.rows[0]?.new_version!==expectedVersion+1)return result('indeterminate');
     return result('applied_review_only',{newVersion:expectedVersion+1});
   }catch{return result('indeterminate');}
 }
 return Object.freeze({touchJob});
}
