import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {R105_CONTRACT,assertR105Environment,assertR105Identity,validateR105Proof,
 createR105GenerationLease} from './car02-r105-generation-lease-isolated.mjs';
import {verifyR105Workflow} from './car02-r105-workflow-guard.mjs';
const DB='car02_r93q_qa_ci',SHOP='street_house_kitsuki',JOB='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const mockClaim={status:'claimed',shopCode:SHOP,jobId:JOB,
 storagePath:'street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/88888888-8888-4888-8888-000000000123.jpg',
 generation:2,token:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'};
const goodProof={kind:'r105_in_process_private_storage',testOnly:true,storagePath:mockClaim.storagePath,
 privateBucket:true,deleted:true,definitivelyMissing:false};
const yaml=readFileSync('.github/workflows/car02-r105-generation-lease-qa.yml','utf8');
const source=readFileSync('car02-r105-generation-lease-isolated.mjs','utf8');
const sql=readFileSync('R105_PG17_LEASE_GENERATION_FIXTURE_QA_ONLY.sql','utf8');
test('R105 strict disposable environment',()=>{
 const e={R105_DISPOSABLE_GENERATION_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',
 PGUSER:'postgres',PGPASSWORD:'disposable-r93s-ci-only',PGDATABASE:DB};
 assertR105Environment(e);
 for(const k of Object.keys(e))assert.throws(()=>assertR105Environment({...e,[k]:'wrong'}),/R105_DISPOSABLE_ONLY/);
});
test('R105 PG17 and database identity protected',()=>{
 const row={db:DB,pg:170002,no_live:true,generation_table:true};assertR105Identity(row);
 for(const delta of [{db:'postgres'},{pg:160002},{pg:180000},{no_live:false},{generation_table:false}])
  assert.throws(()=>assertR105Identity({...row,...delta}));
});
test('R105 cannot authorize production or connect real Storage',()=>{
 assert.equal(R105_CONTRACT.productionReady,false);
 assert.equal(R105_CONTRACT.liveStorageDeleteAllowed,false);
 assert.equal(R105_CONTRACT.releaseDecision,'NO_GO');
 assert.equal(R105_CONTRACT.migrationDecision,'HOLD');
 assert.doesNotMatch(source,/SUPABASE_SERVICE_ROLE_KEY|CAR02_DATABASE_URL|\bfetch\s*\(|wrangler|deleteObject/);
});
test('R105 requires safe injected dependencies',()=>{
 assert.throws(()=>createR105GenerationLease(),/R105_ISOLATION_REQUIRED/);
 assert.throws(()=>createR105GenerationLease({environment:'production',dbName:DB,pool:{query:()=>{},connect:()=>{}},shopCode:SHOP,reviewGate:()=>true}));
});
test('R105 verifies in-process private Storage proof and rejects forged success',()=>{
 assert.equal(validateR105Proof(mockClaim,goodProof),'deleted');
 assert.equal(validateR105Proof(mockClaim,{...goodProof,deleted:false,definitivelyMissing:true}),'missing');
 for(const delta of [{testOnly:false},{kind:'live'},{privateBucket:false},
  {storagePath:'other_shop/evil.jpg'},{deleted:true,definitivelyMissing:true},
  {deleted:false,definitivelyMissing:false}])
  assert.throws(()=>validateR105Proof(mockClaim,{...goodProof,...delta}),/R105_UNTRUSTED_DELETE_PROOF/);
});
test('R105 closed gate stops DB before allocating client',async()=>{
 let accessed=0;
 const pool={connect:async()=>{accessed++;throw Error('SHOULD_NOT_CONNECT')},query:async()=>{accessed++;throw Error()}};
 const worker=createR105GenerationLease({environment:'isolated_qa',dbName:DB,shopCode:SHOP,pool,reviewGate:async()=>false});
 await assert.rejects(()=>worker.claim(JOB),/R105_GATE_LOCKED/);
 await assert.rejects(()=>worker.settle(mockClaim,'retry'),/R105_GATE_LOCKED/);
 assert.equal(accessed,0);
});
test('R105 malformed job and invalid claim are blocked before DB',async()=>{
 const pool={connect:async()=>{throw Error('DB_NOT_EXPECTED')},query:async()=>{throw Error('DB_NOT_EXPECTED')}};
 const worker=createR105GenerationLease({environment:'isolated_qa',dbName:DB,shopCode:SHOP,pool,reviewGate:async()=>true});
 await assert.rejects(()=>worker.claim('../escape'),/R105_INVALID_JOB/);
 await assert.rejects(()=>worker.settle({...mockClaim,shopCode:'other_shop'},'done',goodProof),/R105_INVALID_CLAIM/);
 await assert.rejects(()=>worker.settle(mockClaim,'done',{...goodProof,testOnly:false}),/R105_UNTRUSTED_DELETE_PROOF/);
});
test('R105 foreign shop has no claim and rolls back',async()=>{
 const calls=[];
 const client={async query(sql){calls.push(sql);if(sql.includes('current_database()'))return {rows:[{db:DB,pg:170001,no_live:true,generation_table:true}]};
  if(sql.includes('FROM car02_r93q_qa.cleanup_jobs'))return {rows:[]};return {rows:[]}},release(){calls.push('released')}};
 const pool={connect:async()=>client,query:async()=>{throw Error('SHOULD_NOT_USE_POOL_QUERY')}};
 const worker=createR105GenerationLease({environment:'isolated_qa',dbName:DB,pool,shopCode:SHOP,reviewGate:async()=>true});
 assert.deepEqual(await worker.claim(JOB),{status:'unavailable'});
 assert.ok(calls.includes('ROLLBACK'));assert.ok(calls.includes('released'));
});
test('R105 stale completion must be CAS with token and generation, plus fresh lease',()=>{
 assert.match(source,/generation=\$4 AND token=\$5/);
 assert.match(source,/lease_until>clock_timestamp\(\)/);
 assert.match(source,/R105_STALE_GENERATION_FAIL_CLOSED/);
 assert.ok(source.includes('generation=${S}.r105_generation_claims.generation+1'));
});
test('R105 prevents done reclaim, never reuses token, and enforces generation limit',()=>{
 assert.match(source,/state='retry' OR/);
 assert.match(source,/state='claimed' AND/);
 assert.match(source,/generation<1000000/);
 assert.match(source,/randomUUID\(\)/);
});
test('R105 SQL fixture is guarded, receipt separate and no PUBLIC privilege',()=>{
 assert.match(sql,/current_database\(\)<>'car02_r93q_qa_ci'/);
 assert.match(sql,/server_version_num/);
 assert.match(sql,/CREATE TABLE car02_r93q_qa\.r105_generation_claims/);
 assert.match(sql,/REVOKE ALL ON car02_r93q_qa\.r105_generation_claims FROM PUBLIC/);
 assert.doesNotMatch(sql,/DROP SCHEMA public|CREATE EXTENSION|ALTER ROLE postgres/i);
});
test('R105 QA driver includes parallel claim and stale transition rejection',()=>{
 const driver=readFileSync('car02-r105-pg17-lease-qa.mjs','utf8');
 for(const n of ['Promise.all([a.claim','R105_PARALLEL_CLAIM_SINGLE_OWNER_PASS',
  'R105_EXPIRED_OLD_WORKER_CANNOT_OVERWRITE_PASS','R105_MISSING_OBJECT_IDEMPOTENT_RECOVERY_PASS',
  'R105_TENANT_AND_TOKEN_FORGERY_DENIED_PASS'])assert.ok(driver.includes(n),n);
});
test('R105 read-only manual workflow is guarded',()=>{
 const out=verifyR105Workflow(yaml);assert.equal(out.steps,8);assert.equal(out.releaseDecision,'NO_GO');
});
test('R105 workflow rejects changed trigger, wrong database and deploy',()=>{
 for(const text of [yaml.replace('workflow_dispatch:','push:'),
 yaml.replace('contents: read','contents: write'),yaml.replace('postgres:17','postgres:16'),
 yaml+'\n# ${{ secrets.CAR02_PROD }}',yaml+'\n# wrangler deploy',yaml+'\n      - name: hidden step\n'])
  assert.throws(()=>verifyR105Workflow(text));
});
