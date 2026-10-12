import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {R103_CONTRACT,assertR103Env,assertR103SafeJob,createR103MockPrivateStorage,
 createR103IsolatedRecoveryWorker} from './car02-r103-recovery-worker-isolated.mjs';
import {verifyR103Workflow} from './car02-r103-workflow-guard.mjs';
const sql=readFileSync('R103_PG17_CLEANUP_RECEIPTS_FIXTURE_QA_ONLY.sql','utf8');
const impl=readFileSync('car02-r103-recovery-worker-isolated.mjs','utf8');
const driver=readFileSync('car02-r103-pg17-recovery-qa.mjs','utf8');
const workflow=readFileSync('.github/workflows/car02-r103-disposable-cleanup-recovery-qa.yml','utf8');
const env={R103_DISPOSABLE_RECOVERY_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGPASSWORD:'disposable-r93s-ci-only',PGDATABASE:'car02_r93q_qa_ci'};
const shop='street_house_kitsuki';
const path=shop+'/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/88888888-8888-4888-8888-000000000001.jpg';
const job={job_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',shop_code:shop,photo_shop:shop,intent_shop:shop,
 photo_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',intent_photo_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 storage_path:path,photo_path:path,intent_path:path,upload_state:'deleted',state:'queued'};
test('R103 exact disposable environment',()=>{
 assertR103Env(env);
 for(const key of Object.keys(env))assert.throws(()=>assertR103Env({...env,[key]:'wrong'}));
});
test('R103 cannot authorize production',()=>{
 assert.equal(R103_CONTRACT.productionReady,false);
 assert.equal(R103_CONTRACT.liveStorageDeleteAllowed,false);
 assert.equal(R103_CONTRACT.releaseDecision,'NO_GO');assert.equal(R103_CONTRACT.migrationDecision,'HOLD');
});
test('R103 requires exactly matching tombstone, outbox, intent and path',()=>assert.equal(assertR103SafeJob(job,shop),true));
for(const [name,change] of Object.entries({foreignJob:{shop_code:'other_shop'},foreignPhoto:{photo_shop:'other_shop'},
 foreignIntent:{intent_shop:'other_shop'},ready:{upload_state:'ready'},wrongPhotoPath:{photo_path:'tampered'},
 wrongIntentPath:{intent_path:'tampered'},wrongPhotoId:{intent_photo_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},
 unsafePath:{storage_path:'../../x'},wrongJobState:{state:'done'}}))
 test('R103 rejects '+name,()=>assert.throws(()=>assertR103SafeJob({...job,...change},shop)));
test('R103 fake Storage deletion is bounded, in process and private',async()=>{
 const storage=createR103MockPrivateStorage({objects:[path]});
 assert.equal((await storage.verifyPrivateBucket({bucket:'ksh-car02-private-photos'})).public,false);
 await assert.rejects(()=>storage.deleteObject({bucket:'public',path}));
 assert.equal(storage.has(path),true);
 assert.deepEqual(await storage.deleteObject({bucket:'ksh-car02-private-photos',path}),{deleted:true,definitivelyMissing:false});
 assert.deepEqual(await storage.deleteObject({bucket:'ksh-car02-private-photos',path}),{deleted:false,definitivelyMissing:true});
});
test('R103 fake transient failure retains object and supports retry',async()=>{
 const storage=createR103MockPrivateStorage({objects:[path],failPaths:[path]});
 await assert.rejects(()=>storage.deleteObject({bucket:'ksh-car02-private-photos',path}));
 assert.equal(storage.has(path),true);
 assert.equal((await storage.deleteObject({bucket:'ksh-car02-private-photos',path})).deleted,true);
});
test('R103 rejects untrusted injected production-like ports',()=>{
 assert.throws(()=>createR103IsolatedRecoveryWorker());
 const pool={connect:async()=>{},query:async()=>{}};
 assert.throws(()=>createR103IsolatedRecoveryWorker({environment:'isolated_qa',dbName:'postgres',pool,shopCode:shop,
  storage:{kind:'real_supabase'},reviewGate:async()=>true}));
});
test('R103 locked gate prevents DB and Storage calls',async()=>{
 let query=0,connect=0;const storage=createR103MockPrivateStorage({objects:[path]});
 const worker=createR103IsolatedRecoveryWorker({environment:'isolated_qa',dbName:env.PGDATABASE,shopCode:shop,storage,
  reviewGate:async()=>false,pool:{query:async()=>{query++},connect:async()=>{connect++}}});
 await assert.rejects(()=>worker.run(job.job_id),/R103_REVIEW_GATE_CLOSED/);
 assert.equal(query,0);assert.equal(connect,0);assert.equal(storage.deletes,0);
});
test('R103 uses only immutable durable data for deletion eligibility',()=>{
 for(const phrase of ['FOR UPDATE OF j SKIP LOCKED','upload_state','intent_path','photo_path',
  "state='done'","state='retry'","lease_token",'attempts<5','R103_LOST_LEASE_FAIL_CLOSED'])assert.ok(impl.includes(phrase),phrase);
});
test('R103 SQL hard prohibits existing and non PG17 DB',()=>{
 for(const phrase of ["current_database()<>'car02_r93q_qa_ci'",'to_regclass(\'public.ksh_car02_photos\')',
  'r103_cleanup_receipts','CHECK (state IN', 'REVOKE ALL'])assert.ok(sql.includes(phrase),phrase);
});
test('R103 prohibits real deletion clients and production credentials',()=>{
 assert.doesNotMatch(impl,/SUPABASE_SERVICE_ROLE_KEY|CAR02_DATABASE_URL|Deno\.env|\bfetch\s*\(|wrangler/i);
 assert.doesNotMatch(driver,/supabase\.co|wrangler|Deno\.env/);
 assert.match(driver,/R103_CRASH_AFTER_DELETE_IDEMPOTENT_RECOVERY_PASS/);
});
test('R103 cleanup workflow is protected',()=>{
 const a=verifyR103Workflow(workflow);assert.equal(a.releaseDecision,'NO_GO');assert.equal(a.migrationDecision,'HOLD');
});
test('R103 denies workflow changes to deploy, push, secrets or nonPG17',()=>{
 for(const bad of [workflow.replace('workflow_dispatch:','push:'),workflow.replace('contents: read','contents: write'),
 workflow.replace('image: postgres:17','image: postgres:16'),workflow+'\n# ${{ secrets.SERVICE_ROLE }}',
 workflow+'\n# wrangler deploy',workflow+'\n      - name: attacker'])assert.throws(()=>verifyR103Workflow(bad));
});
