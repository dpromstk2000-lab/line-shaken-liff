/**
 * DPRO CAR02 V4.50 — OFFLINE synthetic atomic staff session + tenant CAS write.
 * REVIEW ONLY. NEVER deploy; real Supabase Auth, session rows, Worker, LINE absent.
 * A verified JWT's session_id MUST come from the trusted verifier; never request.
 * The server-bound shop MUST come from trusted route config, not user input.
 * One SQL statement performs session-row lock, membership-generation + fence
 * check, tenant-scoped optimistic write inside ONE PG transaction/function.
 * A lost SQL/COMMIT ACK is INDETERMINATE; NEVER retry or claim rollback.
 * The synthetic provider-session fixture does not prove actual auth.sessions access,
 * signer verification or real post-COMMIT cutover. No R44/R46/R50/R52 wiring.
 */
export const CAR02_V450_RELEASE_LOCK=true;
export const CAR02_V450_ATOMIC_SQL=
 'SELECT applied,new_version FROM v450_private.qa_atomic_session_touch($1::text,$2::uuid,$3::uuid,$4::uuid,$5::integer)';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHOP=/^[A-Za-z0-9_-]{1,64}$/;
const isUUID=s=>typeof s==='string'&&UUID.test(s);
const reject=()=>{const e=Error('CAR02_UNAUTHORIZED');e.code='CAR02_UNAUTHORIZED';e.status=401;throw e;};
const frozen=(status,rest={})=>Object.freeze({status,...rest});
function bearer(request){
 const h=request?.headers;
 const auth=h?.get?.('authorization');
 if(typeof auth!=='string'||!/^Bearer [^\s]{12,8192}$/.test(auth)||
    h.get('x-line-id-token')!==null)reject();
 return auth.slice(7);
}
const validVersion=n=>Number.isSafeInteger(n)&&n>=1&&n<2147483647;
/** authorizeShop and verifyJwt MUST be true server-owned adapters. This factory
 * only models their contracts. The SQL adapter can ONLY use a disposable DB.
 */
export function createCar02OfflineAtomicSessionWriteR450({store,verifyJwt,authorizeShop,expectedIssuer,nowMs=()=>Date.now()}={}){
 if(CAR02_V450_RELEASE_LOCK!==true||typeof store?.query!=='function'||
    typeof verifyJwt!=='function'||typeof authorizeShop!=='function'||
    typeof nowMs!=='function'||typeof expectedIssuer!=='string'||
    !/^https:\/\/[a-z0-9-]+\.supabase\.co\/auth\/v1$/.test(expectedIssuer))
   throw Error('CAR02_V450_TRUSTED_OFFLINE_CONFIG_REQUIRED');
 async function touch({request,orderId,expectedVersion}={}){
   let claims,shopCode;
   try{
     if(!isUUID(orderId)||!validVersion(expectedVersion))reject();
     const token=bearer(request),now=nowMs();
     if(!Number.isSafeInteger(now)||now<=0)reject();
     const bound=await authorizeShop({request});
     if(!bound||bound.verified!==true||bound.mode!=='isolated_qa'||
       typeof bound.shopCode!=='string'||!SHOP.test(bound.shopCode))reject();
     shopCode=bound.shopCode;
     claims=await verifyJwt({accessToken:token,expectedIssuer});
     if(!claims||claims.verified!==true||!isUUID(claims.sub)||!isUUID(claims.sessionId)||
       claims.issuer!==expectedIssuer||claims.audience!=='authenticated'||
       claims.role!=='authenticated'||!Number.isSafeInteger(claims.expMs)||
       claims.expMs<=now)reject();
   }catch{reject();}
   // The DB function is the ONLY authority: no separate stale auth read allowed.
   // No client nonce, actor role, session row timestamp or tenant override.
   try{
     const response=await store.query(CAR02_V450_ATOMIC_SQL,
       [shopCode,claims.sub,claims.sessionId,orderId,expectedVersion]);
     if(!Array.isArray(response?.rows)||response.rows.length!==1||
        response.rows[0]?.applied!==true||
        response.rows[0]?.new_version!==expectedVersion+1)
       return frozen('indeterminate');
     return frozen('applied_review_only',{newVersion:expectedVersion+1});
   }catch{
     // An exception can occur AFTER an atomic update committed on the DB side.
     // MUST NOT assume no write; never automatically replay this operation.
     return frozen('indeterminate');
   }
 }
 return Object.freeze({touch});
}
