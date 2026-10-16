/** CAR02 V1.5: HTTP POST booking -> disposable PG17 UUID -> R57/R45 work order.
 * Synthetic staff verification, in-process Request/Response only. Not a public API.
 * Run after full journey in existing disposable PG17 CI workflow.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createCar02Authenticator} from './car02-identity-r44.mjs';
import {createCar02BookingHttpIsolated} from './car02-basic-booking-http-isolated.mjs';
import {createAtomicBookingQa} from './car02-basic-booking-atomic-isolated.mjs';
import {createCar02RuntimeR45} from './car02-runtime-r45.mjs';
import {createCar02BrowserClientR57} from './car02-browser-client-r57.mjs';
import {createCar02BasicUiR45Port} from './car02-basic-ui-r45-port-isolated.mjs';

const e=process.env;
if(e.GITHUB_ACTIONS!=='true'||e.NODE_ENV!=='test'||e.CAR02_RELEASE_LOCK!=='true'||e.CAR02_BASIC_PG17_QA!=='yes'||
   e.PGHOST!=='127.0.0.1'||e.PGPORT!=='5432'||e.PGUSER!=='postgres'||e.PGPASSWORD!=='qa_only_local'||e.PGDATABASE!=='car02_qa')
  throw Error('CAR02_BOOKING_HTTP_DISPOSABLE_PG17_ONLY');
if(!readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8').includes('const CAR02_RELEASE_LOCK=true;'))
 throw Error('CAR02_R52_LOCK_REQUIRED');
const SHOP='street_house_kitsuki',OTHER='other_shop';
const C='11111111-1111-4111-8111-111111111111',V='22222222-2222-4222-8222-222222222222';
const COTHER='33333333-3333-4333-8333-333333333333',VOTHER='44444444-4444-4444-8444-444444444444';
const ORIGIN='https://dpromstk2000-lab.github.io', TOKEN='qa-http-fake-verified-staff-not-production';
const pool=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',password:'qa_only_local',database:'car02_qa',max:8,connectionTimeoutMillis:8000});
let bookingReleased=false,workReleased=false,authCalls=0,passed=0;
const qa=(name,fn)=>fn().then(()=>{console.log(`PASS HTTP-BOOKING ${++passed}: ${name}`)});
const tokenVerifier=async({accessToken})=>{authCalls++;if(accessToken!==TOKEN)throw Error('SYNTHETIC_TOKEN_DENIED');return {sub:'qa-http-staff',verified:true,exp:4102444800}};
const staffResolver=async({shopCode,userSub})=>({active:shopCode===SHOP&&userSub==='qa-http-staff',shopCode,userSub,role:'staff'});
const auth=createCar02Authenticator({shopCode:SHOP,lineClientId:'qa-http-channel',verifyStaffJwt:tokenVerifier,
 resolveStaffAccess:staffResolver,verifyLineIdToken:async()=>{throw Error('CUSTOMER_BOOKING_UNSUPPORTED')},resolveLineCustomer:async()=>{throw Error('CUSTOMER_BOOKING_UNSUPPORTED')},nowSeconds:()=>1790000000});
const booking=createAtomicBookingQa({pool,environment:'disposable_qa',allowDisposableQa:true});
const http=createCar02BookingHttpIsolated({environment:'disposable_qa',allowDisposableQa:true,authenticate:auth,booking,
 releaseEnabled:()=>bookingReleased,allowedOrigins:[ORIGIN]});
const runtime=createCar02RuntimeR45({pool,shopCode:SHOP,lineClientId:'qa-http-channel',verifyStaffJwt:tokenVerifier,resolveStaffAccess:staffResolver,
 verifyLineIdToken:async()=>{throw Error('CUSTOMER_NOT_ENABLED')},resolveLineCustomer:async()=>{throw Error('CUSTOMER_NOT_ENABLED')},
 releaseState:()=>({systemCode:'CAR02',contracted:workReleased,goLiveApproved:workReleased,
   migrationVerified:workReleased,verifiedIdentityBound:workReleased,workerBackendReady:workReleased,externalNotificationsReviewed:workReleased}),
 allowedOrigins:[ORIGIN],nowSeconds:()=>1790000000});
const api=createCar02BasicUiR45Port({environment:'disposable_qa',allowIsolatedQa:true,
 client:createCar02BrowserClientR57({apiOrigin:'https://car02-http-qa.invalid',credentials:async()=>({kind:'staff',token:TOKEN}),
 fetchImpl:async(url,opts)=>{const headers=new Headers(opts.headers);headers.set('Origin',ORIGIN);return runtime(new Request(url,{method:opts.method,headers,body:opts.body}))},
 cryptoImpl:{randomUUID},connectionEnabled:true})});
function nextDay(){const now=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));const d=new Date(`${now.year}-${now.month}-${now.day}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+7);while(d.getUTCDay()===0)d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)}
const input={customerId:C,vehicleId:V,day:nextDay(),time:'15:30'};
const url='https://car02-http-qa.invalid/api/car02/booking', key='qa-http-booking-001';
const req=({data=input,keyValue=key,token=TOKEN,origin=ORIGIN,method='POST'}={})=>new Request(url,{method,headers:{Origin:origin,'Content-Type':'application/json','Authorization':'Bearer '+token,'Idempotency-Key':keyValue},...(method==='POST'?{body:JSON.stringify(data)}:{})});
const call=async opts=>{const r=await http(req(opts));return {status:r.status,data:await r.json()}};
const count=async(table)=>{if(!['car02_basic_qa.bookings','public.ksh_demo_reservations','public.ksh_car02_work_orders'].includes(table))throw Error('TABLE_NOT_ALLOWED');return Number((await pool.query(`SELECT count(*)::integer n FROM ${table}`)).rows[0].n)};
try{
 await qa('disposable PG17 and R13 booking fixture still present',async()=>{
  const d=(await pool.query("SELECT current_database() db,current_setting('server_version_num')::int v")).rows[0];
  assert.equal(d.db,'car02_qa');assert.ok(d.v>=170000&&d.v<180000);
  assert.ok((await pool.query("SELECT to_regclass('car02_basic_qa.bookings') ok")).rows[0].ok);
 });
 const baseReservations=await count('public.ksh_demo_reservations'),baseBookings=await count('car02_basic_qa.bookings'),baseOrders=await count('public.ksh_car02_work_orders');
 await qa('hard guard denies HTTP before R44 and SQL',async()=>{
  let n=authCalls;const r=await call();assert.equal(r.status,503);assert.equal(authCalls,n);assert.equal(await count('car02_basic_qa.bookings'),baseBookings);
 });
 bookingReleased=true; // Synthetic CI-local gate only, NEVER R52.
 await qa('foreign Origin is rejected without touching auth or DB',async()=>{const n=authCalls;assert.equal((await call({origin:'https://attacker.invalid'})).status,403);assert.equal(authCalls,n)});
 await qa('forged staff token rejected through actual R44 authenticator',async()=>{assert.equal((await call({token:'qa-fake-forged-staff-token'})).status,401)});
 await qa('browser cannot inject tenant or role fields',async()=>{const r=await call({data:{...input,role:'owner',shopCode:OTHER}});assert.equal(r.status,422);assert.equal(r.data.code,'CAR02_BOOKING_FIELDS_INVALID')});
 let reservation;
 await qa('authenticated synthetic HTTP request inserts PG17 booking UUID',async()=>{
  const r=await call();assert.equal(r.status,201);reservation=r.data.data;
  assert.equal(reservation.day,input.day);assert.equal(reservation.time,input.time);
  assert.equal((await pool.query('SELECT shop_code,customer_id,vehicle_id FROM public.ksh_demo_reservations WHERE id=$1',[reservation.reservationId])).rows[0].shop_code,SHOP);
  assert.equal(await count('public.ksh_demo_reservations'),baseReservations+1);assert.equal(await count('car02_basic_qa.bookings'),baseBookings+1);
 });
 await qa('same request key returns same UUID without a duplicate reservation',async()=>{const r=await call();assert.equal(r.status,201);assert.equal(r.data.data.reservationId,reservation.reservationId);assert.equal(await count('car02_basic_qa.bookings'),baseBookings+1)});
 await qa('changed payload with same idempotency key yields 409',async()=>{const r=await call({data:{...input,time:'16:00'}});assert.equal(r.status,409);assert.equal(r.data.code,'CAR02_BOOKING_IDEMPOTENCY_CONFLICT')});
 await qa('same slot and different request key yields 409',async()=>{const r=await call({keyValue:'qa-http-booking-002'});assert.equal(r.status,409);assert.equal(r.data.code,'CAR02_BOOKING_SLOT_OCCUPIED')});
 await qa('foreign customer and vehicle never accepted as local booking',async()=>{const r=await call({data:{...input,customerId:COTHER,vehicleId:VOTHER,time:'16:30'},keyValue:'qa-http-booking-003'});assert.equal(r.status,403);assert.equal(r.data.code,'CAR02_BOOKING_REFERENCE_SCOPE_MISMATCH')});
 await qa('invalid half-hour rejected by backend with status 422',async()=>{const r=await call({data:{...input,time:'15:15'},keyValue:'qa-http-booking-004'});assert.equal(r.status,422);assert.equal(r.data.code,'CAR02_BOOKING_TIME_INVALID')});
 await qa('completed booking commit contains no orphan record',async()=>{const r=await pool.query('SELECT id FROM public.ksh_demo_reservations WHERE id=$1',[reservation.reservationId]);assert.equal(r.rowCount,1);assert.equal(await count('car02_basic_qa.bookings'),baseBookings+1)});
 await qa('R45 work order release still closed when booking QA release is open',async()=>{await assert.rejects(api.createFromResolvedReferences({customerId:C,vehicleId:V,reservationId:reservation.reservationId,idempotencyKey:'qa-http-order-001'}),e=>e.code==='CAR02_NOT_RELEASED');assert.equal(await count('public.ksh_car02_work_orders'),baseOrders)});
 workReleased=true; // synthetic R45 only; real R52 lock unchanged
 await qa('new HTTP booking UUID links to R45 R13 work order via R57',async()=>{
  const order=await api.createFromResolvedReferences({customerId:C,vehicleId:V,reservationId:reservation.reservationId,idempotencyKey:'qa-http-order-001'});
  assert.equal(order.state,'draft');assert.equal(order.reservationLinked,true);
  const row=(await pool.query('SELECT reservation_id,customer_id,vehicle_id,shop_code FROM public.ksh_car02_work_orders WHERE id=$1',[order.id])).rows[0];
  assert.deepEqual(row,{reservation_id:reservation.reservationId,customer_id:C,vehicle_id:V,shop_code:SHOP});
  assert.equal(await count('public.ksh_car02_work_orders'),baseOrders+1);
 });
 bookingReleased=false;workReleased=false;
 await qa('both HTTP gates relock without erasing completed test writes',async()=>{const n=authCalls;assert.equal((await call({keyValue:'qa-http-booking-006'})).status,503);assert.equal(authCalls,n);assert.equal(await count('public.ksh_demo_reservations'),baseReservations+1)});
 console.log(`CAR02_BASIC_BOOKING_HTTP_R44_R57_R45_R13_PG17_PASS ${passed}/${passed} SYNTHETIC_ONLY NO_GO HOLD`);
}catch(e){console.error('CAR02_BOOKING_HTTP_PG17_FAILED',e.code||e.message);process.exitCode=1}
finally{bookingReleased=false;workReleased=false;await pool.end()}
