import test from 'node:test';
import assert from 'node:assert/strict';
import {CAR02_V480_RUN_PINS} from './car02-ci-provenance-audit-r480.mjs';
import {CAR02_V481_JOB_PINS,CAR02_V481_RELEASE_LOCK,
  validateCar02JobStepR481,createCar02ReadOnlyJobStepAuditorR481} from './car02-ci-job-step-audit-r481.mjs';

const noWrite=result=>{
  assert.equal(result.status,'no_go');
  for(const f of ['releasePermitted','businessWritesAuthorized','lineDispatchAllowed','realStagingValidated','realOwnerApprovalVerified'])assert.equal(result[f],false);
  assert.equal(result.realProviderProofsVerified,0);
};
const fixture=(pin,base)=>{
  const n=['Set up job',...(pin.disposablePG17?['Initialize containers']:[]),'Checkout review-only commit',
    pin.lockStep,pin.nodeStep,pin.safetyStep,'Complete job'];
  return {total_count:1,jobs:[{id:pin.jobId,run_id:pin.runId,run_attempt:1,
    head_sha:base.headSha,name:pin.jobName,status:'completed',conclusion:'success',
    html_url:`https://github.com/dpromstk2000-lab/line-shaken-liff/actions/runs/${pin.runId}/job/${pin.jobId}`,
    steps:n.map((name,i)=>({name,number:i+1,status:'completed',conclusion:'success'}))}]};
};
const clone=x=>structuredClone(x);
const pin=CAR02_V481_JOB_PINS[0],base=CAR02_V480_RUN_PINS[0];
const validAuth=async()=>({verified:true,role:'ci_job_auditor',mode:'isolated_qa',shopCode:'qa_shop_a'});
const validIsolation=async()=>({verified:true,testOnly:true,environment:'read_only_github_ci',providerCallsEnabled:false});
const readGood=async({runId,repository})=>{
  assert.equal(repository,'dpromstk2000-lab/line-shaken-liff');
  const n=CAR02_V481_JOB_PINS.findIndex(p=>p.runId===runId);
  assert.ok(n>=0);
  return fixture(CAR02_V481_JOB_PINS[n],CAR02_V480_RUN_PINS[n]);
};

test('V481 guard release lock and exact ten distinct pins',()=>{
 assert.equal(CAR02_V481_RELEASE_LOCK,true);
 assert.equal(CAR02_V481_JOB_PINS.length,10);
 assert.equal(new Set(CAR02_V481_JOB_PINS.map(p=>p.jobId)).size,10);
});

for(let i=0;i<10;i++){
 test(`real pinned job fixture V4.${70+i} accepted only as job metadata`,()=>{
  const a=CAR02_V481_JOB_PINS[i],b=CAR02_V480_RUN_PINS[i];
  assert.equal(validateCar02JobStepR481(fixture(a,b),a,b),null);
 });
}
for(let i=0;i<10;i++){
 test(`pin ${i} modified HEAD fails closed`,()=>{
  const p=CAR02_V481_JOB_PINS[i],b=CAR02_V480_RUN_PINS[i],obj=fixture(p,b);
  obj.jobs[0].head_sha='0'.repeat(40);
  assert.equal(validateCar02JobStepR481(obj,p,b),'job_commit_mismatch');
 });
}
const cases=[
 ['count',o=>{o.total_count=2},'job_count_not_one'],
 ['wrong_run',o=>{o.jobs[0].run_id+=1},'job_identity_mismatch'],
 ['wrong_job',o=>{o.jobs[0].id+=1},'job_identity_mismatch'],
 ['rerun',o=>{o.jobs[0].run_attempt=2},'job_rerun_disallowed'],
 ['job_name',o=>{o.jobs[0].name='fake'},'job_name_mismatch'],
 ['job_failure',o=>{o.jobs[0].conclusion='failure'},'job_failed_or_incomplete'],
 ['job_url',o=>{o.jobs[0].html_url='https://example.invalid/'},'job_url_mismatch'],
 ['missing_steps',o=>{o.jobs[0].steps=[]},'job_steps_missing'],
 ['duplicate',o=>{o.jobs[0].steps[2].name=o.jobs[0].steps[1].name},'duplicate_or_invalid_step'],
 ['step_failure',o=>{o.jobs[0].steps[4].conclusion='failure'},'step_failed_skipped_or_pending'],
 ['step_skipped',o=>{o.jobs[0].steps[4].conclusion='skipped'},'step_failed_skipped_or_pending'],
 ['step_out_of_sequence',o=>{o.jobs[0].steps[3].number=2},'step_sequence_invalid'],
 ['missing_lock',o=>{o.jobs[0].steps[3].name='not a lock'},'mandatory_step_missing'],
 ['wrong_order',o=>{let a=o.jobs[0].steps;const tmp=a[3].name;a[3].name=a[4].name;a[4].name=tmp},'mandatory_step_out_of_order'],
 ['missing_pg17_container',o=>{o.jobs[0].steps.splice(1,1)},'pg17_container_missing'],
];
for(const [label,alter,expected] of cases){
 test(`job metadata rejects ${label}`,()=>{const o=fixture(pin,base);alter(o);
 assert.equal(validateCar02JobStepR481(o,pin,base),expected)});
}

test('actual pinned fixture adapter 10 jobs, 30 steps, 7 PostgreSQL checks, never release',async()=>{
 const a=createCar02ReadOnlyJobStepAuditorR481({readJobs:readGood,authorizeAuditor:validAuth,inspectIsolation:validIsolation});
 const r=await a.inspect();noWrite(r);assert.equal(r.checkedActualGithubJobs,10);
 assert.equal(r.verifiedMandatorySteps,30);assert.equal(r.verifiedPriorDisposablePg17Jobs,7);
 assert.equal(r.reason,'ten_real_github_jobs_and_mandatory_steps_verified_still_no_go');
});
test('untrusted auditor is rejected before fetch',async()=>{
 const a=createCar02ReadOnlyJobStepAuditorR481({readJobs:async()=>{throw Error('unexpected fetch')},authorizeAuditor:async()=>({...await validAuth(),role:'user'}),inspectIsolation:validIsolation});
 const r=await a.inspect();noWrite(r);assert.equal(r.reason,'auditor_or_isolation_untrusted');
});
test('non-isolated stage is rejected',async()=>{
 const a=createCar02ReadOnlyJobStepAuditorR481({readJobs:readGood,authorizeAuditor:validAuth,inspectIsolation:async()=>({...await validIsolation(),testOnly:false})});
 const r=await a.inspect();noWrite(r);assert.equal(r.reason,'auditor_or_isolation_untrusted');
});
test('API failure is rejected with honest progress count',async()=>{
 let count=0;
 const a=createCar02ReadOnlyJobStepAuditorR481({readJobs:async args=>{if(++count===4)throw Error('API');return readGood(args)},authorizeAuditor:validAuth,inspectIsolation:validIsolation});
 const r=await a.inspect();noWrite(r);assert.equal(r.checkedActualGithubJobs,3);assert.equal(r.verifiedMandatorySteps,9);
 assert.equal(r.reason,'github_job_read_unavailable');
});
