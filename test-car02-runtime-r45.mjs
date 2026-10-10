import test from 'node:test';
import assert from 'node:assert/strict';
import {createCar02RuntimeR45} from './car02-runtime-r45.mjs';
import {createCar02Api} from './car02-api.mjs';
const A='11111111-1111-4111-8111-111111111111';
const gate={systemCode:'CAR02',contracted:true,goLiveApproved:true,migrationVerified:true,
 verifiedIdentityBound:true,workerBackendReady:true,externalNotificationsReviewed:true};
const ok=(extras={})=>({pool:{connect:async()=>{throw Error('should not connect')}},shopCode:'street_house_kitsuki',lineClientId:'2010239091',
 verifyLineIdToken:async()=>({sub:'unit-member',aud:'2010239091',iss:'https://access.line.me',exp:4102444800}),
 verifyStaffJwt:async()=>({sub:'unit-staff',verified:true,exp:4102444800}),
 resolveLineCustomer:async()=>({active:true,shopCode:'street_house_kitsuki',lineSub:'unit-member',customerId:A}),
 resolveStaffAccess:async()=>({active:true,shopCode:'street_house_kitsuki',userSub:'unit-staff',role:'staff'}),
 releaseState:gate,allowedOrigins:['https://dpromstk2000-lab.github.io'],nowSeconds:()=>1000,...extras});
const url='https://api.example.invalid/api/car02';
const input=(path='',method='GET',headers={},body)=>new Request(url+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});

test('staging runtime rejects missing pool',()=>{assert.throws(()=>createCar02RuntimeR45({...ok(),pool:null}),/POOL_REQUIRED/)});
test('staging runtime rejects missing cryptographic verifier callback',()=>{assert.throws(()=>createCar02RuntimeR45({...ok(),verifyLineIdToken:null}),/IDENTITY_CONFIG_REQUIRED/)});
test('staging runtime rejects missing release state',()=>{assert.throws(()=>createCar02RuntimeR45({...ok(),releaseState:undefined}),/RELEASE_GATE_REQUIRED/)});
test('staging runtime rejects unsafe CORS origin',()=>{assert.throws(()=>createCar02RuntimeR45({...ok(),allowedOrigins:['*']}),/ORIGIN_ALLOWLIST_INVALID/)});
test('unreleased route blocks staff authorization and DB access',async()=>{
 let called=false;const a=createCar02RuntimeR45(ok({releaseState:()=>{called=true;return{...gate,contracted:false}}}));
 const r=await a(input('/'+A,'GET',{'Authorization':'Bearer unit-staff-token-1'}));
 assert.equal(r.status,503);assert.equal((await r.json()).code,'CAR02_NOT_RELEASED');assert.equal(called,true);
});
test('missing auth on released route is refused, no DB reads',async()=>{
 const a=createCar02RuntimeR45(ok());const r=await a(input('/'+A));
 assert.equal(r.status,401);assert.equal((await r.json()).code,'CAR02_UNAUTHORIZED');
});
test('CORS preflight allows verified LINE ID token header',async()=>{
 const a=createCar02Api({service:{},authenticate:async()=>null,releaseEnabled:()=>false,allowedOrigins:['https://dpromstk2000-lab.github.io']});
 const r=await a(input('', 'OPTIONS',{'Origin':'https://dpromstk2000-lab.github.io','Access-Control-Request-Headers':'x-line-id-token'}));
 assert.equal(r.status,204);assert.ok(r.headers.get('Access-Control-Allow-Headers').toLowerCase().includes('x-line-id-token'));
});
test('unlisted origin blocked before release, auth, or DB',async()=>{
 const a=createCar02RuntimeR45(ok());const r=await a(input('/'+A,'GET',{'Origin':'https://attacker.example'}));
 assert.equal(r.status,403);assert.equal((await r.json()).code,'CAR02_ORIGIN_DENIED');
});
test('simultaneous LINE and staff credentials are refused',async()=>{
 const a=createCar02RuntimeR45(ok());const r=await a(input('/'+A,'GET',{'Authorization':'Bearer unit-staff-token-1','X-Line-ID-Token':'unit-line-token'}));
 assert.equal(r.status,401);
});
test('client-provided shop/role fields do not become actor',async()=>{
 const a=createCar02RuntimeR45(ok());const r=await a(input('', 'POST',{'Authorization':'Bearer unit-staff-token-1','Content-Type':'application/json'},
 {customerId:A,vehicleId:A,shopCode:'other_shop',role:'owner'}));
 assert.equal(r.status,422);assert.equal((await r.json()).code,'CAR02_BODY_FIELDS_INVALID');
});
