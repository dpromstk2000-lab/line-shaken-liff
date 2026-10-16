/** Synthetic-only, disposable PG17: atomic reservation UUID -> R45 work order.
 * Must run LAST in car02-basic-reference-pg17-qa.yml after existing R13/R45 checks.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {createAtomicBookingQa,ATOMIC_BOOKING_MODE} from './car02-basic-booking-atomic-isolated.mjs';
import {createCar02RuntimeR45} from './car02-runtime-r45.mjs';
const e=process.env;
if(e.GITHUB_ACTIONS!=='true'||e.NODE_ENV!=='test'||e.CAR02_RELEASE_LOCK!=='true'||e.CAR02_BASIC_PG17_QA!=='yes'||
  e.PGHOST!=='127.0.0.1'||e.PGPORT!=='5432'||e.PGUSER!=='postgres'||e.PGPASSWORD!=='qa_only_local'||e.PGDATABASE!=='car02_qa')
 throw Error('CAR02_ATOMIC_BOOKING_PG17_DISPOSABLE_ONLY');
const SHOP='street_house_kitsuki',OTHER='other_shop';
const A='11111111-1111-4111-8111-111111111111',V='22222222-2222-4222-8222-222222222222';
const B='33333333-3333-4333-8333-333333333333',W='44444444-4444-4444-8444-444444444444';
const TOKEN='CAR02-BOOKING-QA-ONLY-NOT-A-JWT';
const pool=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',password:'qa_only_local',database:'car02_qa',max:9,connectionTimeoutMillis:8000});
const staff={verified:true,role:'staff',subject:'qa-local-atomic-staff',shopCode:SHOP};
const other={...staff,shopCode:OTHER};
const booking=createAtomicBookingQa({pool,environment:'disposable_qa',allowDisposableQa:true});
let gate=false,authChecks=0,passed=0;
const check=async(name,fn)=>{await fn();console.log(`PASS BOOKING-PG17 ${++passed}: ${name}`)};
const error=async(fn,code)=>assert.rejects(fn,e=>e?.code===code||e?.message===code,`Expected ${code}`);
const future=(days=2)=>{
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 const local=`${parts.year}-${parts.month}-${parts.day}`;
 const d=new Date(local+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);
 while(d.getUTCDay()===0)d.setUTCDate(d.getUTCDate()+1);
 return d.toISOString().slice(0,10);
};
const day=future(),input={customerId:A,vehicleId:V,day,time:'10:30',requestKey:'qa-atomic-booking-00001'};
const count=async table=>{
 const allowed=new Set(['car02_basic_qa.bookings','public.ksh_demo_reservations','public.ksh_car02_work_orders']);
 if(!allowed.has(table))throw Error('CAR02_QA_INVALID_COUNT_TABLE');
 return Number((await pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n);
};
const runtime=createCar02RuntimeR45({pool,shopCode:SHOP,lineClientId:'qa-only-line-channel',
 verifyLineIdToken:async()=>{throw Error('NO_REAL_LINE')},
 verifyStaffJwt:async({accessToken})=>{
  authChecks++;if(accessToken!==TOKEN)throw Error('BAD_SYNTHETIC_TOKEN');
  return {sub:'qa-atomic-auth-staff',verified:true,exp:4102444800};
 },
 resolveLineCustomer:async()=>{throw Error('NO_REAL_LINE')},
 resolveStaffAccess:async({userSub,shopCode})=>({active:userSub==='qa-atomic-auth-staff'&&shopCode===SHOP,shopCode,userSub,role:'staff'}),
 releaseState:()=>({systemCode:'CAR02',contracted:gate,goLiveApproved:gate,migrationVerified:gate,
  verifiedIdentityBound:gate,workerBackendReady:gate,externalNotificationsReviewed:gate}),
 allowedOrigins:['https://dpromstk2000-lab.github.io'],nowSeconds:()=>1790000000});
async function request(body,key,token=TOKEN){
 const res=await runtime(new Request('https://car02-booking-qa.invalid/api/car02',{method:'POST',headers:{
 'Authorization':'Bearer '+token,'Content-Type':'application/json',
 'Idempotency-Key':key,'Origin':'https://dpromstk2000-lab.github.io'},body:JSON.stringify(body)}));
 return {status:res.status,body:await res.json()};
}
let initial=0,link;
try{
 await check('guarded QA schema creates only in disposable PG17',async()=>{
  await pool.query(readFileSync(new URL('./CAR02_BASIC_BOOKING_ATOMIC_PG17_QA_ONLY.sql',import.meta.url),'utf8'));
  const r=(await pool.query("SELECT current_database() db,current_setting('server_version_num')::integer v")).rows[0];
  assert.equal(r.db,'car02_qa');assert.ok(r.v>=170000&&r.v<180000);
  const rs=(await pool.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='car02_basic_qa.bookings'::regclass")).rows[0];
  assert.equal(rs.relrowsecurity,true);assert.equal(rs.relforcerowsecurity,true);
  assert.equal(await count('car02_basic_qa.bookings'),0);
  initial=await count('public.ksh_demo_reservations');
 });
 await check('create matching customer and vehicle booking with UUID',async()=>{
  link=await booking.create({actor:staff,input});
  assert.equal(link.shopCode,SHOP);assert.equal(link.customerId,A);assert.equal(link.vehicleId,V);
  assert.match(link.id,/^[0-9a-f-]{36}$/);assert.equal(link.day,day);assert.equal(link.time,'10:30');
  assert.equal(await count('car02_basic_qa.bookings'),1);
 });
 await check('R13 baseline reservation stores exact linked UUID and ownership',async()=>{
  const rows=(await pool.query('SELECT id,shop_code,customer_id,vehicle_id FROM public.ksh_demo_reservations WHERE id=$1',[link.id])).rows;
  assert.equal(rows.length,1);assert.deepEqual(rows[0],{id:link.id,shop_code:SHOP,customer_id:A,vehicle_id:V});
 });
 await check('idempotent request returns original booking without orphan insert',async()=>{
  const same=await booking.create({actor:staff,input});assert.deepEqual(same,link);
  assert.equal(await count('car02_basic_qa.bookings'),1);
  assert.equal(await count('public.ksh_demo_reservations'),initial+1);
 });
 await check('changed payload with same request key is rejected',async()=>{
  await error(()=>booking.create({actor:staff,input:{...input,time:'11:00'}}),'CAR02_BOOKING_IDEMPOTENCY_CONFLICT');
  assert.equal(await count('public.ksh_demo_reservations'),initial+1);
 });
 await check('different request in same shop and same slot is rejected',async()=>{
  await error(()=>booking.create({actor:staff,input:{...input,requestKey:'qa-atomic-booking-00002'}}),'CAR02_BOOKING_SLOT_OCCUPIED');
  assert.equal(await count('public.ksh_demo_reservations'),initial+1);
 });
 let otherLink;
 await check('other shop can use same slot with scoped customer and vehicle',async()=>{
  otherLink=await booking.create({actor:other,input:{...input,customerId:B,vehicleId:W,requestKey:'qa-other-booking-00001'}});
  assert.notEqual(otherLink.id,link.id);assert.equal(otherLink.shopCode,OTHER);
 });
 await check('foreign shop customer reference cannot be used in local shop',async()=>{
  await error(()=>booking.create({actor:staff,input:{...input,customerId:B,vehicleId:W,time:'11:30',requestKey:'qa-foreign-booking-00001'}}),'CAR02_BOOKING_REFERENCE_SCOPE_MISMATCH');
 });
 await check('local customer cannot reserve foreign-owned vehicle',async()=>{
  await error(()=>booking.create({actor:staff,input:{...input,vehicleId:W,time:'11:30',requestKey:'qa-wrong-vehicle-00001'}}),'CAR02_BOOKING_REFERENCE_SCOPE_MISMATCH');
 });
 await check('forged staff and bad time are rejected without inserts',async()=>{
  await error(()=>booking.create({actor:{...staff,verified:false},input}),'CAR02_BOOKING_SYNTHETIC_STAFF_REQUIRED');
  await error(()=>booking.create({actor:staff,input:{...input,time:'10:15'}}),'CAR02_BOOKING_TIME_INVALID');
  assert.equal(await count('car02_basic_qa.bookings'),2);
 });
 await check('concurrent same-slot requests create exactly one booking UUID',async()=>{
  const requests=Array.from({length:6},(_,i)=>booking.create({actor:staff,input:{...input,time:'12:30',requestKey:`qa-atomic-race-${String(i).padStart(5,'0')}`}}));
  const settled=await Promise.allSettled(requests);
  assert.equal(settled.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(settled.filter(x=>x.status==='rejected'&&x.reason?.code==='CAR02_BOOKING_SLOT_OCCUPIED').length,5);
  const n=(await pool.query('SELECT count(*)::int n FROM car02_basic_qa.bookings WHERE shop_code=$1 AND day=$2::date AND begins_at=$3::time',[SHOP,day,'12:30'])).rows[0].n;
  assert.equal(n,1);assert.equal(await count('car02_basic_qa.bookings'),3);
  assert.equal(await count('public.ksh_demo_reservations'),initial+3);
 });
 await check('hard R45 release gate stays closed before synthetic identity',async()=>{
  const before=authChecks;const r=await request({customerId:A,vehicleId:V,reservationId:link.id},'qa-case-creation-00001');
  assert.equal(r.status,503);assert.equal(authChecks,before);
 });
 gate=true; // Isolated runner ONLY. This does not touch or bypass R52 production lock.
 await check('forged identity denied even with valid reference UUID',async()=>{
  const r=await request({customerId:A,vehicleId:V,reservationId:link.id},'qa-forged-case-00001','invalid-qa-token');
  assert.equal(r.status,401);
 });
 let order;
 await check('verified synthetic staff links NEW real PG17 booking UUID into R45 R13 work order',async()=>{
  const r=await request({customerId:A,vehicleId:V,reservationId:link.id},'qa-case-creation-00001');
  assert.equal(r.status,200);assert.equal(r.body.ok,true);order=r.body.data;
  assert.equal(order.reservationId,link.id);assert.equal(order.status,'draft');
  const row=(await pool.query('SELECT reservation_id,shop_code,customer_id,vehicle_id FROM public.ksh_car02_work_orders WHERE id=$1',[order.id])).rows[0];
  assert.deepEqual(row,{reservation_id:link.id,shop_code:SHOP,customer_id:A,vehicle_id:V});
 });
 await check('HTTP work order idempotency creates no duplicate',async()=>{
  const r=await request({customerId:A,vehicleId:V,reservationId:link.id},'qa-case-creation-00001');
  assert.equal(r.status,200);assert.deepEqual(r.body.data,order);
 });
 await check('R13 refuses forged other-shop booking without adapter',async()=>{
  const r=await request({customerId:A,vehicleId:V,reservationId:otherLink.id},'qa-foreign-case-00002');
  assert.equal(r.status,403);assert.equal(r.body.code,'CAR02_REFERENCE_SCOPE_MISMATCH');
 });
 gate=false;
 await check('relock prevents further writes while QA reservations persist',async()=>{
  const r=await request({customerId:A,vehicleId:V,reservationId:link.id},'qa-closed-case-00002');
  assert.equal(r.status,503);assert.equal(await count('car02_basic_qa.bookings'),3);
  assert.equal(ATOMIC_BOOKING_MODE.release,'NO_GO');assert.equal(ATOMIC_BOOKING_MODE.productionReady,false);
  const edge=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
  assert.ok(edge.includes('const CAR02_RELEASE_LOCK=true;'));
 });
 console.log(`CAR02_BASIC_ATOMIC_BOOKING_R45_R13_PG17_SYNTHETIC_PASS ${passed}/${passed} NO_GO HOLD`);
}catch(err){console.error('CAR02_ATOMIC_BOOKING_PG17_FAILED',err.code||err.message);process.exitCode=1}
finally{gate=false;await pool.end()}
