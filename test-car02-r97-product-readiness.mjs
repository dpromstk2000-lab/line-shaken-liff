import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {R97_APPROVALS,R97_ALLOWED_SERVICES,R97_PRODUCT,R97_RELEASE,R97_PRODUCTION_BLOCKERS,
 validateR97Intake,gitBlobSha1,validateR97SourceBaseline,assembleR97Report,
 assertR97NeverApprovesProduction} from './car02-r97-product-readiness.mjs';
import {R97_STEPS,verifyR97Workflow} from './car02-r97-workflow-guard.mjs';

const template=JSON.parse(readFileSync('CAR02_R97_CUSTOMER_INTAKE_TEMPLATE.json','utf8'));
const yaml=readFileSync('.github/workflows/car02-r97-order-readiness-qa.yml','utf8');
const moduleSource=readFileSync('car02-r97-product-readiness.mjs','utf8');
const runnerSource=readFileSync('car02-r97-readonly-preflight.mjs','utf8');
const playbook=readFileSync('CAR02_R97_ORDER_TO_GO_LIVE_PLAYBOOK.txt','utf8');
const clone=x=>structuredClone(x);
const filled=()=>({...clone(template),customerType:'new',facilityCode:'car02_demo_001',domainPlan:'new_domain',bookingMinutes:30,
 approvals:Object.fromEntries(R97_APPROVALS.map(x=>[x,true]))});
const sourceStatus=Object.freeze({verified:true,releaseLock:true,count:7});
const integration={releaseDecision:'NO_GO',migrationDecision:'HOLD',integrationReady:false,
 sourceAuditOnly:true,unsafeCount:0,openCount:6,openGates:['A','B','C','D','E','F']};
const assemble=(overrides={})=>assembleR97Report({sourceStatus,integration,intake:template,
 playbookReady:true,githubEvidence:'R96_GITHUB_ACTIONS_SUCCESS_38191039794',...overrides});
const sourceFiles=()=>Object.fromEntries(['car02-edge-entry-r52.ts','a','b','c','d','e','f'].map(k=>[k,k==='car02-edge-entry-r52.ts'
 ? 'const CAR02_RELEASE_LOCK=true;\nisServerReleased:()=>!CAR02_RELEASE_LOCK' : 'safe '+k]));
const expected=files=>Object.fromEntries(Object.entries(files).map(([name,s])=>[name,gitBlobSha1(s)]));

test('R97 product and release safety are fail-closed, always',()=>{
 assert.equal(R97_PRODUCT,'DPRO_CAR02');
 assert.deepEqual(R97_RELEASE,{productionReady:false,productionDeployAllowed:false,
  customerDataMigrationAllowed:false,lineDispatchAllowed:false,releaseDecision:'NO_GO',migrationDecision:'HOLD'});
});
test('R97 template contains exactly nine approval fields',()=>{
 assert.equal(R97_APPROVALS.length,9);
 assert.deepEqual(Object.keys(template.approvals).sort(),R97_APPROVALS.slice().sort());
 assert.ok(Object.values(template.approvals).every(x=>x===false));
});
test('R97 template has no tenant or staff identifiable data',()=>{
 assert.equal(template.customerType,null);
 assert.equal(template.facilityCode,null);
 assert.equal(template.domainPlan,null);
 assert.equal(template.bookingMinutes,null);
 assert.doesNotMatch(JSON.stringify(template),/PRIVATE_KEY|SERVICE_ROLE|password|api[_-]?key|@|Bearer /i);
});
test('R97 only supports five declared product capabilities',()=>{
 assert.deepEqual(template.requestedServices,R97_ALLOWED_SERVICES);
});
test('R97 empty intake never claimed ready',()=>{
 const result=validateR97Intake(template);
 assert.equal(result.intakeInformationComplete,false);
 assert.equal(result.pending.length,13);
 assert.equal(result.completed,0);
 assert.equal(result.releaseDecision,'NO_GO');
});
test('R97 complete sales information is never production approval',()=>{
 const result=validateR97Intake(filled());
 assert.equal(result.pending.length,0);
 assert.equal(result.intakeInformationComplete,true);
 assert.match(result.stage,/NOT_AUTHORIZED/);
 assert.equal(result.migrationDecision,'HOLD');
});
test('R97 false approval always prevents intake completion',()=>{
 for(const key of R97_APPROVALS){const input=filled();input.approvals[key]=false;
  const result=validateR97Intake(input);assert.ok(result.pending.includes(key));assert.equal(result.intakeInformationComplete,false);}
});
test('R97 refuses extra secret or undeclared keys in input',()=>{
 const v=filled();v.privateToken='secret';assert.throws(()=>validateR97Intake(v),/R97_INTAKE_SCHEMA/);
 const s=filled();s.approvals.service_role_key=true;assert.throws(()=>validateR97Intake(s),/R97_APPROVAL_FIELDS/);
});
test('R97 rejects missing approval key',()=>{
 const v=filled();delete v.approvals.owner_identity;
 assert.throws(()=>validateR97Intake(v),/R97_APPROVAL_FIELDS/);
});
test('R97 accepts no unapproved approval field value',()=>{
 for(const bad of [null,1,'yes','true',[],{}]){
  const v=filled();v.approvals.owner_identity=bad;
  assert.throws(()=>validateR97Intake(v),/R97_APPROVAL_VALUE/);
 }
});
test('R97 facility codes cannot include links or traversal',()=>{
 for(const bad of ['../other','https://foo','CAR02 Demo','x','demo@x','🎉','car02-demo',42,'a'.repeat(50)]){
  const v=filled();v.facilityCode=bad;assert.throws(()=>validateR97Intake(v),/R97_FACILITY_CODE/);
 }
});
test('R97 domain plan is controlled enum, not user URL',()=>{
 for(const bad of ['https://example.com','unapproved','',99]){
  const v=filled();v.domainPlan=bad;assert.throws(()=>validateR97Intake(v),/R97_DOMAIN_PLAN/);
 }
});
test('R97 does not invent a universal appointment slot default',()=>{
 assert.equal(template.bookingMinutes,null);
 for(const n of [10,15,30]){const v=filled();v.bookingMinutes=n;assert.equal(validateR97Intake(v).intakeInformationComplete,true);}
 for(const n of [0,5,20,60,'30']){const v=filled();v.bookingMinutes=n;assert.throws(()=>validateR97Intake(v),/R97_BOOKING_INTERVAL/);}
});
test('R97 detects spoofed partial product scopes',()=>{
 for(const services of [[],['HP'],R97_ALLOWED_SERVICES.slice().reverse(),[...R97_ALLOWED_SERVICES,'CUSTOM']]){
  const v=filled();v.requestedServices=services;assert.throws(()=>validateR97Intake(v),/R97_SCOPE_TEMPLATE_CHANGED/);
 }
});
test('R97 customer type is explicitly chosen',()=>{
 for(const bad of ['demo','tenant','',123]){const v=filled();v.customerType=bad;assert.throws(()=>validateR97Intake(v),/R97_CUSTOMER_TYPE/);}
});
test('R97 validated result does not echo customer-specific facility code',()=>{
 assert.doesNotMatch(JSON.stringify(validateR97Intake(filled())),/car02_demo_001/);
});
test('R97 Git blob SHA hashing matches known Git behavior',()=>{
 assert.equal(gitBlobSha1('test\n'),'9daeafb9864cf43055ae93beb0afd6c7d144bfa4');
 assert.throws(()=>gitBlobSha1(null));
});
test('R97 source baseline requires seven exact file identities',()=>{
 const f=sourceFiles();const result=validateR97SourceBaseline(f,expected(f));
 assert.deepEqual(result,{verified:true,count:7,releaseLock:true});
});
test('R97 source baseline catches unauthorized mutation',()=>{
 const f=sourceFiles();const base=expected(f);
 const bad=clone(f);bad.b+='\nchange';
 assert.throws(()=>validateR97SourceBaseline(bad,base),/R97_SOURCE_BASELINE_DRIFT/);
});
test('R97 source baseline catches missing files and extras',()=>{
 const f=sourceFiles();const base=expected(f);
 const missing=clone(f);delete missing.a;
 assert.throws(()=>validateR97SourceBaseline(missing,base),/R97_SOURCE_SET_INCOMPLETE/);
 assert.throws(()=>validateR97SourceBaseline({...f,extra:'x'},base),/R97_SOURCE_SET_INCOMPLETE/);
});
test('R97 hard release lock cannot be removed even with updated SHA',()=>{
 const f=sourceFiles();f['car02-edge-entry-r52.ts']='const CAR02_RELEASE_LOCK=false;\nisServerReleased:()=>CAR02_RELEASE_LOCK';
 assert.throws(()=>validateR97SourceBaseline(f,expected(f)),/R97_RELEASE_LOCK_DRIFT/);
});
test('R97 rejects bogus SHA or insufficient baseline',()=>{
 const f=sourceFiles();const exp=expected(f);exp.a='not-a-hash';
 assert.throws(()=>validateR97SourceBaseline(f,exp),/R97_SOURCE_BASELINE_DRIFT/);
 assert.throws(()=>validateR97SourceBaseline({a:'b'},{a:gitBlobSha1('b')}),/R97_SOURCE_SET_INCOMPLETE/);
});
test('R97 report recognizes six unresolved integration issues and eight production blockers',()=>{
 const r=assemble();assert.equal(r.stagingIntegrationGaps.length,6);
 assert.equal(r.productionBlockers.length,8);assert.ok(r.productionBlockers.every(g=>g.state==='PENDING_VERIFICATION'));
 assertR97NeverApprovesProduction(r);
});
test('R97 report refuses unsafe integration audits',()=>{
 assert.throws(()=>assemble({integration:{...integration,unsafeCount:1}}),/R97_INTEGRATION_BASELINE_DRIFT/);
 assert.throws(()=>assemble({integration:{...integration,openCount:0,openGates:[]}}),/R97_INTEGRATION_BASELINE_DRIFT/);
});
test('R97 report refuses missing source check, playbook or evidence',()=>{
 assert.throws(()=>assemble({sourceStatus:{verified:false,releaseLock:true,count:7}}),/R97_UNVERIFIED_SOURCES/);
 assert.throws(()=>assemble({playbookReady:false}),/R97_PLAYBOOK_MISSING/);
 assert.throws(()=>assemble({githubEvidence:'R96_FAILED'}),/R97_GITHUB_EVIDENCE_UNVERIFIED/);
});
test('R97 cannot auto approve production even if intake fields are all complete',()=>{
 const r=assemble({intake:filled()});assert.equal(r.intake.intakeInformationComplete,true);
 assertR97NeverApprovesProduction(r);assert.equal(r.productionReady,false);
});
test('R97 gate check catches forged release',()=>{
 const report=assemble();assert.throws(()=>assertR97NeverApprovesProduction({...report,releaseDecision:'GO'}),/R97_FAIL_CLOSED_GATE/);
 assert.throws(()=>assertR97NeverApprovesProduction({...report,productionDeployAllowed:true}),/R97_FAIL_CLOSED_GATE/);
});
test('R97 playbook contains critical sequencing and privacy policy',()=>{
 for(const token of ['R47','R50','R51','R52','R90 JSON','Supabase','LINE','NO_GO','HOLD','バックアップ','ロールバック','GitHub'])
 assert.ok(playbook.includes(token),token);
 assert.ok(playbook.length>1600);
});
test('R97 audit imports read-only R93T report and R96 workflow guard',()=>{
 assert.match(runnerSource,/auditCar02R93TSourceContracts/);
 assert.match(runnerSource,/R93T_APPROVED_BASELINE/);
 assert.match(runnerSource,/verifyR96Workflow/);
 assert.match(runnerSource,/R97_TEMPLATE_EXPECTED_EMPTY/);
});
test('R97 modules never contain network calls or production connections',()=>{
 for(const source of [moduleSource,runnerSource]){
  assert.doesNotMatch(source,/\bfetch\s*\(|new WebSocket\s*\(|new pg\.Pool\s*\(|exec\s*\(/);
  assert.doesNotMatch(source,/wrangler\s+deploy|supabase db push|LINE_CHANNEL_ACCESS_TOKEN/);
 }
});
test('R97 workflow has exact five-step read-only manual configuration',()=>{
 assert.deepEqual(R97_STEPS.length,5);
 assert.deepEqual(verifyR97Workflow(yaml),{ok:true,steps:5,manualOnly:true,readOnly:true,releaseDecision:'NO_GO',migrationDecision:'HOLD'});
});
test('R97 workflow guard rejects unsafe triggers',()=>{
 for(const replacement of ['  push:','  pull_request:']){
  assert.throws(()=>verifyR97Workflow(yaml.replace('  workflow_dispatch:',replacement)));
 }
});
test('R97 workflow guard rejects deployment credentials or commands',()=>{
 for(const cmd of ['wrangler deploy','curl https://x.invalid','psql -h example','gh api /repos','npm install pg', '${{ secrets.WORKER_KEY }}']){
  assert.throws(()=>verifyR97Workflow(yaml+'\n      - name: extra\n        run: '+cmd));
 }
});
test('R97 workflow guard rejects missing critical verification or injected step',()=>{
 assert.throws(()=>verifyR97Workflow(yaml.replace('node car02-r97-readonly-preflight.mjs','echo skipped')));
 assert.throws(()=>verifyR97Workflow(yaml.replace('Final immutable read-only release gate','ignored')+'\n      - name: rogue'));
});
test('R97 no production interfaces exposed by the core product module',()=>{
 assert.doesNotMatch(moduleSource,/export\s+(?:async\s+)?function\s+(?:deploy|migrate|activate|sendLine)/i);
 assert.equal(R97_PRODUCTION_BLOCKERS.length,8);
});
