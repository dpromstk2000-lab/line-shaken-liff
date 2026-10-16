/**
 * DPRO CAR02 Basic Version: isolated reference -> verified R45 runtime -> R13 PostgreSQL 17.
 * Disposable GitHub Actions PostgreSQL ONLY. Not production authentication, not deployable.
 * Run AFTER the existing pg17-integration.mjs has created the synthetic baseline and R13.
 * Never receives production credentials, contacts LINE or Supabase, or changes R52.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCar02ReferenceBridge} from './car02-basic-reference-bridge-isolated.mjs';
import {createCar02RuntimeR45} from './car02-runtime-r45.mjs';

const e=process.env;
if(e.GITHUB_ACTIONS!=='true'||e.CAR02_BASIC_PG17_QA!=='yes'||
   e.CAR02_RELEASE_LOCK!=='true'||e.NODE_ENV!=='test'||
   e.PGHOST!=='127.0.0.1'||e.PGPORT!=='5432'||
   e.PGUSER!=='postgres'||e.PGDATABASE!=='car02_qa'||
   e.PGPASSWORD!=='qa_only_local')throw Error('CAR02_BASIC_PG17_DISPOSABLE_ONLY');
const {default:pg}=await import('pg');
const edge=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
if(!edge.includes('const CAR02_RELEASE_LOCK=true;'))throw Error('CAR02_R52_RELEASE_LOCK_MISSING');

const SHOP='street_house_kitsuki';
const OTHER='other_shop';
const CUSTOMER='11111111-1111-4111-8111-111111111111';
const VEHICLE='22222222-2222-4222-8222-222222222222';
const OTHER_CUSTOMER='33333333-3333-4333-8333-333333333333';
const OTHER_VEHICLE='44444444-4444-4444-8444-444444444444';
const BOOKING='66666666-6666-4666-8666-666666666666';
const FOREIGN_BOOKING='77777777-7777-4777-8777-777777777777';
const TOKEN='qa-only-fake-staff-token-not-production';
const ORIGIN='https://dpromstk2000-lab.github.io';
const pool=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',password:'qa_only_local',
  database:'car02_qa',max:2,connectionTimeoutMillis:7000});
const actor=Object.freeze({verified:true,role:'staff',subject:'qa-local-verified-fixture',shopCode:SHOP});
let gate=false,authChecks=0,cases=0;
const pass=async (label,fn)=>{await fn();console.log(`PASS BASIC-PG17 ${++cases}: ${label}`)};
const reject=async (run,pattern)=>{await assert.rejects(run,pattern)};
const rowCount=async(table)=>{
  const allowed={'public.ksh_car02_work_orders':true,'public.ksh_demo_reservations':true};
  if(!allowed[table])throw Error('CAR02_QA_TABLE_NOT_ALLOWED');
  return Number((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);
};
function server() {
 return createCar02RuntimeR45({
  pool,shopCode:SHOP,lineClientId:'qa-only-channel',
  verifyLineIdToken:async()=>{throw Error('CAR02_LINE_DISABLED_IN_BASIC_QA')},
  verifyStaffJwt:async({accessToken})=>{
    authChecks++;
    if(accessToken!==TOKEN)throw Error('FAKE_STAFF_TOKEN_DENIED');
    return {sub:'qa-local-staff',verified:true,exp:4102444800};
  },
  resolveLineCustomer:async()=>{throw Error('CAR02_CUSTOMER_LINE_DISABLED_IN_BASIC_QA')},
  resolveStaffAccess:async({userSub,shopCode})=>({
    active:userSub==='qa-local-staff'&&shopCode===SHOP,role:'staff',userSub,shopCode
  }),
  releaseState:()=>({systemCode:'CAR02',contracted:gate,goLiveApproved:gate,
    migrationVerified:gate,verifiedIdentityBound:gate,workerBackendReady:gate,
    externalNotificationsReviewed:gate}),
  allowedOrigins:[ORIGIN],nowSeconds:()=>1790000000
 });
}
function requestFor(desc,{token=TOKEN,body=desc.body,key=desc.idempotencyKey}={}){
 return new Request('https://car02-basic-qa.invalid'+desc.path,{
  method:desc.method,
  headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`,
    'Idempotency-Key':key,'Origin':ORIGIN},body:JSON.stringify(body)
 });
}
try{
 await pass('PostgreSQL 17 and required R13 tables exist',async()=>{
  const v=await pool.query('SHOW server_version_num');
  assert.ok(Number(v.rows[0].server_version_num)>=170000);
  const r=await pool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'ksh_car02_%'");
  assert.equal(r.rows[0].n,8);
 });
 await pass('insert only synthetic reservations in disposable baseline',async()=>{
  assert.equal(await rowCount('public.ksh_demo_reservations'),0);
  await pool.query(`INSERT INTO public.ksh_demo_reservations(id,shop_code,customer_id,vehicle_id)
    VALUES ($1,$2,$3,$4),($5,$6,$7,$8)`,
    [BOOKING,SHOP,CUSTOMER,VEHICLE,FOREIGN_BOOKING,OTHER,OTHER_CUSTOMER,OTHER_VEHICLE]);
  assert.equal(await rowCount('public.ksh_demo_reservations'),2);
 });
 const bridge=createCar02ReferenceBridge({pool,environment:'disposable_qa',allowReadOnlyQa:true});
 const input={actor,customerId:CUSTOMER,vehicleId:VEHICLE,reservationId:BOOKING,
   idempotencyKey:'CAR02-BASIC-PG17-RESERVATION-LINK-001'};
 const workOrdersBefore=await rowCount('public.ksh_car02_work_orders');
 let desc;
 await pass('read-only bridge verifies the real PG17 customer vehicle reservation associations',async()=>{
  desc=await bridge.prepare(input);
  assert.equal(desc.sendable,false);
  assert.equal(desc.authorization,'SERVER_VERIFICATION_REQUIRED');
  assert.deepEqual(desc.body,{customerId:CUSTOMER,vehicleId:VEHICLE,reservationId:BOOKING});
  assert.deepEqual(Object.keys(desc.body),['customerId','vehicleId','reservationId']);
  assert.equal(await rowCount('public.ksh_car02_work_orders'),workOrdersBefore);
 });
 await pass('real PG17 rejects a foreign-shop booking reference',async()=>{
  await reject(()=>bridge.prepare({...input,reservationId:FOREIGN_BOOKING}),/CAR02_REFERENCE_SCOPE_MISMATCH/);
 });
 await pass('real PG17 rejects foreign-shop customer and vehicle references',async()=>{
  await reject(()=>bridge.prepare({...input,customerId:OTHER_CUSTOMER,vehicleId:OTHER_VEHICLE}),/CAR02_REFERENCE_SCOPE_MISMATCH/);
 });
 await pass('real PG17 rejects a non-owner vehicle reference',async()=>{
  await reject(()=>bridge.prepare({...input,vehicleId:OTHER_VEHICLE}),/CAR02_REFERENCE_SCOPE_MISMATCH/);
 });
 await pass('unverified actor and invalid UUID are rejected before DB access',async()=>{
  await reject(()=>bridge.prepare({...input,actor:{...actor,verified:false}}),/CAR02_REFERENCE_IDENTITY_REQUIRED/);
  await reject(()=>bridge.prepare({...input,customerId:'display name'}),/CAR02_REFERENCE_UUID_REQUIRED/);
 });
 const api=server();
 await pass('server release gate refuses a request before identity verification or business write',async()=>{
  const r=await api(requestFor(desc));assert.equal(r.status,503);
  assert.equal(authChecks,0);
  assert.equal(await rowCount('public.ksh_car02_work_orders'),workOrdersBefore);
 });
 gate=true; // Synthetic CI-only approval. R52 release lock remains hard-coded true.
 await pass('unverified HTTP credentials are rejected by R44 before a write',async()=>{
  const r=await api(requestFor(desc,{token:'qa-forged-staff-token'}));assert.equal(r.status,401);
  assert.equal(await rowCount('public.ksh_car02_work_orders'),workOrdersBefore);
 });
 await pass('HTTP request body may not assert shopCode or role',async()=>{
  const r=await api(requestFor(desc,{body:{...desc.body,shopCode:OTHER,role:'owner'}}));
  assert.equal(r.status,422);
  assert.equal(await rowCount('public.ksh_car02_work_orders'),workOrdersBefore);
 });
 await pass('R45 and R13 reject a foreign-shop reservation even when bridge is bypassed',async()=>{
  const r=await api(requestFor(desc,{body:{customerId:CUSTOMER,vehicleId:VEHICLE,reservationId:FOREIGN_BOOKING},
    key:'CAR02-BASIC-PG17-BYPASS-DENIED-002'}));
  assert.equal(r.status,403);
  assert.equal((await r.json()).code,'CAR02_REFERENCE_SCOPE_MISMATCH');
  assert.equal(await rowCount('public.ksh_car02_work_orders'),workOrdersBefore);
 });
 let result;
 await pass('R45 authenticated synthetic HTTP request writes linked work order to R13 PostgreSQL',async()=>{
  const r=await api(requestFor(desc));assert.equal(r.status,200);
  const json=await r.json();assert.equal(json.ok,true);
  result=json.data;
  assert.equal(result.customerId,CUSTOMER);
  assert.equal(result.vehicleId,VEHICLE);
  assert.equal(result.reservationId,BOOKING);
  const q=await pool.query('SELECT shop_code,customer_id,vehicle_id,reservation_id,status FROM public.ksh_car02_work_orders WHERE id=$1',[result.id]);
  assert.equal(q.rowCount,1);assert.equal(q.rows[0].shop_code,SHOP);
  assert.equal(q.rows[0].reservation_id,BOOKING);assert.equal(q.rows[0].status,'draft');
  assert.equal(await rowCount('public.ksh_car02_work_orders'),workOrdersBefore+1);
 });
 await pass('idempotency replay returns same work order, no duplicate records',async()=>{
  const r=await api(requestFor(desc));assert.equal(r.status,200);
  assert.deepEqual((await r.json()).data,result);
  assert.equal(await rowCount('public.ksh_car02_work_orders'),workOrdersBefore+1);
 });
 await pass('reused idempotency key with a different intent is rejected',async()=>{
  const r=await api(requestFor(desc,{body:{customerId:CUSTOMER,vehicleId:VEHICLE}}));
  assert.equal(r.status,409);assert.equal((await r.json()).code,'CAR02_IDEMPOTENCY_KEY_REUSED');
  assert.equal(await rowCount('public.ksh_car02_work_orders'),workOrdersBefore+1);
 });
 gate=false;
 await pass('gate re-locks while the linked reservation and written work order persist',async()=>{
  const r=await api(requestFor(desc,{key:'CAR02-BASIC-PG17-OTHER-REQUEST-002'}));
  assert.equal(r.status,503);
  const q=await pool.query('SELECT status FROM public.ksh_car02_work_orders WHERE id=$1',[result.id]);
  assert.equal(q.rows[0].status,'draft');
  assert.equal(await rowCount('public.ksh_demo_reservations'),2);
  assert.equal(await rowCount('public.ksh_car02_work_orders'),workOrdersBefore+1);
  assert.ok(readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8').includes('const CAR02_RELEASE_LOCK=true;'));
 });
 console.log(`CAR02_BASIC_REFERENCE_R45_R13_PG17_ISOLATED_PASS ${cases}/${cases} NO_GO HOLD SYNTHETIC_ONLY`);
}catch(error){console.error('CAR02_BASIC_REFERENCE_PG17_FAILED',error.code||error.message);process.exitCode=1}
finally{gate=false;await pool.end()}
