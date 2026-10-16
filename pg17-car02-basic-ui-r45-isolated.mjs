/**
 * DPRO CAR02: R57 browser transport -> UI presentation port -> R45 HTTP -> R13 PG17.
 * Disposable CI-only PostgreSQL; synthetic staff and LINE credentials, NO real authentication.
 * The UI preview HTML remains separate and disconnected from production endpoints.
 * Precondition: pg17-integration.mjs and pg17-car02-basic-reference-to-api-isolated.mjs completed.
 */
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {createCar02RuntimeR45} from './car02-runtime-r45.mjs';
import {createCar02BrowserClientR57} from './car02-browser-client-r57.mjs';
import {createCar02BasicUiR45Port,CAR02_BASIC_UI_PORT_MODE} from './car02-basic-ui-r45-port-isolated.mjs';

const env=process.env;
if(env.GITHUB_ACTIONS!=='true'||env.NODE_ENV!=='test'||env.CAR02_RELEASE_LOCK!=='true'||
   env.CAR02_BASIC_PG17_QA!=='yes'||env.PGHOST!=='127.0.0.1'||env.PGPORT!=='5432'||
   env.PGUSER!=='postgres'||env.PGPASSWORD!=='qa_only_local'||env.PGDATABASE!=='car02_qa')
 throw Error('CAR02_UI_R45_DISPOSABLE_PG17_ONLY');
const shop='street_house_kitsuki';
const customerId='11111111-1111-4111-8111-111111111111';
const vehicleId='22222222-2222-4222-8222-222222222222';
const bookingId='66666666-6666-4666-8666-666666666666';
const foreignBooking='77777777-7777-4777-8777-777777777777';
const fakeApi='https://car02-ui-disposable.invalid';
const origin='https://dpromstk2000-lab.github.io';
const STAFF='qa-ui-staff-ONLY-no-real-jwt';
const CUSTOMER='qa-ui-customer-ONLY-no-real-line';
const pool=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',password:'qa_only_local',database:'car02_qa',max:3});
let gate=false,authCalls=0,requests=0,checks=0;
const ok=async(label,fn)=>{await fn();checks++;console.log(`PASS UI-R45-PG17 ${checks}: ${label}`)};
const rejected=async(fn,code)=>assert.rejects(fn,e=>e?.code===code||e?.message===code,`Expected ${code}`);

const handle=createCar02RuntimeR45({
 pool,shopCode:shop,lineClientId:'qa-ui-disposable-channel',
 verifyStaffJwt:async({accessToken})=>{
  authCalls++;if(accessToken!==STAFF)throw Error('INVALID_SYNTHETIC_TOKEN');
  return {sub:'ui-qa-staff',verified:true,exp:4102444800};
 },
 resolveStaffAccess:async({userSub,shopCode})=>({active:userSub==='ui-qa-staff'&&shopCode===shop,userSub,shopCode,role:'staff'}),
 verifyLineIdToken:async({idToken,clientId})=>{
  authCalls++;if(idToken!==CUSTOMER||clientId!=='qa-ui-disposable-channel')throw Error('INVALID_SYNTHETIC_LINE');
  return {sub:'ui-qa-line',aud:clientId,iss:'https://access.line.me',exp:4102444800};
 },
 resolveLineCustomer:async({shopCode,lineSub})=>({active:shopCode===shop&&lineSub==='ui-qa-line',shopCode,lineSub,customerId}),
 releaseState:()=>({systemCode:'CAR02',contracted:gate,goLiveApproved:gate,
  migrationVerified:gate,verifiedIdentityBound:gate,workerBackendReady:gate,externalNotificationsReviewed:gate}),
 allowedOrigins:[origin],nowSeconds:()=>1790000000
});
function transport(kind,token){
 return createCar02BrowserClientR57({apiOrigin:fakeApi,credentials:async()=>({kind,token}),
  // IN-PROCESS transport only. No external fetch, no real URL is contacted.
  fetchImpl:async(url,opts)=>{
   assert.equal(new URL(url).origin,fakeApi);requests++;
   const headers=new Headers(opts.headers);
   headers.set('Origin',origin);
   return handle(new Request(url,{method:opts.method,headers,body:opts.body}));
  },
  cryptoImpl:{randomUUID},connectionEnabled:true});
}
const staff=createCar02BasicUiR45Port({environment:'disposable_qa',allowIsolatedQa:true,client:transport('staff',STAFF)});
const customer=createCar02BasicUiR45Port({environment:'disposable_qa',allowIsolatedQa:true,client:transport('customer',CUSTOMER)});
const forged=createCar02BasicUiR45Port({environment:'disposable_qa',allowIsolatedQa:true,client:transport('staff','fake-staff-token-invalid')});
const key=i=>'CAR02-UI-R45-PG17-'+i;
const refs={customerId,vehicleId,reservationId:bookingId,idempotencyKey:key('create')};
let created;
try{
 await ok('PostgreSQL 17 and isolated CAR02 schema exist',async()=>{
  assert.ok(Number((await pool.query('SHOW server_version_num')).rows[0].server_version_num)>=170000);
  assert.equal((await pool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'ksh_car02_%'")).rows[0].n,8);
  assert.equal((await pool.query('SELECT count(*)::int n FROM public.ksh_demo_reservations WHERE id=$1',[bookingId])).rows[0].n,1);
 });
 await ok('server release gate returns 503 before authentication when closed',async()=>{
  const before=authCalls;
  await rejected(()=>staff.createFromResolvedReferences(refs),'CAR02_NOT_RELEASED');
  assert.equal(authCalls,before);
 });
 gate=true; // Synthetic runner only; R52 remains hard locked in repository.
 await ok('forged staff identity denied via R44 and R45',async()=>{
  await rejected(()=>forged.createFromResolvedReferences(refs),'CAR02_UNAUTHORIZED');
 });
 await ok('untrusted browser cannot assert shop or role in create body',async()=>{
  await rejected(()=>staff.createFromResolvedReferences({...refs,shopCode:'other_shop',role:'owner'}),'CAR02_CONTRACT_FIELDS_INVALID');
 });
 await ok('R57 creates reservation-linked order using R45, R13 and real disposable PG17',async()=>{
  created=await staff.createFromResolvedReferences(refs);
  assert.equal(created.state,'draft');assert.equal(created.reservationLinked,true);
  const row=(await pool.query('SELECT customer_id,vehicle_id,reservation_id,shop_code,status FROM public.ksh_car02_work_orders WHERE id=$1',[created.id])).rows[0];
  assert.equal(row.customer_id,customerId);assert.equal(row.vehicle_id,vehicleId);
  assert.equal(row.reservation_id,bookingId);assert.equal(row.shop_code,shop);
  assert.equal(created.statusLabel,'整備報告待ち');
 });
 await ok('idempotent UI retry returns identical order',async()=>{
  const again=await staff.createFromResolvedReferences(refs);assert.deepEqual(again,created);
 });
 await ok('R13 rejects other-shop reservation even through browser transport',async()=>{
  await rejected(()=>staff.createFromResolvedReferences({...refs,reservationId:foreignBooking,idempotencyKey:key('foreign')}),'CAR02_REFERENCE_SCOPE_MISMATCH');
 });
 await ok('report persists in PostgreSQL and projects quote-ready status',async()=>{
  created=await staff.saveReport({id:created.id,observation:'合成検査：ブレーキ摩耗',expectedVersion:created.version,requestId:key('report')});
  assert.equal(created.state,'draft');assert.equal(created.statusLabel,'見積作成待ち');
  assert.equal(created.canPresent,true);
 });
 await ok('staff presents quote, server calculates tax and approval state',async()=>{
  created=await staff.presentQuote({id:created.id,items:[{name:'点検',price:3000}],expectedVersion:created.version,requestId:key('quote')});
  assert.equal(created.state,'pending');assert.equal(created.subtotalYen,3000);assert.equal(created.taxYen,300);
  assert.equal(created.totalYen,3300);assert.equal(created.canDecide,true);
 });
 await ok('staff cannot impersonate LINE customer decision',async()=>{
  await rejected(()=>staff.decide({id:created.id,decision:'approved',expectedVersion:created.version,requestId:key('staff-approval')}),'CAR02_UNAUTHORIZED');
 });
 await ok('synthetic LINE customer can approve own quote',async()=>{
  created=await customer.decide({id:created.id,decision:'approved',expectedVersion:created.version,requestId:key('customer-approval')});
  assert.equal(created.state,'approved');assert.equal(created.canComplete,true);
 });
 await ok('staff completes work and UI state reflects persisted record',async()=>{
  created=await staff.complete({id:created.id,expectedVersion:created.version,requestId:key('complete')});
  assert.equal(created.state,'completed');
  const actual=await customer.read(created.id);assert.equal(actual.state,'completed');
  const row=(await pool.query('SELECT status FROM public.ksh_car02_work_orders WHERE id=$1',[created.id])).rows[0];
  assert.equal(row.status,'completed');
 });
 await ok('customer can read scrubbed history without secrets',async()=>{
  const history=await customer.history(created.id);
  assert.ok(history.length>=5);
  assert.ok(history.every(e=>!Object.hasOwn(e,'actorFingerprint')&&!Object.hasOwn(e,'shopCode')));
 });
 await ok('stale update and duplicate completion fail closed',async()=>{
  await rejected(()=>staff.complete({id:created.id,expectedVersion:1,requestId:key('stale')}),'CAR02_VERSION_CONFLICT');
 });
 gate=false;
 await ok('re-lock denies read even after successful synthetic workflow',async()=>{
  const before=authCalls;await rejected(()=>customer.read(created.id),'CAR02_NOT_RELEASED');
  assert.equal(authCalls,before);assert.equal(CAR02_BASIC_UI_PORT_MODE.release,'NO_GO');
 });
 console.log(`CAR02_BASIC_UI_R57_R45_R13_PG17_ISOLATED_PASS ${checks}/${checks} NO_GO HOLD SYNTHETIC_ONLY`);
}catch(e){console.error('CAR02_BASIC_UI_R45_PG17_FAILED',e.code||e.message);process.exitCode=1}
finally{gate=false;await pool.end()}
