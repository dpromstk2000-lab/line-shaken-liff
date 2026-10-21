import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {CAR02_V464_RELEASE_LOCK,CAR02_V464_REVIEW_BRANCH,CAR02_V464_WORKFLOWS,
 createCar02OfflineWorkflowLayoutR464} from './car02-workflow-layout-r464.mjs';
const branch=CAR02_V464_REVIEW_BRANCH;
const wf=(p)=>`name: CAR02 V4.64 Review Workflow Placement (NO_GO HOLD)\non:\n  push:\n    branches: [car02-v434-review-only]\n  workflow_dispatch:\npermissions:\n  contents: read\njobs:\n  check:\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          persist-credentials: false\n      - run: |\n          node --test car02-*.test.mjs\n          grep -Fxq '# fail 0' results.txt\n          echo NO_GO\n# ${p}\n`;
function fixture({paths=[...CAR02_V464_WORKFLOWS],contents={},throwAt='',listValue=null}={}){
 const calls=[];
 const obj=createCar02OfflineWorkflowLayoutR464({
  listPaths:async({branch})=>{calls.push(['list',branch]);if(throwAt==='list')throw Error('SECRET');return listValue??paths;},
  readFile:async({branch,path})=>{calls.push(['read',branch,path]);if(throwAt==='read')throw Error('SECRET');return Object.hasOwn(contents,path)?contents[path]:wf(path);}
 });
 return{obj,calls};
}
const inspect=f=>f.obj.inspect({branch});
const denied=async(f,reason)=>{const r=await inspect(f);assert.deepEqual(r,{status:'no_go',reason,releasePermitted:false,workflowLayoutVerified:false});return r;};
test('release lock, strictly three immutable workflow paths, no automatic adapters',()=>{
 assert.equal(CAR02_V464_RELEASE_LOCK,true);
 assert.equal(CAR02_V464_WORKFLOWS.length,3);
 assert.equal(Object.isFrozen(CAR02_V464_WORKFLOWS),true);
 assert.throws(()=>createCar02OfflineWorkflowLayoutR464(),/TRUSTED_READ_ONLY_SOURCE_REQUIRED/);
});
test('proper GitHub .github/workflows placement is verified, not commercial permission',async()=>{
 const f=fixture(),r=await inspect(f);
 assert.deepEqual(r,{status:'layout_verified_review_only',reason:'isolated_ci_not_provider_proof',releasePermitted:false,workflowLayoutVerified:true,workflowCount:3});
 assert.equal(f.calls.length,4);
 assert.ok(Object.isFrozen(r));
});
test('wrong branch denies before calling trusted adapters',async()=>{
 const f=fixture();assert.equal((await f.obj.inspect({branch:'main'})).reason,'wrong_branch');assert.equal(f.calls.length,0);
});
test('missing workflow directory is rejected even with root file present',async()=>{
 const ps=[...CAR02_V464_WORKFLOWS.slice(1),CAR02_V464_WORKFLOWS[0].split('/').at(-1)];
 await denied(fixture({paths:ps}),'workflow_missing_from_correct_directory');
});
test('root shadow of actual workflow is forbidden',async()=>{
 const ps=[...CAR02_V464_WORKFLOWS,CAR02_V464_WORKFLOWS[0].split('/').at(-1)];
 await denied(fixture({paths:ps}),'duplicate_workflow_outside_authorized_directory');
});
test('shadow inside another directory is forbidden',async()=>{
 const ps=[...CAR02_V464_WORKFLOWS,'misc/'+CAR02_V464_WORKFLOWS[1].split('/').at(-1)];
 await denied(fixture({paths:ps}),'duplicate_workflow_outside_authorized_directory');
});
test('duplicate listing or invalid paths must be refused',async()=>{
 for(const paths of [[...CAR02_V464_WORKFLOWS,CAR02_V464_WORKFLOWS[0]],
  [...CAR02_V464_WORKFLOWS,'../stolen'],[...CAR02_V464_WORKFLOWS,'C:\\bad'],
  [...CAR02_V464_WORKFLOWS,'/absolute'],[...CAR02_V464_WORKFLOWS,'dir//bad']])
   await denied(fixture({paths}),'invalid_or_duplicated_repository_paths');
});
test('untrusted or too big workflow bytes fail closed',async()=>{
 const target=CAR02_V464_WORKFLOWS[0];
 for(const content of ['',null,'a'.repeat(70000)])
   await denied(fixture({contents:{[target]:content}}),'unreadable_or_oversized_workflow');
});
test('workflow must keep review-only branch trigger and manual execution',async()=>{
 const target=CAR02_V464_WORKFLOWS[0];
 for(const replacement of ['branches: [main]','branches: [other]'])
  await denied(fixture({contents:{[target]:wf(target).replace('branches: [car02-v434-review-only]',replacement)}}),'workflow_security_or_regression_gate_missing');
 await denied(fixture({contents:{[target]:wf(target).replace('workflow_dispatch:','workflow_manual:')}}),'workflow_security_or_regression_gate_missing');
});
test('permissions and checkout must not silently become write-capable',async()=>{
 const target=CAR02_V464_WORKFLOWS[2];
 await denied(fixture({contents:{[target]:wf(target).replace('persist-credentials: false','persist-credentials: true')}}),'workflow_security_or_regression_gate_missing');
 await denied(fixture({contents:{[target]:wf(target).replace('contents: read','contents: write')}}),'unsafe_workflow_scope_or_stale_test_count');
});
test('Node regression and fail-zero evidence are mandatory',async()=>{
 const target=CAR02_V464_WORKFLOWS[2];
 for(const x of ['node --test car02-*.test.mjs',"grep -Fxq '# fail 0'"])
  await denied(fixture({contents:{[target]:wf(target).replace(x,'echo skipped')}}),'workflow_security_or_regression_gate_missing');
});
test('hardcoded historical 385-test assertion is unsafe',async()=>{
 const target=CAR02_V464_WORKFLOWS[0];
 await denied(fixture({contents:{[target]:wf(target)+"\ngrep -Fxq '# tests 385' old.log\n"}}),'unsafe_workflow_scope_or_stale_test_count');
});
test('external source read errors are not treated as successful evidence',async()=>{
 await denied(fixture({throwAt:'list'}),'trusted_source_read_failed');
 await denied(fixture({throwAt:'read'}),'trusted_source_read_failed');
});
test('invalid source listings are rejected before reading any workflow',async()=>{
 const f=fixture({listValue:{files:[...CAR02_V464_WORKFLOWS]}});
 await denied(f,'invalid_or_duplicated_repository_paths');assert.equal(f.calls.length,1);
});
test('read-only source cannot accidentally claim LINE delivery, session proof or release',async()=>{
 const r=await inspect(fixture());assert.equal(r.releasePermitted,false);
 assert.equal(typeof r.canSendLine,'undefined');assert.equal(typeof r.sessionVerified,'undefined');
});
test('actual checkout fixture uses GitHub-correct path for all three workflows',()=>{
 for(const path of CAR02_V464_WORKFLOWS){
  assert.equal(existsSync(new URL('./'+path,import.meta.url)),true,path);
  assert.equal(existsSync(new URL('./'+path.split('/').at(-1),import.meta.url)),false,'root duplicate:'+path);
  const y=readFileSync(new URL('./'+path,import.meta.url),'utf8');
  assert.match(y,/^name: CAR02 V4\.(?:57|63|64).*NO_GO HOLD/m);
 }
});
test('review source R52 hard release lock is unchanged',()=>{
 const r=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
 assert.match(r,/const\s+CAR02_RELEASE_LOCK\s*=\s*true/);
 assert.doesNotMatch(r,/car02-workflow-layout-r464|releasePermitted:true/);
});
