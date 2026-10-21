/**
 * DPRO CAR02 V4.46 — OFFLINE GENERATION-BOUND LOGIN CUTOVER CONTRACT.
 * REVIEW-ONLY / NEVER DEPLOY / NO REAL SUPABASE OR PROVIDER SESSIONS.
 *
 * A JWT signature check alone cannot show that a staff member signed in AFTER
 * revocation/reactivation. This model REQUIRES a separate, server-controlled,
 * independently authenticated new-login event bound to a committed membership
 * generation nonce, exact token digest, provider session ID, shop and subject.
 * The synthetic PG17 fixture records those events explicitly after COMMIT.
 *
 * Neither an actual Supabase server-side session attestation source nor a
 * secure post-commit writer exists here. DO NOT accept the fixture's login
 * events as real provider evidence. R44/R46/R50/R52 are unchanged/locked.
 */
import {createHash} from 'node:crypto';
export const CAR02_V446_RELEASE_LOCK=true;
export const CAR02_V446_READ_SQL='SELECT staff_role,auth_version,generation_nonce,login_id FROM public.v446_qa_read_bound_login($1::text,$2::uuid,$3::uuid,$4::text)';
export const CAR02_V446_WRITE_SQL='SELECT staff_role,auth_version,generation_nonce,login_id FROM public.v446_qa_lock_bound_login($1::text,$2::uuid,$3::uuid,$4::text)';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHOP=/^[A-Za-z0-9_-]{1,64}$/;
const HEX=/^[a-f0-9]{64}$/;
const validUUID=x=>typeof x==='string'&&UUID.test(x);
const validShop=x=>typeof x==='string'&&SHOP.test(x);
const validVersion=x=>Number.isSafeInteger(x)&&x>0&&x<2147483647;
const validRole=x=>x==='staff'||x==='owner';
const deny=()=>{const e=Error('CAR02_UNAUTHORIZED');e.code='CAR02_UNAUTHORIZED';e.status=401;throw e;};
function tokenFromRequest(req){
 const headers=req?.headers;
 const auth=headers?.get?.('authorization');
 if(typeof auth!=='string'||!/^Bearer [^\s]{8,8192}$/.test(auth)||
    headers.get('x-line-id-token')!==null)deny();
 return auth.slice(7);
}
function boundRow(row){
 return row&&validRole(row.staff_role)&&validVersion(row.auth_version)&&
  validUUID(row.generation_nonce)&&validUUID(row.login_id);
}
function matchRow(row,actor){
 return boundRow(row)&&row.staff_role===actor.role&&row.auth_version===actor.authVersion&&
  row.generation_nonce===actor.generationNonce&&row.login_id===actor.loginId;
}
/**
 * verifyJwt MUST be server-owned and authenticate signature, issuer, audience and
 * expiry, returning the exact opaque provider session id. The PG17 SQL fixture
 * is NOT a replacement for a real provider-attested sign-in event.
 * query SQL is static and the store is a synthetic disposable DB fixture ONLY.
 */
export function createCar02OfflineSessionCutoverR446({verifyJwt,store,nowMs=()=>Date.now()}={}){
 if(CAR02_V446_RELEASE_LOCK!==true||typeof verifyJwt!=='function'||
    typeof store?.query!=='function'||typeof nowMs!=='function')
   throw Error('CAR02_V446_TRUSTED_PROVIDER_AND_STORE_REQUIRED');
 const issued=new WeakSet();
 async function authenticate(request,shopCode){
  try{
   if(!validShop(shopCode))deny();
   const raw=tokenFromRequest(request),clock=nowMs();
   if(!Number.isSafeInteger(clock)||clock<=0)deny();
   const claims=await verifyJwt({accessToken:raw});
   if(claims?.verified!==true||!validUUID(claims.sub)||!validUUID(claims.sessionId)||
      !Number.isSafeInteger(claims.expMs)||claims.expMs<=clock)deny();
   const tokenHash=createHash('sha256').update(raw).digest('hex');
   const out=await store.query(CAR02_V446_READ_SQL,[shopCode,claims.sub,claims.sessionId,tokenHash]);
   if(!Array.isArray(out?.rows)||out.rows.length!==1||!boundRow(out.rows[0]))deny();
   const x=out.rows[0];
   const actor=Object.freeze({verified:true,shopCode,userSub:claims.sub,
      providerSessionId:claims.sessionId,tokenSha256:tokenHash,role:x.staff_role,
      authVersion:x.auth_version,generationNonce:x.generation_nonce,loginId:x.login_id});
   issued.add(actor);return actor;
  }catch{deny();}
 }
 /** MUST be executed on the same transaction client as the business update.
  * This helper cannot itself enforce BEGIN/COMMIT boundaries; an actual write
  * controller and trusted external provider attestor remain missing.
  */
 async function assertMutation({client,actor,shopCode}={}){
  try{
   if(!actor||typeof actor!=='object'||!issued.has(actor)||!Object.isFrozen(actor)||
      actor.shopCode!==shopCode||!validShop(shopCode)||
      !client||typeof client.query!=='function')deny();
   const out=await client.query(CAR02_V446_WRITE_SQL,
      [shopCode,actor.userSub,actor.providerSessionId,actor.tokenSha256]);
   if(!Array.isArray(out?.rows)||out.rows.length!==1||!matchRow(out.rows[0],actor))deny();
   return true;
  }catch{deny();}
 }
 return Object.freeze({authenticate,assertMutation});
}
