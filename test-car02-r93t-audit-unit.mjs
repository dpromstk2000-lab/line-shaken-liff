import test from 'node:test';
import assert from 'node:assert/strict';
import {auditCar02R93TSourceContracts as audit,R93T_CONTRACT} from './car02-r93t-release-readiness-audit.mjs';
const SAMPLE={
 'car02-private-photo-r47.mjs':"function deleteObject(path){};async function upload(){await deleteObject(path)};".padEnd(70,' '),
 'car02-unified-runtime-r50.mjs':"export function createR50(){return request => photoViewer(request)};".padEnd(75,' '),
 'car02-edge-boundary-r51.mjs':"const MAX_BODY=32768;const PHOTO_PATH=/photos/;function relativePath(){};".padEnd(75,' '),
 'car02-edge-entry-r52.ts':"const CAR02_RELEASE_LOCK=true;const e={isServerReleased:()=>!CAR02_RELEASE_LOCK};".padEnd(90,' '),
 'car02-private-photo-upload-http-r82.mjs':"const MAX_BYTES=5*1024*1024;export function createR82(){return 1};".padEnd(75,' '),
 'car02-r93q-single-schema-lifecycle-isolated.mjs':"const receipts=new Map();export function createR93Q(){return null};".padEnd(75,' '),
 'car02-r93s-durable-upload-intent-isolated.mjs':"const QA_DB='car02_r93q_qa_ci';if(environment!=='isolated_qa')throw Error();".padEnd(90,' ')
};
test('baseline fail closed: no new release authorization',()=>{
 const v=audit(SAMPLE);
 assert.equal(v.releaseDecision,'NO_GO');assert.equal(v.migrationDecision,'HOLD');
 assert.equal(v.productionMutations,false);assert.equal(v.integrationReady,false);
 assert.equal(v.openCount,6);assert.equal(v.unsafeCount,0);
 assert.equal(v.checks[0].state,'LOCKED');assert.equal(v.checks.at(-1).state,'ISOLATED_PASS');
});
test('removing R52 hard lock triggers an unsafe gate',()=>{
 const f={...SAMPLE,'car02-edge-entry-r52.ts':SAMPLE['car02-edge-entry-r52.ts'].replace('=true','=false')};
 assert.deepEqual(audit(f).unsafeGates,['R52_HARD_RELEASE_LOCK']);
});
test('cannot silently omit a source file',()=>{
 const c={...SAMPLE};delete c['car02-private-photo-r47.mjs'];
 assert.throws(()=>audit(c),/R93T_MISSING_OR_SHORT_SOURCE_r47/);
});
test('route cap mismatch and URL omission are explicitly shown',()=>{
 const result=audit(SAMPLE);const byId=Object.fromEntries(result.checks.map(x=>[x.id,x]));
 assert.equal(byId.R51_BODY_CAP_CONFLICT.state,'OPEN');
 assert.equal(byId.R51_UPLOAD_ROUTE.state,'OPEN');
 assert.equal(byId.R50_UPLOAD_COMPOSITION.state,'OPEN');
});
test('R82 and R93S are not assumed connected',()=>{
 const v=audit(SAMPLE);assert.ok(v.openGates.includes('R82_DURABLE_INTENT_KEY'));
 assert.ok(!v.openGates.includes('R93S_ONLY_DISPOSABLE_QA'));
});
test('fix wording does not itself change productionReady',()=>{
 const x={...SAMPLE,'car02-unified-runtime-r50.mjs':SAMPLE['car02-unified-runtime-r50.mjs']+'\n// /api/car02/uploads/ TODO'};
 const v=audit(x);assert.equal(v.integrationReady,false);assert.equal(v.releaseDecision,'NO_GO');
 assert.equal(v.checks.find(g=>g.id==='R50_UPLOAD_COMPOSITION').state,'REVIEW_REQUIRED');
});
test('contract forbids production write and deployment',()=>{
 assert.equal(R93T_CONTRACT.deployAuthorized,false);
 assert.equal(R93T_CONTRACT.databaseWriteAuthorized,false);
});
