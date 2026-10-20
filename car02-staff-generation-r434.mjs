/**
 * DPRO CAR02 V4.34 — ISOLATED REVIEW CANDIDATE ONLY / NOT PRODUCTION AUTH.
 * This module is NOT wired to R44/R46/R50/R52 and has NO live provider integration.
 * Never accept membership epoch, role, session age, or version from the request body/JWT.
 * Required authority adapters are server-side and NOT implemented by this candidate:
 *   verifyStaffJwt: signature/issuer/audience/expiry verified against Supabase Auth.
 *   attestProviderSession: independent, immutable server-side proof of the specific
 *     Supabase auth session's sign-in/creation timestamp, status, and binding to
 *     this exact token and user. A successful /auth/v1/user call alone IS NOT enough.
 *   readStaffMembership: authoritative row with strictly post-COMMIT generation
 *     fence, not PostgreSQL now()/updated_at (transaction-start timestamp).
 * The real R46 verifier does not currently provide a trusted session epoch;
 * the existing schema has no trusted commit fence. Consequently this must
 * FAIL CLOSED on existing deployments. Do not relax these requirements.
 */
import { createHash } from 'node:crypto';

export const CAR02_V434_RELEASE_LOCK = true;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad=()=>{const e=new Error('CAR02_UNAUTHORIZED');e.code='CAR02_UNAUTHORIZED';e.status=401;throw e;};
const uuid=x=>typeof x==='string'&&UUID.test(x);
const safeShop=x=>typeof x==='string'&&x.length>0&&x.length<=256&&x.trim()===x;
const timestamp=x=>Number.isSafeInteger(x)&&x>0;
const generation=x=>Number.isSafeInteger(x)&&x>0&&x<=2147483647;
const role=x=>x==='staff'||x==='owner';
const hash=s=>createHash('sha256').update(s).digest('hex');
const bearer=req=>{
  const val=req?.headers?.get?.('authorization');
  if(typeof val!=='string'||!/^Bearer [^\s]{8,8192}$/.test(val))bad();
  if(req.headers.get('x-line-id-token'))bad();
  return val.slice(7);
};
function validMembership(m,sub,shop){
  return m&&m.active===true&&m.userSub===sub&&m.shopCode===shop&&role(m.role)&&
     generation(m.authVersion)&&timestamp(m.authGenerationCommittedAtMs);
}

/**
 * An isolated staff-only authentication candidate that emits version-scoped actors.
 * It deliberately does not fall back to plain R44/R46 auth on missing proof.
 * All injected adapters MUST be trusted server-side implementations.
 */
export function createCar02GenerationBoundStaffAuthR434({shopCode,verifyStaffJwt,attestProviderSession,readStaffMembership,nowMs=()=>Date.now()}={}){
  if(!safeShop(shopCode)||![verifyStaffJwt,attestProviderSession,readStaffMembership,nowMs].every(x=>typeof x==='function'))
    throw Error('CAR02_V434_SERVER_CONFIG_REQUIRED');
  return async function authenticate(req){
    try{
      const accessToken=bearer(req);
      const clock=nowMs();
      if(!timestamp(clock))bad();
      const verified=await verifyStaffJwt({accessToken});
      if(verified?.verified!==true||!uuid(verified.sub)||!Number.isSafeInteger(verified.exp)||verified.exp*1000<=clock)bad();
      const first=await readStaffMembership({shopCode,userSub:verified.sub});
      if(!validMembership(first,verified.sub,shopCode))bad();
      // This adapter must attest the real provider session. An ordinary R46 JWT
      // verification cannot prove fresh login and must not masquerade as this call.
      const proof=await attestProviderSession({accessToken,userSub:verified.sub,shopCode});
      if(proof?.verified!==true||proof.active!==true||proof.userSub!==verified.sub||
        !uuid(proof.sessionId)||!timestamp(proof.createdAtMs)||proof.createdAtMs>clock||
        proof.credentialSha256!==hash(accessToken))bad();
      // STRICTLY after the membership generation was durably committed; "equal"
      // and old refreshes are denied. No client supplied timestamps accepted.
      if(proof.createdAtMs<=first.authGenerationCommittedAtMs)bad();
      // Detect revocation/reactivation while the provider attestation was pending.
      // Writes STILL require row-lock authorization INSIDE their transaction.
      const current=await readStaffMembership({shopCode,userSub:verified.sub});
      if(!validMembership(current,verified.sub,shopCode)||
         current.authVersion!==first.authVersion||current.role!==first.role||
         current.authGenerationCommittedAtMs!==first.authGenerationCommittedAtMs)bad();
      return Object.freeze({verified:true,role:current.role,subject:`staff:${verified.sub}`,
        shopCode,userSub:verified.sub,authVersion:current.authVersion,
        authGenerationCommittedAtMs:current.authGenerationCommittedAtMs,
        providerSessionId:proof.sessionId});
    }catch {bad();} // no provider or database internals escape
  };
}

/** Must be called inside the SAME database transaction as the ensuing mutation.
 * The FOR UPDATE row lock must be held until COMMIT/ROLLBACK. This helper cannot
 * establish that invariant on its own; caller must independently enforce it.
 */
export async function assertCar02StaffMutationGenerationR434({transactionClient,actor,shopCode}={}){
  try{
    if(!transactionClient||typeof transactionClient.query!=='function'||!actor||
      actor.verified!==true||!uuid(actor.userSub)||actor.shopCode!==shopCode||
      !safeShop(shopCode)||!role(actor.role)||!generation(actor.authVersion)||
      !timestamp(actor.authGenerationCommittedAtMs))bad();
    const r=await transactionClient.query(`SELECT shop_code,user_sub,staff_role,active,auth_version,
      auth_generation_committed_at_ms
      FROM public.ksh_car02_staff_access
      WHERE shop_code=$1 AND user_sub=$2 FOR UPDATE`,[shopCode,actor.userSub]);
    if(r?.rows?.length!==1)bad();
    const x=r.rows[0];
    if(x.shop_code!==shopCode||x.user_sub!==actor.userSub||x.active!==true||
       x.staff_role!==actor.role||Number(x.auth_version)!==actor.authVersion||
       Number(x.auth_generation_committed_at_ms)!==actor.authGenerationCommittedAtMs)bad();
    return true;
  }catch {bad();}
}
