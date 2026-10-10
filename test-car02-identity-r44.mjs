import test from 'node:test';
import assert from 'node:assert/strict';
import {createCar02Authenticator,createCar02ReleaseGate} from './car02-identity-r44.mjs';
import {createCar02Api} from './car02-api.mjs';
const SHOP='street_house_kitsuki';
const CLIENT='2010239091';
const C='11111111-1111-4111-8111-111111111111';
const T='fake-line-token-for-tests';
const STAFF='fake-valid-jwt-for-tests';
const clock=() => 1000;
let lineCalls=0,staffCalls=0,customerCalls=0,accessCalls=0;
let bindings={
 shopCode:SHOP,lineClientId:CLIENT,nowSeconds:clock,
 verifyLineIdToken:async ({idToken,clientId})=>{lineCalls++;assert.equal(clientId,CLIENT);return idToken===T?{sub:'Uabcdef123',aud:CLIENT,iss:'https://access.line.me',exp:2000}:null},
 resolveLineCustomer:async ({shopCode,lineSub})=>{customerCalls++;return {shopCode,lineSub,customerId:C,active:true}},
 verifyStaffJwt:async ({accessToken})=>{staffCalls++;return accessToken===STAFF?{sub:'auth-user-1234',verified:true,exp:2000}:null},
 resolveStaffAccess:async ({userSub,shopCode})=>{accessCalls++;return{userSub,shopCode,role:'staff',active:true}}
};
const auth=(override={})=>createCar02Authenticator({...bindings,...override});
const r=(headers)=>new Request('https://example.test/api/car02',{headers});
const denies=async p=>assert.rejects(p,e=>e.code==='CAR02_UNAUTHORIZED'&&e.status===401);
test('no credential fails CLOSED with no resolver access',async()=>{customerCalls=0;accessCalls=0;await denies(auth()(r({})));assert.equal(customerCalls,0);assert.equal(accessCalls,0)});
test('forged role and shop headers ignored; customer identity derived only from verified LINE and lookup',async()=>{
 const a=await auth()(r({'X-Line-ID-Token':T,'X-Actor-Role':'owner','X-Shop-Code':'other_shop','X-Customer-Id':'evil'}));
 assert.deepEqual(a,{verified:true,role:'customer',subject:'line:Uabcdef123',shopCode:SHOP,customerId:C});assert.ok(Object.isFrozen(a));
});
test('invalid LINE token fails before customer lookup',async()=>{customerCalls=0;await denies(auth()(r({'X-Line-ID-Token':'fake-invalid-token'})));assert.equal(customerCalls,0)});
test('LINE audience, issuer and expiration must be valid',async()=>{
 for(const value of [{aud:'wrong'},{iss:'https://attacker.test'},{exp:999}]) {
  const altered=async()=>({...{sub:'Uabc',aud:CLIENT,iss:'https://access.line.me',exp:2000},...value});
  await denies(auth({verifyLineIdToken:altered})(r({'X-Line-ID-Token':T})));
 }
});
test('customer mapping requires active, exact shop, exact subject and UUID',async()=>{
 for(const override of [{active:false},{shopCode:'other'},{lineSub:'other'},{customerId:'not-a-uuid'}]){
  const resolver=async()=>({...{active:true,shopCode:SHOP,lineSub:'Uabcdef123',customerId:C},...override});
  await denies(auth({resolveLineCustomer:resolver})(r({'X-Line-ID-Token':T})));
 }
});
test('staff JWT requires verified signature callback and active matching staff access',async()=>{
 const a=await auth()(r({Authorization:`Bearer ${STAFF}`}));assert.equal(a.role,'staff');assert.equal(a.shopCode,SHOP);
 for(const override of [{active:false},{shopCode:'other_shop'},{userSub:'other'},{role:'admin'}]){
  await denies(auth({resolveStaffAccess:async()=>({...{active:true,userSub:'auth-user-1234',shopCode:SHOP,role:'staff'},...override})})(r({Authorization:`Bearer ${STAFF}`})));
 }
 await denies(auth()(r({Authorization:'Bearer invalid-token-123'})));
 await denies(auth({verifyStaffJwt:async()=>({sub:'auth-user-1234',verified:true})})(r({Authorization:`Bearer ${STAFF}`}))); // missing exp
 await denies(auth({verifyStaffJwt:async()=>({sub:'auth-user-1234',verified:true,exp:999})})(r({Authorization:`Bearer ${STAFF}`}))); // expired
});
test('dual credential ambiguity, malformed bearer, and extra whitespace fail CLOSED',async()=>{
 await denies(auth()(r({Authorization:`Bearer ${STAFF}`,'X-Line-ID-Token':T})));
 await denies(auth()(r({Authorization:'Basic hello'})));
 await denies(auth()(r({'X-Line-ID-Token':'token with spaces'})));
});
test('release gate remains CLOSED until ALL server contract, identity, DB and runtime checks are true',async()=>{
 const yes={systemCode:'CAR02',contracted:true,goLiveApproved:true,migrationVerified:true,
 verifiedIdentityBound:true,workerBackendReady:true,externalNotificationsReviewed:true};
 assert.equal(await createCar02ReleaseGate(yes)(),true);
 for(const k of Object.keys(yes)){assert.equal(await createCar02ReleaseGate({...yes,[k]:k==='systemCode'?'NOT_CAR02':false})(),false,k)}
 assert.equal(await createCar02ReleaseGate(null)(),false);
});
test('release gate blocks CAR02 HTTP router BEFORE any authentication, DB or body parsing',async()=>{
 let authCount=0,serviceCount=0;
 const api=createCar02Api({service:{create:async()=>{serviceCount++;return {}}},authenticate:async()=>{authCount++;return{}},releaseEnabled:createCar02ReleaseGate({systemCode:'CAR02',contracted:false}),allowedOrigins:[]});
 const res=await api(new Request('https://example.test/api/car02',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customerId:C,vehicleId:C})}));
 assert.equal(res.status,503);assert.equal((await res.json()).code,'CAR02_NOT_RELEASED');assert.equal(authCount,0);assert.equal(serviceCount,0);
});
