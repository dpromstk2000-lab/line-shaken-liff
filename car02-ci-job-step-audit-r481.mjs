/** CAR02 V4.81. Validate genuine GitHub Actions job AND step metadata for pinned V4.70-V4.79 historical runs.
 * Results are GitHub CI provenance only; NEVER commercial proof or authority to write. */
import {CAR02_V480_RUN_PINS,CAR02_V480_REPOSITORY,CAR02_V480_BRANCH} from './car02-ci-provenance-audit-r480.mjs';
export const CAR02_V481_RELEASE_LOCK=true;
export const CAR02_V481_JOB_PINS=Object.freeze([{"version":"V4.70","runId":39700954544,"jobId":119569773505,"jobName":"disposable-line-retry-review","lockStep":"Enforce original R52 release lock and no live provider keys","nodeStep":"Entire Node regression plus official LINE retry behavior mock","safetyStep":"Disposable PostgreSQL17 retry key cross-tenant and expiry QA","disposablePG17":true},{"version":"V4.71","runId":39702274067,"jobId":119574063363,"jobName":"disposable-raw-webhook-replay","lockStep":"Confirm actual R52 lock, no provider secrets, and expected file layout","nodeStep":"Execute all 683 or more Node regression tests including official LINE HMAC example","safetyStep":"Disposable PG17 cross-tenant replay collision and 8 simultaneous registrations","disposablePG17":true},{"version":"V4.72","runId":39703805289,"jobId":119578978972,"jobName":"disposable-atomic-webhook-inbox","lockStep":"Enforce R52 hard release lock, no provider secrets, correct layout","nodeStep":"Run 712 or more Node tests and verify offline-only API contract","safetyStep":"Disposable PG17 atomic claim and 8 concurrent event races","disposablePG17":true},{"version":"V4.73","runId":39705116469,"jobId":119583230934,"jobName":"disposable-synthetic-webhook-worker-lease","lockStep":"Verify actual R52 hard lock, no live secrets, expected layout","nodeStep":"Run all 741 or more Node tests and hard NO_GO contract","safetyStep":"Disposable PG17 private worker lease expiry, fencing, eight racing owners","disposablePG17":true},{"version":"V4.74","runId":39706304070,"jobId":119587032766,"jobName":"disposable-synthetic-webhook-quarantine","lockStep":"Assert no production secrets, R52 immutable lock and correct paths","nodeStep":"Run complete minimum 783 Node regression tests and hard NO_GO contract","safetyStep":"Disposable PG17 quarantine fencing, rollback and eight concurrent idem claims","disposablePG17":true},{"version":"V4.75","runId":39707312563,"jobId":119590266787,"jobName":"disposable-dual-review","lockStep":"Check original R52 release lock and no production credentials","nodeStep":"Dynamic full Node regression and hard NO_GO review contract","safetyStep":"Disposable PostgreSQL 17 independent reviewer and eight-way same-person contention","disposablePG17":true},{"version":"V4.76","runId":39708691820,"jobId":119594625001,"jobName":"disposable-mock-review-invalidation","lockStep":"Refuse provider credentials and confirm actual R52 R475 unmodified source","nodeStep":"Run full dynamic Node regression and deny any release or real reviewer inference","safetyStep":"Disposable PostgreSQL17 review invalidation and eight simultaneous revision races","disposablePG17":true},{"version":"V4.77","runId":39709650964,"jobId":119597667272,"jobName":"offline-commercial-gaps-never-go","lockStep":"Check original R52 and R476 immutable pins; no real credentials","nodeStep":"Complete dynamic Node regression 882 or more tests no failures","safetyStep":"Seven independent real service proofs must remain unverified","disposablePG17":false},{"version":"V4.78","runId":39713246494,"jobId":119609268790,"jobName":"isolated-staging-preflight-no-go","lockStep":"Assert R52 and V477 pinned sources, no real credentials, exact file layout","nodeStep":"Run all 916 or more Node regression tests with no failures","safetyStep":"Keep all seven real provider proofs and staging owner authorization unverified","disposablePG17":false},{"version":"V4.79","runId":39714412265,"jobId":119612998799,"jobName":"synthetic-evidence-chain-no-go","lockStep":"Refuse live provider credentials and pin genuine R52 V477 V478 sources","nodeStep":"Run all 975 plus regression tests with zero failures","safetyStep":"Verify seven synthetic hash receipts never become seven real proofs","disposablePG17":false}].map(p=>Object.freeze(p)));
const deny=(reason,checked=0,steps=0,pg17=0)=>Object.freeze({
  status:'no_go',reason,checkedActualGithubJobs:checked,verifiedMandatorySteps:steps,
  verifiedPriorDisposablePg17Jobs:pg17,requiredActualGithubJobs:10,realProviderProofsVerified:0,
  realOwnerApprovalVerified:false,realStagingValidated:false,releasePermitted:false,
  businessWritesAuthorized:false,lineDispatchAllowed:false,sourceEvidenceClass:'github_job_step_metadata_only',
  nextAction:'owner_approved_isolated_staging_and_seven_real_proofs'});
export function validateCar02JobStepR481(payload,pin,baselinePin){
 if(!payload||typeof payload!=='object'||Array.isArray(payload))return 'missing_jobs_response';
 if(payload.total_count!==1||!Array.isArray(payload.jobs)||payload.jobs.length!==1)return 'job_count_not_one';
 const job=payload.jobs[0];
 if(!job||typeof job!=='object'||Array.isArray(job))return 'missing_job';
 if(!baselinePin||baselinePin.runId!==pin.runId||!/^V4\./.test(pin.version))return 'baseline_mismatch';
 if(job.run_id!==pin.runId||job.id!==pin.jobId)return 'job_identity_mismatch';
 if(job.run_attempt!==1)return 'job_rerun_disallowed';
 if(job.head_sha!==baselinePin.headSha)return 'job_commit_mismatch';
 if(job.name!==pin.jobName)return 'job_name_mismatch';
 if(job.status!=='completed'||job.conclusion!=='success')return 'job_failed_or_incomplete';
 if(job.html_url!==`https://github.com/${CAR02_V480_REPOSITORY}/actions/runs/${pin.runId}/job/${pin.jobId}`)return 'job_url_mismatch';
 if(!Array.isArray(job.steps)||job.steps.length<6||job.steps.length>30)return 'job_steps_missing';
 const names=new Set(),required=[pin.lockStep,pin.nodeStep,pin.safetyStep];
 let lastNumber=-1;
 for(const step of job.steps){
   if(!step||typeof step.name!=='string'||!step.name.trim()||names.has(step.name))return 'duplicate_or_invalid_step';
   names.add(step.name);
   if(!Number.isSafeInteger(step.number)||step.number<=lastNumber)return 'step_sequence_invalid';
   lastNumber=step.number;
   if(step.status!=='completed'||step.conclusion!=='success')return 'step_failed_skipped_or_pending';
 }
 if(!required.every(n=>names.has(n)))return 'mandatory_step_missing';
 const indexes=required.map(n=>job.steps.findIndex(s=>s.name===n));
 if(!(indexes[0]<indexes[1]&&indexes[1]<indexes[2]))return 'mandatory_step_out_of_order';
 if(!names.has('Set up job')||!names.has('Complete job'))return 'setup_or_cleanup_missing';
 if(pin.disposablePG17&&!names.has('Initialize containers'))return 'pg17_container_missing';
 return null;
}
export function createCar02ReadOnlyJobStepAuditorR481({readJobs,authorizeAuditor,inspectIsolation}={}){
 if(![readJobs,authorizeAuditor,inspectIsolation].every(f=>typeof f==='function'))throw Error('V481_READ_ONLY_ADAPTERS_REQUIRED');
 return Object.freeze({inspect:async()=>{
   let auth,isol;
   try{[auth,isol]=await Promise.all([authorizeAuditor(),inspectIsolation()]);}catch{return deny('auditor_or_isolation_unavailable');}
   if(auth?.verified!==true||auth.role!=='ci_job_auditor'||auth.mode!=='isolated_qa'||auth.shopCode!=='qa_shop_a'||
       isol?.verified!==true||isol.environment!=='read_only_github_ci'||isol.testOnly!==true||isol.providerCallsEnabled!==false)
     return deny('auditor_or_isolation_untrusted');
   if(CAR02_V480_RUN_PINS.length!==10||CAR02_V481_JOB_PINS.length!==10||CAR02_V480_BRANCH!=='car02-v434-review-only')return deny('baseline_pins_invalid');
   let count=0,steps=0,pg17=0;
   for(let i=0;i<CAR02_V481_JOB_PINS.length;i++){
     const pin=CAR02_V481_JOB_PINS[i],base=CAR02_V480_RUN_PINS[i];
     let payload;
     try{payload=await readJobs({repository:CAR02_V480_REPOSITORY,runId:pin.runId});}catch{return deny('github_job_read_unavailable',count,steps,pg17);}
     const failure=validateCar02JobStepR481(payload,pin,base);
     if(failure)return deny(`github_job_${failure}`,count,steps,pg17);
     count++;steps+=3;if(pin.disposablePG17)pg17++;
   }
   return deny('ten_real_github_jobs_and_mandatory_steps_verified_still_no_go',count,steps,pg17);
 }});
}
