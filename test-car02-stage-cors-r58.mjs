import test from 'node:test';
import assert from 'node:assert/strict';
import {createCar02StageCorsR58,CAR02_R58_ORIGIN} from './car02-stage-cors-r58.mjs';
import {createCar02EdgeBoundaryR51} from './car02-edge-boundary-r51.mjs';

const URL='https://cbknucemarcpbscirzyv.supabase.co';
const ROOT='/functions/v1/dpro-car02-stage';
const ALIAS='/dpro-car02-stage';
const ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const origins={origin:CAR02_R58_ORIGIN};
let dbTouches=0,authTouches=0;
const locked=()=>createCar02StageCorsR58({handleEdge:createCar02EdgeBoundaryR51({
  isServerReleased:()=>{authTouches++;return false},createRuntime:()=>{dbTouches++;throw Error('should never run')}
})});
const req=(path,method='GET',headers=origins)=>new Request(URL+path,{method,headers});
const preflight=(path,headers={},method='POST')=>req(path,'OPTIONS',{
  ...origins,'Access-Control-Request-Method':method,'Access-Control-Request-Headers':'Authorization, Content-Type, Idempotency-Key',...headers
});
const expectLocked=async r=>{assert.equal(r.status,503);assert.deepEqual(await r.json(),{ok:false,code:'CAR02_NOT_RELEASED'})};

test('R58 staging health GET remains review-only and has exact CORS origin',async()=>{
  const r=await locked()(req(ROOT+'/health'));assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{ok:true,service:'DPRO CAR02 isolated staging gateway',deployment:'review-only',live:false});
  assert.equal(r.headers.get('access-control-allow-origin'),CAR02_R58_ORIGIN);
  assert.equal(r.headers.get('cache-control'),'no-store');
});
test('R58 locked GET never touches runtime and carries CORS for approved origin',async()=>{
  dbTouches=0;authTouches=0;const r=await locked()(req(ROOT+'/api/car02/'+ID));await expectLocked(r);
  assert.equal(r.headers.get('access-control-allow-origin'),CAR02_R58_ORIGIN);
  assert.equal(dbTouches,0);assert.equal(authTouches,1);
});
test('R58 locked POST never reads JSON body and remains 503',async()=>{
  const r=await locked()(new Request(URL+ROOT+'/api/car02',{method:'POST',headers:{...origins,'Content-Type':'application/json'},body:'this-is-not-json'}));await expectLocked(r);assert.equal(r.headers.get('access-control-allow-origin'),CAR02_R58_ORIGIN);
});
test('R58 approved OPTIONS preflight succeeds while release remains locked',async()=>{
  dbTouches=0;authTouches=0;const r=await locked()(preflight(ROOT+'/api/car02'));assert.equal(r.status,204);
  assert.equal(r.headers.get('access-control-allow-origin'),CAR02_R58_ORIGIN);
  assert.equal(r.headers.get('access-control-allow-credentials'),null);
  assert.match(r.headers.get('access-control-allow-headers'),/X-Line-ID-Token/);
  assert.equal(dbTouches,0);assert.equal(authTouches,0);
});
test('R58 LINE customer token preflight allowed without opening the API',async()=>{
  const r=await locked()(preflight(ROOT+'/api/car02/'+ID,{ 'Access-Control-Request-Headers':'X-Line-ID-Token, Content-Type'},'GET'));
  assert.equal(r.status,204);assert.equal(r.headers.get('access-control-max-age'),'300');
});
test('R58 alternate Supabase mount prefix remains compatible',async()=>{
  const r=await locked()(req(ALIAS+'/api/car02'));await expectLocked(r);
  const pre=await locked()(preflight(ALIAS+'/api/car02'));assert.equal(pre.status,204);
});
test('R58 photo endpoint remains locked with no storage access',async()=>{
  dbTouches=0;const r=await locked()(req(ROOT+'/api/car02/photos/'+ID));await expectLocked(r);assert.equal(dbTouches,0);
});
test('R58 unknown origin is denied without CORS allow-origin or runtime',async()=>{
  dbTouches=0;authTouches=0;const r=await locked()(req(ROOT+'/api/car02','GET',{origin:'https://malicious.example'}));assert.equal(r.status,403);assert.equal(r.headers.get('access-control-allow-origin'),null);assert.equal(dbTouches,0);assert.equal(authTouches,0);
});
test('R58 null origin rejected',async()=>{
  const r=await locked()(req(ROOT+'/health','GET',{origin:'null'}));assert.equal(r.status,403);assert.equal(r.headers.get('access-control-allow-origin'),null);
});
test('R58 lookalike origin rejected',async()=>{
  const r=await locked()(req(ROOT+'/api/car02','GET',{origin:CAR02_R58_ORIGIN+'.evil.example'}));assert.equal(r.status,403);
});
test('R58 unknown preflight header rejected and no runtime',async()=>{
  dbTouches=0;authTouches=0;const r=await locked()(preflight(ROOT+'/api/car02',{'Access-Control-Request-Headers':'X-Admin-Bypass'}));assert.equal(r.status,403);assert.equal(dbTouches,0);assert.equal(authTouches,0);
});
test('R58 disallowed DELETE preflight rejected',async()=>{
  const r=await locked()(preflight(ROOT+'/api/car02',{},'DELETE'));assert.equal(r.status,405);
});
test('R58 health POST preflight rejected',async()=>{
  const r=await locked()(preflight(ROOT+'/health',{},'POST'));assert.equal(r.status,405);
});
test('R58 old reservation route remains absent with no allow origin',async()=>{
  const r=await locked()(req(ROOT+'/api/reservations'));assert.equal(r.status,404);assert.equal(r.headers.get('access-control-allow-origin'),null);
});
test('R58 unprefixed route remains rejected',async()=>{
  const r=await locked()(req('/api/car02'));assert.equal(r.status,404);assert.equal(r.headers.get('access-control-allow-origin'),null);
});
test('R58 query bypass refused and no CORS granted',async()=>{
  const r=await locked()(req(ROOT+'/api/car02?release=1'));assert.equal(r.status,404);assert.equal(r.headers.get('access-control-allow-origin'),null);
});
test('R58 without Origin behaves as before: locked GET, no ACAO',async()=>{
  const r=await locked()(req(ROOT+'/api/car02','GET',{}));await expectLocked(r);assert.equal(r.headers.get('access-control-allow-origin'),null);
});
test('R58 no wildcard, cookies, or accessible headers on refused origin',async()=>{
  const r=await locked()(req(ROOT+'/api/car02','GET',{origin:'https://unknown.example'}));assert.equal(r.headers.get('access-control-allow-origin'),null);
  assert.equal(r.headers.get('access-control-allow-credentials'),null);
});
test('R58 cannot use alternate allowed origin or missing boundary handler',()=>{
  assert.throws(()=>createCar02StageCorsR58({handleEdge:()=>{},allowedOrigin:'*'}),/CAR02_CORS_CONFIG_INVALID/);
  assert.throws(()=>createCar02StageCorsR58({}),/CAR02_CORS_CONFIG_INVALID/);
});
test('R58 approved origin error response hides any internal exception details',async()=>{
  const handler=createCar02StageCorsR58({handleEdge:()=>new Response(JSON.stringify({ok:false,code:'CAR02_NOT_RELEASED'}),{status:503,headers:{'Content-Type':'application/json'}})});
  const r=await handler(req(ROOT+'/api/car02'));
  assert.equal(r.status,503);assert.deepEqual(await r.json(),{ok:false,code:'CAR02_NOT_RELEASED'});
});
