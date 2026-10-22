import test from 'node:test';
import assert from 'node:assert/strict';
import {CAR02_V481_RELEASE_LOCK} from './car02-ci-job-step-audit-r481.mjs';
import {CAR02_V482_RELEASE_LOCK,CAR02_V482_RUN_PIN,validateCar02RunVerdictR482,
 validateCar02JobVerdictR482,createCar02ReadOnlyVerdictAuditorR482} from './car02-ci-run-verdict-audit-r482.mjs';

const pin=CAR02_V482_RUN_PIN;
const fixtureRun=()=>({
 id:pin.runId,workflow_id:pin.workflowId,head_branch:'car02-v434-review-only',
 head_sha:pin.headSha,name:pin.runName,path:pin.workflowPath,
 event:'push',run_attempt:1,status:'completed',conclusion:'success',
 html_url:`https://github.com/dpromstk2000-lab/line-shaken-liff/actions/runs/${pin.runId}`
});
const fixtureJobs=()=>({total_count:1,jobs:[{
 id:pin.jobId,run_id:pin.runId,run_attempt:1,name:pin.jobName,head_sha:pin.headSha,
 status:'completed',conclusion:'success',
 html_url:`https://github.com/dpromstk2000-lab/line-shaken-liff/actions/runs/${pin.runId}/job/${pin.jobId}`,
 steps:pin.requiredSteps.map((name,i)=>({
  name,number:[1,2,3,4,5,10,11][i],status:'completed',conclusion:'success'
 }))
}]});
const validWho=async()=>({verified:true,role:'ci_verdict_auditor',mode:'isolated_qa',shopCode:'qa_shop_a'});
const validIsol=async()=>({verified:true,environment:'read_only_github_ci',testOnly:true,providerCallsEnabled:false});
const readRun=async({repository,runId})=>{
 assert.equal(repository,'dpromstk2000-lab/line-shaken-liff');assert.equal(runId,pin.runId);
 return fixtureRun();
};
const readJobs=async({repository,runId})=>{
 assert.equal(repository,'dpromstk2000-lab/line-shaken-liff');assert.equal(runId,pin.runId);
 return fixtureJobs();
};
const make=over=>createCar02ReadOnlyVerdictAuditorR482({
 readRun,readJobs,authorizeAuditor:validWho,inspectIsolation:validIsol,...over
});
const noGo=r=>{
 assert.equal(r.status,'no_go');
 assert.equal(r.releasePermitted,false);
 assert.equal(r.businessWritesAuthorized,false);
 assert.equal(r.lineDispatchAllowed,false);
 assert.equal(r.ownerApprovalVerified,false);
 assert.equal(r.stagingAcceptanceVerified,false);
 assert.equal(r.realProviderProofsVerified,0);
};

test('V482 hard NO_GO and one exact locked V481 run pin',()=>{
 assert.equal(CAR02_V482_RELEASE_LOCK,true);
 assert.equal(CAR02_V481_RELEASE_LOCK,true);
 assert.equal(pin.runId,39722231225);
 assert.equal(pin.jobId,119638086357);
 assert.equal(pin.headSha,'135762874c46c984332581f145d6d833edf562b6');
 assert.equal(pin.requiredSteps.length,7);
 assert.equal(new Set(pin.requiredSteps).size,7);
});
test('unchanged actual V481 run metadata fixture accepted',()=>{
 assert.equal(validateCar02RunVerdictR482(fixtureRun()),null);
});
const runCases=[
 ['missing',()=>null,'missing_run'],
 ['not_object',()=>[],'missing_run'],
 ['run_id',r=>{r.id++},'run_identity_mismatch'],
 ['workflow_id',r=>{r.workflow_id++},'run_identity_mismatch'],
 ['commit',r=>{r.head_sha='0'.repeat(40)},'run_commit_or_branch_mismatch'],
 ['branch',r=>{r.head_branch='main'},'run_commit_or_branch_mismatch'],
 ['name',r=>{r.name='unrelated'},'workflow_identity_mismatch'],
 ['path',r=>{r.path='worker-deploy.yml'},'workflow_identity_mismatch'],
 ['trigger',r=>{r.event='workflow_dispatch'},'unexpected_trigger_or_attempt'],
 ['rerun',r=>{r.run_attempt=2},'unexpected_trigger_or_attempt'],
 ['failed',r=>{r.conclusion='failure'},'run_not_successful'],
 ['pending',r=>{r.status='in_progress'},'run_not_successful'],
 ['url',r=>{r.html_url='https://other.invalid/'},'run_url_mismatch'],
 ['empty_path',r=>{r.path=''},'workflow_identity_mismatch'],
];
for(const [label,modify,expected] of runCases){
 test(`actual run rejects ${label}`,()=>{
  const r=fixtureRun();const obj=modify(r)??(label==='missing'?null:r);
  assert.equal(validateCar02RunVerdictR482(obj),expected);
 });
}
test('unchanged actual V481 job and seven mandatory steps accepted',()=>{
 assert.equal(validateCar02JobVerdictR482(fixtureJobs()),null);
});
const jobCases=[
 ['missing',()=>null,'job_count_mismatch'],
 ['multiple',o=>{o.total_count=2},'job_count_mismatch'],
 ['wrong_length',o=>{o.jobs.push({...o.jobs[0]})},'job_count_mismatch'],
 ['missing_job',o=>{o.jobs[0]=null},'missing_job'],
 ['job_id',o=>{o.jobs[0].id++},'job_identity_mismatch'],
 ['run_id',o=>{o.jobs[0].run_id++},'job_identity_mismatch'],
 ['rerun',o=>{o.jobs[0].run_attempt=2},'job_identity_mismatch'],
 ['job_name',o=>{o.jobs[0].name='deploy'},'job_name_or_commit_mismatch'],
 ['job_sha',o=>{o.jobs[0].head_sha='0'.repeat(40)},'job_name_or_commit_mismatch'],
 ['job_failure',o=>{o.jobs[0].conclusion='failure'},'job_not_successful'],
 ['job_running',o=>{o.jobs[0].status='in_progress'},'job_not_successful'],
 ['job_url',o=>{o.jobs[0].html_url='https://example.invalid'},'job_url_mismatch'],
 ['missing_step',o=>{o.jobs[0].steps.pop()},'job_step_count_mismatch'],
 ['extra_step',o=>{o.jobs[0].steps.push({...o.jobs[0].steps[6]})},'job_step_count_mismatch'],
 ['renamed_step',o=>{o.jobs[0].steps[3].name='fake tests'},'step_name_or_order_mismatch'],
 ['reordered_step',o=>{const a=o.jobs[0].steps;[a[3],a[4]]=[a[4],a[3]]},'step_name_or_order_mismatch'],
 ['duplicate_number',o=>{o.jobs[0].steps[3].number=3},'step_sequence_invalid'],
 ['skipped_step',o=>{o.jobs[0].steps[4].conclusion='skipped'},'step_not_successful'],
 ['pending_step',o=>{o.jobs[0].steps[4].status='in_progress'},'step_not_successful'],
 ['missing_step_name',o=>{delete o.jobs[0].steps[4].name},'step_name_or_order_mismatch']
];
for(const [label,modify,expected] of jobCases){
 test(`actual job rejects ${label}`,()=>{
  const o=fixtureJobs();const obj=modify(o)??(label==='missing'?null:o);
  assert.equal(validateCar02JobVerdictR482(obj),expected);
 });
}
test('read only audit validates V481 run, job and seven steps and still denies release',async()=>{
 const r=await make().inspect();noGo(r);
 assert.equal(r.verifiedV481GithubRun,1);
 assert.equal(r.verifiedV481GithubJob,1);
 assert.equal(r.verifiedV481JobSteps,7);
 assert.equal(r.reason,'real_v481_ci_run_and_seven_steps_verified_still_no_go');
});
test('untrusted auditor fails before API calls',async()=>{
 const r=await make({authorizeAuditor:async()=>({...await validWho(),role:'owner'})}).inspect();
 noGo(r);assert.equal(r.reason,'auditor_or_isolation_untrusted');
});
test('nonisolated environment fails before API calls',async()=>{
 const r=await make({inspectIsolation:async()=>({...await validIsol(),providerCallsEnabled:true})}).inspect();
 noGo(r);assert.equal(r.reason,'auditor_or_isolation_untrusted');
});
test('auditor read error fails closed',async()=>{
 const r=await make({authorizeAuditor:async()=>{throw Error('unavailable')}}).inspect();
 noGo(r);assert.equal(r.reason,'auditor_or_isolation_unavailable');
});
test('GitHub run transport error fails closed',async()=>{
 const r=await make({readRun:async()=>{throw Error('api')}}).inspect();
 noGo(r);assert.equal(r.reason,'github_run_read_unavailable');
});
test('GitHub job transport error keeps honest run count',async()=>{
 const r=await make({readJobs:async()=>{throw Error('api')}}).inspect();
 noGo(r);assert.equal(r.reason,'github_job_read_unavailable');
 assert.equal(r.verifiedV481GithubRun,1);assert.equal(r.verifiedV481GithubJob,0);
});
test('tampered run blocks job fetch',async()=>{
 const r=await make({readRun:async()=>({...fixtureRun(),event:'schedule'}),
  readJobs:async()=>{throw Error('must not be called')}}).inspect();
 noGo(r);assert.equal(r.reason,'github_run_unexpected_trigger_or_attempt');
});
test('tampered job retains zero verified steps',async()=>{
 const bad=fixtureJobs();bad.jobs[0].steps[4].conclusion='failure';
 const r=await make({readJobs:async()=>bad}).inspect();
 noGo(r);assert.equal(r.reason,'github_job_step_not_successful');
 assert.equal(r.verifiedV481GithubRun,1);assert.equal(r.verifiedV481GithubJob,0);
});
test('missing adapters throw immediately',()=>{
 assert.throws(()=>createCar02ReadOnlyVerdictAuditorR482({}),/V482_READ_ONLY_ADAPTERS_REQUIRED/);
});
