/**
 * DPRO CAR02 V4.82 — immutable V4.81 GitHub Actions verdict metadata audit.
 * A real CI SUCCESS is evidence of that CI run only, never commercial readiness.
 * No network in this module. A caller may inject READ-ONLY GitHub GET adapters.
 */
import {CAR02_V481_RELEASE_LOCK,CAR02_V481_JOB_PINS} from './car02-ci-job-step-audit-r481.mjs';
export const CAR02_V482_RELEASE_LOCK=true;
export const CAR02_V482_REPOSITORY='dpromstk2000-lab/line-shaken-liff';
export const CAR02_V482_BRANCH='car02-v434-review-only';
export const CAR02_V482_RUN_PIN=Object.freeze({
 runId:39722231225,
 workflowId:392467505,
 headSha:'135762874c46c984332581f145d6d833edf562b6',
 runName:'CAR02 V4.81 Actual GitHub Ten Jobs and Mandatory Steps Read-Only (NO_GO HOLD)',
 workflowPath:'.github/workflows/car02-v481-actual-github-job-step-qa.yml',
 jobId:119638086357,
 jobName:'read-only-real-ci-step-attestation',
 requiredSteps:Object.freeze([
  'Set up job',
  'Checkout restricted review branch without persisted credentials',
  'Pin R52 and V480 real sources and reject provider credentials',
  'Run all 1062 or more Node tests, no failures',
  'Read the ten actual historical GitHub jobs and required steps, never authorize release',
  'Post Checkout restricted review branch without persisted credentials',
  'Complete job'
 ])
});
const blocked=(reason,run=0,job=0,steps=0)=>Object.freeze({
 status:'no_go',reason,verifiedV481GithubRun:run,verifiedV481GithubJob:job,
 verifiedV481JobSteps:steps,requiredV481JobSteps:7,
 realProviderProofsVerified:0,ownerApprovalVerified:false,
 stagingAcceptanceVerified:false,releasePermitted:false,
 businessWritesAuthorized:false,lineDispatchAllowed:false,
 evidenceClass:'read_only_ci_verdict_metadata_not_commercial_proof',
 nextAction:'owner_approved_isolated_staging_and_seven_real_proofs'
});
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export function validateCar02RunVerdictR482(run,pin=CAR02_V482_RUN_PIN){
 if(!object(run))return 'missing_run';
 if(run.id!==pin.runId||run.workflow_id!==pin.workflowId)return 'run_identity_mismatch';
 if(run.head_branch!==CAR02_V482_BRANCH||run.head_sha!==pin.headSha)return 'run_commit_or_branch_mismatch';
 if(run.name!==pin.runName||run.path!==pin.workflowPath)return 'workflow_identity_mismatch';
 if(run.event!=='push'||run.run_attempt!==1)return 'unexpected_trigger_or_attempt';
 if(run.status!=='completed'||run.conclusion!=='success')return 'run_not_successful';
 if(run.html_url!==`https://github.com/${CAR02_V482_REPOSITORY}/actions/runs/${pin.runId}`)
  return 'run_url_mismatch';
 return null;
}
export function validateCar02JobVerdictR482(payload,pin=CAR02_V482_RUN_PIN){
 if(!object(payload)||payload.total_count!==1||!Array.isArray(payload.jobs)||
    payload.jobs.length!==1)return 'job_count_mismatch';
 const job=payload.jobs[0];
 if(!object(job))return 'missing_job';
 if(job.id!==pin.jobId||job.run_id!==pin.runId||job.run_attempt!==1)return 'job_identity_mismatch';
 if(job.name!==pin.jobName||job.head_sha!==pin.headSha)return 'job_name_or_commit_mismatch';
 if(job.status!=='completed'||job.conclusion!=='success')return 'job_not_successful';
 if(job.html_url!==`https://github.com/${CAR02_V482_REPOSITORY}/actions/runs/${pin.runId}/job/${pin.jobId}`)
   return 'job_url_mismatch';
 if(!Array.isArray(job.steps)||job.steps.length!==pin.requiredSteps.length)return 'job_step_count_mismatch';
 let previous=0;
 for(let i=0;i<pin.requiredSteps.length;i++){
  const step=job.steps[i];
  if(!object(step)||step.name!==pin.requiredSteps[i])return 'step_name_or_order_mismatch';
  if(!Number.isSafeInteger(step.number)||step.number<=previous)return 'step_sequence_invalid';
  if(step.status!=='completed'||step.conclusion!=='success')return 'step_not_successful';
  previous=step.number;
 }
 return null;
}
export function createCar02ReadOnlyVerdictAuditorR482({readRun,readJobs,authorizeAuditor,inspectIsolation}={}){
 if(![readRun,readJobs,authorizeAuditor,inspectIsolation].every(x=>typeof x==='function'))
  throw Error('V482_READ_ONLY_ADAPTERS_REQUIRED');
 return Object.freeze({inspect:async()=>{
  let who,isol;
  try{[who,isol]=await Promise.all([authorizeAuditor(),inspectIsolation()]);}
  catch{return blocked('auditor_or_isolation_unavailable');}
  if(who?.verified!==true||who.role!=='ci_verdict_auditor'||who.mode!=='isolated_qa'||
   who.shopCode!=='qa_shop_a'||isol?.verified!==true||
   isol.environment!=='read_only_github_ci'||isol.testOnly!==true||
   isol.providerCallsEnabled!==false)return blocked('auditor_or_isolation_untrusted');
  if(CAR02_V481_RELEASE_LOCK!==true||CAR02_V481_JOB_PINS.length!==10||
   CAR02_V482_RELEASE_LOCK!==true)return blocked('predecessor_release_lock_or_pin_invalid');
  let run;
  try{run=await readRun({repository:CAR02_V482_REPOSITORY,runId:CAR02_V482_RUN_PIN.runId});}
  catch{return blocked('github_run_read_unavailable');}
  const runProblem=validateCar02RunVerdictR482(run);
  if(runProblem)return blocked(`github_run_${runProblem}`);
  let jobs;
  try{jobs=await readJobs({repository:CAR02_V482_REPOSITORY,runId:CAR02_V482_RUN_PIN.runId});}
  catch{return blocked('github_job_read_unavailable',1);}
  const jobProblem=validateCar02JobVerdictR482(jobs);
  if(jobProblem)return blocked(`github_job_${jobProblem}`,1);
  return blocked('real_v481_ci_run_and_seven_steps_verified_still_no_go',1,1,7);
 }});
}
