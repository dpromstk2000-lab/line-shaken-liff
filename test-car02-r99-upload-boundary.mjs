import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {R99_CONTRACT,R99_DB,R99_MAX_UPLOAD,assertR99Environment,
 createR99QARig,createR99QARequest,runR99AdversarialCases} from './car02-r99-disposable-upload-boundary-qa.mjs';
import {verifyR99Workflow} from './car02-r99-workflow-readonly-guard.mjs';
const workflow=readFileSync('.github/workflows/car02-r99-disposable-upload-boundary-qa.yml','utf8');
function mockRig({open=true}={}){
 const count={connect:0,query:0};const pool={
  connect:async()=>{count.connect++;throw Error('MOCK_MUST_NEVER_CONNECT')},
  query:async()=>{count.query++;throw Error('MOCK_MUST_NEVER_QUERY')}
 };
 const rig=createR99QARig({pool,reviewGate:async()=>open});
 return {count,...rig};
}
const noSideEffects=(fixture,count)=>{
 assert.equal(count.connect,0);assert.equal(count.query,0);assert.equal(fixture.posts,0);
};
test('R99 strict environment: cannot use production/cloud/non-PG17 services',()=>{
 const baseline={R99_DISPOSABLE_BOUNDARY_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',
  PGUSER:'postgres',PGPASSWORD:'disposable-r93s-ci-only',PGDATABASE:R99_DB};
 assertR99Environment(baseline);
 for(const key of Object.keys(baseline))assert.throws(()=>assertR99Environment({...baseline,[key]:'wrong'}),/R99_NOT_DISPOSABLE/);
});
test('R99 contract is never a release/deploy authorization',()=>{
 assert.equal(R99_CONTRACT.qaOnly,true);assert.equal(R99_CONTRACT.productionReady,false);
 assert.equal(R99_CONTRACT.releaseDecision,'NO_GO');assert.equal(R99_CONTRACT.migrationDecision,'HOLD');
 assert.equal(R99_CONTRACT.deployAuthorized,false);assert.equal(R99_CONTRACT.lineDispatchAllowed,false);
});
test('R99 requires injected isolated memory storage and DB adapters',()=>{
 assert.throws(()=>createR99QARig(),/R99_DISPOSABLE_DEPS_REQUIRED/);
 assert.throws(()=>createR99QARig({pool:{connect:async()=>{}}}),/R99_DISPOSABLE_DEPS_REQUIRED/);
});
test('R99 release-gate hard stop before auth, storage and DB',async()=>{
 const {handle,fixture,count}=mockRig({open:false});
 const r=await handle(createR99QARequest());assert.equal(r.status,503);
 noSideEffects(fixture,count);assert.equal(fixture.calls.length,0);
});
const failures=[
 {name:'foreign_origin',overrides:{origin:'https://attacker.invalid'},status:403},
 {name:'foreign_actor',overrides:{token:'Bearer qa-foreign-r99-fixture'},status:401},
 {name:'guest_actor',overrides:{token:'Bearer qa-guest-r99-fixture'},status:401},
 {name:'bad_key',overrides:{extra:{'idempotency-key':'bad-value'}},status:400},
 {name:'unprefixed',overrides:{url:'https://r99-boundary-fixture.invalid/api/car02/uploads/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333'},status:404},
 {name:'query_injection',overrides:{url:'https://r99-boundary-fixture.invalid/functions/v1/dpro-car02-stage/api/car02/uploads/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333?shop=other_shop'},status:404},
 {name:'bad_mime',overrides:{mime:'application/octet-stream'},status:415},
 {name:'line_identity_rejected',overrides:{extra:{'x-line-id-token':'untrusted'}},status:403},
 {name:'upload_cap',overrides:{bytes:new Uint8Array(R99_MAX_UPLOAD+1)},status:413},
 {name:'business_cap',overrides:{url:'https://r99-boundary-fixture.invalid/functions/v1/dpro-car02-stage/api/car02',bytes:new Uint8Array(32769)},status:413},
 {name:'no_delete',overrides:{method:'DELETE'},status:405}
];
for(const c of failures){
 test('R99 offline reject '+c.name,async()=>{
  const {handle,fixture,count}=mockRig();
  const r=await handle(createR99QARequest(c.overrides));
  assert.equal(r.status,c.status,c.name);
  noSideEffects(fixture,count);
 });
}
test('R99 CORS preflight approved and unapproved headers are safe',async()=>{
 const {handle,fixture,count}=mockRig();
 const req=createR99QARequest({method:'OPTIONS',extra:{
  'access-control-request-method':'POST','access-control-request-headers':'authorization,content-type,idempotency-key'
 }});
 assert.equal((await handle(req)).status,204);
 assert.equal((await handle(createR99QARequest({method:'OPTIONS',extra:{
  'access-control-request-method':'POST','access-control-request-headers':'x-shop-code'
 }}))).status,403);
 noSideEffects(fixture,count);
});
test('R99 challenges include negative tenants, storage failures, read-back, outbox',()=>{
 const code=String(runR99AdversarialCases);
 for(const required of ['foreign_tenant_actor','inactive_staff','business_cap_32k',
  'upload_cap_5m','R99_IDEMPOTENCY_REUSED_ID','R99_IDEMPOTENCY_REUPLOADED',
  'postFailure:true','postAckLost:true','publicBucket:true','R99_OUTBOX_BINDING','R99_CROSS_TENANT_WRITE','R99_VALID_ACTOR_SCOPE_NOT_OVERRIDDEN_BY_HEADER'])
  assert.ok(code.includes(required),required);
});
test('R99 no real network/cloud credentials or Deploy logic',()=>{
 const s=readFileSync('car02-r99-disposable-upload-boundary-qa.mjs','utf8');
 assert.doesNotMatch(s,/SUPABASE_SERVICE_ROLE_KEY|wrangler deploy|Deno\.env|process\.env\.CAR02_DATABASE_URL|https:\/\/[^\s'"`]+\.supabase\.co/);
 assert.doesNotMatch(s,/\bfetch\s*\(|\bDELETE\s+FROM\s+public\./);
});
test('R99 required PG17 workflow shape and safe/manual checks',()=>{
 const v=verifyR99Workflow(workflow);
 assert.equal(v.releaseDecision,'NO_GO');assert.equal(v.migrationDecision,'HOLD');
 assert.equal(v.disposableOnly,true);
});
test('R99 workflow detects unexpected triggering, deploy or secrets',()=>{
 assert.throws(()=>verifyR99Workflow(workflow.replace('workflow_dispatch:','push:')));
 assert.throws(()=>verifyR99Workflow(workflow.replace('image: postgres:17','image: postgres:16')));
 assert.throws(()=>verifyR99Workflow(workflow.replace('contents: read','contents: write')));
 assert.throws(()=>verifyR99Workflow(workflow+'\n# ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}'));
 assert.throws(()=>verifyR99Workflow(workflow+'\n# wrangler deploy'));
});
