import assert from 'node:assert/strict';
import test from 'node:test';
import {createCar02R257BasicStagingGateway,R257_CONTRACT} from './car02-r257-basic-staging-gateway-isolated.mjs';
const SH='street_house_kitsuki';
const prefix='/functions/v1/dpro-car02-stage';
const alt='/dpro-car02-stage';
const origin='https://fixture.invalid';
function fixture(){
 let allowed=false,builds=0,requests=[];
 const gateway=createCar02R257BasicStagingGateway({environment:'isolated_qa',dbName:'car02_qa',shopCode:SH,
  reviewGate:async()=>allowed,buildBasicRuntime:async({shopCode,dbName})=>{
   builds++;assert.equal(shopCode,SH);assert.equal(dbName,'car02_qa');
   return async(req)=>{requests.push({path:new URL(req.url).pathname,method:req.method});
     return new Response(JSON.stringify({ok:true,path:new URL(req.url).pathname}),{status:200});};
  }});
 async function call(path,method='GET',body){const req=new Request(origin+path,{method,
  ...(body===undefined?{}:{headers:{'content-type':'application/json'},body})});
  const resp=await gateway(req);return {status:resp.status,result:await resp.json()};}
 return {call,gateway,allow:()=>{allowed=true},relock:()=>{allowed=false},state:()=>({builds,requests})};
}
test('the staging-only boundary requires exact disposable configuration',()=>{
 const base={environment:'isolated_qa',dbName:'car02_qa',shopCode:SH,reviewGate:async()=>true,buildBasicRuntime:async()=>async()=>{}};
 for(const change of [{environment:'production'},{dbName:'customers'},{shopCode:'customer_1'},{reviewGate:null},{buildBasicRuntime:null}])
  assert.throws(()=>createCar02R257BasicStagingGateway({...base,...change}));
});
test('hard release lock denies business before constructing backend',async()=>{
 const f=fixture();const r=await f.call(prefix+'/api/car02');assert.equal(r.status,503);
 assert.equal(r.result.code,'CAR02_NOT_RELEASED');assert.deepEqual(f.state(),{builds:0,requests:[]});
});
test('both supported Edge prefixes normalize to original unprefixed API',async()=>{
 const f=fixture();f.allow();for(const p of [prefix,alt]){
 const r=await f.call(p+'/api/car02');assert.equal(r.status,200);
 assert.equal(r.result.path,'/api/car02');
 }assert.equal(f.state().builds,1);
});
test('review relock denies after an earlier simulated release; no backend invocation',async()=>{
 const f=fixture();f.allow();assert.equal((await f.call(prefix+'/api/car02')).status,200);
 f.relock();assert.equal((await f.call(prefix+'/api/car02')).status,503);
 assert.equal(f.state().requests.length,1);
});
test('unknown paths, legacy paths, query and prefix confusion fail closed',async()=>{
 const f=fixture();f.allow();
 for(const p of ['/api/car02',prefix+'/api/car02?unlock=1',prefix+'/api/legacy-reservations',
  prefix+'-evil/api/car02',prefix+'/api/car02/'+('x'.repeat(36))]){
   assert.equal((await f.call(p)).status,404,p);
  }
 assert.equal(f.state().builds,0);
});
test('photo read and upload remain unavailable, with no backend load',async()=>{
 const f=fixture();f.allow();const uuid='11111111-1111-4111-8111-111111111111';
 for(const p of [prefix,alt]){
  assert.equal((await f.call(p+'/api/car02/photos/'+uuid)).status,404);
  assert.equal((await f.call(p+'/api/car02/photos/'+uuid,'POST','{}')).status,404);
 }assert.equal(f.state().builds,0);
});
test('disallowed method and request body size are blocked before backend',async()=>{
 const f=fixture();f.allow();
 assert.equal((await f.call(prefix+'/api/car02','DELETE')).status,405);
 assert.equal((await f.call(prefix+'/api/car02','POST','x'.repeat(32769))).status,413);
 assert.equal(f.state().builds,0);
});
test('broken backend fails with generic 503, no internal details',async()=>{
 const route=createCar02R257BasicStagingGateway({environment:'isolated_qa',dbName:'car02_qa',shopCode:SH,
  reviewGate:async()=>true,buildBasicRuntime:async()=>{throw Error('PRIVATE DB SECRET');}});
 const r=await route(new Request(origin+prefix+'/api/car02'));
 assert.equal(r.status,503);assert.equal((await r.text()).includes('PRIVATE DB SECRET'),false);
});
test('health reveals isolated QA status only, never live readiness',async()=>{
 const f=fixture();const r=await f.call(prefix+'/health');assert.equal(r.status,200);
 assert.equal(r.result.live,false);assert.equal(r.result.deployment,'review-only');
 assert.equal(f.state().builds,0);
});
test('the contract refuses all production readiness claims',()=>{
 assert.equal(R257_CONTRACT.releaseDecision,'NO_GO');assert.equal(R257_CONTRACT.migrationDecision,'HOLD');
 assert.equal(R257_CONTRACT.deployable,false);assert.equal(R257_CONTRACT.realWorldGatesOpen,12);
});
