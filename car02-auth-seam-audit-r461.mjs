/**
 * CAR02 V4.61 — real-source R46/R50/R51/R52 staff-auth integration gap audit.
 * REVIEW ONLY. Pure text/static source inspection. No provider calls or secrets.
 * IMPORTANT: R46 /auth/v1/user verification proves a user response, NOT an
 * independently verified live auth.sessions row or postcommit session fence.
 * R46 currently returns sub/exp only; it does NOT return trusted session_id.
 * These 4 pinned review files are immutable inputs; source drift fails closed.
 * This is NOT a JWT verifier, does NOT authorize calls, and NEVER enables GO.
 * R52 release lock stays TRUE, with zero production code mutation.
 */
import {createHash} from 'node:crypto';
export const CAR02_V461_RELEASE_LOCK=true;
export const CAR02_V461_REQUIRED_FILES=Object.freeze({
 'car02-auth-providers-r46.mjs':'d90404a880c06b809c30685654029a938913ec09',
 'car02-unified-runtime-r50.mjs':'76e4e8cae27599f27e3d887118148718c32ebb80',
 'car02-edge-boundary-r51.mjs':'6614f2ed1933aa787576cb8074cb7d4bc704efa0',
 'car02-edge-entry-r52.ts':'f0e31fb9f9d98524519d01dffd3489893d3d3302'
});
const names=Object.keys(CAR02_V461_REQUIRED_FILES);
export function gitBlobR461(text){
 if(typeof text!=='string')throw Error('CAR02_V461_TEXT_REQUIRED');
 const b=Buffer.from(text,'utf8');
 return createHash('sha1').update(Buffer.from(`blob ${b.length}\0`)).update(b).digest('hex');
}
export function inspectR46StaffVerifierShapeR461(text){
 if(typeof text!=='string')return Object.freeze({authUserGet:false,returnsSessionId:false,staffMembershipLookup:false});
 // Informational syntax cues only. Never authorize from these patterns.
 const f=text.match(/export function createSupabaseStaffTokenVerifierR46\b[\s\S]*?(?=export function createLineCustomerResolverR46)/)?.[0]??'';
 const result=f.match(/return\s*\{\s*verified\s*:\s*true\s*,\s*sub\s*:\s*user\.id\s*,\s*exp\s*:\s*claims\.exp\s*\}/)?.[0]??'';
 return Object.freeze({
  authUserGet:f.includes("issuer+'/user'")&&f.includes("Authorization:'Bearer '+accessToken"),
  returnsSessionId:/\b(?:sessionId|session_id)\b/.test(result),
  staffMembershipLookup:/createDbStaffMembershipLookupR46/.test(text)
 });
}
const noGo=(reason,matched=[])=>Object.freeze({status:'no_go',releasePermitted:false,
 sourcePinsMatched:Object.freeze([...matched]),providerSessionProven:false,
 postcommitFenceProven:false,reason,blockedControl:'actual_supabase_auth_sessions'});
/**
 * sources: exact raw contents from GitHub checkout, NOT browser-provided text.
 * inventory: descriptive checklist; all real external proofs remain unverified.
 */
export function auditCar02ActualAuthSeamR461({sources,inventory}={}){
 try{
  if(CAR02_V461_RELEASE_LOCK!==true||sources===null||typeof sources!=='object'||Array.isArray(sources)||
   Object.keys(sources).sort().join('|')!==names.slice().sort().join('|'))
   return noGo('exact_source_set_required');
  const matched=[];
  for(const name of names){
    if(typeof sources[name]!=='string'||gitBlobR461(sources[name])!==CAR02_V461_REQUIRED_FILES[name])
      return noGo('real_source_drift_or_stub',matched);
    matched.push(name);
  }
  if(!inventory||inventory.schemaVersion!==461||inventory.project!=='DPRO_CAR02'||
    inventory.releaseDecision!=='NO_GO'||inventory.evidenceStatus!=='UNVERIFIED'||
    !Array.isArray(inventory.stagingProbeOrder)||inventory.stagingProbeOrder.length!==7||
    inventory.stagingProbeOrder.some(x=>x?.evidenceState!=='unverified'||
      typeof x?.control!=='string'||typeof x?.humanAcceptance!=='string'||
      x.humanAcceptance.length<50))return noGo('staging_inventory_not_trusted',matched);
  const r46=sources['car02-auth-providers-r46.mjs'];
  const r50=sources['car02-unified-runtime-r50.mjs'];
  const r51=sources['car02-edge-boundary-r51.mjs'];
  const r52=sources['car02-edge-entry-r52.ts'];
  const shape=inspectR46StaffVerifierShapeR461(r46);
  if(!shape.authUserGet||shape.returnsSessionId||!shape.staffMembershipLookup||
   !r50.includes('createCar02AuthProvidersR46({')||
   !r50.includes('lookupStaffMembership')||
   !r51.includes("if(!released)return json(503,'CAR02_NOT_RELEASED')")||
   !/const CAR02_RELEASE_LOCK\s*=\s*true;/.test(r52)||
   !r52.includes("if(CAR02_RELEASE_LOCK)throw Error('CAR02_NOT_RELEASED')"))
    return noGo('auth_or_runtime_boundary_mismatch',matched);
  return Object.freeze({status:'no_go',releasePermitted:false,
   sourcePinsMatched:Object.freeze(matched),providerSessionProven:false,
   postcommitFenceProven:false,
   reason:'r46_verified_user_without_trusted_session_identity',
   blockedControl:'actual_supabase_auth_sessions',
   requiredNextProof:'nonproduction_verified_provider_session_row_and_postcommit_fence'});
 }catch{return noGo('source_gap_audit_failed_closed')}
}
