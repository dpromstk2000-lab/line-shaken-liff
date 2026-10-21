/**
 * CAR02 V4.62 — ISOLATED READ-ONLY provider-session attestation *contract*.
 * NOT AN AUTH PROVIDER, NOT A TOKEN, NOT A BUSINESS-WRITE AUTHORIZATION.
 * R46 /auth/v1/user returns verified user sub/exp with NO provider sessionId.
 * Even if isolated mock adapters observe matching JWT, provider session,
 * membership and committed fence, the result stays NO_GO and review-only.
 * Never assume a real Supabase auth.sessions schema, grants, clock semantics,
 * or provider's session revocation behavior from this synthetic contract.
 * No SQL, LINE, network, Supabase, Worker, secrets or production mutations.
 * Production R44/R46/R50/R51/R52 remain unchanged and release-locked.
 */
export const CAR02_V462_RELEASE_LOCK=true;
export const CAR02_V462_REQUIRED_PROOFS=Object.freeze([
 'verified_auth_user','verified_signed_jwt_with_session_id',
 'provider_owned_live_session','active_tenant_membership','acknowledged_postcommit_fence'
]);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHOP=/^[A-Za-z0-9_-]{1,64}$/;
const isUuid=s=>typeof s==='string'&&UUID.test(s);
const sec=n=>Number.isSafeInteger(n)&&n>0;
const ms=n=>Number.isSafeInteger(n)&&n>0;
const noGo=(reason,step=0)=>Object.freeze({status:'no_go',reason,observedChecks:step,
  releasePermitted:false,writeAuthorized:false,realProviderEvidenceVerified:false});
function bearer(req){
 const h=req?.headers;
 const t=h?.get?.('authorization');
 if(typeof t!=='string'||!/^Bearer [^\s]{12,8192}$/.test(t)||
  h.get('x-line-id-token')!==null)throw Error('AUTH_REQUIRED');
 return t.slice(7);
}
/** All adapters are TEST DOUBLES until their trust and origin are independently proven.
 * Returned value can ONLY be used in an isolated evidence inventory.
 * Caller must never use it to permit a job update or to change R52 release flag.
 */
export function createCar02OfflineSessionObservationR462({authorizeShop,verifyAuthUserR46,
 verifySignedSessionJwt,readProviderSession,readMemberWithFence,nowSeconds=()=>Math.floor(Date.now()/1000)}={}){
 if(CAR02_V462_RELEASE_LOCK!==true||![authorizeShop,verifyAuthUserR46,
  verifySignedSessionJwt,readProviderSession,readMemberWithFence,nowSeconds].every(f=>typeof f==='function'))
  throw Error('CAR02_V462_OFFLINE_ADAPTERS_REQUIRED');
 async function inspect({request}={}){
  let token,scope,user,jwt,now;
  try{
   token=bearer(request);
   scope=await authorizeShop({request});
   if(scope?.verified!==true||scope.mode!=='isolated_qa'||
      typeof scope.shopCode!=='string'||!SHOP.test(scope.shopCode))return noGo('untrusted_shop_scope');
   now=nowSeconds();if(!sec(now))return noGo('invalid_clock');
   user=await verifyAuthUserR46({accessToken:token});
   if(user?.verified!==true||!isUuid(user.sub)||!sec(user.exp)||user.exp<=now)
    return noGo('r46_user_unverified');
  }catch{return noGo('r46_user_unverified');}
  let checks=1;
  try{
   jwt=await verifySignedSessionJwt({accessToken:token});
   if(jwt?.verified!==true||jwt.sub!==user.sub||!isUuid(jwt.sessionId)||
      jwt.aud!=='authenticated'||jwt.role!=='authenticated'||
      !sec(jwt.exp)||jwt.exp!==user.exp||!sec(nowSeconds())||jwt.exp<=nowSeconds())
    return noGo('signed_session_claim_not_verified',checks);
  }catch{return noGo('signed_session_claim_not_verified',checks);}
  checks++;
  let session;
  try{
   session=await readProviderSession({sessionId:jwt.sessionId,userSub:user.sub});
   if(session?.source!=='independent_provider_read' ||session.active!==true||
      session.userSub!==user.sub||session.sessionId!==jwt.sessionId||
      !ms(session.createdAtMs)||
      // Check again after awaiting I/O: expired tokens cannot pass observation.
      !sec(nowSeconds())||jwt.exp<=nowSeconds())return noGo('provider_session_not_observed',checks);
  }catch{return noGo('provider_session_not_observed',checks);}
  checks++;
  let membership;
  try{
   membership=await readMemberWithFence({shopCode:scope.shopCode,userSub:user.sub});
   if(membership?.shopCode!==scope.shopCode||membership.userSub!==user.sub||
     membership.active!==true||!['staff','owner'].includes(membership.role)||
     !Number.isSafeInteger(membership.authVersion)||membership.authVersion<=0||
     membership.fenceCommitAcknowledged!==true||!ms(membership.postcommitFenceAtMs)||
     session.createdAtMs<=membership.postcommitFenceAtMs||
     !sec(nowSeconds())||jwt.exp<=nowSeconds())return noGo('tenant_generation_or_fence_unverified',checks);
  }catch{return noGo('tenant_generation_or_fence_unverified',checks);}
  // Still missing an atomic row-locked authorization during the business write.
  // A read-only, time-of-check observation is never an enduring permission.
  return noGo('offline_observation_only_atomic_live_proof_missing',checks+2);
 }
 return Object.freeze({inspect});
}
