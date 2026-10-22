/**
 * DPRO CAR02 V4.80: Read-only, pinned, real GitHub Actions run provenance audit.
 * Not a release gate; no real provider evidence and no network in this module.
 * GitHub API fetch happens only through an injected, read-only adapter in CI.
 */
export const CAR02_V480_RELEASE_LOCK=true;
export const CAR02_V480_REPOSITORY='dpromstk2000-lab/line-shaken-liff';
export const CAR02_V480_BRANCH='car02-v434-review-only';
export const CAR02_V480_RUN_PINS=Object.freeze([{"version":"V4.70","runId":39700954544,"headSha":"c80b6155e021da3ef6e27c96c9dba16f514d0999","workflowName":"CAR02 V4.70 LINE Retry Key and Acceptance Review Disposable PG17 (NO_GO HOLD)","workflowPath":".github/workflows/car02-v470-line-retry-review-pg17-qa.yml","historicallyObservedNodeTests":657},{"version":"V4.71","runId":39702274067,"headSha":"2c001a3a6b47c3c92378ea32c0847f26e2400058","workflowName":"CAR02 V4.71 Raw LINE Webhook Signature and Replay PG17 (NO_GO HOLD)","workflowPath":".github/workflows/car02-v471-line-webhook-signature-pg17-qa.yml","historicallyObservedNodeTests":683},{"version":"V4.72","runId":39703805289,"headSha":"12818ccd5a04fd0cdf1f520f14e77bdaadd8ae9e","workflowName":"CAR02 V4.72 Verified Webhook Disposable Inbox PG17 (NO_GO HOLD)","workflowPath":".github/workflows/car02-v472-webhook-inbox-atomic-pg17-qa.yml","historicallyObservedNodeTests":712},{"version":"V4.73","runId":39705116469,"headSha":"911a991f0290113b10816ec77dba3285b8af38bc","workflowName":"CAR02 V4.73 Disposable Webhook Inbox Worker Lease PG17 (NO_GO HOLD)","workflowPath":".github/workflows/car02-v473-inbox-worker-lease-pg17-qa.yml","historicallyObservedNodeTests":741},{"version":"V4.74","runId":39706304070,"headSha":"10120a1d5a8c0b715b9e415307f39c5444546a5c","workflowName":"CAR02 V4.74 Disposable Webhook Quarantine Review PG17 (NO_GO HOLD)","workflowPath":".github/workflows/car02-v474-inbox-quarantine-pg17-qa.yml","historicallyObservedNodeTests":783},{"version":"V4.75","runId":39707312563,"headSha":"5a580d76c393ea6333a4ab95ba938da2bf02b876","workflowName":"CAR02 V4.75 Disposable Dual Quarantine Review PG17 (NO_GO HOLD)","workflowPath":".github/workflows/car02-v475-quarantine-dual-review-pg17-qa.yml","historicallyObservedNodeTests":816},{"version":"V4.76","runId":39708691820,"headSha":"06528f1c5533895bfa40d01e655b1ea57b854782","workflowName":"CAR02 V4.76 Mock Review Revision Invalidation Fence PG17 (NO_GO HOLD)","workflowPath":".github/workflows/car02-v476-review-revision-fence-pg17-qa.yml","historicallyObservedNodeTests":849},{"version":"V4.77","runId":39709650964,"headSha":"bcf591f3a9d7378d81d63031d6b798ab817fb18f","workflowName":"CAR02 V4.77 Seven Commercial Reality Gaps and Actual V476 Provenance (NO_GO HOLD)","workflowPath":".github/workflows/car02-v477-commercial-readiness-gap-qa.yml","historicallyObservedNodeTests":882},{"version":"V4.78","runId":39713246494,"headSha":"487e194b1c610f14dffce5ee84f665d67eb70838","workflowName":"CAR02 V4.78 Isolated Staging Boundary Preflight and Actual V477 Provenance (NO_GO HOLD)","workflowPath":".github/workflows/car02-v478-isolated-staging-preflight-qa.yml","historicallyObservedNodeTests":916},{"version":"V4.79","runId":39714412265,"headSha":"a545028a0a4656fc67756e58a997c988a0505844","workflowName":"CAR02 V4.79 Offline Staging Evidence Chain Tamper QA (NO_GO HOLD)","workflowPath":".github/workflows/car02-v479-staging-evidence-chain-qa.yml","historicallyObservedNodeTests":975}].map(p=>Object.freeze(p)));
const forty=/^[a-f0-9]{40}$/;
const finiteDate=t=>typeof t==='string'&&Number.isFinite(Date.parse(t))&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(t);
const deny=(reason,verified=0)=>Object.freeze({status:'no_go',reason,
  checkedActualGithubRuns:verified,runPinsRequired:CAR02_V480_RUN_PINS.length,
  realProviderProofsVerified:0,ownerApproved:false,releasePermitted:false,
  businessWritesAuthorized:false,lineDeliveryProven:false,realStagingVerified:false,
  sourceEvidenceClass:'github_workflow_run_metadata_only',
  nextAction:'owner_approved_separate_real_staging_7_provider_proofs'});
export function validateCar02GithubRunR480(run,pin){
 if(!run||typeof run!=='object'||Array.isArray(run)||!pin||typeof pin!=='object')return 'missing_run';
 if(!Number.isSafeInteger(run.id)||run.id!==pin.runId)return 'unexpected_run_id';
 if(run.name!==pin.workflowName)return 'unexpected_workflow_name';
 if(run.path!==pin.workflowPath)return 'unexpected_workflow_path';
 if(run.head_sha!==pin.headSha||!forty.test(run.head_sha))return 'unexpected_commit';
 if(run.head_branch!==CAR02_V480_BRANCH)return 'unexpected_branch';
 if(run.repository?.full_name!==CAR02_V480_REPOSITORY||run.head_repository?.full_name!==CAR02_V480_REPOSITORY)return 'wrong_repository_or_fork';
 if(run.head_commit?.id!==pin.headSha)return 'unexpected_head_commit';
 if(run.event!=='push')return 'non_push_event';
 if(run.status!=='completed'||run.conclusion!=='success')return 'run_not_successful';
 if(!Number.isSafeInteger(run.run_attempt)||run.run_attempt<1)return 'run_attempt_invalid';
 if(!finiteDate(run.created_at)||!finiteDate(run.updated_at)||Date.parse(run.updated_at)<Date.parse(run.created_at))return 'run_timestamp_invalid';
 if(run.html_url!==`https://github.com/${CAR02_V480_REPOSITORY}/actions/runs/${pin.runId}`)return 'run_url_mismatch';
 return null;
}
/** This inspector always returns NO_GO, including when all ten real run metadata records match. */
export function createCar02ReadOnlyCIProvenanceAuditorR480({readRun,authorizeAuditor,inspectIsolation}={}){
 if(![readRun,authorizeAuditor,inspectIsolation].every(fn=>typeof fn==='function'))throw Error('V480_READ_ONLY_ADAPTERS_REQUIRED');
 return Object.freeze({inspect:async()=>{
  let auth,isol;
  try{[auth,isol]=await Promise.all([authorizeAuditor(),inspectIsolation()]);}
  catch{return deny('auditor_or_isolation_unavailable');}
  if(auth?.verified!==true||auth.role!=='ci_provenance_auditor'||auth.mode!=='isolated_qa'||
      auth.shopCode!=='qa_shop_a'||isol?.verified!==true||isol.testOnly!==true||
      isol.environment!=='read_only_github_ci'||isol.providerCallsEnabled!==false)
     return deny('auditor_or_isolation_untrusted');
  let checked=0;
  for(const pin of CAR02_V480_RUN_PINS){
    let run;
    try{run=await readRun({runId:pin.runId,repository:CAR02_V480_REPOSITORY});}
    catch{return deny('github_run_read_unavailable',checked);}
    const problem=validateCar02GithubRunR480(run,pin);
    if(problem)return deny(`github_provenance_${problem}`,checked);
    checked++;
  }
  return deny('ten_real_github_ci_runs_verified_still_no_commercial_proofs',checked);
 }});
}
