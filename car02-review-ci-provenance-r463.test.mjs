import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CAR02_V463_MAIN_SHA,CAR02_V463_RELEASE_LOCK,CAR02_V463_REVIEW_BRANCH,
 CAR02_V463_CHECKS,createCar02OfflineCiProvenanceR463} from './car02-review-ci-provenance-r463.mjs';
const head='7894f4d6e2e91eb70364d04684bfcf40fec9926e';
const runId=39559851569,jobId=119088192295;
const successLog=(n=483,key=CAR02_V463_CHECKS.v462.marker)=>
 `2026-10-21T07:07:54.4791169Z # tests ${n}\n2026-10-21T07:07:54.4791426Z # pass ${n}\n2026-10-21T07:07:54.4791626Z # fail 0\n2026-10-21T07:07:54.5242001Z ${key}\n`;
function fixture({branch=head,main=CAR02_V463_MAIN_SHA,runPatch={},jobPatch={},log=successLog(),
   throwAt='',jobsLength=1}={}){
 let calls=[];
 const run={id:runId,head_branch:CAR02_V463_REVIEW_BRANCH,head_sha:head,
  name:CAR02_V463_CHECKS.v462.name,status:'completed',conclusion:'success',...runPatch};
 const job={id:jobId,status:'completed',conclusion:'success',...jobPatch};
 const inject=(name,fn)=>async(args)=>{calls.push({name,args});if(throwAt===name)throw Error('SENSITIVE_ERROR');return fn(args)};
 const api=createCar02OfflineCiProvenanceR463({
  trustedReadBranch:inject('branch',({branch:b})=>({sha:b==='main'?main:branch})),
  trustedReadRun:inject('run',()=>run),
  trustedReadJobs:inject('jobs',()=>Array(jobsLength).fill(job)),
  trustedReadJobLog:inject('log',()=>log)
 });
 return{api,calls,run};
}
const check=(f,checkId='v462',id=runId)=>f.api.check({runId:id,checkId});
const blocked=async(f,reason,checkId='v462',id=runId)=>{
 const r=await check(f,checkId,id);assert.equal(r.status,'no_go');
 assert.equal(r.reason,reason);assert.equal(r.releasePermitted,false);
 assert.equal(r.businessWritesAuthorized,false);assert.equal(r.realProviderProofVerified,false);
 return r;
};
test('V463 release stays locked, immutable review checks, no real API adapters',()=>{
 assert.equal(CAR02_V463_RELEASE_LOCK,true);assert.equal(Object.isFrozen(CAR02_V463_CHECKS),true);
 assert.throws(()=>createCar02OfflineCiProvenanceR463(),/TRUSTED_READ_ONLY_ADAPTERS_REQUIRED/);
});
test('current review-branch success with full trusted job log never grants commercial release',async()=>{
 const f=fixture(),r=await check(f);
 assert.deepEqual(r,{status:'matched_review_only',reason:'ci_success_not_commercial_proof',
 reviewCiCurrent:true,releasePermitted:false,businessWritesAuthorized:false,
 realProviderProofVerified:false,runId,testCount:483,reviewSha:head});
 assert.ok(Object.isFrozen(r));assert.deepEqual(f.calls.map(x=>x.name),['branch','branch','run','jobs','log']);
});
test('successful V461R1 run can be independently checked against exact head and marker',async()=>{
 const f=fixture({runPatch:{name:CAR02_V463_CHECKS.v461r1.name},log:successLog(483,CAR02_V463_CHECKS.v461r1.marker)});
 assert.equal((await check(f,'v461r1')).status,'matched_review_only');
});
test('older successful workflow on stale head is rejected, not promoted to present',async()=>{
 await blocked(fixture({branch:'a'.repeat(40)}),'stale_or_wrong_review_run');
});
test('other-branch workflow cannot validate current review',async()=>{
 await blocked(fixture({runPatch:{head_branch:'main'}}),'stale_or_wrong_review_run');
});
test('tampered workflow name or run id rejected',async()=>{
 await blocked(fixture({runPatch:{name:'CAR02 release GO'}}),'stale_or_wrong_review_run');
 await blocked(fixture({runPatch:{id:1}}),'stale_or_wrong_review_run');
});
test('failed, queued, canceled runs do not count',async()=>{
 for(const runPatch of [{conclusion:'failure'},{status:'queued'},{status:'completed',conclusion:'cancelled'}])
  await blocked(fixture({runPatch}),'run_not_success');
});
test('unknown main commit invalidates the entire review-only result',async()=>{
 await blocked(fixture({main:'1'.repeat(40)}),'untrusted_or_drifted_branch');
});
test('bad or incomplete branch SHA fails closed before any job reads',async()=>{
 const f=fixture({branch:'bad'});await blocked(f,'untrusted_or_drifted_branch');
 assert.deepEqual(f.calls.map(x=>x.name),['branch','branch']);
});
test('missing, failed or multiple jobs cannot be marked verified',async()=>{
 for(const o of [{jobsLength:0},{jobPatch:{conclusion:'failure'}},{jobsLength:2}])
  await blocked(fixture(o),'job_not_success');
});
test('job log missing or wrong-type prevents certification',async()=>{
 for(const log of [null,1,''])await blocked(fixture({log}),'job_log_unavailable');
});
test('historical test number below minimum rejected',async()=>{
 await blocked(fixture({log:successLog(482)}),'incomplete_or_failed_job_log');
});
test('test pass count not equal total rejected',async()=>{
 await blocked(fixture({log:'# tests 483\n# pass 482\n# fail 1\n'+CAR02_V463_CHECKS.v462.marker}),'incomplete_or_failed_job_log');
});
test('errors anywhere in job log refuse even if final marker printed',async()=>{
 await blocked(fixture({log:successLog()+'##[error] failure'}),'incomplete_or_failed_job_log');
});
test('a marker merely written inside an echoed script is not accepted',async()=>{
 const log=successLog().replace(/2026-10-21T07:07:54.5242001Z V462_FINAL_RELEASE_NO_GO_HOLD_TRUE/,
  '2026-10-21T07:07:54.5242001Z echo V462_FINAL_RELEASE_NO_GO_HOLD_TRUE');
 await blocked(fixture({log}),'incomplete_or_failed_job_log');
});
test('duplicate test totals and incomplete stdout are not reliable job logs',async()=>{
 await blocked(fixture({log:successLog()+'# tests 483\n'}),'incomplete_or_failed_job_log');
 await blocked(fixture({log:'# tests 483\n# pass 483\n'+CAR02_V463_CHECKS.v462.marker}),'incomplete_or_failed_job_log');
});
test('wrong review marker rejects a green log, even with matching run title',async()=>{
 await blocked(fixture({log:successLog(483,CAR02_V463_CHECKS.v461r1.marker)}),'incomplete_or_failed_job_log');
});
test('malformed run IDs or invented workflow checks fail before remote calls',async()=>{
 const f=fixture();for(const id of [0,-1,'39559851569',null,Number.MAX_SAFE_INTEGER+1])
  await blocked(f,'invalid_run_or_check_id','v462',id);
 await blocked(f,'invalid_run_or_check_id','invalid');
 assert.equal(f.calls.length,0);
});
test('read-only source exception never reveals details or claims success',async()=>{
 for(const throwAt of ['branch','run','jobs','log'])
  await blocked(fixture({throwAt}),'trusted_source_read_failed');
});
test('repaired historical V457 workflow uses dynamic count and preserves PG17 checks',()=>{
 const y=readFileSync(new URL('./car02-v457-signed-evidence-manifest-pg17-qa.yml',import.meta.url),'utf8');
 assert.match(y,/V4\.57R1/);
 assert.match(y,/tests=\$\(awk '\/\^# tests/);
 assert.match(y,/test "\$passed" = "\$tests"/);
 assert.doesNotMatch(y,/grep -Fxq '# tests 385'/);
 assert.match(y,/V457_PG17_EIGHT_READERS_IDENTICAL_FULL_LEDGER_DIGEST_PASS/);
});
test('R52 real hard release lock remains unchanged; never source-integrate this module',()=>{
 const src=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
 assert.match(src,/const\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/);
 assert.doesNotMatch(src,/review-ci-provenance-r463|v463_private/);
});
