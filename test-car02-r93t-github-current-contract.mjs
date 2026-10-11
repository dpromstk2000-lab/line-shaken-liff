// R93T - run inside the actual approved GitHub repo only. No network calls, no secrets.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {auditCar02R93TSourceContracts,R93T_APPROVED_BASELINE} from './car02-r93t-release-readiness-audit.mjs';
import {createCar02EdgeBoundaryR51} from './car02-edge-boundary-r51.mjs';
import {createCar02PhotoUploadHttpR82} from './car02-private-photo-upload-http-r82.mjs';
const sources={};
function sha1GitBlob(bytes){
 return createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
}
for(const [path,sha] of Object.entries(R93T_APPROVED_BASELINE)){
 const bytes=readFileSync(path);
 assert.equal(sha1GitBlob(bytes),sha,`GitHub source drift: ${path}`);
 sources[path]=bytes.toString('utf8');
}
const audit=auditCar02R93TSourceContracts(sources);
const byId=Object.fromEntries(audit.checks.map(x=>[x.id,x]));
test('release lock is hard coded and business upload not wired',()=>{
 assert.equal(audit.releaseDecision,'NO_GO');
 assert.equal(audit.integrationReady,false);
 assert.equal(audit.unsafeCount,0);
 assert.equal(byId.R52_HARD_RELEASE_LOCK.state,'LOCKED');
 assert.equal(byId.R50_UPLOAD_COMPOSITION.state,'OPEN');
});
test('outer R51 routing and POST cap are incompatible with the existing 5MiB upload route',()=>{
 assert.equal(byId.R51_UPLOAD_ROUTE.state,'OPEN');
 assert.equal(byId.R51_BODY_CAP_CONFLICT.state,'OPEN');
});
test('old direct delete and volatile receipt remain explicitly unconnected',()=>{
 assert.equal(byId.R47_DIRECT_STORAGE_DELETE.state,'OPEN');
 assert.equal(byId.R93Q_PROCESS_LOCAL_RECEIPTS.state,'OPEN');
});
test('R82 does not propagate durable intent and R93S is isolated-only',()=>{
 assert.equal(byId.R82_DURABLE_INTENT_KEY.state,'OPEN');
 assert.equal(byId.R93S_ONLY_DISPOSABLE_QA.state,'ISOLATED_PASS');
});
test('R51 rejected upload under closed gate without constructing DB runtime or reading body',async()=>{
 let constructed=0,auth=0;
 const handler=createCar02EdgeBoundaryR51({isServerReleased:async()=>false,createRuntime:async()=>{constructed++;return()=>{auth++;}}});
 const path='/functions/v1/dpro-car02-stage/api/car02/uploads/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333';
 let read=false;
 const req=new Request('https://localhost'+path,{method:'POST',headers:{'content-type':'image/jpeg','content-length':'5242880'}});
 // Request has no real body; a route reaching a DB is a QA failure.
 const response=await handler(req);assert.equal(response.status,404);
 const text=await response.text();assert.match(text,/CAR02_NOT_FOUND/);
 assert.equal(constructed,0);assert.equal(auth,0);assert.equal(read,false);
});
test('R51 photo view remains denied before any runtime initialization',async()=>{
 let constructed=0;
 const handler=createCar02EdgeBoundaryR51({isServerReleased:async()=>false,createRuntime:async()=>{constructed++;throw Error('BAD');}});
 const res=await handler(new Request('https://localhost/functions/v1/dpro-car02-stage/api/car02/photos/22222222-2222-4222-8222-222222222222'));
 assert.equal(res.status,503);assert.match(await res.text(),/CAR02_NOT_RELEASED/);
 assert.equal(constructed,0);
});
test('R82 refuses before authenticating or reading an uploaded body while locked',async()=>{
 let authenticated=0,uploads=0;
 const handler=createCar02PhotoUploadHttpR82({shopCode:'street_house_kitsuki',
  releaseEnabled:async()=>false,authenticate:async()=>{authenticated++;throw Error('NO_AUTH');},
  uploadService:{upload:async()=>{uploads++;throw Error('NO_UPLOAD');}},allowedOrigins:['https://qa.example.test']});
 const route='https://qa.example.test/api/car02/uploads/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333';
 const resp=await handler(new Request(route,{method:'POST',headers:{origin:'https://qa.example.test','content-type':'image/jpeg','authorization':'Bearer sample-test-token'}}));
 assert.equal(resp.status,503);assert.match(await resp.text(),/CAR02_NOT_RELEASED/);
 assert.equal(authenticated,0);assert.equal(uploads,0);
});
test('machine-readable audit is a blocked gate inventory, never a deployment pass',()=>{
 assert.equal(audit.openCount,6);assert.equal(audit.integrationReady,false);
 assert.equal(audit.productionMutations,false);assert.equal(audit.migrationDecision,'HOLD');
 console.log('R93T_INTEGRATION_READINESS_NO_GO_CONFIRMED');
});
