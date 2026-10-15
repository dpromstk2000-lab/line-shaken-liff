/**
 * R257 end-to-end QA: Supabase Edge-shaped route -> R51 gateway -> R45 runtime
 * -> R13 relational PostgreSQL 17. ONLY synthetic credentials and disposable DB.
 * Neither a production Worker nor a real LINE/Supabase authentication test.
 */
import assert from 'node:assert/strict';
import pg from 'pg';
import {createCar02RuntimeR45} from './car02-runtime-r45.mjs';
import {createCar02R257BasicStagingGateway} from './car02-r257-basic-staging-gateway-isolated.mjs';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.CAR02_RELEASE_LOCK!=='true'||
 process.env.CAR02_R257_ISOLATED!=='yes'||process.env.PGHOST!=='127.0.0.1'||
 process.env.PGDATABASE!=='car02_qa'||process.env.PGUSER!=='postgres'||
 process.env.PGPASSWORD!=='qa_only_local'||process.env.NODE_ENV==='production')
 throw Error('R257_DISPOSABLE_CI_PG17_ONLY');
const SHOP='street_house_kitsuki';
const ORIGIN='https://dpromstk2000-lab.github.io';
const CHANNEL='r257-synthetic-line-channel';
const STAFF='r257-fixture-staff-token';
const LINE='r257-fixture-line-token';
const C='11111111-1111-4111-8111-111111111111';
const V='22222222-2222-4222-8222-222222222222';
const base='/functions/v1/dpro-car02-stage';
const pool=new pg.Pool({host:process.env.PGHOST,port:Number(process.env.PGPORT||5432),
 user:process.env.PGUSER,password:process.env.PGPASSWORD,database:process.env.PGDATABASE,
 connectionTimeoutMillis:8000,max:2});
let reviews=false,builds=0,authCalls=0,passes=0;
const gateState=()=>({systemCode:'CAR02',contracted:reviews,goLiveApproved:reviews,
 migrationVerified:reviews,verifiedIdentityBound:reviews,workerBackendReady:reviews,
 externalNotificationsReviewed:reviews});
const handler=createCar02R257BasicStagingGateway({environment:'isolated_qa',dbName:'car02_qa',shopCode:SHOP,
 reviewGate:async()=>reviews,
 buildBasicRuntime:async()=>{
  builds++;
  return createCar02RuntimeR45({pool,shopCode:SHOP,lineClientId:CHANNEL,
   verifyLineIdToken:async({idToken,clientId})=>{authCalls++;
    if(idToken!==LINE||clientId!==CHANNEL)throw Error('SYNTHETIC_ONLY');
    return {sub:'r257-ci-customer',aud:CHANNEL,iss:'https://access.line.me',exp:4102444800};},
   verifyStaffJwt:async({accessToken})=>{authCalls++;
    if(accessToken!==STAFF)throw Error('SYNTHETIC_ONLY');
    return {sub:'r257-ci-staff',verified:true,exp:4102444800};},
   resolveLineCustomer:async({shopCode,lineSub})=>({active:shopCode===SHOP&&lineSub==='r257-ci-customer',shopCode:SHOP,
    lineSub:'r257-ci-customer',customerId:C}),
   resolveStaffAccess:async({shopCode,userSub})=>({active:shopCode===SHOP&&userSub==='r257-ci-staff',
    shopCode:SHOP,userSub:'r257-ci-staff',role:'staff'}),
   releaseState:gateState,allowedOrigins:[ORIGIN],nowSeconds:()=>1790000000});
 }});
const idem=n=>`R257-PG17-EDGE-SYNTHETIC-${n}-ONLY`;
async function call(path,{method='GET',line=false,token=STAFF,body,key,origin=ORIGIN}={}){
 const headers={origin};if(token)headers[line?'x-line-id-token':'authorization']=line?token:`Bearer ${token}`;
 if(key)headers['idempotency-key']=key;
 if(body!==undefined)headers['content-type']='application/json';
 const req=new Request('https://r257-fixture.invalid'+path,{method,headers,
  ...(body===undefined?{}:{body:JSON.stringify(body)})});
 const resp=await handler(req);
 return {status:resp.status,json:await resp.json()};
}
async function check(name,fn){await fn();passes++;console.log(`PASS R257 PG17 ${passes}: ${name}`)}
try{
 const ver=await pool.query('SHOW server_version_num');assert.ok(Number(ver.rows[0].server_version_num)>=170000);
 const tables=await pool.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'ksh_car02_%'");
 assert.equal(tables.rows[0].n,8);
 await check('release blocked at edge before backend construction or auth',async()=>{
  const r=await call(base+'/api/car02',{method:'POST',body:{customerId:C,vehicleId:V},key:idem('blocked')});
  assert.equal(r.status,503);assert.equal(builds,0);assert.equal(authCalls,0);
 });
 reviews=true;
 await check('anonymous and unknown token denied on prefixed API',async()=>{
  assert.equal((await call(base+'/api/car02',{token:''})).status,401);
  assert.equal((await call(base+'/api/car02',{token:'wrong-fixture-token'})).status,401);
 });
 let order;
 await check('prefixed POST creates a relational work order',async()=>{
  const r=await call(base+'/api/car02',{method:'POST',body:{customerId:C,vehicleId:V,reservationId:null},key:idem('create')});
  assert.equal(r.status,200);order=r.json.data;assert.equal(order.status,'draft');
  const db=await pool.query('SELECT status FROM public.ksh_car02_work_orders WHERE id=$1',[order.id]);
  assert.equal(db.rowCount,1);assert.equal(db.rows[0].status,'draft');
 });
 await check('replayed create idempotent at real database boundary',async()=>{
  const r=await call(base+'/api/car02',{method:'POST',body:{customerId:C,vehicleId:V,reservationId:null},key:idem('create')});
  assert.equal(r.status,200);assert.deepEqual(r.json.data,order);
 });
 await check('Edge staff reports inspection without photo',async()=>{
  const r=await call(base+'/api/car02/'+order.id+'/report',{method:'POST',body:{observation:'R257 synthetic inspection',photos:[],expectedVersion:order.version},key:idem('report')});
  assert.equal(r.status,200);order=r.json.data;assert.equal(order.observation,'R257 synthetic inspection');
 });
 await check('Edge staff presents quote',async()=>{
  const r=await call(base+'/api/car02/'+order.id+'/quote',{method:'POST',body:{items:[{name:'Synthetic brake check',price:5000}],expectedVersion:order.version},key:idem('quote')});
  assert.equal(r.status,200);order=r.json.data;assert.equal(order.status,'pending');assert.equal(order.quote.total,5500);
 });
 await check('customer accepts via synthetic LINE token; staff cannot decide',async()=>{
  const path=base+'/api/car02/'+order.id+'/decision';
  const body={decision:'approved',reason:'',expectedVersion:order.version};
  assert.equal((await call(path,{method:'POST',body,key:idem('staff-decision')})).status,403);
  const r=await call(path,{method:'POST',token:LINE,line:true,body,key:idem('line-decision')});
  assert.equal(r.status,200);order=r.json.data;assert.equal(order.status,'approved');
 });
 await check('Edge completion, history and database persistence',async()=>{
  const r=await call(base+'/api/car02/'+order.id+'/complete',{method:'POST',body:{expectedVersion:order.version},key:idem('complete')});
  assert.equal(r.status,200);order=r.json.data;assert.equal(order.status,'completed');
  const h=await call(base+'/api/car02/'+order.id+'/history',{token:LINE,line:true});
  assert.equal(h.status,200);assert.ok(h.json.data.length>=5);
  const db=await pool.query('SELECT status FROM public.ksh_car02_work_orders WHERE id=$1',[order.id]);
  assert.equal(db.rows[0].status,'completed');
 });
 await check('photo, unprefixed and foreign origins fail closed',async()=>{
  const p=base+'/api/car02/photos/'+order.id;
  assert.equal((await call(p)).status,404);
  assert.equal((await call('/api/car02/'+order.id)).status,404);
  assert.equal((await call(base+'/api/car02/'+order.id,{origin:'https://attacker.invalid'})).status,403);
 });
 await check('relock denies reads even when database still holds records',async()=>{
  reviews=false;const r=await call(base+'/api/car02/'+order.id);assert.equal(r.status,503);
  assert.equal(builds,1);
  const db=await pool.query('SELECT status FROM public.ksh_car02_work_orders WHERE id=$1',[order.id]);
  assert.equal(db.rows[0].status,'completed');
 });
 console.log(`R257_EDGE_PREFIX_R45_REAL_PG17_SYNTHETIC_QA_PASS ${passes} / ${passes}; NO_GO / HOLD`);
}catch(e){console.error('R257 PG17 FAILED:',e?.code||e?.message);process.exitCode=1}
finally{await pool.end()}
