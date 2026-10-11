// Run in the checked-out approved GitHub repository. Uses actual R82 source,
// but a fake uploader/authenticator; no DB, Storage, tokens or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createCar02PhotoUploadHttpR82} from './car02-private-photo-upload-http-r82.mjs';
import {createCar02R93UIsolatedStagingRouter} from './car02-r93u-staging-upload-route-isolated.mjs';
import {R93T_APPROVED_BASELINE,auditCar02R93TSourceContracts} from './car02-r93t-release-readiness-audit.mjs';
const DB='car02_r93q_qa_ci';
const SHOP='street_house_kitsuki';
const ORIGIN='https://qa.example.test';
const O='22222222-2222-4222-8222-222222222222';
const R='33333333-3333-4333-8333-333333333333';
const P='77777777-7777-4777-8777-777777777777';
const URL=`${ORIGIN}/functions/v1/dpro-car02-stage/api/car02/uploads/${O}/${R}`;
const MIME='image/png';
const png=new Uint8Array([137,80,78,71,13,10,26,10,1,2,3,4]);
const actor={verified:true,shopCode:SHOP,role:'staff',subject:'staff:11111111-1111-4111-8111-111111111111'};
const shaGit=buf=>createHash('sha1').update(Buffer.from(`blob ${buf.length}\0`)).update(buf).digest('hex');
function actualRouter({gate=true}={}){
 const usage={auth:0,upload:0,create:0,business:0};
 const r82=createCar02PhotoUploadHttpR82({shopCode:SHOP,
  releaseEnabled:async()=>gate,
  authenticate:async()=>{usage.auth++;return actor;},
  uploadService:{upload:async x=>{usage.upload++;
   assert.equal(x.shop,SHOP);assert.equal(x.orderId,O);assert.equal(x.reportId,R);
   assert.equal(x.mimeType,MIME);assert.deepEqual(x.bytes,png);
   return {photoId:P,state:'ready',mimeType:MIME,byteSize:png.length,sha256:'a'.repeat(64)};
  }},allowedOrigins:[ORIGIN]});
 const route=createCar02R93UIsolatedStagingRouter({environment:'isolated_qa',dbName:DB,
  reviewGate:async()=>gate,
  createUploadHandler:async()=>{usage.create++;return r82;},
  createBusinessHandler:async()=>{usage.business++;return async()=>new Response('BUSINESS');}});
 return {route,usage};
}
const headers={origin:ORIGIN,'content-type':MIME,authorization:'Bearer local-ci-token-not-live'};
test('original seven approved production and isolated files must remain unchanged and locked',()=>{
 const source={};
 for(const [path,sha] of Object.entries(R93T_APPROVED_BASELINE)){
  const buf=readFileSync(path);assert.equal(shaGit(buf),sha,`drift: ${path}`);source[path]=buf.toString('utf8');
 }
 const report=auditCar02R93TSourceContracts(source);
 assert.equal(report.openCount,6);assert.equal(report.unsafeCount,0);
 assert.equal(report.integrationReady,false);assert.equal(report.releaseDecision,'NO_GO');
 assert.equal(report.migrationDecision,'HOLD');
});
test('exact R82 handler accepts normalized 12-byte PNG through isolated R93U router',async()=>{
 const {route,usage}=actualRouter();
 const res=await route(new Request(URL,{method:'POST',headers,body:png}));
 assert.equal(res.status,201);const data=await res.json();
 assert.equal(data.ok,true);assert.equal(data.photoId,P);assert.equal(data.state,'ready');
 assert.equal(usage.auth,1);assert.equal(usage.upload,1);assert.equal(usage.business,0);
});
test('real R82 preflight works after isolated route normalization',async()=>{
 const {route,usage}=actualRouter();
 const req=new Request(URL,{method:'OPTIONS',headers:{origin:ORIGIN,
  'access-control-request-method':'POST',
  'access-control-request-headers':'authorization, content-type'}});
 const res=await route(req);assert.equal(res.status,204);
 assert.equal(res.headers.get('access-control-allow-origin'),ORIGIN);
 assert.equal(usage.auth,0);assert.equal(usage.upload,0);
});
test('real R82 rejects wrong origin without hitting authentication or upload',async()=>{
 const {route,usage}=actualRouter();
 const res=await route(new Request(URL,{method:'POST',headers:{...headers,origin:'https://bad.example.test'},body:png}));
 assert.equal(res.status,403);assert.equal(usage.auth,0);assert.equal(usage.upload,0);
});
test('R93U gate blocks real R82 before constructing its handler',async()=>{
 const {route,usage}=actualRouter({gate:false});
 const res=await route(new Request(URL,{method:'POST',headers,body:png}));
 assert.equal(res.status,503);assert.equal(usage.create,0);
 assert.equal(usage.auth,0);assert.equal(usage.upload,0);
});
test('still cannot route uploads from existing R51 production boundary',async()=>{
 const {createCar02EdgeBoundaryR51}=await import('./car02-edge-boundary-r51.mjs');
 let n=0;
 const old=createCar02EdgeBoundaryR51({isServerReleased:async()=>false,
  createRuntime:async()=>{n++;throw Error('SHOULD_NOT_CALL');}});
 const res=await old(new Request(URL,{method:'POST',headers,body:png}));
 assert.equal(res.status,404);assert.equal(n,0);
});
console.log('R93U_R82_EXACT_ISOLATED_SOURCE_PASS');
