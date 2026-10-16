import test from 'node:test';
import assert from 'node:assert/strict';
import {V26_MODE,V26_SOURCE_FILES,V26_LIVE_GAPS,auditCar02V26ReleaseReadiness as audit} from './car02-v26-release-readiness-audit-isolated.mjs';
const examples=()=>({
 'dashboard.html':`const WORKER_API_BASE = CONTROL_ADAPTER_BASE + '/wangan'; /* existing legacy UI */ `,
 'owner-ipad.html':`const WORKER_API_BASE = CONTROL_ADAPTER_BASE + '/ksh'; /* existing legacy UI */ `,
 'index.html':`const WORKER_API_BASE = CONTROL_ADAPTER_BASE + '/ksh'; /* existing legacy UI */ `,
 'member.html':`const WORKER_API_BASE = CONTROL_ADAPTER_BASE + '/ksh'; /* existing legacy UI */ `,
 'car02-edge-entry-r52.ts':`const CAR02_RELEASE_LOCK=true; if(CAR02_RELEASE_LOCK)throw Error('CAR02_NOT_RELEASED');`.repeat(2),
 'car02-identity-r44.mjs':`function createCar02Authenticator(){verifyStaffJwt();verifyLineIdToken();resolveStaffAccess()}function createCar02ReleaseGate(){}`.repeat(2),
 'car02-runtime-r45.mjs':`// QA ONLY; Not a Cloudflare Worker bundle; createCar02ReleaseGate`.repeat(2),
 'car02-v25-concurrent-qa-claim-isolated.mjs':`realOrderWrite:false, public.car02_v25_qa_claims, safeToCreateRealOrder:false`.repeat(2),
 'BASELINE_QA_ONLY.sql':`CREATE TABLE public.ksh_demo_reservations(id uuid PRIMARY KEY,shop_code text NOT NULL,customer_id uuid,vehicle_id uuid);`.repeat(2),
 'R13_MIGRATION_QA_ONLY.sql':`-- HOLD / NOT EXECUTED / DO NOT RUN WITHOUT VERIFIED RECOVERABLE BACKUP`.repeat(2)
});
const good=()=>audit(examples());
const mismatch=(path,replace)=>{let x=examples();x[path]=replace(x[path]);return()=>audit(x)};
const rejected=(fn,fragment)=>assert.throws(fn,e=>e.code?.includes(fragment),fragment);
test('V2.6 remains read-only and NO_GO',()=>{assert.equal(V26_MODE.productionReady,false);assert.equal(V26_MODE.sendable,false);assert.equal(V26_MODE.migration,'HOLD')});
test('required source allowlist has no secret files',()=>{assert.equal(V26_SOURCE_FILES.length,10);assert.ok(!V26_SOURCE_FILES.some(x=>/pass|secret|\.env|key/i.test(x)))});
test('all static contracts pass but release remains blocked',()=>{const r=good();assert.equal(r.staticChecksPassed,10);assert.equal(r.blockerCount,8);assert.equal(r.releaseReady,false)});
test('never claims to have inspected live resources',()=>{let r=good();assert.equal(r.realServicesChecked,false);assert.equal(r.liveTenantIdentityMappingVerified,false)});
test('blocker ids are stable and explicit',()=>{assert.equal(V26_LIVE_GAPS.length,8);assert.deepEqual(good().blockers.map(x=>x.id),V26_LIVE_GAPS)});
test('reports and arrays are frozen',()=>{const r=good();assert.ok(Object.isFrozen(r));assert.ok(Object.isFrozen(r.blockers));assert.ok(Object.isFrozen(r.checks));assert.ok(Object.isFrozen(r.blockers[0]))});
test('safe report has no source strings',()=>{const r=JSON.stringify(good());for(const marker of ['CONTROL_ADAPTER_BASE','CREATE TABLE','verifyStaffJwt()'])assert.ok(!r.includes(marker))});
test('null source fails closed',()=>rejected(()=>audit(null),'SOURCES_REQUIRED'));
test('array source fails closed',()=>rejected(()=>audit([]),'SOURCES_REQUIRED'));
test('missing dashboard fails closed',()=>{let x=examples();delete x['dashboard.html'];rejected(()=>audit(x),'SOURCE_MISSING')});
test('missing R13 sql fails closed',()=>{let x=examples();delete x['R13_MIGRATION_QA_ONLY.sql'];rejected(()=>audit(x),'SOURCE_MISSING')});
test('missing V25 source fails closed',()=>{let x=examples();delete x['car02-v25-concurrent-qa-claim-isolated.mjs'];rejected(()=>audit(x),'SOURCE_MISSING')});
test('owner tenant path drift fails closed',()=>rejected(mismatch('dashboard.html',x=>x.replaceAll('/wangan','/ksh')),'LEGACY_BRANCH_DRIFT'));
test('ipad tenant path drift fails closed',()=>rejected(mismatch('owner-ipad.html',x=>x.replaceAll('/ksh','/wangan')),'LEGACY_BRANCH_DRIFT'));
test('booking tenant path drift fails closed',()=>rejected(mismatch('index.html',x=>x.replaceAll('/ksh','/wangan')),'LEGACY_BRANCH_DRIFT'));
test('member tenant path drift fails closed',()=>rejected(mismatch('member.html',x=>x.replaceAll('/ksh','/wangan')),'LEGACY_BRANCH_DRIFT'));
test('second branch declaration denied',()=>rejected(mismatch('dashboard.html',x=>x+` const WORKER_API_BASE = CONTROL_ADAPTER_BASE + '/ksh';`),'LEGACY_BRANCH_DRIFT'));
test('R52 source lock release denied',()=>rejected(mismatch('car02-edge-entry-r52.ts',x=>x.replaceAll('RELEASE_LOCK=true','RELEASE_LOCK=false')),'STATIC_CONTRACT_DRIFT'));
test('R52 fail-close thrown gate required',()=>rejected(mismatch('car02-edge-entry-r52.ts',x=>x.replaceAll('CAR02_NOT_RELEASED','RELEASED')),'STATIC_CONTRACT_DRIFT'));
test('R44 staff verification callback must remain',()=>rejected(mismatch('car02-identity-r44.mjs',x=>x.replaceAll('verifyStaffJwt','verifyAnything')),'STATIC_CONTRACT_DRIFT'));
test('R44 LINE verification callback must remain',()=>rejected(mismatch('car02-identity-r44.mjs',x=>x.replaceAll('verifyLineIdToken','verifyAnything')),'STATIC_CONTRACT_DRIFT'));
test('R44 access lookup callback must remain',()=>rejected(mismatch('car02-identity-r44.mjs',x=>x.replaceAll('resolveStaffAccess','fakeStaff')),'STATIC_CONTRACT_DRIFT'));
test('R45 runtime must remain QA only',()=>rejected(mismatch('car02-runtime-r45.mjs',x=>x.replaceAll('QA ONLY','PRODUCTION READY')),'STATIC_CONTRACT_DRIFT'));
test('R45 runtime must not be represented as Worker bundle',()=>rejected(mismatch('car02-runtime-r45.mjs',x=>x.replaceAll('Not a Cloudflare Worker bundle','Cloudflare deployed')),'STATIC_CONTRACT_DRIFT'));
test('V25 cannot claim real write',()=>rejected(mismatch('car02-v25-concurrent-qa-claim-isolated.mjs',x=>x.replaceAll('realOrderWrite:false','realOrderWrite:true')),'STATIC_CONTRACT_DRIFT'));
test('V25 claim fixture marker required',()=>rejected(mismatch('car02-v25-concurrent-qa-claim-isolated.mjs',x=>x.replaceAll('car02_v25_qa_claims','car02_live_claims')),'STATIC_CONTRACT_DRIFT'));
test('R13 migration HOLD marker required',()=>rejected(mismatch('R13_MIGRATION_QA_ONLY.sql',x=>x.replaceAll('HOLD / NOT EXECUTED','DEPLOYED')),'STATIC_CONTRACT_DRIFT'));
test('R13 requires backup marker',()=>rejected(mismatch('R13_MIGRATION_QA_ONLY.sql',x=>x.replaceAll('VERIFIED RECOVERABLE BACKUP','NO BACKUP')),'STATIC_CONTRACT_DRIFT'));
test('baseline status column drift requires review',()=>rejected(mismatch('BASELINE_QA_ONLY.sql',x=>x.replaceAll('vehicle_id uuid','status text,vehicle_id uuid')),'STATIC_CONTRACT_DRIFT'));
test('baseline version column drift requires review',()=>rejected(mismatch('BASELINE_QA_ONLY.sql',x=>x.replaceAll('vehicle_id uuid','version integer,vehicle_id uuid')),'STATIC_CONTRACT_DRIFT'));
test('baseline SQL missing required reservation table rejected',()=>rejected(mismatch('BASELINE_QA_ONLY.sql',x=>x.replaceAll('ksh_demo_reservations','another_table')),'STATIC_CONTRACT_DRIFT'));
test('invalid source type rejected',()=>{let x=examples();x['index.html']={foo:'bar'};rejected(()=>audit(x),'SOURCE_MISSING')});
