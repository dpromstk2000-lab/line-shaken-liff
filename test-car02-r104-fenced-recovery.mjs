import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createR103MockPrivateStorage} from './car02-r103-recovery-worker-isolated.mjs';
import {R104_CONTRACT,assertR104Environment,assertR104DbIdentity,
  createR104FencedRecoveryWorker} from './car02-r104-fenced-recovery-isolated.mjs';
import {verifyR104Workflow} from './car02-r104-workflow-guard.mjs';
const DB='car02_r93q_qa_ci',SHOP='street_house_kitsuki';
const JOB='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const baseRow={db:DB,pg:170004,no_live:true,receipts_ok:true};
const fake=()=>createR103MockPrivateStorage();
function mock({locked=false,brokenUnlock=false,brokenBucket=false,gate=true}={}){
 const state={connected:0,db:0,locks:0,unlocks:0,releases:[],storage:0};
 const storage=fake();
 const port={...storage,verifyPrivateBucket:async(x)=>{
  state.storage++;if(brokenBucket)throw Error('BROKEN_BUCKET');return storage.verifyPrivateBucket(x);
 }};
 const client={async query(sql){
  if(sql.includes('current_database()')){state.db++;return {rows:[baseRow]}}
  if(sql.includes('pg_try_advisory_lock')){state.locks++;return {rows:[{acquired:locked}]}}
  if(sql.includes('pg_advisory_unlock')){state.unlocks++;if(brokenUnlock)throw Error('UNLOCK_FAIL');
   return {rows:[{released:true}]}}
  throw Error('UNEXPECTED_MOCK_SQL');
 },release(destroy){state.releases.push(destroy)}};
 const pool={connect:async()=>{state.connected++;return client},
  query:async(sql)=>{
   if(sql.includes('current_database()'))return {rows:[baseRow]};
   throw Error('UNEXPECTED_POOL_SQL');
  }};
 const worker=createR104FencedRecoveryWorker({environment:'isolated_qa',dbName:DB,pool,shopCode:SHOP,
  storage:port,reviewGate:async()=>gate});
 return {worker,state};
}
test('R104 exact environment guard',()=>{
 const env={R104_DISPOSABLE_FENCE_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',
  PGUSER:'postgres',PGPASSWORD:'disposable-r93s-ci-only',PGDATABASE:DB};
 assertR104Environment(env);
 for(const key of Object.keys(env))assert.throws(()=>assertR104Environment({...env,[key]:'not-allowed'}),/R104_DISPOSABLE_ONLY/);
});
test('R104 refuses wrong database and PostgreSQL versions',()=>{
 assertR104DbIdentity(baseRow);
 for(const change of [{db:'postgres'},{pg:160010},{pg:180001},{no_live:false},{receipts_ok:false}])
  assert.throws(()=>assertR104DbIdentity({...baseRow,...change}));
});
test('R104 cannot authorize live deletion or release',()=>{
 assert.equal(R104_CONTRACT.liveStorageDeleteAllowed,false);
 assert.equal(R104_CONTRACT.productionReady,false);
 assert.equal(R104_CONTRACT.releaseDecision,'NO_GO');
 assert.equal(R104_CONTRACT.migrationDecision,'HOLD');
});
test('R104 rejects missing or real Storage dependency',()=>{
 assert.throws(()=>createR104FencedRecoveryWorker(),/R104_ISOLATION_REQUIRED/);
 const pool={connect:async()=>{},query:async()=>{}};
 assert.throws(()=>createR104FencedRecoveryWorker({environment:'isolated_qa',dbName:DB,pool,shopCode:SHOP,
  storage:{kind:'real_supabase',testOnly:true,transport:'network'},reviewGate:async()=>true}));
});
test('R104 closed review gate denies DB and Storage before access',async()=>{
 const {worker,state}=mock({gate:false});
 await assert.rejects(()=>worker.run(JOB),/R104_REVIEW_LOCK_CLOSED/);
 assert.equal(state.connected,0);assert.equal(state.storage,0);
});
test('R104 refuses malformed job ids without access',async()=>{
 const {worker,state}=mock();await assert.rejects(()=>worker.run('../outside'),/R104_BAD_JOB_ID/);
 assert.equal(state.connected,0);
});
test('R104 advisory lock contention denies before R103 Storage',async()=>{
 const {worker,state}=mock();assert.deepEqual(await worker.run(JOB),{status:'busy_fenced'});
 assert.equal(state.connected,1);assert.equal(state.locks,1);assert.equal(state.unlocks,0);
 assert.equal(state.storage,0);assert.equal(state.releases.length,1);
});
test('R104 releases advisory lock on simulated R103 failure',async()=>{
 const {worker,state}=mock({locked:true,brokenBucket:true});
 await assert.rejects(()=>worker.run(JOB),/BROKEN_BUCKET/);
 assert.equal(state.locks,1);assert.equal(state.unlocks,1);assert.equal(state.releases.length,1);
});
test('R104 destroys session when unlock is unconfirmed',async()=>{
 const {worker,state}=mock({locked:true,brokenBucket:true,brokenUnlock:true});
 await assert.rejects(()=>worker.run(JOB),/UNLOCK_FAIL/);
 assert.equal(state.unlocks,1);assert.deepEqual(state.releases,[true]);
});
test('R104 requires SQL session advisory lock throughout Storage call',()=>{
 const impl=readFileSync('car02-r104-fenced-recovery-isolated.mjs','utf8');
 assert.match(impl,/pg_try_advisory_lock/);assert.match(impl,/pg_advisory_unlock/);
 assert.match(impl,/answer=await base\.run\(jobId,options\)/);
 assert.ok(impl.indexOf('answer=await base.run(jobId,options)')<impl.indexOf('client.query(SQL_UNLOCK'));
 assert.doesNotMatch(impl,/SUPABASE_SERVICE_ROLE_KEY|CAR02_DATABASE_URL|wrangler|\bfetch\s*\(/);
});
test('R104 PG17 driver proves simultaneous workers, retry, done and no duplicates',()=>{
 const src=readFileSync('car02-r104-pg17-fence-qa.mjs','utf8');
 for(const token of ['await enteredPromise','release()','busy_fenced','R104_CONCURRENT_DELETE_SESSION_FENCE_PASS',
  'R104_FAILURE_UNLOCK_AND_RETRY_PASS','R104_AFTER_DONE_NO_DOUBLE_DELETE_PASS'])assert.ok(src.includes(token),token);
});
test('R104 approved workflow only is manual read-only disposable',()=>{
 const yaml=readFileSync('.github/workflows/car02-r104-advisory-fence-qa.yml','utf8');
 const result=verifyR104Workflow(yaml);assert.equal(result.steps,8);
 assert.equal(result.releaseDecision,'NO_GO');assert.equal(result.migrationDecision,'HOLD');
});
test('R104 workflow rejects unsafe trigger, deploy, secrets and wrong PG',()=>{
 const yaml=readFileSync('.github/workflows/car02-r104-advisory-fence-qa.yml','utf8');
 for(const x of [yaml.replace('workflow_dispatch:','push:'),yaml.replace('contents: read','contents: write'),
  yaml.replace('postgres:17','postgres:16'),yaml+'\n# ${{ secrets.PRODUCTION_KEY }}',
  yaml+'\n# wrangler deploy',yaml+'\n      - name: hidden extra step'])assert.throws(()=>verifyR104Workflow(x));
});
