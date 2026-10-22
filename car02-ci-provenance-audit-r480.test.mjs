import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CAR02_V480_RELEASE_LOCK,CAR02_V480_REPOSITORY,CAR02_V480_BRANCH,CAR02_V480_RUN_PINS,validateCar02GithubRunR480,createCar02ReadOnlyCIProvenanceAuditorR480} from './car02-ci-provenance-audit-r480.mjs';
const c=JSON.parse(readFileSync(new URL('./car02-v480-ci-run-provenance-contract.json',import.meta.url),'utf8'));
const first=CAR02_V480_RUN_PINS[0];
function example(p){return{id:p.runId,name:p.workflowName,path:p.workflowPath,head_sha:p.headSha,
 head_branch:CAR02_V480_BRANCH,repository:{full_name:CAR02_V480_REPOSITORY},head_repository:{full_name:CAR02_V480_REPOSITORY},
 head_commit:{id:p.headSha},event:'push',status:'completed',conclusion:'success',run_attempt:1,
 created_at:'2026-10-22T00:01:01Z',updated_at:'2026-10-22T00:02:00Z',
 html_url:`https://github.com/${CAR02_V480_REPOSITORY}/actions/runs/${p.runId}`};}
function fixture(o={}){const calls=[];const service=createCar02ReadOnlyCIProvenanceAuditorR480({
 authorizeAuditor:async()=>{if(o.throw==='auth')throw Error('redacted');return{verified:true,role:'ci_provenance_auditor',mode:'isolated_qa',shopCode:'qa_shop_a',...o.auth};},
 inspectIsolation:async()=>{if(o.throw==='isolation')throw Error('redacted');return{verified:true,testOnly:true,environment:'read_only_github_ci',providerCallsEnabled:false,...o.isolation};},
 readRun:async x=>{calls.push(x);if(o.throw==='read')throw Error('redacted');const p=CAR02_V480_RUN_PINS.find(y=>y.runId===x.runId);return o.badRunId===x.runId?{...example(p),...o.overrides}:example(p);}});return{service,calls};}
function locked(r){assert.equal(r.status,'no_go');for(const k of ['releasePermitted','ownerApproved','businessWritesAuthorized','lineDeliveryProven','realStagingVerified'])assert.equal(r[k],false);
 assert.equal(r.realProviderProofsVerified,0);assert.ok(Object.isFrozen(r));assert.equal(r.sourceEvidenceClass,'github_workflow_run_metadata_only');assert.ok(!('token' in r));}
test('static provenance pins and hard NO_GO',()=>{assert.equal(CAR02_V480_RELEASE_LOCK,true);assert.equal(CAR02_V480_RUN_PINS.length,10);
 assert.deepEqual(c.actualRunPins,CAR02_V480_RUN_PINS);assert.equal(c.releasePermitted,false);assert.equal(c.realProviderProofCount,0);
 assert.equal(c.expectedMinFullNodeTests,1022);assert.ok(Object.isFrozen(CAR02_V480_RUN_PINS));
 assert.deepEqual(CAR02_V480_RUN_PINS.map(p=>p.version),Array.from({length:10},(_,i)=>`V4.${70+i}`));});
test('all ten pinned runs still never permit release',async()=>{const f=fixture(),r=await f.service.inspect({request:{releasePermitted:true}});locked(r);
 assert.equal(r.checkedActualGithubRuns,10);assert.equal(r.reason,'ten_real_github_ci_runs_verified_still_no_commercial_proofs');
 assert.equal(f.calls.length,10);assert.deepEqual(f.calls[0],{runId:first.runId,repository:CAR02_V480_REPOSITORY});});
test('missing run reader or guard is a construction error',()=>{for(const a of [{},{readRun:()=>{}},{readRun:()=>{},authorizeAuditor:()=>{}}])assert.throws(()=>createCar02ReadOnlyCIProvenanceAuditorR480(a),/REQUIRED/);});
test('untrusted request tokens never appear in output',async()=>{const f=fixture(),r=await f.service.inspect({request:{token:'SENSITIVE',releasePermitted:true}});locked(r);
 assert.equal(JSON.stringify(r).includes('SENSITIVE'),false);});
for(const p of CAR02_V480_RUN_PINS)test(`${p.version}: exact GitHub run accepted as metadata only`,()=>assert.equal(validateCar02GithubRunR480(example(p),p),null));
const variants=[
 ['id',1,'unexpected_run_id'],['name','wrong','unexpected_workflow_name'],['path','.github/workflows/wrong.yml','unexpected_workflow_path'],
 ['head_sha','f'.repeat(40),'unexpected_commit'],['head_branch','main','unexpected_branch'],
 ['repository',{full_name:'other/repo'},'wrong_repository_or_fork'],['head_repository',{full_name:'other/repo'},'wrong_repository_or_fork'],
 ['head_commit',{id:'f'.repeat(40)},'unexpected_head_commit'],['event','workflow_dispatch','non_push_event'],
 ['status','in_progress','run_not_successful'],['conclusion','failure','run_not_successful'],['conclusion',null,'run_not_successful'],
 ['run_attempt',0,'run_attempt_invalid'],['run_attempt',1.5,'run_attempt_invalid'],
 ['created_at','yesterday','run_timestamp_invalid'],['updated_at','invalid','run_timestamp_invalid'],
 ['updated_at','2026-10-22T00:00:00Z','run_timestamp_invalid'],
 ['html_url','https://github.com/other/actions/runs/1','run_url_mismatch']
];
for(const [field,value,why] of variants)test(`tamper ${field} ${String(value).slice(0,20)}`,()=>assert.equal(validateCar02GithubRunR480({...example(first),[field]:value},first),why));
for(const [label,value] of [['undefined',undefined],['null',null],['string','abc'],['array',[]]])test(`malformed run ${label}`,()=>assert.equal(validateCar02GithubRunR480(value,first),'missing_run'));
const refusal=[
 ['unverified auditor',{auth:{verified:false}},'auditor_or_isolation_untrusted',0],
 ['role changed',{auth:{role:'admin'}},'auditor_or_isolation_untrusted',0],
 ['shop changed',{auth:{shopCode:'shop_b'}},'auditor_or_isolation_untrusted',0],
 ['production isolation',{isolation:{environment:'production'}},'auditor_or_isolation_untrusted',0],
 ['provider access enabled',{isolation:{providerCallsEnabled:true}},'auditor_or_isolation_untrusted',0],
 ['auditor unavailable',{throw:'auth'},'auditor_or_isolation_unavailable',0],
 ['isolation unavailable',{throw:'isolation'},'auditor_or_isolation_unavailable',0],
 ['GitHub missing',{throw:'read'},'github_run_read_unavailable',1]
];
for(const [label,opts,why,reads] of refusal)test(`refuse ${label}`,async()=>{let f=fixture(opts),r=await f.service.inspect();locked(r);assert.equal(r.reason,why);assert.equal(f.calls.length,reads);});
test('invalid ninth run has only eight confirmed',async()=>{const f=fixture({badRunId:CAR02_V480_RUN_PINS[8].runId,overrides:{head_branch:'main'}}),r=await f.service.inspect();locked(r);
 assert.equal(r.reason,'github_provenance_unexpected_branch');assert.equal(r.checkedActualGithubRuns,8);assert.equal(f.calls.length,9);});
test('wrong first head commit aborts before further fetch',async()=>{const f=fixture({badRunId:first.runId,overrides:{head_commit:null}}),r=await f.service.inspect();locked(r);
 assert.equal(r.reason,'github_provenance_unexpected_head_commit');assert.equal(f.calls.length,1);});
test('Actions only reads contents and CI run metadata',()=>{assert.deepEqual(c.githubReadOnlyPermissions,['contents:read','actions:read']);
 assert.equal(c.actualGithubRunLookupRequiredInCI,true);assert.equal(c.ownerApproved,false);assert.equal(c.productionWritesAuthorized,false);});
