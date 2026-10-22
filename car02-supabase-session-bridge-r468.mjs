/**
 * DPRO CAR02 V4.68 — review-only R46 Supabase identity -> session bridge.
 * Real R46 can verify a user through /auth/v1/user but returns only sub/exp.
 * The JWT session_id is UNTRUSTED until a trusted server-side R46 verifier
 * validates the same token, AND an independently maintained session reader
 * validates current session, membership, and generation after a fence.
 * All injections in QA are mocks; this NEVER verifies real Supabase sessions.
 * No SQL, LINE, Worker, production backend or business permissions. NEVER DEPLOY.
 */
export const CAR02_V468_RELEASE_LOCK=true;
const UUID=/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const EPOCH=x=>Number.isSafeInteger(x)&&x>0&&x<2147483647;
const MS=x=>Number.isSafeInteger(x)&&x>0;
const isUUID=x=>typeof x==='string'&&UUID.test(x);
const denied=(reason,checks=0)=>Object.freeze({status:'no_go',reason,checksObserved:checks,
 releasePermitted:false,businessWriteAllowed:false,lineDispatchAllowed:false,
 realSupabaseSessionVerified:false,providerCredentialsUsed:false});
function untrustedJwtSession(token){
  if(typeof token!=='string'||token.length<8||token.length>8192||/\s/.test(token))return null;
  const parts=token.split('.');
  if(parts.length!==3||!parts.every(x=>/^[A-Za-z0-9_-]+$/.test(x)))return null;
  try{
    const b=Buffer.from(parts[1],'base64url');
    if(b.length>2048)return null;
    const c=JSON.parse(b.toString('utf8'));
    if(!c||Array.isArray(c)||typeof c!=='object')return null;
    if(!isUUID(c.sub)||!isUUID(c.session_id)||!EPOCH(c.exp)||
       c.aud!=='authenticated'||c.role!=='authenticated'||
       typeof c.iss!=='string'||!/^https:\/\/[^/]+\/auth\/v1$/.test(c.iss))return null;
    return {subject:c.sub,sessionId:c.session_id,exp:c.exp,issuer:c.iss};
  }catch{return null;}
}
/** All injected operations MUST remain offline mocks. R46 is used in tests with
 * a synthetic /auth/v1/user response, NOT real provider or signature verification.
 */
export function createCar02OfflineSupabaseSessionBridgeR468({authorizeReviewer,inspectIsolation,
 verifyStaffJwt,readSession,readMembership,nowSeconds=()=>Math.floor(Date.now()/1000)}={}){
 if(CAR02_V468_RELEASE_LOCK!==true||
  ![authorizeReviewer,inspectIsolation,verifyStaffJwt,readSession,readMembership,nowSeconds]
   .every(x=>typeof x==='function'))throw Error('V468_REQUIRED_OFFLINE_ADAPTERS');
 async function inspect({request}={}){
  let scope;
  try{
   const [reviewer,environment]=await Promise.all([authorizeReviewer({request}),inspectIsolation()]);
   if(reviewer?.verified!==true||reviewer.mode!=='isolated_qa'||reviewer.role!=='session_bridge_auditor'||
      !SHOP.test(reviewer.shopCode)||environment?.verified!==true||
      environment.environment!=='isolated_mock_only'||environment.testOnly!==true)
    return denied('untrusted_reviewer_or_environment');
   scope={shopCode:reviewer.shopCode};
  }catch{return denied('untrusted_reviewer_or_environment');}
  try{
   const authorization=request?.headers?.get?.('authorization');
   if(typeof authorization!=='string'||!/^Bearer [^\s]{8,8192}$/.test(authorization))
    return denied('invalid_offline_bearer');
   // This claim is decoded for correlation only; NEVER proof by itself.
   const token=authorization.slice(7),untrusted=untrustedJwtSession(token);
   if(!untrusted)return denied('invalid_unsigned_session_claim');
   const now=nowSeconds();if(!EPOCH(now)||untrusted.exp<=now)return denied('expired_or_invalid_clock');
   // Verified identity must be from R46 /auth/v1/user, simulated ONLY in tests.
   const verified=await verifyStaffJwt({accessToken:token});
   if(verified?.verified!==true||verified.sub!==untrusted.subject||
     verified.exp!==untrusted.exp)return denied('r46_identity_not_verified');
   const session=await readSession({subject:verified.sub,sessionId:untrusted.sessionId});
   if(session?.source!=='isolated_mock_session_store'||session.active!==true||
      session.userSub!==verified.sub||session.sessionId!==untrusted.sessionId||
      !EPOCH(session.expiresAtSec)||session.expiresAtSec<=now||
      !MS(session.createdAtMs)||!Number.isSafeInteger(session.generation)||session.generation<1)
    return denied('trusted_session_not_observed',1);
   const membership=await readMembership({shopCode:scope.shopCode,userSub:verified.sub});
   if(membership?.source!=='isolated_mock_membership'||membership.active!==true||
      membership.shopCode!==scope.shopCode||membership.userSub!==verified.sub||
      !['staff','owner'].includes(membership.role)||
      membership.generation!==session.generation||
      membership.acknowledgedGeneration!==session.generation||
      !MS(membership.postcommitFenceAtMs)||
      session.createdAtMs<=membership.postcommitFenceAtMs)
    return denied('membership_or_postcommit_generation_not_observed',2);
   // Even all matches are NOT an authorization to call any business API.
   return denied('offline_bridge_consistent_still_no_go',3);
  }catch{return denied('provider_or_adapter_rejected');}
 }
 return Object.freeze({inspect});
}
