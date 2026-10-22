/**
 * DPRO CAR02 V4.77 — isolated commercial-readiness evidence gap assessor.
 * Every input is synthetic/read-only, and nothing here can authorize a release.
 * A successful isolated CI run is NOT evidence of real Supabase, LINE or human IAM.
 * No network, customer data, credentials, provider call, dispatch, SQL, release or writes.
 */
export const CAR02_V477_RELEASE_LOCK=true;
export const CAR02_V477_REVIEW_BRANCH='car02-v434-review-only';
export const CAR02_V477_BASELINE_COMMIT='06528f1c5533895bfa40d01e655b1ea57b854782';
export const CAR02_V477_BASELINE_CI_RUN=39708691820;
export const CAR02_V477_PROOF_KEYS=Object.freeze([
 'provider_session_revocation', 'staff_and_reviewer_identity',
 'transaction_final_auth_fence','line_webhook_send_and_delivery',
 'independent_immutable_evidence','independent_key_custody',
 'owner_approved_isolated_staging_acceptance'
]);
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const HEX40=/^[0-9a-f]{40}$/;
const ciFields=['source','reviewBranch','headSha','runId','conclusion','nodeTests','nodeFailed','releaseLock'];
const claimFields=['key','state','evidenceClass'];
const own=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
 Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join('|')===keys.slice().sort().join('|');
const UNVERIFIED=Object.freeze([...CAR02_V477_PROOF_KEYS]);
const no=(reason,baselineObserved=false)=>Object.freeze({status:'no_go',reason,
 classification:'offline_ci_is_not_commercial_evidence',releasePermitted:false,
 businessWritesAuthorized:false,lineDispatchAuthorized:false,quarantineLifted:false,
 realProviderEvidenceVerified:false,realHumanApprovalVerified:false,
 baselineObserved,unverifiedProofs:UNVERIFIED,verifiedProofCount:0});
function validBaseline(v){
 return own(v,ciFields)&&v.source==='isolated_mock_ci_metadata'&&
 v.reviewBranch===CAR02_V477_REVIEW_BRANCH&&v.headSha===CAR02_V477_BASELINE_COMMIT&&
 HEX40.test(v.headSha)&&v.runId===CAR02_V477_BASELINE_CI_RUN&&v.conclusion==='success'&&
 Number.isSafeInteger(v.nodeTests)&&v.nodeTests>=849&&Number.isSafeInteger(v.nodeFailed)&&v.nodeFailed===0&&
 v.releaseLock===true;
}
function validClaims(claims){
 if(!Array.isArray(claims)||claims.length!==CAR02_V477_PROOF_KEYS.length)return false;
 const seen=new Set();
 for(const x of claims){
  if(!own(x,claimFields)||!CAR02_V477_PROOF_KEYS.includes(x.key)||seen.has(x.key)||
     !['missing','unverified','mock_claim_only'].includes(x.state)||
     !['none','offline_fixture'].includes(x.evidenceClass))return false;
  seen.add(x.key);
 }
 return seen.size===CAR02_V477_PROOF_KEYS.length;
}
/** Does not turn claims into proofs. Only documents why commercial GO is blocked. */
export function createCar02OfflineCommercialGapAssessorR477({expectedShopCode,
 authorizeAuditor,inspectIsolation,readBaselineCI,readProofClaims}={}){
 if(!SHOP.test(expectedShopCode??'')||
  ![authorizeAuditor,inspectIsolation,readBaselineCI,readProofClaims].every(x=>typeof x==='function'))
  throw Error('CAR02_V477_OFFLINE_ADAPTERS_REQUIRED');
 async function inspect({request}={}){
  let auditor,isolation,ci,claims;
  try{[auditor,isolation]=await Promise.all([authorizeAuditor({request}),inspectIsolation()]);}
  catch{return no('offline_audit_unavailable');}
  if(auditor?.verified!==true||auditor?.role!=='commercial_gap_auditor'||
     auditor?.mode!=='isolated_qa'||auditor?.shopCode!==expectedShopCode||
     isolation?.verified!==true||isolation?.testOnly!==true||
     isolation?.environment!=='offline_mock_only')return no('offline_audit_untrusted');
  try{ci=await readBaselineCI();}catch{return no('baseline_ci_unavailable');}
  if(!validBaseline(ci))return no('baseline_ci_stale_or_untrusted');
  try{claims=await readProofClaims({shopCode:expectedShopCode});}
  catch{return no('proof_inventory_unavailable',true);}
  if(!validClaims(claims))return no('proof_inventory_untrusted',true);
  return no('seven_real_commercial_proofs_still_unverified',true);
 }
 return Object.freeze({inspect,scopedShopCode:expectedShopCode});
}
