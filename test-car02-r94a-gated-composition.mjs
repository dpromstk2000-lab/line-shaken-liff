import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCar02R94AFullStagingPipeline,R94A_CONTRACT} from './car02-r94a-full-staging-pipeline-isolated.mjs';
import {createR93YInProcessStorageFixture,createR93YIsolatedStorageProtocol} from './car02-r93y-qa-storage-http-fixture.mjs';
const DB='car02_r93q_qa_ci',SHOP='street_house_kitsuki',HOST='https://isolated-staging.invalid';
const ORDER='22222222-2222-4222-8222-222222222222';
const REPORT='33333333-3333-4333-8333-333333333333';
const UPLOAD_URL=HOST+'/functions/v1/dpro-car02-stage/api/car02/uploads/'+ORDER+'/'+REPORT;
function rig({open=false,env='isolated_qa',dbName=DB,override={}}={}){
 const counts={connect:0,query:0,auth:0,gate:0};
 const pool={connect:async()=>{counts.connect++;throw Error('NEVER_CONNECT');},
             query:async()=>{counts.query++;throw Error('NEVER_QUERY');}};
 const fixture=createR93YInProcessStorageFixture();
 const storage=createR93YIsolatedStorageProtocol({environment:'isolated_qa',dbName:DB,fixture});
 const fn=()=>createCar02R94AFullStagingPipeline({environment:env,dbName,
  shopCode:SHOP,pool,storage,reviewGate:async()=>{counts.gate++;return open;},
  authenticate:async()=>{counts.auth++;throw Error('SHOULD_NOT_AUTH');},origins:[HOST],...override});
 return {fn,counts,fixture};
}
const req=(path=UPLOAD_URL,method='POST',size=4)=>new Request(path,{method,
 headers:{origin:HOST,authorization:'Bearer fake-isolated-only',
 'idempotency-key':'88888888-8888-4888-8888-000000000001',
 'content-type':'image/jpeg'},...(method==='POST'?{body:new Uint8Array(size).fill(1)}:{})});

test('explicit isolated QA DB and in-process HTTP fixture required',()=>{
 assert.throws(rig({env:'staging'}).fn,/R94A_DISPOSABLE/);
 assert.throws(rig({dbName:'postgres'}).fn,/R94A_DISPOSABLE/);
 assert.throws(rig({override:{storage:{kind:'isolated_memory',testOnly:true,transport:'live'}}}).fn,/R94A_DISPOSABLE/);
 assert.throws(rig({override:{pool:{query:async()=>{}}}}).fn,/R94A_DISPOSABLE/);
});
test('locked release gate stops before authentication, DB and Storage, even for POST',async()=>{
 const {fn,counts,fixture}=rig();const handle=fn();const res=await handle(req());
 assert.equal(res.status,503);assert.equal(counts.auth,0);assert.equal(counts.connect,0);
 assert.equal(counts.query,0);assert.equal(fixture.calls.length,0);
});
test('malformed, unprefixed and unknown routes never reach DB or auth',async()=>{
 const {fn,counts,fixture}=rig({open:true});const handle=fn();
 for(const p of [HOST+'/api/car02/uploads/'+ORDER+'/'+REPORT,
   HOST+'/functions/v1/dpro-car02-stage/api/car02/line-send',
   UPLOAD_URL+'?token=preview',HOST+'/functions/v1/not-car02-stage/api/car02/uploads/'+ORDER+'/'+REPORT]){
   assert.equal((await handle(req(p))).status,404);
 }
 assert.equal(counts.connect,0);assert.equal(counts.auth,0);assert.equal(fixture.calls.length,0);
});
test('business paths intentionally not connected to legacy runtime',async()=>{
 const {fn,counts,fixture}=rig({open:true});
 const res=await fn()(req(HOST+'/functions/v1/dpro-car02-stage/api/car02','GET'));
 assert.equal(res.status,404);assert.equal((await res.json()).code,'CAR02_STAGING_BUSINESS_NOT_WIRED');
 assert.equal(counts.connect,0);assert.equal(counts.auth,0);assert.equal(fixture.calls.length,0);
});
test('oversize request rejected before authentication and DB',async()=>{
 const {fn,counts,fixture}=rig({open:true});const res=await fn()(req(UPLOAD_URL,'POST',5242881));
 assert.equal(res.status,413);assert.equal(counts.connect,0);assert.equal(counts.auth,0);
 assert.equal(fixture.calls.length,0);
});
test('unapproved HTTP verbs never call backends',async()=>{
 const {fn,counts}=rig({open:true});assert.equal((await fn()(req(UPLOAD_URL,'DELETE'))).status,405);
 assert.equal(counts.connect,0);assert.equal(counts.auth,0);
});
test('source excludes R47 immediate DELETE and all network credentials',()=>{
 const s=readFileSync(new URL('./car02-r94a-full-staging-pipeline-isolated.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(s,/\bfetch\s*\(|\.deleteObject\s*\(|\bdeleteObject\s*\(|method\s*:\s*['"]DELETE['"]/);
 assert.doesNotMatch(s,/SUPABASE_SERVICE_ROLE_KEY|wrangler\s+deploy|serviceRoleKey/);
 assert.equal(R94A_CONTRACT.productionReady,false);assert.equal(R94A_CONTRACT.releaseDecision,'NO_GO');
 assert.equal(R94A_CONTRACT.migrationDecision,'HOLD');
});
