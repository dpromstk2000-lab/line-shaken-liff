/**
 * DPRO CAR02 common basic version: ONE continuous disposable PG17 journey.
 * Atomic booking -> verified DB references -> R57 client -> R45 API -> R13 DB
 * -> staff report -> quote -> simulated customer approval -> completion -> history.
 * Synthetic authority ONLY. This is never an application endpoint or deployment file.
 * Run AFTER pg17-car02-basic-booking-to-work-order-isolated.mjs in existing CI.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createAtomicBookingQa} from './car02-basic-booking-atomic-isolated.mjs';
import {createCar02ReferenceBridge} from './car02-basic-reference-bridge-isolated.mjs';
import {createCar02BrowserClientR57} from './car02-browser-client-r57.mjs';
import {createCar02BasicUiR45Port} from './car02-basic-ui-r45-port-isolated.mjs';
import {createCar02RuntimeR45} from './car02-runtime-r45.mjs';

const env=process.env;
if(env.GITHUB_ACTIONS!=='true'||env.NODE_ENV!=='test'||env.CAR02_BASIC_PG17_QA!=='yes'||
 env.CAR02_RELEASE_LOCK!=='true'||env.PGHOST!=='127.0.0.1'||env.PGPORT!=='5432'||
 env.PGUSER!=='postgres'||env.PGPASSWORD!=='qa_only_local'||env.PGDATABASE!=='car02_qa')
 throw Error('CAR02_FULL_JOURNEY_DISPOSABLE_ONLY');
if(!readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8').includes('const CAR02_RELEASE_LOCK=true;'))
 throw Error('CAR02_R52_RELEASE_LOCK_REQUIRED');

const SHOP='street_house_kitsuki';
const CUSTOMER_ID='11111111-1111-4111-8111-111111111111';
const VEHICLE_ID='22222222-2222-4222-8222-222222222222';
const OTHER_BOOKING='77777777-7777-4777-8777-777777777777';
const STAFF_TOKEN='qa-journey-staff-synthetic-no-real-jwt';
const LINE_TOKEN='qa-journey-customer-synthetic-no-real-line';
const ORIGIN='https://dpromstk2000-lab.github.io';
const API='https://car02-full-journey-ci.invalid';
const pool=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',password:'qa_only_local',database:'car02_qa',max:8,connectionTimeoutMillis:8000});
const actor=Object.freeze({verified:true,role:'staff',subject:'qa-journey-staff',shopCode:SHOP});
const booking=createAtomicBookingQa({pool,environment:'disposable_qa',allowDisposableQa:true});
const bridge=createCar02ReferenceBridge({pool,environment:'disposable_qa',allowReadOnlyQa:true});
let release=false,verifyCalls=0,tests=0,order,link,desc;
const check=async(name,run)=>{await run();console.log(`PASS FULL-JOURNEY ${++tests}: ${name}`)};
const denied=(fn,code)=>assert.rejects(fn,e=>e?.code===code||e?.message===code,`Expected ${code}`);
const runtime=createCar02RuntimeR45({
 pool,shopCode:SHOP,lineClientId:'qa-journey-channel',
 verifyStaffJwt:async({accessToken})=>{verifyCalls++;if(accessToken!==STAFF_TOKEN)throw Error('QA_BAD_STAFF_TOKEN');return {sub:'qa-journey-staff',verified:true,exp:4102444800}},
 resolveStaffAccess:async({userSub,shopCode})=>({active:userSub==='qa-journey-staff'&&shopCode===SHOP,userSub,shopCode,role:'staff'}),
 verifyLineIdToken:async({idToken,clientId})=>{verifyCalls++;if(idToken!==LINE_TOKEN||clientId!=='qa-journey-channel')throw Error('QA_BAD_LINE_TOKEN');return {sub:'qa-journey-customer',aud:clientId,iss:'https://access.line.me',exp:4102444800}},
 resolveLineCustomer:async({shopCode,lineSub})=>({active:shopCode===SHOP&&lineSub==='qa-journey-customer',shopCode,lineSub,customerId:CUSTOMER_ID}),
 releaseState:()=>({systemCode:'CAR02',contracted:release,goLiveApproved:release,migrationVerified:release,verifiedIdentityBound:release,workerBackendReady:release,externalNotificationsReviewed:release}),
 allowedOrigins:[ORIGIN],nowSeconds:()=>1790000000
});
const makePort=(kind,token)=>createCar02BasicUiR45Port({environment:'disposable_qa',allowIsolatedQa:true,
 client:createCar02BrowserClientR57({apiOrigin:API,credentials:async()=>({kind,token}),
  fetchImpl:async(url,opts)=>{assert.equal(new URL(url).origin,API);const headers=new Headers(opts.headers);headers.set('Origin',ORIGIN);return runtime(new Request(url,{method:opts.method,headers,body:opts.body}))},
  cryptoImpl:{randomUUID},connectionEnabled:true})});
const staff=makePort('staff',STAFF_TOKEN);
const customer=makePort('customer',LINE_TOKEN);
const forged=makePort('staff','synthetic-invalid-staff-token');
const key=n=>'qa-full-journey-'+n+'-20261016';
function bookingDay(){
 const fields=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 const d=new Date(`${fields.year}-${fields.month}-${fields.day}T00:00:00Z`);
 d.setUTCDate(d.getUTCDate()+4);while(d.getUTCDay()===0)d.setUTCDate(d.getUTCDate()+1);
 return d.toISOString().slice(0,10);
}
const base={customerId:CUSTOMER_ID,vehicleId:VEHICLE_ID,day:bookingDay(),time:'14:30',requestKey:key('booking')};
const count=async(table)=>{
 if(!['public.ksh_demo_reservations','car02_basic_qa.bookings','public.ksh_car02_work_orders'].includes(table))throw Error('CAR02_QA_TABLE_DENIED');
 return Number((await pool.query(`SELECT count(*)::integer AS n FROM ${table}`)).rows[0].n);
};
try{
 await check('disposable database and prior R13 + booking fixture exist',async()=>{
  const d=(await pool.query("SELECT current_database() AS db,current_setting('server_version_num')::integer AS v")).rows[0];
  assert.equal(d.db,'car02_qa');assert.ok(d.v>=170000&&d.v<180000);
  const fixture=await pool.query("SELECT to_regclass('car02_basic_qa.bookings') AS booking,to_regclass('public.ksh_car02_work_orders') AS orders");
  assert.ok(fixture.rows[0].booking&&fixture.rows[0].orders);
 });
 const preReservations=await count('public.ksh_demo_reservations'),preOrders=await count('public.ksh_car02_work_orders');
 await check('atomic booking persists newly assigned UUID',async()=>{
  link=await booking.create({actor,input:base});
  assert.match(link.id,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  assert.equal(link.day,base.day);assert.equal(await count('public.ksh_demo_reservations'),preReservations+1);
 });
 await check('retrying booking returns original UUID without duplicate',async()=>{
  assert.deepEqual(await booking.create({actor,input:base}),link);
  assert.equal(await count('public.ksh_demo_reservations'),preReservations+1);
 });
 await check('server-side resolver verifies booking belongs to customer and vehicle',async()=>{
  desc=await bridge.prepare({actor,customerId:CUSTOMER_ID,vehicleId:VEHICLE_ID,reservationId:link.id,idempotencyKey:key('order')});
  assert.equal(desc.sendable,false);assert.equal(desc.authorization,'SERVER_VERIFICATION_REQUIRED');
  assert.deepEqual(desc.body,{customerId:CUSTOMER_ID,vehicleId:VEHICLE_ID,reservationId:link.id});
 });
 await check('different tenant booking cannot pass server reference bridge',async()=>{
  await denied(()=>bridge.prepare({actor,customerId:CUSTOMER_ID,vehicleId:VEHICLE_ID,reservationId:OTHER_BOOKING,idempotencyKey:key('foreign')}),'CAR02_REFERENCE_SCOPE_MISMATCH');
 });
 await check('closed release rejects R57 UI create before auth and before DB write',async()=>{
  const prev=verifyCalls;
  await denied(()=>staff.createFromResolvedReferences({...desc.body,idempotencyKey:desc.idempotencyKey}),'CAR02_NOT_RELEASED');
  assert.equal(verifyCalls,prev);assert.equal(await count('public.ksh_car02_work_orders'),preOrders);
 });
 release=true; // QA-only synthetic releaseState; R52 hard release lock remains true.
 await check('forged staff credential cannot create order',async()=>{
  await denied(()=>forged.createFromResolvedReferences({...desc.body,idempotencyKey:key('forged')}),'CAR02_UNAUTHORIZED');
  assert.equal(await count('public.ksh_car02_work_orders'),preOrders);
 });
 await check('browser cannot forge tenant or owner role',async()=>{
  await denied(()=>staff.createFromResolvedReferences({...desc.body,idempotencyKey:key('fields'),role:'owner',shopCode:'other_shop'}),'CAR02_CONTRACT_FIELDS_INVALID');
 });
 await check('UI port through R57/R45 persists R13 work order linked to new booking UUID',async()=>{
  order=await staff.createFromResolvedReferences({...desc.body,idempotencyKey:desc.idempotencyKey});
  assert.equal(order.state,'draft');assert.equal(order.reservationLinked,true);
  const rows=(await pool.query('SELECT reservation_id,customer_id,vehicle_id,shop_code FROM public.ksh_car02_work_orders WHERE id=$1',[order.id])).rows;
  assert.deepEqual(rows,[{reservation_id:link.id,customer_id:CUSTOMER_ID,vehicle_id:VEHICLE_ID,shop_code:SHOP}]);
  assert.equal(await count('public.ksh_car02_work_orders'),preOrders+1);
 });
 await check('UI retry is idempotent (no second work order)',async()=>{
  assert.deepEqual(await staff.createFromResolvedReferences({...desc.body,idempotencyKey:desc.idempotencyKey}),order);
  assert.equal(await count('public.ksh_car02_work_orders'),preOrders+1);
 });
 await check('staff adds report and quote using R57/R45',async()=>{
  order=await staff.saveReport({id:order.id,observation:'合成検査・整備報告',expectedVersion:order.version,requestId:key('report')});
  assert.equal(order.statusLabel,'見積作成待ち');
  order=await staff.presentQuote({id:order.id,items:[{name:'ブレーキ点検',price:2000}],expectedVersion:order.version,requestId:key('quote')});
  assert.equal(order.state,'pending');assert.equal(order.totalYen,2200);
 });
 await check('staff cannot make customer-only approval',async()=>{
  await denied(()=>staff.decide({id:order.id,decision:'approved',expectedVersion:order.version,requestId:key('staff-forge')}),'CAR02_UNAUTHORIZED');
 });
 await check('synthetic LINE customer approves own quote and staff completes',async()=>{
  order=await customer.decide({id:order.id,decision:'approved',expectedVersion:order.version,requestId:key('approve')});
  assert.equal(order.state,'approved');
  order=await staff.complete({id:order.id,expectedVersion:order.version,requestId:key('complete')});
  assert.equal(order.state,'completed');
 });
 await check('customer read and history map persisted data without internal fingerprints',async()=>{
  const view=await customer.read(order.id);assert.equal(view.state,'completed');
  assert.ok(!('customerId' in view)&&!('shop' in view));
  const history=await customer.history(order.id);
  assert.ok(history.length>=5);assert.ok(history.every(x=>!('actorFingerprint' in x)&&typeof x.event==='string'));
 });
 await check('stale operation rejected by R45 conflict detection',async()=>{
  await denied(()=>staff.complete({id:order.id,expectedVersion:1,requestId:key('stale')}),'CAR02_VERSION_CONFLICT');
 });
 release=false;
 await check('relock blocks further customer reads without erasing completed records',async()=>{
  const prev=verifyCalls;
  await denied(()=>customer.read(order.id),'CAR02_NOT_RELEASED');
  assert.equal(verifyCalls,prev);
  const q=await pool.query('SELECT status FROM public.ksh_car02_work_orders WHERE id=$1',[order.id]);assert.equal(q.rows[0].status,'completed');
  assert.equal(await count('public.ksh_demo_reservations'),preReservations+1);
 });
 console.log(`CAR02_BASIC_FULL_JOURNEY_R57_R45_R13_PG17_PASS ${tests}/${tests} SYNTHETIC_ONLY NO_GO HOLD`);
}catch(e){console.error('CAR02_BASIC_FULL_JOURNEY_FAILED',e?.code||e?.message);process.exitCode=1}
finally{release=false;await pool.end()}
