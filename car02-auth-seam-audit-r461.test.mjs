import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CAR02_V461_RELEASE_LOCK,CAR02_V461_REQUIRED_FILES,gitBlobR461,
 inspectR46StaffVerifierShapeR461,auditCar02ActualAuthSeamR461} from './car02-auth-seam-audit-r461.mjs';
const read=(n)=>readFileSync(new URL('./'+n,import.meta.url),'utf8');
const inventory=JSON.parse(read('car02-v461-staging-auth-gap-checklist.json'));
const filenames=Object.keys(CAR02_V461_REQUIRED_FILES);
const fakeSet=()=>Object.fromEntries(filenames.map(k=>[k,'fake']));
const check=(x)=>{assert.equal(x.status,'no_go');assert.equal(x.releasePermitted,false);assert.equal(x.providerSessionProven,false);return x;};
test('V461 hard release lock and four fixed actual GitHub source blob pins',()=>{
 assert.equal(CAR02_V461_RELEASE_LOCK,true);assert.equal(filenames.length,4);
 assert.equal(CAR02_V461_REQUIRED_FILES['car02-edge-entry-r52.ts'],'f0e31fb9f9d98524519d01dffd3489893d3d3302');
 assert.equal(Object.isFrozen(CAR02_V461_REQUIRED_FILES),true);
});
test('Git blob implementation matches checked out real R52',()=>{
 assert.equal(gitBlobR461(read('car02-edge-entry-r52.ts')),CAR02_V461_REQUIRED_FILES['car02-edge-entry-r52.ts']);
});
test('Git blob hash rejects wrong inputs',()=>{
 assert.throws(()=>gitBlobR461(null),/TEXT_REQUIRED/);
 assert.notEqual(gitBlobR461('fake'),CAR02_V461_REQUIRED_FILES['car02-edge-entry-r52.ts']);
});
test('R46 verifier shape detects user fetch and absence of sessionId',()=>{
 const fake=`export function createSupabaseStaffTokenVerifierR46() { const fetchImpl=()=>null;
 const accessToken='x'; fetchImpl(issuer+'/user',{headers:{Authorization:'Bearer '+accessToken}});
 return {verified:true,sub:user.id,exp:claims.exp}; }
 export function createLineCustomerResolverR46(){}
 export function createDbStaffMembershipLookupR46(){}`;
 const r=inspectR46StaffVerifierShapeR461(fake);
 assert.deepEqual(r,{authUserGet:true,returnsSessionId:false,staffMembershipLookup:true});
});
test('R46 shape alone cannot prove provider session',()=>{
 const sample='export function createSupabaseStaffTokenVerifierR46(){} export function createLineCustomerResolverR46(){}';
 assert.equal(inspectR46StaffVerifierShapeR461(sample).authUserGet,false);
 assert.equal(inspectR46StaffVerifierShapeR461(sample).returnsSessionId,false);
});
test('No source set is never a release success',()=>check(auditCar02ActualAuthSeamR461()));
test('No partial source set can satisfy the pinned review inputs',()=>{
 const a=check(auditCar02ActualAuthSeamR461({sources:{'car02-edge-entry-r52.ts':read('car02-edge-entry-r52.ts')},inventory}));
 assert.equal(a.reason,'exact_source_set_required');
});
test('A local R52 stub is refused as real GitHub source',()=>{
 const a=check(auditCar02ActualAuthSeamR461({sources:{...fakeSet(), 'car02-edge-entry-r52.ts':'const CAR02_RELEASE_LOCK=true;'},inventory}));
 assert.equal(a.reason,'real_source_drift_or_stub');
});
test('Wrong or truncated Supabase provider source cannot match pinned source',()=>{
 const s=fakeSet();s['car02-auth-providers-r46.mjs']='// fake token';
 assert.equal(check(auditCar02ActualAuthSeamR461({sources:s,inventory})).reason,'real_source_drift_or_stub');
});
test('Unexpected source file cannot pass source-set check',()=>{
 const s={...fakeSet(),unexpected:'fake'};
 assert.equal(check(auditCar02ActualAuthSeamR461({sources:s,inventory})).reason,'exact_source_set_required');
});
test('User-provided claims cannot unlock the audit',()=>{
 const r=check(auditCar02ActualAuthSeamR461({sources:{...fakeSet(),claims:{verified:true,sessionId:'fake'}},inventory}));
 assert.equal(r.reason,'exact_source_set_required');
});
test('Review manifest has seven ordered explicit unverified external acceptance items',()=>{
 assert.equal(inventory.schemaVersion,461);assert.equal(inventory.stagingProbeOrder.length,7);
 assert.equal(new Set(inventory.stagingProbeOrder.map(x=>x.control)).size,7);
 assert.ok(inventory.stagingProbeOrder.every(x=>x.evidenceState==='unverified'&&x.humanAcceptance.length>=50));
});
test('Review manifest is not an external Supabase evidence record',()=>{
 assert.equal(inventory.releaseDecision,'NO_GO');assert.equal(inventory.evidenceStatus,'UNVERIFIED');
 assert.match(inventory.sourceFinding,/without independently verified provider session/);
});
test('No credentials or test tokens are present in the gap checklist',()=>{
 const s=JSON.stringify(inventory);
 for(const needle of ['service_role_key','Bearer eyJ','-----BEGIN PRIVATE KEY-----'])assert.equal(s.includes(needle),false);
});
test('A safe path requires provider session metadata AND postcommit fence verification',()=>{
 const a=inventory.stagingProbeOrder.map(x=>x.control);
 assert.ok(a.includes('actual_supabase_auth_sessions'));assert.ok(a.includes('postcommit_auth_generation_fence'));
});
test('A role-scoped user lookup is distinct from provider session row verification',()=>{
 const sample="export function createSupabaseStaffTokenVerifierR46() { fetchImpl(issuer+'/user',{headers:{Authorization:'Bearer '+accessToken}}); return {verified:true,sub:user.id,exp:claims.exp}; } export function createLineCustomerResolverR46(){}";
 const shape=inspectR46StaffVerifierShapeR461(sample);
 assert.equal(shape.authUserGet,true);assert.equal(shape.returnsSessionId,false);
});
test('R52 source is still locked and not wired to new gap audit',()=>{
 const s=read('car02-edge-entry-r52.ts');assert.match(s,/const CAR02_RELEASE_LOCK=true;/);
 assert.match(s,/if\(CAR02_RELEASE_LOCK\)throw Error\('CAR02_NOT_RELEASED'\)/);
 assert.doesNotMatch(s,/auth-seam-audit-r461/);
});
test('Original V460 remains fail-closed',async()=>{
 const {CAR02_V460_RELEASE_LOCK,inspectCar02SourceProvenanceR460}=await import('./car02-source-provenance-r460.mjs');
 assert.equal(CAR02_V460_RELEASE_LOCK,true);
 assert.equal(inspectCar02SourceProvenanceR460().releasePermitted,false);
});
