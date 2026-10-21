/**
 * DPRO CAR02 V4.63: OFFLINE review-branch CI provenance witness (never releases).
 * Distinguishes green OLD CI runs from success at the CURRENT branch HEAD;
 * checks complete trusted job logs, not guessed test counts or GitHub step code.
 * INJECTED READ-ONLY GITHUB API adapters are NOT independently authenticated here.
 * Historical source validation remains separate from actual customer/provider proof.
 * Does not call GitHub, Supabase, LINE, Workers, database or external networks.
 * Does not create permissions, authorize staff or bypass R52 release lock.
 */
export const CAR02_V463_RELEASE_LOCK=true;
export const CAR02_V463_MAIN_SHA='ad6e27c5fa866be9b010e349e9d164691d7a8988';
export const CAR02_V463_REVIEW_BRANCH='car02-v434-review-only';
export const CAR02_V463_REPO='dpromstk2000-lab/line-shaken-liff';
export const CAR02_V463_CHECKS=Object.freeze({
  v461r1:Object.freeze({name:'CAR02 V4.61R1 Actual Auth Gap Audit and Deterministic Signature Regression (NO_GO HOLD)',marker:'V461_FINAL_RELEASE_NO_GO_HOLD_TRUE',minimumTests:465}),
  v462:Object.freeze({name:'CAR02 V4.62 Staging Session Attestation Contract and V461R1 Regression (NO_GO HOLD)',marker:'V462_FINAL_RELEASE_NO_GO_HOLD_TRUE',minimumTests:483}),
  v457r1:Object.freeze({name:'CAR02 V4.57R1 Signed Evidence Manifest PG17 Dynamic Regression (NO_GO HOLD)',marker:'V457_FINAL_RELEASE_NO_GO_HOLD_TRUE',minimumTests:385})
});
const SHA=/^[a-f0-9]{40}$/;
const noGo=(reason,details={})=>Object.freeze({status:'no_go',reason,reviewCiCurrent:false,releasePermitted:false,
  businessWritesAuthorized:false,realProviderProofVerified:false,...details});
const good=(runId,n,sha)=>Object.freeze({status:'matched_review_only',reason:'ci_success_not_commercial_proof',
  reviewCiCurrent:true,releasePermitted:false,businessWritesAuthorized:false,
  realProviderProofVerified:false,runId,testCount:n,reviewSha:sha});
const count=(lines,prefix)=>{
 const matched=lines.filter(s=>new RegExp('^(?:\\d{4}-\\d{2}-\\d{2}T[^ ]+Z )?# '+prefix+' (\\d+)$').test(s));
 if(matched.length!==1)return NaN;
 return Number(matched[0].match(/(\d+)$/)?.[1]);
};
const markerSeen=(lines,key)=>lines.some(s=>new RegExp('^(?:\\d{4}-\\d{2}-\\d{2}T[^ ]+Z )?'+key+'$').test(s));
const safeLine=s=>typeof s==='string'&&s.length>0&&s.length<=1024*1024*8;
/**
 * trustedReadBranch() returns review/main branch SHA snapshots; trustedReadRun(runId)
 * returns GitHub Actions run metadata; trustedReadJobs(runId) returns job metadata;
 * trustedReadJobLog(jobId) returns the COMPLETE job log. All must be server-only.
 * A log string pasted by a browser must never be treated as an independent source.
 */
export function createCar02OfflineCiProvenanceR463({trustedReadBranch,trustedReadRun,trustedReadJobs,trustedReadJobLog}={}){
 if(CAR02_V463_RELEASE_LOCK!==true||![trustedReadBranch,trustedReadRun,trustedReadJobs,trustedReadJobLog].every(x=>typeof x==='function'))
  throw Error('CAR02_V463_TRUSTED_READ_ONLY_ADAPTERS_REQUIRED');
 async function check({runId,checkId}={}){
  const spec=CAR02_V463_CHECKS[checkId];
  if(!Number.isSafeInteger(runId)||runId<1||!Object.hasOwn(CAR02_V463_CHECKS,checkId)||!spec)
    return noGo('invalid_run_or_check_id');
  try{
   const branch=await trustedReadBranch({repository:CAR02_V463_REPO,branch:CAR02_V463_REVIEW_BRANCH});
   const main=await trustedReadBranch({repository:CAR02_V463_REPO,branch:'main'});
   if(!SHA.test(branch?.sha??'')||!SHA.test(main?.sha??'')||main.sha!==CAR02_V463_MAIN_SHA)
    return noGo('untrusted_or_drifted_branch');
   const run=await trustedReadRun({repository:CAR02_V463_REPO,runId});
   if(run?.id!==runId||run.head_branch!==CAR02_V463_REVIEW_BRANCH||
      run.head_sha!==branch.sha||run.name!==spec.name)return noGo('stale_or_wrong_review_run');
   if(run.status!=='completed'||run.conclusion!=='success')return noGo('run_not_success');
   const jobs=await trustedReadJobs({repository:CAR02_V463_REPO,runId});
   if(!Array.isArray(jobs)||jobs.length!==1||!Number.isSafeInteger(jobs[0]?.id)||
      jobs[0].id<1||jobs[0].status!=='completed'||jobs[0].conclusion!=='success')
     return noGo('job_not_success');
   const log=await trustedReadJobLog({repository:CAR02_V463_REPO,jobId:jobs[0].id});
   if(!safeLine(log))return noGo('job_log_unavailable');
   const lines=log.split(/\r?\n/);
   const tests=count(lines,'tests'),passed=count(lines,'pass'),failed=count(lines,'fail');
   if(!Number.isSafeInteger(tests)||tests<spec.minimumTests||passed!==tests||failed!==0||
      log.includes('##[error]')||!markerSeen(lines,spec.marker))
     return noGo('incomplete_or_failed_job_log');
   // A valid CI job is not actual Supabase session proof, LINE delivery or GO.
   return good(runId,tests,branch.sha);
  }catch{return noGo('trusted_source_read_failed');}
 }
 return Object.freeze({check});
}
