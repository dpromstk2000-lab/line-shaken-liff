import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateR93BGates,renderR93BTxt,R93B_VERSION} from './car02-r93b-gate-evaluator.mjs';
const GOOD=JSON.parse(readFileSync(new URL('./R93B_SOURCE_EVIDENCE.json',import.meta.url),'utf8'));
const clone=()=>structuredClone(GOOD);
const reject=(patch,code)=>{const e=clone();patch(e);assert.throws(()=>evaluateR93BGates(e),{code});};
test('version is review-only',()=>assert.match(R93B_VERSION,/EVIDENCE-ONLY/));
test('canonical reviewed evidence returns blockers and NEVER GO',()=>{
 const r=evaluateR93BGates(clone());assert.equal(r.gateCount,8);assert.equal(r.blockedCount,8);
 assert.equal(r.releaseDecision,'NO_GO');assert.equal(r.migrationDecision,'HOLD');assert.equal(r.productionReady,false);
 assert.equal(r.sourceFilesReviewed,13);assert.equal(r.pagesReadiness,'STATIC_PAGES_VERIFIED');
 assert.deepEqual(r.blockedGates.map(g=>g.state),Array(8).fill('BLOCKED'));
});
test('report text contains action owners and lock',()=>{
 const r=renderR93BTxt(evaluateR93BGates(clone()));assert.match(r,/NO_GO/);assert.match(r,/HOLD/);
 assert.match(r,/COMPANY_PC_HUMAN_QA/);assert.match(r,/PRODUCTION_BACKUP_RESTORE/);
 assert.match(r,/NO_GO \/ 移行/);assert.doesNotMatch(r,/releaseDecision:\s*GO\b/);
});
for(const [name,alter] of [
 ['schema',o=>o.schema='unknown'],['wrong Pages',o=>o.pagesReadiness='FAILED'],
 ['failed test',o=>o.testFail=1],['false unit count',o=>o.testPass=41],
 ['wrong run',o=>o.runId=38112804869],['wrong commit',o=>o.gitHead='f'.repeat(40)],
 ['backup falsely complete',o=>o.baseline.liveBackupCompleted=true],
 ['restore falsely complete',o=>o.baseline.separateRestoreVerified=true],
 ['CAR02 tables unexpectedly exist',o=>o.baseline.car02Tables=1],
 ['storage bucket changed',o=>o.baseline.car02PhotoBuckets=1],
 ['release decision forged',o=>o.baseline.releaseDecision='GO'],
 ['migration decision forged',o=>o.baseline.migrationDecision='DONE'],
 ['release lock removed',o=>o.verified.releaseLockEnabled=false],
 ['R85 production wired',o=>o.verified.staffHttpNotProductionWired=false],
 ['R84 production wired',o=>o.verified.photoQaNotProductionWired=false],
 ['R81 not QA only',o=>o.verified.ownerBootstrapQaOnly=false],
 ['storage not fake',o=>o.verified.photoStorageSimulated=false],
 ['DB not disposable',o=>o.verified.photoDbDisposable=false],
 ['unknown source',o=>o.sourceHashEvidence['unexpected.mjs']='f'.repeat(40)],
 ['tampered R52 hash',o=>o.sourceHashEvidence['car02-edge-entry-r52.ts']='e'.repeat(40)],
 ['removed source',o=>delete o.sourceHashEvidence['car02-unified-runtime-r50.mjs']],
 ['extra baseline key',o=>o.baseline.productionReady=true],
 ['extra verified key',o=>o.verified.productionReady=true],
 ['extra root key',o=>o.productionReady=true],
 ])test('R93B rejects evidence drift: '+name,()=>{
 const e=clone();alter(e);assert.throws(()=>evaluateR93BGates(e),/R93B_/);
 });
for(const invalid of [null,[],{},'GO'])test('R93B invalid evidence always fails',()=>assert.throws(()=>evaluateR93BGates(invalid),/R93B_/));
for(const x of [null,{}, {schema:'DPRO_CAR02_R93B_RELEASE_GAPS',releaseDecision:'GO',migrationDecision:'HOLD',productionReady:true,blockedCount:8}])
 test('R93B refuses misleading output',()=>assert.throws(()=>renderR93BTxt(x),/R93B_/));
