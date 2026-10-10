// R52 address-path / release-lock regression tests; no network or production access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCar02EdgeBoundaryR51} from './car02-edge-boundary-r51.mjs';
const SITE='https://stage.example.invalid';
const ID='11111111-1111-4111-8111-111111111111';
function make(released=false){
 const trace={created:0,requests:[],checks:0};
 const handler=createCar02EdgeBoundaryR51({
   isServerReleased:()=>{trace.checks++;return released},
   createRuntime:()=>{trace.created++;return async req=>{
    trace.requests.push(req);
    return Response.json({path:new URL(req.url).pathname,method:req.method,token:req.headers.get('X-Line-ID-Token'),body:req.method==='POST'?await req.text():null});
   }}
 });
 return {trace,handler};
}
const call=(h,path,init)=>h(new Request(SITE+path,init));
const paths=['/functions/v1/dpro-car02-stage','/dpro-car02-stage'];
for(const base of paths){
 test('R52 health '+base+' is not a live-release signal',async()=>{
  const {handler,trace}=make();const r=await call(handler,base+'/health');
  assert.equal(r.status,200);assert.deepEqual((await r.json()).live,false);
  assert.deepEqual(trace,{created:0,requests:[],checks:0});
 });
 test('R52 precontract lock '+base+' denies before DB and request parsing',async()=>{
  const {handler,trace}=make();const req={method:'POST',body:'{very invalid json',headers:{'Content-Type':'application/json'}};
  const r=await call(handler,base+'/api/car02',req);
  assert.equal(r.status,503);assert.equal((await r.json()).code,'CAR02_NOT_RELEASED');
  assert.equal(trace.created,0);assert.equal(trace.checks,1);
 });
 test('R52 scoped release routing '+base+' normalizes CAR02 only',async()=>{
  const {handler,trace}=make(true);
  const r=await call(handler,base+'/api/car02/'+ID,{headers:{'X-Line-ID-Token':'fake-test-token'}});
  assert.equal(r.status,200);const data=await r.json();
  assert.equal(data.path,'/api/car02/'+ID);assert.equal(data.token,'fake-test-token');
  assert.equal(trace.created,1);
 });
 test('R52 POST body '+base+' forwarded intact',async()=>{
  const {handler}=make(true);const payload='{"source":"R52"}';
  const r=await call(handler,base+'/api/car02',{method:'POST',headers:{'Content-Type':'application/json'},body:payload});
  assert.equal(r.status,200);assert.equal((await r.json()).body,payload);
 });
}
test('R52 no bare CAR02 or reservation routes can be recognized',async()=>{
 const {handler,trace}=make(true);
 for(const path of ['/api/car02','/api/reservations','/ksh/api/inquiries','/functions/v1/other-system/api/car02',
  '/functions/v1/dpro-car02-stageevil/api/car02','/dpro-car02-stageevil/api/car02','/dpro-car02-stage']){
  assert.equal((await call(handler,path)).status,404,path);
 }
 assert.equal(trace.created,0);
});
test('R52 URL flags reject before release',async()=>{
 const {handler,trace}=make(true);for(const base of paths){
  assert.equal((await call(handler,base+'/api/car02?demo=1')).status,404);
  assert.equal((await call(handler,base+'/health?debug=1')).status,404);
 }
 assert.equal(trace.checks,0);assert.equal(trace.created,0);
});
test('R52 malicious image namespace blocked',async()=>{
 const {handler,trace}=make(true);
 for(const base of paths){for(const path of ['/api/car02/photos-extra/'+ID,'/api/car02/photos/unknown','/api/car02/'+ID+'/delete']){
  assert.equal((await call(handler,base+path)).status,404);
 }}assert.equal(trace.created,0);
});
test('R52 error handling never leaks provider internals',async()=>{
 const handler=createCar02EdgeBoundaryR51({isServerReleased:()=>true,createRuntime:()=>{throw Error('CAR02_SECRET_INTERNAL')}});
 const r=await call(handler,paths[0]+'/api/car02');assert.equal(r.status,503);
 assert.ok(!(await r.text()).includes('SECRET'));
});
