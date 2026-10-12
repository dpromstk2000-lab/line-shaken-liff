import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {R107_BLOCKERS,R107_RELEASE,R107_REFERENCES,immutablePath,verifyR107PathOwnership,
  createR107DisposableNamespace,modelR107HeadDeleteRace,assessR107Candidate,auditR107Sources}
  from './car02-r107-storage-compatibility-gate.mjs';
import {verifyR107Workflow} from './car02-r107-workflow-guard.mjs';
const ORDER='22222222-2222-4222-8222-222222222222';
const REPORT='33333333-3333-4333-8333-333333333333';
const OBJECT='88888888-8888-4888-8888-000000000107';
const SHOP='street_house_kitsuki';
const HASH='a'.repeat(64);
const params={shop:SHOP,orderId:ORDER,reportId:REPORT,objectId:OBJECT,mime:'image/jpeg'};
const p=immutablePath(params);
const read=path=>readFileSync(path,'utf8');
const r47Fixture=("const deleteObject=async(path)=>{ /* synthetic review fixture */ }; await deleteObject(path); 'x-upsert':'false' ").padEnd(180,' ');
const r52Fixture=("const CAR02_RELEASE_LOCK=true; /* synthetic review fixture */ ").padEnd(180,' ');
const source=()=>({r47:r47Fixture,r52:r52Fixture,
 r106:read('car02-r106-versioned-object-delete-isolated.mjs'),
 decisionText:read('CAR02_R107_STORAGE_COMPATIBILITY_DECISION.txt')});
const attestation=()=>Object.fromEntries(['privateBucketVerified','serverAssignedUnpredictableObjectKey','createOnlyNoUpsert',
 'noOverwriteForEveryWriter','restrictedDeleteIdentity','tenantBoundDeletion','durableNonreuseTombstone',
 'stagingRecoveryTestPassed'].map(k=>[k,true]));

test('R107 release and migration remain locked',()=>{
 assert.equal(R107_RELEASE.productionReady,false);assert.equal(R107_RELEASE.storageDeleteAuthorized,false);
 assert.equal(R107_RELEASE.releaseDecision,'NO_GO');assert.equal(R107_RELEASE.migrationDecision,'HOLD');
});
test('canonical server-defined object path',()=>assert.equal(p,`${SHOP}/${ORDER}/${REPORT}/${OBJECT}.jpg`));
test('invalid tenant, IDs and MIME are rejected',()=>{
 for(const changed of [{shop:'OTHER'},{orderId:'not-an-id'},{reportId:''},{objectId:'../x'},
  {mime:'image/svg+xml'}])assert.throws(()=>immutablePath({...params,...changed}),/R107_PATH_INVALID/);
});
test('private bucket, exact path and hash are bound to trusted server scope',()=>{
 assert.equal(verifyR107PathOwnership({...params,path:p,sha256:HASH,bucket:'ksh-car02-private-photos'}),true);
 for(const changed of [{bucket:'public'},{path:p+'?token=x'},{sha256:'b'}])
  assert.throws(()=>verifyR107PathOwnership({...params,path:p,sha256:HASH,bucket:'ksh-car02-private-photos',...changed}));
});
test('test-only namespace is create-once; duplicate create never replaces content',()=>{
 const ns=createR107DisposableNamespace();assert.equal(ns.testOnly,true);
 ns.createOnly(p,HASH);assert.equal(ns.read(p),HASH);
 assert.throws(()=>ns.createOnly(p,'b'.repeat(64)),/R107_PATH_REUSE_DENIED/);
 assert.equal(ns.read(p),HASH);
});
test('deleted objects remain tombstoned; path cannot be resurrected',()=>{
 const ns=createR107DisposableNamespace();ns.createOnly(p,HASH);ns.remove(p);
 assert.equal(ns.read(p),null);assert.equal(ns.hasEverExisted(p),true);
 assert.throws(()=>ns.createOnly(p,HASH),/R107_PATH_REUSE_DENIED/);
});
test('test-only namespace disallows unknown removal and invalid bytes',()=>{
 const ns=createR107DisposableNamespace();assert.throws(()=>ns.remove(p),/R107_UNKNOWN_PATH/);
 assert.throws(()=>ns.createOnly(p,'notsha'),/R107_BAD_OBJECT/);
});
test('HEAD then path DELETE can delete a newly replaced object (unsafe)',()=>{
 const race=modelR107HeadDeleteRace();assert.equal(race.unsafe,true);
 assert.equal(race.replacementRemoved,true);assert.equal(race.readBefore,'sha-old');
});
test('missing attestation leaves capability assessment BLOCKED',()=>{
 const claims=attestation();claims.noOverwriteForEveryWriter=false;
 const report=assessR107Candidate(claims);assert.equal(report.candidateStatus,'BLOCKED');
 assert.deepEqual(report.pending,['noOverwriteForEveryWriter']);assert.equal(report.approvedForProduction,false);
});
test('all self-asserted attestation booleans still never approve real production',()=>{
 const report=assessR107Candidate(attestation());
 assert.equal(report.candidateStatus,'REQUIRES_INDEPENDENT_STAGING_PROOF');
 assert.equal(report.claimsComplete,true);assert.equal(report.storageDeleteAuthorized,false);
 assert.equal(report.releaseDecision,'NO_GO');
});
test('malformed attestation cannot be accepted',()=>{
 for(const changed of [{privateBucketVerified:'yes'},{unknown:true},{privateBucketVerified:null}])
  assert.throws(()=>assessR107Candidate({...attestation(),...changed}),/R107_ATTESTATION_SCHEMA_INVALID/);
});
test('R47 direct delete risk detected and immutability baseline reported',()=>{
 const report=auditR107Sources(source());
 assert.equal(report.sourceBaselineVerified,true);assert.equal(report.openGates.length,6);
 assert.equal(report.storageDeleteAuthorized,false);
 assert.equal(report.releaseDecision,'NO_GO');assert.ok(report.hashes.R47.length===64);
});
test('changing existing source risk without reviewed update fails audit',()=>{
 const s=source();s.r47=s.r47.replace('const deleteObject=async(path)=>','const oldDelete=async(path)=>');
 assert.throws(()=>auditR107Sources(s),/R107_R47_ISSUE_CHANGED/);
});
test('attempting to turn off R52 release lock fails audit',()=>{
 const s=source();s.r52=s.r52.replace('const CAR02_RELEASE_LOCK=true;','const CAR02_RELEASE_LOCK=false;');
 assert.throws(()=>auditR107Sources(s),/R107_RELEASE_UNLOCKED/);
});
test('R106 isolated capability cannot be silently relabeled as production',()=>{
 const s=source();s.r106=s.r106.replace('realStorageCapabilityVerified:false','realStorageCapabilityVerified:true');
 assert.throws(()=>auditR107Sources(s),/R107_R106_SCOPE_CHANGED/);
});
test('decision text includes all provider documentation and six mandatory open gates',()=>{
 const doc=source().decisionText;
 assert.equal(R107_BLOCKERS.length,6);assert.ok(R107_REFERENCES.every(x=>doc.includes(x)));
 assert.ok(R107_BLOCKERS.every(x=>doc.includes(x)));
});
test('R107 workflow manual read-only and production remains closed',()=>{
 const v=verifyR107Workflow(read('.github/workflows/car02-r107-storage-compatibility-audit.yml'));
 assert.equal(v.manualOnly,true);assert.equal(v.readOnly,true);assert.equal(v.liveProviderVerified,false);
});
test('workflow cannot switch on deploy, secrets or automated triggering',()=>{
 const y=read('.github/workflows/car02-r107-storage-compatibility-audit.yml');
 for(const edited of [y.replace('workflow_dispatch:','push:'),y.replace('contents: read','contents: write'),
  y+'\n# ${{ secrets.SERVICE_ROLE_KEY }}',y+'\n# wrangler deploy',y.replace('      - name: Assert release remains NO_GO migration HOLD','      - name: Hidden unreviewed step\n      - name: Assert release remains NO_GO migration HOLD')])
  assert.throws(()=>verifyR107Workflow(edited));
});
