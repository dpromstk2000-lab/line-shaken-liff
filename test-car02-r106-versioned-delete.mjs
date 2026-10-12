import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertR106Pin,assertR106Env,R106_CONTRACT,createR106MockVersionedPrivateStore,
 createR106VersionBoundCleanup} from './car02-r106-versioned-object-delete-isolated.mjs';
import {verifyR106Workflow} from './car02-r106-workflow-guard.mjs';
const sql=readFileSync('R106_PG17_VERSION_PIN_FIXTURE_QA_ONLY.sql','utf8');
const yaml=readFileSync('.github/workflows/car02-r106-conditional-delete-qa.yml','utf8');
const validPath='street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/88888888-8888-4888-8888-000000000001.jpg';
const good={job_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',photo_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 shop_code:'street_house_kitsuki',photo_shop:'street_house_kitsuki',intent_shop:'street_house_kitsuki',
 job_shop:'street_house_kitsuki',storage_path:validPath,photo_path:validPath,intent_path:validPath,
 job_path:validPath,upload_state:'deleted',job_state:'queued',sha256:'a'.repeat(64),photo_sha:'a'.repeat(64),
 object_version:'v001',bucket:'ksh-car02-private-photos',photo_bucket:'ksh-car02-private-photos'};
const mock=opts=>createR106MockVersionedPrivateStore(opts);
test('R106 requires disposable env exact match',()=>{
 const env={R106_DISPOSABLE_VERSION_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGPASSWORD:'disposable-r93s-ci-only',PGDATABASE:'car02_r93q_qa_ci'};
 assertR106Env(env);for(const k of Object.keys(env))assert.throws(()=>assertR106Env({...env,[k]:'not-allowed'}));
});
test('R106 contract never authorizes production / real storage',()=>{
 assert.equal(R106_CONTRACT.productionReady,false);assert.equal(R106_CONTRACT.realStorageCapabilityVerified,false);
 assert.equal(R106_CONTRACT.productionDeployAllowed,false);assert.equal(R106_CONTRACT.releaseDecision,'NO_GO');
 assert.equal(R106_CONTRACT.migrationDecision,'HOLD');
});
test('R106 validates tenant, version, sha, path and tombstone proof',()=>assertR106Pin(good,good.shop_code));
for(const [label,over] of Object.entries({foreign:{shop_code:'other_shop'},foreignPhoto:{photo_shop:'other_shop'},
 foreignIntent:{intent_shop:'other_shop'},foreignJob:{job_shop:'other_shop'},livePhoto:{upload_state:'ready'},
 unqueued:{job_state:'done'},badVersion:{object_version:'no-version'},badHash:{sha256:'wrong'},
 photoHash:{photo_sha:'f'.repeat(64)},jobPath:{job_path:validPath+'-extra'},
 intentPath:{intent_path:'other_shop/file.jpg'},bucket:{bucket:'public'},photoBucket:{photo_bucket:'public'}})){
 test('R106 rejects pinned record '+label,()=>assert.throws(()=>assertR106Pin({...good,...over},good.shop_code)));
}
test('R106 refuses production-shaped dependencies',()=>{
 assert.throws(()=>createR106VersionBoundCleanup({}),/R106_DISPOSABLE_DEPS_REQUIRED/);
 const pool={connect:async()=>{},query:async()=>{}};
 assert.throws(()=>createR106VersionBoundCleanup({environment:'production',dbName:'car02_r93q_qa_ci',pool,
  shopCode:good.shop_code,storage:mock(),reviewGate:()=>true}),/R106_DISPOSABLE_DEPS_REQUIRED/);
 assert.throws(()=>createR106VersionBoundCleanup({environment:'isolated_qa',dbName:'car02_r93q_qa_ci',pool,
  shopCode:good.shop_code,storage:{kind:'real_supabase',testOnly:true},reviewGate:()=>true}),/R106_DISPOSABLE_DEPS_REQUIRED/);
});
test('R106 hard gate rejects before database and Storage calls',async()=>{
 const count={query:0,connect:0};const pool={connect:async()=>{count.connect++;throw Error('BAD_CONNECT')},
  query:async()=>{count.query++;throw Error('BAD_QUERY')}};
 const fixture=mock();
 const worker=createR106VersionBoundCleanup({environment:'isolated_qa',dbName:'car02_r93q_qa_ci',
  pool,shopCode:good.shop_code,storage:fixture,reviewGate:()=>false});
 await assert.rejects(()=>worker.run(good.job_id),/R106_GATE_LOCKED/);
 assert.equal(count.query,0);assert.equal(count.connect,0);assert.equal(fixture.deleteCalls,0);
});
test('R106 fixture forbids malformed objects and duplicate paths',()=>{
 const obj={path:validPath,version:'v001',sha256:'a'.repeat(64)};
 assert.throws(()=>mock({objects:[obj,obj]}));assert.throws(()=>mock({objects:[{...obj,version:'oops'}]}));
});
test('R106 conditional atomic mismatch leaves replacement intact',async()=>{
 const x=mock({objects:[{path:validPath,version:'v001',sha256:'a'.repeat(64)}],
  beforeConditionalDelete:({replace})=>replace(validPath,'v002','b'.repeat(64))});
 const r=await x.deleteIfMatch({bucket:'ksh-car02-private-photos',path:validPath,version:'v001',sha256:'a'.repeat(64)});
 assert.equal(r.preconditionFailed,true);const head=await x.head({bucket:'ksh-car02-private-photos',path:validPath});
 assert.equal(head.version,'v002');assert.equal(x.deleteCalls,1);
});
test('R106 conditional exact match removes only pinned object',async()=>{
 const x=mock({objects:[{path:validPath,version:'v001',sha256:'a'.repeat(64)}]});
 assert.equal((await x.deleteIfMatch({bucket:'ksh-car02-private-photos',path:validPath,version:'v001',sha256:'a'.repeat(64)})).deleted,true);
 assert.equal((await x.head({bucket:'ksh-car02-private-photos',path:validPath})).definitivelyMissing,true);
});
test('R106 lost delete acknowledgment is not accepted as successful immediately',async()=>{
 const x=mock({objects:[{path:validPath,version:'v001',sha256:'a'.repeat(64)}],ackLostPaths:[validPath]});
 await assert.rejects(()=>x.deleteIfMatch({bucket:'ksh-car02-private-photos',path:validPath,
  version:'v001',sha256:'a'.repeat(64)}),/R106_SIMULATED_ACK_LOST/);
 assert.equal((await x.head({bucket:'ksh-car02-private-photos',path:validPath})).definitivelyMissing,true);
});
test('R106 refuses wrong bucket or unversioned deletion',async()=>{
 const x=mock();await assert.rejects(()=>x.deleteIfMatch({bucket:'public',path:validPath,version:'v001',sha256:'a'.repeat(64)}));
 await assert.rejects(()=>x.deleteIfMatch({bucket:'ksh-car02-private-photos',path:validPath,version:'',sha256:'a'.repeat(64)}));
});
test('R106 SQL is guarded and never connects to production',()=>{
 assert.match(sql,/R106_DISPOSABLE_PG17_ONLY/);assert.match(sql,/R105_generation_claims/i);
 assert.match(sql,/current_database\(\)/);assert.match(sql,/NOT BETWEEN 170000 AND 179999/);
 assert.match(sql,/REVOKE ALL .* FROM PUBLIC/);
});
test('R106 workflow manually triggered with immutable NO_GO',()=>{
 const z=verifyR106Workflow(yaml);assert.equal(z.steps,8);assert.equal(z.releaseDecision,'NO_GO');
});
test('R106 rejects push/secrets/deployment workflows',()=>{
 for(const evil of [yaml.replace('workflow_dispatch:','push:'),yaml.replace('postgres:17','postgres:16'),
  yaml.replace('contents: read','contents: write'),yaml+'\n# ${{ secrets.LIVE_DB }}',yaml+'\n# wrangler deploy'])
  assert.throws(()=>verifyR106Workflow(evil));
});
test('R106 source never references live storage or cloud API',()=>{
 for(const file of ['car02-r106-versioned-object-delete-isolated.mjs','car02-r106-pg17-conditional-delete-qa.mjs']){
  const src=readFileSync(file,'utf8');assert.doesNotMatch(src,/SUPABASE_SERVICE_ROLE_KEY|CAR02_DATABASE_URL|\bfetch\s*\(|wrangler\s+deploy|Deno\.env/);
 }
});
