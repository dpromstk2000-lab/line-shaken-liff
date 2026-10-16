/** DPRO CAR02 V1.6: staff booking browser -> isolated R44 HTTP -> atomic PG17 booking UUID
 * -> R57/R45 work order. In-process synthetic authority ONLY. NOT production.
 * Requires prior V1.5 PostgreSQL workflow fixture and R52 hard lock.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createCar02Authenticator} from './car02-identity-r44.mjs';
import {createCar02BookingHttpIsolated} from './car02-basic-booking-http-isolated.mjs';
import {createAtomicBookingQa} from './car02-basic-booking-atomic-isolated.mjs';
import {createCar02StaffBookingBrowserIsolated} from './car02-basic-staff-booking-browser-isolated.mjs';
import {createCar02RuntimeR45} from './car02-runtime-r45.mjs';
import {createCar02BrowserClientR57} from './car02-browser-client-r57.mjs';
import {createCar02BasicUiR45Port} from './car02-basic-ui-r45-port-isolated.mjs';
const e=process.env;
if(e.GITHUB_ACTIONS!=='true'||e.NODE_ENV!=='test'||e.CAR02_BASIC_PG17_QA!=='yes'||
   e.CAR02_RELEASE_LOCK!=='true'||e.PGHOST!=='127.0.0.1'||e.PGPORT!=='5432'||
   e.PGUSER!=='postgres'||e.PGPASSWORD!=='qa_only_local'||e.PGDATABASE!=='car02_qa')
 throw Error('CAR02_V16_DISPOSABLE_PG17_ONLY');
if(!readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8').includes('const CAR02_RELEASE_LOCK=true;'))throw Error('CAR02_V16_R52_LOCK_REQUIRED');
const SHOP='street_house_kitsuki',OTHER='other_shop';
const C='11111111-1111-4111-8111-111111111111',V='22222222-2222-4222-8222-222222222222';
const COTHER='33333333-3333-4333-8333-333333333333',VOTHER='44444444-4444-4444-8444-444444444444';
const ORIGIN='https://dpromstk2000-lab.github.io';
const TOKEN='qa-browser-staff-token-not-production';
const URL_QA='https://car02-booking-qa.invalid/api/car02/booking';
const pool=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',password:'qa_only_local',database:'car02_qa',max:8,connectionTimeoutMillis:8000});
const isoDate=(days=13)=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));const d=new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);while(d.getUTCDay()===0)d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)};
const data={customerId:C,vehicleId:V,day:isoDate(),time:'11:30'};
const counts=async table=>{
 if(!['public.ksh_demo_reservations','public.ksh_car02_work_orders','car02_basic_qa.bookings'].includes(table))throw Error('CAR02_V16_INVALID_TABLE');
 return Number((await pool.query(`SELECT count(*)::integer n FROM ${table}`)).rows[0].n);
};
let bookingReleased=false,workReleased=false,authChecks=0,requests=0,passed=0;
const check=async(label,fn)=>{await fn();console.log(`PASS STAFF-BROWSER-PG17 ${++passed}: ${label}`)};
const rejects=async(fn,code)=>assert.rejects(fn,e=>e?.code===code,`Expected ${code}`);
const verifyStaffJwt=async({accessToken})=>{
 authChecks++;if(accessToken!==TOKEN)throw Error('INVALID_SYNTHETIC_TOKEN');
 return{sub:'qa-browser-staff',verified:true,exp:4102444800};
};
const resolveStaffAccess=async({shopCode,userSub})=>({active:shopCode===SHOP&&userSub==='qa-browser-staff',shopCode,userSub,role:'staff'});
const authenticate=createCar02Authenticator({shopCode:SHOP,lineClientId:'qa-browser-nonreal-channel',verifyStaffJwt,resolveStaffAccess,
 verifyLineIdToken:async()=>{throw Error('CUSTOMER_NOT_SUPPORTED')},resolveLineCustomer:async()=>{throw Error('CUSTOMER_NOT_SUPPORTED')},nowSeconds:()=>1790000000});
const booking=createAtomicBookingQa({pool,environment:'disposable_qa',allowDisposableQa:true});
const http=createCar02BookingHttpIsolated({environment:'disposable_qa',allowDisposableQa:true,authenticate,booking,
 releaseEnabled:()=>bookingReleased,allowedOrigins:[ORIGIN]});
const transport=async(url,opts)=>{
 requests++;assert.equal(url,URL_QA);
 const headers=new Headers(opts.headers);headers.set('Origin',ORIGIN);
 return http(new Request(url,{method:opts.method,headers,body:opts.body}));
};
function browser({credentials=async()=>({kind:'staff',token:TOKEN}),connectionEnabled=true}={}){
 return createCar02StaffBookingBrowserIsolated({environment:'isolated_qa',allowIsolatedQa:true,connectionEnabled,
 credentials,fetchImpl:transport,randomUUID,now:()=>new Date()});
}
const runtime=createCar02RuntimeR45({pool,shopCode:SHOP,lineClientId:'qa-browser-nonreal-channel',
 verifyStaffJwt,resolveStaffAccess,verifyLineIdToken:async()=>{throw Error('CUSTOMER_NOT_SUPPORTED')},
 resolveLineCustomer:async()=>{throw Error('CUSTOMER_NOT_SUPPORTED')},
 releaseState:()=>({systemCode:'CAR02',contracted:workReleased,goLiveApproved:workReleased,
 migrationVerified:workReleased,verifiedIdentityBound:workReleased,workerBackendReady:workReleased,externalNotificationsReviewed:workReleased}),
 allowedOrigins:[ORIGIN],nowSeconds:()=>1790000000});
const ui=createCar02BasicUiR45Port({environment:'disposable_qa',allowIsolatedQa:true,
 client:createCar02BrowserClientR57({apiOrigin:'https://car02-staff-browser-qa.invalid',
 credentials:async()=>({kind:'staff',token:TOKEN}),
 fetchImpl:async(url,opts)=>{const headers=new Headers(opts.headers);headers.set('Origin',ORIGIN);return runtime(new Request(url,{method:opts.method,headers,body:opts.body}))},
 cryptoImpl:{randomUUID},connectionEnabled:true})});
try{
 await check('disposable PG17 and prior booking schema exist',async()=>{
  const row=(await pool.query("SELECT current_database() AS db,current_setting('server_version_num')::int AS v")).rows[0];
  assert.equal(row.db,'car02_qa');assert.ok(row.v>=170000&&row.v<180000);
  assert.ok((await pool.query("SELECT to_regclass('car02_basic_qa.bookings') AS o")).rows[0].o);
 });
 const beforeBookings=await counts('car02_basic_qa.bookings'),beforeRefs=await counts('public.ksh_demo_reservations'),beforeOrders=await counts('public.ksh_car02_work_orders');
 await check('browser connection starts disabled; no HTTP or identity touched',async()=>{
  const c=browser({connectionEnabled:false,credentials:async()=>{throw Error('identity must not be reached')}});
  const n=requests;await rejects(()=>c.create(data),'CAR02_BOOKING_UI_CLOSED');assert.equal(requests,n);
 });
 await check('server release guard denies browser request before R44 authentication',async()=>{
  const n=authChecks;await rejects(()=>browser().create(data,{requestKey:'qa-browser-booking-0001'}),'CAR02_NOT_RELEASED');assert.equal(authChecks,n);
  assert.equal(await counts('car02_basic_qa.bookings'),beforeBookings);
 });
 bookingReleased=true; // QA synthetic only; R52 remains source-locked.
 await check('forged browser staff token is rejected by R44',async()=>{
  await rejects(()=>browser({credentials:async()=>({kind:'staff',token:'forged-browser-staff-token'})}).create(data,{requestKey:'qa-browser-forged-0001'}),'CAR02_BOOKING_UNAUTHORIZED');
 });
 await check('browser refuses customer token for staff-assisted booking',async()=>{
  const n=requests;await rejects(()=>browser({credentials:async()=>({kind:'customer',token:'fake-customer-line-token'})}).create(data),'CAR02_BOOKING_UI_IDENTITY_REQUIRED');assert.equal(requests,n);
 });
 await check('browser refuses injected shop or owner role without touching HTTP',async()=>{
  const n=requests;await rejects(()=>browser().create({...data,shopCode:OTHER,role:'owner'}),'CAR02_BOOKING_UI_FIELDS_INVALID');assert.equal(requests,n);
 });
 let bookingResult;
 await check('browser HTTP booking persists UUID in disposable PG17',async()=>{
  bookingResult=await browser().create(data,{requestKey:'qa-browser-booking-0001'});
  assert.match(bookingResult.reservationId,/^[a-f0-9-]{36}$/);assert.equal(bookingResult.day,data.day);
  const q=(await pool.query('SELECT shop_code,customer_id,vehicle_id FROM public.ksh_demo_reservations WHERE id=$1',[bookingResult.reservationId])).rows[0];
  assert.deepEqual(q,{shop_code:SHOP,customer_id:C,vehicle_id:V});
  assert.equal(await counts('car02_basic_qa.bookings'),beforeBookings+1);
  assert.equal(await counts('public.ksh_demo_reservations'),beforeRefs+1);
 });
 await check('same idempotency key returns identical reservation and no duplicate',async()=>{
  const again=await browser().create(data,{requestKey:'qa-browser-booking-0001'});
  assert.deepEqual(again,bookingResult);assert.equal(await counts('public.ksh_demo_reservations'),beforeRefs+1);
 });
 await check('reused request key with changed payload maps to safe 409 conflict',async()=>{
  await rejects(()=>browser().create({...data,time:'12:00'},{requestKey:'qa-browser-booking-0001'}),'CAR02_BOOKING_IDEMPOTENCY_CONFLICT');
 });
 await check('same slot with another key is blocked and makes no orphan reservation',async()=>{
  await rejects(()=>browser().create(data,{requestKey:'qa-browser-booking-0002'}),'CAR02_BOOKING_SLOT_OCCUPIED');
  assert.equal(await counts('public.ksh_demo_reservations'),beforeRefs+1);
 });
 await check('forged foreign customer cannot book via staff origin',async()=>{
  await rejects(()=>browser().create({...data,customerId:COTHER,vehicleId:VOTHER,time:'12:30'},{requestKey:'qa-browser-foreign-0001'}),'CAR02_BOOKING_REFERENCE_SCOPE_MISMATCH');
 });
 await check('R45 work-order API stays closed even after booking created',async()=>{
  await rejects(()=>ui.createFromResolvedReferences({customerId:C,vehicleId:V,reservationId:bookingResult.reservationId,idempotencyKey:'qa-browser-order-0001'}),'CAR02_NOT_RELEASED');
  assert.equal(await counts('public.ksh_car02_work_orders'),beforeOrders);
 });
 workReleased=true;
 await check('R57/R45 creates matching order from HTTP-produced booking UUID',async()=>{
  const order=await ui.createFromResolvedReferences({customerId:C,vehicleId:V,reservationId:bookingResult.reservationId,idempotencyKey:'qa-browser-order-0001'});
  assert.equal(order.state,'draft');assert.equal(order.reservationLinked,true);
  const q=(await pool.query('SELECT reservation_id,customer_id,vehicle_id,shop_code FROM public.ksh_car02_work_orders WHERE id=$1',[order.id])).rows[0];
  assert.deepEqual(q,{reservation_id:bookingResult.reservationId,customer_id:C,vehicle_id:V,shop_code:SHOP});
  assert.equal(await counts('public.ksh_car02_work_orders'),beforeOrders+1);
 });
 await check('only UUID, date, time, and synthetic marker returned to browser',async()=>{
  assert.deepEqual(Object.keys(bookingResult).sort(),['day','reservationId','syntheticOnly','time']);
  assert.ok(!('shopCode' in bookingResult)&&!('token' in bookingResult));
 });
 bookingReleased=false;workReleased=false;
 await check('both gates relock and audit records stay persisted in QA only',async()=>{
  const n=authChecks;await rejects(()=>browser().create({...data,time:'13:00'},{requestKey:'qa-browser-booking-0003'}),'CAR02_NOT_RELEASED');assert.equal(authChecks,n);
  assert.equal(await counts('public.ksh_demo_reservations'),beforeRefs+1);
  assert.equal(await counts('public.ksh_car02_work_orders'),beforeOrders+1);
 });
 console.log(`CAR02_BASIC_STAFF_BOOKING_BROWSER_R44_R57_R45_R13_PG17_PASS ${passed}/${passed} SYNTHETIC_ONLY NO_GO HOLD`);
}catch(err){console.error('CAR02_STAFF_BOOKING_BROWSER_PG17_FAILED',err.code||err.message);process.exitCode=1}
finally{bookingReleased=false;workReleased=false;await pool.end()}
