import test from 'node:test';
import assert from 'node:assert/strict';
import {createCar02StaffBookingBrowserIsolated,validateStaffBookingBrowserInput,CAR02_STAFF_BOOKING_BROWSER_MODE} from './car02-basic-staff-booking-browser-isolated.mjs';
const CUSTOMER='11111111-1111-4111-8111-111111111111',VEHICLE='22222222-2222-4222-8222-222222222222',BOOKING='99999999-9999-4999-8999-999999999999';
const NOW=new Date('2026-10-16T00:00:00Z');
const input={customerId:CUSTOMER,vehicleId:VEHICLE,day:'2026-10-19',time:'10:30'};
const success=()=>new Response(JSON.stringify({ok:true,data:{reservationId:BOOKING,day:input.day,time:input.time,syntheticOnly:true}}),{status:201,headers:{'Content-Type':'application/json'}});
const fail=(status,code)=>new Response(JSON.stringify({ok:false,code}),{status,headers:{'Content-Type':'application/json'}});
let calls=[];const options=(extra={})=>({environment:'isolated_qa',allowIsolatedQa:true,connectionEnabled:true,
 credentials:async()=>({kind:'staff',token:'synthetic-staff-not-jwt'}),fetchImpl:async(...args)=>(calls.push(args),success()),now:()=>NOW,randomUUID:()=>BOOKING,...extra});
const client=(extra={})=>createCar02StaffBookingBrowserIsolated(options(extra));
const throws=(fn,code)=>assert.throws(fn,{code});
const rejects=(fn,code)=>assert.rejects(fn,e=>e?.code===code,`Expected ${code}`);
test('mode is non-deployable, never claims real customer authentication',()=>{
 assert.equal(CAR02_STAFF_BOOKING_BROWSER_MODE.release,'NO_GO');assert.equal(CAR02_STAFF_BOOKING_BROWSER_MODE.realAuth,false);assert.equal(CAR02_STAFF_BOOKING_BROWSER_MODE.customerSelfBooking,false);
});
test('strict input accepts Tokyo future half-hour',()=>assert.deepEqual(validateStaffBookingBrowserInput(input,{now:NOW}),input));
test('rejects user-supplied owner role or tenant',()=>throws(()=>validateStaffBookingBrowserInput({...input,role:'owner'},{now:NOW}),'CAR02_BOOKING_UI_FIELDS_INVALID'));
test('rejects missing and label-only IDs',()=>{throws(()=>validateStaffBookingBrowserInput({...input,customerId:'customer label'},{now:NOW}),'CAR02_BOOKING_UI_REFERENCE_INVALID');throws(()=>validateStaffBookingBrowserInput({...input,vehicleId:null},{now:NOW}),'CAR02_BOOKING_UI_REFERENCE_INVALID')});
test('rejects invalid month and February rollover',()=>{for(const day of ['2026-13-01','2027-02-30'])throws(()=>validateStaffBookingBrowserInput({...input,day},{now:NOW}),'CAR02_BOOKING_UI_DATE_INVALID')});
test('rejects closed Sundays',()=>throws(()=>validateStaffBookingBrowserInput({...input,day:'2026-10-18'},{now:NOW}),'CAR02_BOOKING_UI_CLOSED_DAY'));
test('rejects minute grid mismatch',()=>throws(()=>validateStaffBookingBrowserInput({...input,time:'10:15'},{now:NOW}),'CAR02_BOOKING_UI_TIME_INVALID'));
test('rejects outside opening hours',()=>{for(const time of ['08:30','18:00'])throws(()=>validateStaffBookingBrowserInput({...input,time},{now:NOW}),'CAR02_BOOKING_UI_HOURS_INVALID')});
test('blocks past day and over 60 days',()=>{for(const day of ['2026-10-15','2026-12-17'])throws(()=>validateStaffBookingBrowserInput({...input,day},{now:NOW}),'CAR02_BOOKING_UI_WINDOW_INVALID')});
test('today past Tokyo local time rejected',()=>throws(()=>validateStaffBookingBrowserInput({...input,day:'2026-10-16',time:'09:30'},{now:new Date('2026-10-16T01:00:00Z')}),'CAR02_BOOKING_UI_WINDOW_INVALID'));
test('requires isolated QA and explicit injected dependencies',()=>{
 throws(()=>createCar02StaffBookingBrowserIsolated({environment:'production',allowIsolatedQa:true,fetchImpl:()=>{},credentials:()=>{},randomUUID:()=>''}),'CAR02_BOOKING_UI_ISOLATION_REQUIRED');
 throws(()=>createCar02StaffBookingBrowserIsolated(options({fetchImpl:undefined})),'CAR02_BOOKING_UI_ISOLATION_REQUIRED');
});
test('rejects arbitrary real or modified endpoint',()=>{for(const endpoint of ['https://example.com','https://car02-booking-qa.invalid/api/car02','http://car02-booking-qa.invalid/api/car02/booking'])throws(()=>createCar02StaffBookingBrowserIsolated(options({endpoint})),'CAR02_BOOKING_UI_ISOLATION_REQUIRED')});
test('defaults to closed and never contacts identity provider or transport',async()=>{let count=0;const p=createCar02StaffBookingBrowserIsolated(options({connectionEnabled:false,credentials:()=>{count++;throw Error()},fetchImpl:()=>{count++;throw Error()}}));await rejects(()=>p.create(input),'CAR02_BOOKING_UI_CLOSED');assert.equal(count,0)});
test('sends strict body and bearer header with no secrets in query or cookie',async()=>{
 calls=[];const r=await client().create(input,{requestKey:'qa-booking-request-001'});assert.equal(r.reservationId,BOOKING);
 const [url,opts]=calls[0];assert.equal(url,'https://car02-booking-qa.invalid/api/car02/booking');assert.equal(opts.method,'POST');assert.deepEqual(JSON.parse(opts.body),input);
 assert.equal(opts.headers.get('Authorization'),'Bearer synthetic-staff-not-jwt');assert.equal(opts.headers.get('Idempotency-Key'),'qa-booking-request-001');
 assert.equal(opts.headers.has('Cookie'),false);assert.equal(opts.headers.has('Origin'),false);
 assert.equal(opts.credentials,'omit');assert.equal(opts.redirect,'error');assert.equal(opts.referrerPolicy,'no-referrer');
});
test('supplied request key is reused for deliberate retry',async()=>{calls=[];await client().create(input,{requestKey:'same-booking-request-123'});await client().create(input,{requestKey:'same-booking-request-123'});assert.equal(calls.length,2);assert.equal(calls[0][1].headers.get('Idempotency-Key'),calls[1][1].headers.get('Idempotency-Key'))});
test('generated request key is valid UUID-derived isolated string',async()=>{calls=[];await client().create(input);assert.equal(calls[0][1].headers.get('Idempotency-Key'),'qa-booking-'+BOOKING)});
test('short, whitespace and newline-containing idempotency keys fail closed',async()=>{calls=[];for(const requestKey of ['short','invalid key with space','bad\nkey'])await rejects(()=>client().create(input,{requestKey}),'CAR02_BOOKING_UI_KEY_INVALID');assert.equal(calls.length,0)});
test('customer credential, missing token and forged header are refused',async()=>{
 for(const credentials of [async()=>({kind:'customer',token:'sample-line-token'}),async()=>({kind:'staff',token:'too'}),async()=>({kind:'staff',token:'in validtoken'}),async()=>{throw Error('UNAVAILABLE')}]){
  calls=[];await rejects(()=>client({credentials}).create(input),'CAR02_BOOKING_UI_IDENTITY_REQUIRED');assert.equal(calls.length,0);
 }
});
test('server 401 or 403 preserved without leaking error body',async()=>{
 for(const [status,code] of [[401,'CAR02_BOOKING_UNAUTHORIZED'],[403,'CAR02_BOOKING_REFERENCE_SCOPE_MISMATCH']]){
  await rejects(()=>client({fetchImpl:async()=>fail(status,code)}).create(input),code);
 }
});
test('server duplicate slot and idempotency conflict mapped to 409',async()=>{
 for(const code of ['CAR02_BOOKING_SLOT_OCCUPIED','CAR02_BOOKING_IDEMPOTENCY_CONFLICT'])await rejects(()=>client({fetchImpl:async()=>fail(409,code)}).create(input),code);
});
test('server release 503 remains closed',async()=>rejects(()=>client({fetchImpl:async()=>fail(503,'CAR02_NOT_RELEASED')}).create(input),'CAR02_NOT_RELEASED'));
test('unknown server error masked',async()=>rejects(()=>client({fetchImpl:async()=>fail(500,'SERVER_SECRET_DONT_LEAK')}).create(input),'CAR02_BOOKING_UI_HTTP_ERROR'));
test('invalid MIME and response JSON denied',async()=>{
 for(const response of [new Response('<html>error</html>',{status:200,headers:{'content-type':'text/html'}}),new Response('{bad',{status:201,headers:{'content-type':'application/json'}})])await rejects(()=>client({fetchImpl:async()=>response}).create(input),'CAR02_BOOKING_UI_RESPONSE_INVALID');
});
test('response must match submitted date and time and contain synthetic flag',async()=>{
 for(const data of [{reservationId:BOOKING,day:input.day,time:'14:30',syntheticOnly:true},{reservationId:BOOKING,day:input.day,time:input.time,syntheticOnly:false},{reservationId:'bad',day:input.day,time:input.time,syntheticOnly:true}]){
  await rejects(()=>client({fetchImpl:async()=>new Response(JSON.stringify({ok:true,data}),{status:201,headers:{'content-type':'application/json'}})}).create(input),'CAR02_BOOKING_UI_RESPONSE_INVALID');
 }
});
test('response with extra tenant or secret fields denied',async()=>rejects(()=>client({fetchImpl:async()=>new Response(JSON.stringify({ok:true,data:{reservationId:BOOKING,day:input.day,time:input.time,syntheticOnly:true,shopCode:'wrong'}}),{status:201,headers:{'content-type':'application/json'}})}).create(input),'CAR02_BOOKING_UI_RESPONSE_INVALID'));
test('oversize response rejected before parsing',async()=>rejects(()=>client({fetchImpl:async()=>new Response(JSON.stringify({ok:true,data:{padding:'x'.repeat(5000)}}),{status:201,headers:{'content-type':'application/json'}})}).create(input),'CAR02_BOOKING_UI_RESPONSE_TOO_LARGE'));
test('transport exception denies without exposing endpoint details',async()=>rejects(()=>client({fetchImpl:async()=>{throw Error('connection error with internal URL')}}).create(input),'CAR02_BOOKING_UI_TRANSPORT_UNAVAILABLE'));
