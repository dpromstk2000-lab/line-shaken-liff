/** V3.2 isolated in-process tests of ACTUAL checked-out R44, booking HTTP, R51.
 * All identity verifier callbacks are FAKE and all requests use Request objects,
 * never HTTP network, production DB, LINE, Worker or Supabase.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCar02Authenticator,createCar02ReleaseGate} from './car02-identity-r44.mjs';
import {createCar02BookingHttpIsolated} from './car02-basic-booking-http-isolated.mjs';
import {createCar02EdgeBoundaryR51} from './car02-edge-boundary-r51.mjs';
const SHOP='street_house_kitsuki',CLIENT='synthetic-qa-line-client';
const C='11111111-1111-4111-8111-111111111111',V='22222222-2222-4222-8222-222222222222';
const RID='33333333-3333-4333-8333-333333333333';
const NOW=1800000000;
const base=()=>({
 shopCode:SHOP,lineClientId:CLIENT,nowSeconds:()=>NOW,
 verifyStaffJwt:async()=>({verified:true,sub:'staff-qa-1',exp:NOW+120}),
 resolveStaffAccess:async()=>({active:true,userSub:'staff-qa-1',shopCode:SHOP,role:'staff'}),
 verifyLineIdToken:async()=>({sub:'line-qa-1',aud:CLIENT,iss:'https://access.line.me',exp:NOW+120}),
 resolveLineCustomer:async()=>({active:true,shopCode:SHOP,lineSub:'line-qa-1',customerId:C})
});
const req=(kind='staff',url='https://car02-qa.invalid/api/car02/booking')=>new Request(url,{method:'GET',headers:kind==='staff'?{'authorization':'Bearer stafftoken987654321'}:kind==='line'?{'x-line-id-token':'lineToken987654321'}:kind==='both'?{'authorization':'Bearer stafftoken987654321','x-line-id-token':'lineToken987654321'}:{}});
const fails=async(fn)=>assert.rejects(fn,/CAR02_UNAUTHORIZED/);
const cases=[];const add=(n,fn)=>cases.push([n,fn]);
add('R44 synthetic staff is server-derived',async()=>{
 const a=await createCar02Authenticator(base())(req());assert.equal(a.role,'staff');assert.equal(a.shopCode,SHOP);assert.equal(a.subject,'staff:staff-qa-1');assert.equal(a.verified,true);
});
add('R44 owner role is allowed only when resolved by server',async()=>{
 const a=await createCar02Authenticator({...base(),resolveStaffAccess:async()=>({...await base().resolveStaffAccess(),role:'owner'})})(req());assert.equal(a.role,'owner');
});
add('R44 LINE customer is server resolved with shop binding',async()=>{
 const a=await createCar02Authenticator(base())(req('line'));assert.equal(a.role,'customer');assert.equal(a.shopCode,SHOP);assert.equal(a.customerId,C);
});
add('R44 rejects missing credential',async()=>fails(()=>createCar02Authenticator(base())(req('none'))));
add('R44 rejects simultaneous staff and LINE credentials',async()=>fails(()=>createCar02Authenticator(base())(req('both'))));
add('R44 rejects unchecked JWT signature proof',async()=>fails(()=>createCar02Authenticator({...base(),verifyStaffJwt:async()=>({verified:false,sub:'staff-qa-1',exp:NOW+120})})(req())));
add('R44 rejects JWT expiry',async()=>fails(()=>createCar02Authenticator({...base(),verifyStaffJwt:async()=>({verified:true,sub:'staff-qa-1',exp:NOW})})(req())));
add('R44 rejects staff verifier error',async()=>fails(()=>createCar02Authenticator({...base(),verifyStaffJwt:async()=>{throw Error('fake-signature-invalid')}})(req())));
add('R44 rejects shop mismatch',async()=>fails(()=>createCar02Authenticator({...base(),resolveStaffAccess:async()=>({...await base().resolveStaffAccess(),shopCode:'other_shop'})})(req())));
add('R44 rejects staff subject mismatch',async()=>fails(()=>createCar02Authenticator({...base(),resolveStaffAccess:async()=>({...await base().resolveStaffAccess(),userSub:'other-user'})})(req())));
add('R44 rejects revoked staff',async()=>fails(()=>createCar02Authenticator({...base(),resolveStaffAccess:async()=>({...await base().resolveStaffAccess(),active:false})})(req())));
add('R44 rejects customer posing as staff',async()=>fails(()=>createCar02Authenticator({...base(),resolveStaffAccess:async()=>({...await base().resolveStaffAccess(),role:'customer'})})(req())));
add('R44 rejects staff lookup failure',async()=>fails(()=>createCar02Authenticator({...base(),resolveStaffAccess:async()=>{throw Error('synthetic resolver down')}})(req())));
add('R44 rejects LINE wrong audience',async()=>fails(()=>createCar02Authenticator({...base(),verifyLineIdToken:async()=>({...await base().verifyLineIdToken(),aud:'foreign'})})(req('line'))));
add('R44 rejects LINE wrong issuer',async()=>fails(()=>createCar02Authenticator({...base(),verifyLineIdToken:async()=>({...await base().verifyLineIdToken(),iss:'https://fake.invalid'})})(req('line'))));
add('R44 rejects LINE expired',async()=>fails(()=>createCar02Authenticator({...base(),verifyLineIdToken:async()=>({...await base().verifyLineIdToken(),exp:NOW-1})})(req('line'))));
add('R44 rejects LINE member in another shop',async()=>fails(()=>createCar02Authenticator({...base(),resolveLineCustomer:async()=>({...await base().resolveLineCustomer(),shopCode:'other_shop'})})(req('line'))));
add('R44 rejects disabled LINE member',async()=>fails(()=>createCar02Authenticator({...base(),resolveLineCustomer:async()=>({...await base().resolveLineCustomer(),active:false})})(req('line'))));
add('R44 rejects LINE subject mismatch',async()=>fails(()=>createCar02Authenticator({...base(),resolveLineCustomer:async()=>({...await base().resolveLineCustomer(),lineSub:'other'})})(req('line'))));
const releaseState={systemCode:'CAR02',contracted:true,goLiveApproved:true,migrationVerified:true,verifiedIdentityBound:true,workerBackendReady:true,externalNotificationsReviewed:true};
add('R44 release gate demands all server checks',async()=>{
 for(const k of Object.keys(releaseState)){const gate=createCar02ReleaseGate({...releaseState,[k]:false});assert.equal(await gate(),false,k)}
});
add('R44 synthetic full release state alone is not R52 release authority',async()=>{
 assert.equal(await createCar02ReleaseGate(releaseState)(),true);
 const f=createCar02EdgeBoundaryR51({isServerReleased:()=>false,createRuntime:()=>{throw Error('UNREACHABLE')}});
 const out=await f(new Request('https://car02-stage.invalid/dpro-car02-stage/api/car02'));assert.equal(out.status,503);
});
const BOOK_BODY={customerId:C,vehicleId:V,day:'2026-10-20',time:'10:00'};
const bookingReq=(body=BOOK_BODY,origin='https://car02-qa.invalid')=>new Request('https://car02-qa.invalid/api/car02/booking',{method:'POST',headers:{'content-type':'application/json','origin':origin,'idempotency-key':'qa-request-123456789'},body:JSON.stringify(body)});
const makeBooking=(more={})=>createCar02BookingHttpIsolated({environment:'disposable_qa',allowDisposableQa:true,allowedOrigins:['https://car02-qa.invalid'],releaseEnabled:async()=>true,authenticate:createCar02Authenticator(base()),booking:{create:async()=>({id:RID,day:'2026-10-20',time:'10:00',shopCode:SHOP,syntheticOnly:true})},...more});
add('booking HTTP locked before identity or DB access',async()=>{
 let called=0;const h=makeBooking({releaseEnabled:async()=>false,authenticate:async()=>{called++;return {}},booking:{create:async()=>{called++;return {}}}});
 const out=await h(bookingReq());assert.equal(out.status,503);assert.equal(called,0);
});
add('booking HTTP forbids unknown origin before auth',async()=>{
 const out=await makeBooking()(bookingReq(BOOK_BODY,'https://foreign.invalid'));assert.equal(out.status,403);
});
add('booking HTTP accepts synthetic verified R44 staff only',async()=>{
 let observed=null;const h=makeBooking({booking:{create:async x=>{observed=x;return {id:RID,day:'2026-10-20',time:'10:00',shopCode:SHOP,syntheticOnly:true}}}});
 const b=bookingReq();b.headers.set('authorization','Bearer stafftoken987654321');
 const out=await h(b);assert.equal(out.status,201);assert.equal(observed.actor.shopCode,SHOP);assert.equal(observed.actor.role,'staff');assert.equal(observed.input.customerId,C);
});
add('booking HTTP denies valid LINE customer as staff',async()=>{
 const b=bookingReq();b.headers.set('x-line-id-token','lineToken987654321');
 const out=await makeBooking()(b);assert.equal(out.status,403);
});
add('booking HTTP denies forged shopCode in body',async()=>{
 const b=bookingReq({...BOOK_BODY,shopCode:'other_shop'});b.headers.set('authorization','Bearer stafftoken987654321');
 const out=await makeBooking()(b);assert.equal(out.status,422);
});
add('booking HTTP denies absent bearer',async()=>{
 const out=await makeBooking()(bookingReq());assert.equal(out.status,401);
});
add('R51 denies legacy /wangan without runtime',async()=>{
 let calls=0;const f=createCar02EdgeBoundaryR51({isServerReleased:()=>{calls++;return true},createRuntime:()=>{calls++;return ()=>{}}});
 const out=await f(new Request('https://car02-stage.invalid/dpro-car02-stage/wangan/api/health'));assert.equal(out.status,404);assert.equal(calls,0);
});
add('R51 denies legacy /ksh without runtime',async()=>{
 const f=createCar02EdgeBoundaryR51({isServerReleased:()=>{throw Error('UNREACHABLE')},createRuntime:()=>{throw Error('UNREACHABLE')}});
 const out=await f(new Request('https://car02-stage.invalid/dpro-car02-stage/ksh/api/reservations'));assert.equal(out.status,404);
});
add('R51 denies unprefixed /api/car02 before runtime',async()=>{
 const f=createCar02EdgeBoundaryR51({isServerReleased:()=>{throw Error('UNREACHABLE')},createRuntime:()=>{throw Error('UNREACHABLE')}});
 const out=await f(new Request('https://car02-stage.invalid/api/car02'));assert.equal(out.status,404);
});
for(const [name,fn] of cases)test(name,fn);
