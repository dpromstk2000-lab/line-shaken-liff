import test from 'node:test';
import assert from 'node:assert/strict';
import {createR93YInProcessStorageFixture,createR93YIsolatedStorageProtocol,R93Y_CONTRACT} from './car02-r93y-qa-storage-http-fixture.mjs';
import {buildR93WDurableEnvelope} from './car02-r93w-durable-http-reservation-isolated.mjs';
const SHOP='street_house_kitsuki',O='22222222-2222-4222-8222-222222222222',R='33333333-3333-4333-8333-333333333333';
const STAFF='11111111-1111-4111-8111-111111111111',KEY='88888888-8888-4888-8888-000000000001';
const actor=()=>({verified:true,shopCode:SHOP,role:'staff',subject:`staff:${STAFF}`});
const input=(mimeType='image/jpeg')=>({actor:actor(),shop:SHOP,orderId:O,reportId:R,mimeType,
  intentKey:KEY,bytes:mimeType==='image/jpeg'?new Uint8Array([255,216,255,224,5,6,7,8,9,10]):
    mimeType==='image/webp'?new Uint8Array([82,73,70,70,1,2,3,4,87,69,66,80,1]):
      new Uint8Array([137,80,78,71,13,10,26,10,1,2,3])});
const newPort=(cfg={})=>{const fixture=createR93YInProcessStorageFixture(cfg);const port=createR93YIsolatedStorageProtocol({environment:'isolated_qa',dbName:'car02_r93q_qa_ci',fixture});return {fixture,port};};
test('fixture constructor only accepts hardcoded simulated options',()=>{
 assert.throws(()=>createR93YInProcessStorageFixture({origin:'https://real.supabase.co'}),{code:'R93Y_FIXTURE_CONFIG_INVALID'});
});
for(const c of [{environment:'production'}, {dbName:'postgres'}, {fixture:{kind:'car02_r93y_in_process_http_fixture',testOnly:true,fetch:async()=>{}}}]){
 test('protocol rejects non-QA fixtures and production DB names: '+JSON.stringify(c),()=>{
  const fixture=createR93YInProcessStorageFixture();
  assert.throws(()=>createR93YIsolatedStorageProtocol({environment:'isolated_qa',dbName:'car02_r93q_qa_ci',fixture,...c}),{code:'R93Y_IN_PROCESS_ONLY'});
 });
}
for(const cfg of [{publicBucket:true},{bucketMalformed:true},{bucketRedirect:true},{offline:true}]){
 test('nonprivate, malformed or unavailable bucket rejected before post '+JSON.stringify(cfg),async()=>{
  const {port,fixture}=newPort(cfg);await assert.rejects(port.verifyPrivateBucket({bucket:'ksh-car02-private-photos'}));
  const x=buildR93WDurableEnvelope(input());await assert.rejects(port.postObject({bucket:x.bucket,path:x.path,mimeType:x.mimeType,bytes:input().bytes,upsert:false}));
  assert.equal(fixture.posts,0);
 });
}
test('protocol always refuses cross-bucket calls and missing prior private-bucket proof',async()=>{
 const {port}=newPort(), x=buildR93WDurableEnvelope(input());
 await assert.rejects(port.inspectObject({bucket:x.bucket,path:x.path}),{code:'R93Y_INSPECT_SCOPE_DENIED'});
 await assert.rejects(port.verifyPrivateBucket({bucket:'public'}),{code:'R93Y_BUCKET_DENIED'});
 await port.verifyPrivateBucket({bucket:x.bucket});
 await assert.rejects(port.inspectObject({bucket:'public',path:x.path}),{code:'R93Y_INSPECT_SCOPE_DENIED'});
 await assert.rejects(port.postObject({bucket:x.bucket,path:x.path,mimeType:x.mimeType,bytes:input().bytes,upsert:true}),{code:'R93Y_POST_SCOPE_DENIED'});
});
for(const mime of ['image/jpeg','image/png','image/webp']){
 test('simulated Storage HTTP accepts bounded private '+mime+' readback with exact bytes',async()=>{
  const {port,fixture}=newPort(),x=buildR93WDurableEnvelope(input(mime));
  await port.verifyPrivateBucket({bucket:x.bucket});
  assert.deepEqual(await port.inspectObject({bucket:x.bucket,path:x.path}),{found:false,definitive:true});
  assert.equal((await port.postObject({bucket:x.bucket,path:x.path,mimeType:mime,bytes:input(mime).bytes,upsert:false})).status,201);
  const read=await port.inspectObject({bucket:x.bucket,path:x.path});assert.equal(read.private,true);
  assert.deepEqual(read.bytes,input(mime).bytes);
  assert.equal((await port.postObject({bucket:x.bucket,path:x.path,mimeType:mime,bytes:input(mime).bytes,upsert:false})).status,409);
  assert.equal(fixture.posts,2);
  assert.equal(fixture.calls.some(c=>c.method==='DELETE'),false);
 });
}
for(const cfg of [{postAckLost:true},{postFailedButWritten:true}]){
 test('POST outcome unknown, independent read proves potential existing blob '+JSON.stringify(cfg),async()=>{
  const {port,fixture}=newPort(cfg),x=buildR93WDurableEnvelope(input());
  await port.verifyPrivateBucket({bucket:x.bucket});
  await assert.rejects(port.postObject({bucket:x.bucket,path:x.path,mimeType:x.mimeType,bytes:input().bytes,upsert:false}),{code:'R93Y_POST_RESULT_UNKNOWN'});
  const data=await port.inspectObject({bucket:x.bucket,path:x.path});assert.equal(data.found,true);
  assert.equal(fixture.posts,1);
 });
}
for(const cfg of [{readFailure:true},{readRedirect:true},{wrongMime:true},{oversizeRead:true}]){
 test('read errors never become verified success '+JSON.stringify(cfg),async()=>{
  const {port,fixture}=newPort(cfg),x=buildR93WDurableEnvelope(input());
  await port.verifyPrivateBucket({bucket:x.bucket});
  fixture.objects.set(x.path,{bytes:input().bytes,mime:x.mimeType});
  await assert.rejects(port.inspectObject({bucket:x.bucket,path:x.path}));
 });
}
test('unknown/no-body missing response is not treated as definitive 404',async()=>{
 const {port}=newPort({ambiguousMissing:true});const x=buildR93WDurableEnvelope(input());
 await port.verifyPrivateBucket({bucket:x.bucket});
 await assert.rejects(port.inspectObject({bucket:x.bucket,path:x.path}),{code:'R93Y_INSPECT_UNKNOWN'});
});
test('oversized POST is rejected before fake fetch and cannot be uploaded',async()=>{
 const {port,fixture}=newPort(),x=buildR93WDurableEnvelope(input());await port.verifyPrivateBucket({bucket:x.bucket});
 await assert.rejects(port.postObject({bucket:x.bucket,path:x.path,mimeType:x.mimeType,bytes:new Uint8Array(5242881),upsert:false}),{code:'R93Y_POST_SCOPE_DENIED'});
 assert.equal(fixture.posts,0);
});
test('fixture never accepts redirecting or external/unauthorized requests',async()=>{
 const fixture=createR93YInProcessStorageFixture();
 await assert.rejects(fixture.fetch('https://real.supabase.co/storage/v1/bucket/x',{}),{code:'R93Y_EXTERNAL_OR_UNAUTHORIZED_FETCH'});
 await assert.rejects(fixture.fetch('https://car02-storage-fixture.invalid/storage/v1/object/ksh-car02-private-photos/x',{method:'DELETE',redirect:'error',headers:{'x-qa-fixture':'QA_FIXTURE_HEADER_ONLY'}}),{code:'R93Y_FIXTURE_ROUTE_FORBIDDEN'});
});
test('public contract has no network/deploy/storage DELETE authority',()=>{
 assert.equal(R93Y_CONTRACT.productionReady,false);
 assert.equal(R93Y_CONTRACT.realNetworkAllowed,false);
 assert.equal(R93Y_CONTRACT.directDeleteAllowed,false);
 assert.equal(R93Y_CONTRACT.releaseDecision,'NO_GO');
 assert.equal(R93Y_CONTRACT.migrationDecision,'HOLD');
});
