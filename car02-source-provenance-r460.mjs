/**
 * DPRO CAR02 V4.60 - ACTUAL GitHub R52 source-provenance and real-integration gaps.
 * REVIEW ONLY. A source-parity PASS is never commercial approval. No secrets.
 * Source material MUST be read from the checked-out GitHub tree, not local stubs.
 * The optional GitHub SHA pin is a Git BLOB SHA-1, NOT cryptographic attestation
 * to trusted runtime deployment or evidence of external providers.
 */
import {createHash} from 'node:crypto';
import {CAR02_V459_MANDATORY_CONTROLS} from './car02-release-readiness-r459.mjs';
export const CAR02_V460_RELEASE_LOCK=true;
export const CAR02_V460_PINNED_R52_GIT_BLOB_SHA='f0e31fb9f9d98524519d01dffd3489893d3d3302';
export const CAR02_V460_PINNED_MAIN_SHA='ad6e27c5fa866be9b010e349e9d164691d7a8988';
export const CAR02_V460_REVIEW_BRANCH='car02-v434-review-only';
const FLAGS=['contracted','goLiveApproved','migrationVerified','verifiedIdentityBound','workerBackendReady','externalNotificationsReviewed'];
const isPlain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,keys)=>isPlain(x)&&Object.keys(x).sort().join('|')===keys.slice().sort().join('|');
const fail=(reason)=>Object.freeze({status:'no_go',releasePermitted:false,sourceParityVerified:false,reason,
 remainingControls:Object.freeze([...CAR02_V459_MANDATORY_CONTROLS])});
export function gitBlobShaR460(input){
 if(typeof input!=='string')throw Error('CAR02_V460_SOURCE_REQUIRED');
 const b=Buffer.from(input,'utf8');
 return createHash('sha1').update(Buffer.from(`blob ${b.length}\0`)).update(b).digest('hex');
}
/**
 * A deliberately fail-closed static source inventory. NO actual secrets, network,
 * deployment, proof recording, test-user creation or external provider access.
 * The input is host-owned check-out material in CI; never a browser upload.
 */
export function inspectCar02SourceProvenanceR460({r52Text,branch,mainSha,manifest}={}){
 try{
  if(CAR02_V460_RELEASE_LOCK!==true||typeof r52Text!=='string'||
     gitBlobShaR460(r52Text)!==CAR02_V460_PINNED_R52_GIT_BLOB_SHA)
    return fail('r52_source_not_pinned');
  if(branch!==CAR02_V460_REVIEW_BRANCH||mainSha!==CAR02_V460_PINNED_MAIN_SHA)
    return fail('branch_or_main_not_pinned');
  const lock=/\bconst\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/;
  const guard=/if\s*\(\s*CAR02_RELEASE_LOCK\s*\)\s*throw\s+Error\(['"]CAR02_NOT_RELEASED['"]\)/;
  const match=guard.exec(r52Text);
  const client=r52Text.indexOf("import('npm:pg@"),runtime=r52Text.indexOf('createCar02UnifiedRuntimeR50({');
  if(!lock.test(r52Text)||!match||client<0||runtime<0||match.index>client||client>runtime)
    return fail('r52_lock_boundary_unverified');
  const initial=r52Text.match(/const\s+releaseState\s*=\s*\{([^}]+)\}/)?.[1];
  if(!initial||!FLAGS.every(k=>new RegExp(`\\b${k}:false\\b`).test(initial)))
    return fail('r52_release_flags_not_all_false');
  if(!exact(manifest,['schemaVersion','project','branch','mainSha','pinnedR52GitBlobSha','releaseDecision','evidenceStatus','controls'])||
    manifest.schemaVersion!==460||manifest.project!=='DPRO_CAR02'||
    manifest.branch!==branch||manifest.mainSha!==mainSha||
    manifest.pinnedR52GitBlobSha!==CAR02_V460_PINNED_R52_GIT_BLOB_SHA||
    manifest.releaseDecision!=='NO_GO'||manifest.evidenceStatus!=='UNVERIFIED'||
    !Array.isArray(manifest.controls)||manifest.controls.length!==CAR02_V459_MANDATORY_CONTROLS.length)
    return fail('readiness_manifest_untrusted');
  const seen=new Set();
  for(const row of manifest.controls){
    if(!exact(row,['code','evidenceState','acceptedProof'])||
       typeof row.code!=='string'||!CAR02_V459_MANDATORY_CONTROLS.includes(row.code)||
       seen.has(row.code)||row.evidenceState!=='unverified'||
       typeof row.acceptedProof!=='string'||row.acceptedProof.trim().length<50)
       return fail('readiness_evidence_missing_or_forged');
    seen.add(row.code);
  }
  return Object.freeze({status:'no_go',releasePermitted:false,sourceParityVerified:true,
     reason:'real_provider_evidence_not_verified',remainingControls:Object.freeze([...CAR02_V459_MANDATORY_CONTROLS])});
 }catch{return fail('source_audit_failed_closed')}
}
