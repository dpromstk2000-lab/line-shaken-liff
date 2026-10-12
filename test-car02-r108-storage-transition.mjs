import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {R108_CONTRACT,createR108OfflineQuarantine,assessR108StagingEvidence,auditR108Baseline}
 from './car02-r108-storage-transition-isolated.mjs';
import {verifyR108Workflow} from './car02-r108-workflow-guard.mjs';
const read=f=>readFileSync(f,'utf8');
const template=()=>JSON.parse(read('CAR02_R108_STAGING_PROOF_TEMPLATE.json'));
const root={shop:'street_house_kitsuki',jobId:'11111111-1111-4111-8111-111111111111',
 photoId:'22222222-2222-4222-8222-222222222222',
 path:'street_house_kitsuki/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444/55555555-5555-4555-8555-555555555555.jpg',
 sha256:'a'.repeat(64)};
const work=()=>createR108OfflineQuarantine({environment:'isolated_qa',dbName:'car02_r93q_qa_ci',releaseState:'HARD_LOCKED'});
const baseline=()=>({r47:("const deleteObject=async(path)=>{}; await deleteObject(path); 'x-upsert':'false'; randomUUID();").padEnd(400,' '),r52:("const CAR02_RELEASE_LOCK=true; isServerReleased:()=>!CAR02_RELEASE_LOCK").padEnd(400,' '),
 r107:read('car02-r107-storage-compatibility-gate.mjs'),plan:read('CAR02_R108_STORAGE_TRANSITION_PLAN.txt')});
test('R108 cannot grant live releases or Storage deletes',()=>{assert.equal(R108_CONTRACT.productionDeleteAuthorized,false);assert.equal(R108_CONTRACT.productionReady,false);assert.equal(R108_CONTRACT.releaseDecision,'NO_GO');assert.equal(R108_CONTRACT.migrationDecision,'HOLD')});
test('R108 requires exact disposable build identity',()=>{for(const changed of [{environment:'production'},{dbName:'postgres'},{releaseState:'RELEASED'},{storage:{delete(){}}}])assert.throws(()=>createR108OfflineQuarantine({environment:'isolated_qa',dbName:'car02_r93q_qa_ci',releaseState:'HARD_LOCKED',...changed}),/R108_DISPOSABLE_ONLY/)});
test('quarantine accepts only exact known tenant scope',()=>{const q=work();assert.equal(q.enqueue(root).status,'QUARANTINED');assert.equal(q.pendingCount,1)});
test('duplicate retry is idempotent',()=>{const q=work();q.enqueue(root);assert.deepEqual(q.enqueue({...root}),{status:'QUARANTINED',duplicate:true});assert.equal(q.pendingCount,1)});
test('job cannot be rebound to another photo',()=>{const q=work();q.enqueue(root);assert.throws(()=>q.enqueue({...root,photoId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}),/R108_JOB_REBIND_DENIED/)});
test('reused object path cannot be assigned to another job',()=>{const q=work();q.enqueue(root);assert.throws(()=>q.enqueue({...root,jobId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}),/R108_PATH_REUSE_DENIED/)});
test('tenant mismatch is rejected before queue insertion',()=>{const q=work();assert.throws(()=>q.enqueue({...root,shop:'other_shop'}),/R108_QUARANTINE_SCOPE_DENIED/);assert.equal(q.pendingCount,0)});
test('arbitrary object path is rejected',()=>{for(const path of ['../escape','street_house_kitsuki/other.jpg',root.path+'?x=y',root.path.replace('jpg','svg')])assert.throws(()=>work().enqueue({...root,path}),/R108_QUARANTINE_SCOPE_DENIED/)});
test('invalid IDs and hash are rejected',()=>{for(const changed of [{jobId:'../attack'},{photoId:'no'},{sha256:'abc'},{shop:'A'}])assert.throws(()=>work().enqueue({...root,...changed}),/R108_QUARANTINE_SCOPE_DENIED/)});
test('unexpected request arguments are refused',()=>{assert.throws(()=>work().enqueue({...root,auth:'Bearer private'}),/R108_QUARANTINE_SCOPE_DENIED/)});
test('quarantine never exposes storage delete capability',()=>{const q=work();q.enqueue(root);assert.equal(typeof q.deleteObject,'undefined');assert.equal(typeof q.fetch,'undefined');assert.throws(()=>q.authorizeDeletion(),/R108_LIVE_DELETE_NOT_AUTHORIZED/)});
test('inspect does not expose sensitive path or hash',()=>{const q=work();q.enqueue(root);let item=q.inspect(root.jobId);assert.deepEqual(item,{status:'QUARANTINED'});assert.equal(JSON.stringify(item).includes(root.path),false)});
test('unknown job inspect is not writable',()=>{const q=work();assert.deepEqual(q.inspect(root.jobId),{status:'NOT_FOUND'});assert.throws(()=>q.inspect('fake'),/R108_BAD_JOB/)});
test('R108 proof template has no evidence of live provider capabilities',()=>{const r=assessR108StagingEvidence(template());assert.equal(r.checkCount,9);assert.equal(r.pending.length,9);assert.equal(r.productionDeleteAuthorized,false);assert.equal(r.claimsComplete,false)});
test('a FAILED staging check is reported, never silently approved',()=>{const t=template();t.checks.concurrencyAndAckLossTest='FAILED';const r=assessR108StagingEvidence(t);assert.deepEqual(r.rejected,['concurrencyAndAckLossTest']);assert.equal(r.releaseDecision,'NO_GO')});
test('all self-asserted PASS labels cannot authorize deployment',()=>{const t=template();for(const k of Object.keys(t.checks))t.checks[k]='PASS_WITH_EVIDENCE';const r=assessR108StagingEvidence(t);assert.equal(r.claimsComplete,true);assert.equal(r.productionDeleteAuthorized,false);assert.equal(r.next,'INDEPENDENT_REVIEW_OF_PRIVATE_EVIDENCE_REQUIRED')});
test('proof refuses copied credentials or extra metadata',()=>{for(const bad of [{secret:'abc'},{apiKey:'bad'},{url:'https://test.invalid'}])assert.throws(()=>assessR108StagingEvidence({...template(),...bad}),/R108_PROOF_SCHEMA_DENIED/)});
test('proof refuses schema, type and missing field drift',()=>{const t=template();delete t.checks.allWriterIdentitiesAudited;assert.throws(()=>assessR108StagingEvidence(t));const u=template();u.checks.separateStagingProject=true;assert.throws(()=>assessR108StagingEvidence(u))});
test('baseline report still detects R47 ambiguous immediate deletion',()=>{const v=auditR108Baseline(baseline());assert.equal(v.baselineVerified,true);assert.equal(v.knownRisk,'R47_DIRECT_DELETE_ON_AMBIGUOUS_FAILURE');assert.equal(v.openGates.length,6);assert.equal(v.productionReady,false)});
test('R47 direct delete change requires fresh review',()=>{const a=baseline();a.r47=a.r47.replace('await deleteObject(path);','void path;');assert.throws(()=>auditR108Baseline(a),/R108_R47_DIRECT_DELETE_BASELINE_CHANGED/)});
test('R52 lock change always fails',()=>{const a=baseline();a.r52=a.r52.replace('const CAR02_RELEASE_LOCK=true;','const CAR02_RELEASE_LOCK=false;');assert.throws(()=>auditR108Baseline(a),/R108_RELEASE_LOCK_DRIFT/)});
test('R107 source capability gate cannot silently disappear',()=>{const a=baseline();a.r107=a.r107.replace('ATOMIC_VERSION_CONDITIONAL_DELETE_NOT_PROVEN_ON_REAL_SUPABASE','REMOVED');assert.throws(()=>auditR108Baseline(a),/R108_R107_BASELINE_DRIFT/)});
test('R108 workflow stays manual, read only, source-only',()=>{const v=verifyR108Workflow(read('.github/workflows/car02-r108-storage-transition-audit.yml'));assert.equal(v.manualOnly,true);assert.equal(v.sourceOnly,true);assert.equal(v.releaseDecision,'NO_GO')});
test('R108 workflow rejects new hidden deploy or push trigger',()=>{const y=read('.github/workflows/car02-r108-storage-transition-audit.yml');for(const s of [y.replace('workflow_dispatch:','push:'),y.replace('contents: read','contents: write'),y+'\n# wrangler deploy',y+'\n# ${{ secrets.SUPABASE_SECRET }}',y.replace('      - name: Final immutable production lock','      - name: Hidden deploy\n      - name: Final immutable production lock')])assert.throws(()=>verifyR108Workflow(s))});
