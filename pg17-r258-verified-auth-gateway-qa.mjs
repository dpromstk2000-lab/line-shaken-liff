/**
 * R258 disposable PG17 e2e: Edge R51 -> existing R46 LINE/Supabase
 * verifier interfaces -> DB-backed member scope -> R13 work-order journal.
 * Network auth is a strict in-process synthetic fixture: no real identity proof.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {createCar02R258VerifiedStagingGateway} from './car02-r258-verified-staging-gateway-isolated.mjs';
const ENV=process.env;
if(ENV.GITHUB_ACTIONS!=='true'||ENV.CAR02_R258_ISOLATED!=='yes'||
  ENV.CAR02_R257_ISOLATED!=='yes'||ENV.CAR02_RELEASE_LOCK!=='true'||
  ENV.NODE_ENV==='production'||ENV.PGHOST!=='127.0.0.1'||
  ENV.PGDATABASE!=='car02_qa'||ENV.PGUSER!=='postgres'||
  ENV.PGPASSWORD!=='qa_only_local')throw Error('R258_DISPOSABLE_PG17_ONLY');
const SHOP='street_house_kitsuki',ORIGIN='https://dpromstk2000-lab.github.io';
const AUTH='https://r258-auth-fixture.invalid',CHANNEL='r258-synthetic-channel';
const STAFF='55555555-5555-4555-8555-555555555555';
const CUSTOMER='11111111-1111-4111-8111-111111111111';
const VEHICLE='22222222-2222-4222-8222-222222222222';
const LINE='r258-synthetic-line-id-token';
const STAFF_JWT=['eyJhbGciOiJub25lIn0',Buffer.from(JSON.stringify({sub:STAFF,iss:AUTH+'/auth/v1',aud:'authenticated',role:'authenticated',exp:4102444800})).toString('base64url'),'synthetic-not-a-signature'].join('.');
const BASE='/functions/v1/dpro-car02-stage/api/car02';
const pool=new pg.Pool({host:ENV.PGHOST,port:Number(ENV.PGPORT||5432),user:ENV.PGUSER,password:ENV.PGPASSWORD,
 database:ENV.PGDATABASE,max:2,connectionTimeoutMillis:10000});
let reviews=false,n=0,lineVerifications=0,staffVerifications=0;
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const fetchImpl=async(url,options={})=>{
  // Only these two fixture endpoints exist; never leave the process.
  if(url==='https://api.line.me/oauth2/v2.1/verify'){
    const params=new URLSearchParams(options.body);
    if(params.get('id_token')!==LINE||params.get('client_id')!==CHANNEL)return response({},401);
    lineVerifications++;
    return response({sub:'r258-line-fixture',aud:CHANNEL,iss:'https://access.line.me',exp:4102444800});
  }
  if(url===AUTH+'/auth/v1/user'){
    if(options.headers?.Authorization!=='Bearer '+STAFF_JWT)return response({},401);
    staffVerifications++;
    return response({id:STAFF,aud:'authenticated',is_anonymous:false});
  }
  throw Error('R258_UNEXPECTED_NETWORK_FORBIDDEN');
};
const gateway=createCar02R258VerifiedStagingGateway({environment:'isolated_qa',dbName:'car02_qa',shopCode:SHOP,
 lineChannelId:CHANNEL,supabaseUrl:AUTH,supabaseAnonKey:'r258-only-synthetic-publishable-key',
 pool,allowedOrigins:[ORIGIN],reviewGate:async()=>reviews,fetchImpl,nowSeconds:()=>1790000000});
const key=i=>'R258-SYNTHETIC-ONLY-'+i;
async function call(path=BASE,{method='GET',actor='staff',body,id,origin=ORIGIN}={}){
 const headers={origin};
 if(actor==='staff')headers.Authorization='Bearer '+STAFF_JWT;
 else if(actor==='customer')headers['X-Line-ID-Token']=LINE;
 else if(actor==='forged')headers.Authorization='Bearer wrong-token-value';
 if(id)headers['Idempotency-Key']=key(id);
 if(body!==undefined)headers['Content-Type']='application/json';
 const req=new Request('https://r258-fixture.invalid'+path,{method,headers,
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
 const r=await gateway(req);const d=await r.json();return {status:r.status,data:d};
}
async function check(label,fn){await fn();console.log('R258 PASS '+(++n)+': '+label)}
try{
 const v=await pool.query('SHOW server_version_num');assert.ok(Number(v.rows[0].server_version_num)>=170000);
 const r=await pool.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'ksh_car02_%'");
 assert.equal(r.rows[0].n,8);
 // QA-only extensions of disposable legacy fixture for the R46 resolvers.
 await pool.query('ALTER TABLE public.ksh_demo_customers ADD COLUMN line_user_id text, ADD COLUMN status text');
 await pool.query("UPDATE public.ksh_demo_customers SET line_user_id=$1,status='LINE連携済み' WHERE id=$2",['r258-line-fixture',CUSTOMER]);
 await pool.query(readFileSync(new URL('./R46_STAFF_GRANTS_QA_ONLY.sql',import.meta.url),'utf8'));
 await pool.query('INSERT INTO public.ksh_car02_staff_access (shop_code,user_sub,staff_role,active) VALUES ($1,$2,$3,true)',[SHOP,STAFF,'staff']);
 await check('hard gate blocks before synthetic Auth and DB business writes',async()=>{
   assert.equal((await call()).status,503);assert.equal(staffVerifications,0);
 });
 reviews=true;
 await check('anonymous access and invented staff token are rejected',async()=>{
   assert.equal((await call(BASE,{actor:'none'})).status,401);
   assert.equal((await call(BASE,{actor:'forged'})).status,401);
 });
 let order;
 await check('R46 fixture Auth user and DB staff membership create work order',async()=>{
   const x=await call(BASE,{method:'POST',body:{customerId:CUSTOMER,vehicleId:VEHICLE,reservationId:null},id:'create'});
   assert.equal(x.status,200);order=x.data.data;
   assert.equal(order.status,'draft');
   const db=await pool.query('SELECT status FROM public.ksh_car02_work_orders WHERE id=$1',[order.id]);
   assert.equal(db.rowCount,1);
 });
 await check('replay is idempotent under verified staff membership',async()=>{
   const x=await call(BASE,{method:'POST',body:{customerId:CUSTOMER,vehicleId:VEHICLE,reservationId:null},id:'create'});
   assert.equal(x.status,200);assert.deepEqual(x.data.data,order);
 });
 await check('revoked staff grant immediately denies access',async()=>{
   await pool.query('UPDATE public.ksh_car02_staff_access SET active=false WHERE shop_code=$1 AND user_sub=$2',[SHOP,STAFF]);
   assert.equal((await call(BASE+'/'+order.id)).status,401);
   await pool.query('UPDATE public.ksh_car02_staff_access SET active=true WHERE shop_code=$1 AND user_sub=$2',[SHOP,STAFF]);
 });
 await check('wrong shop membership cannot authorize even with valid synthetic JWT',async()=>{
   await pool.query('UPDATE public.ksh_car02_staff_access SET shop_code=$1 WHERE user_sub=$2',['other_shop',STAFF]);
   assert.equal((await call(BASE+'/'+order.id)).status,401);
   await pool.query('UPDATE public.ksh_car02_staff_access SET shop_code=$1 WHERE user_sub=$2',[SHOP,STAFF]);
 });
 await check('staff report and quote persist in R13 schema',async()=>{
   const report=await call(BASE+'/'+order.id+'/report',{method:'POST',body:{observation:'R258 synthetic inspection',photos:[],expectedVersion:order.version},id:'report'});
   assert.equal(report.status,200);order=report.data.data;
   const quote=await call(BASE+'/'+order.id+'/quote',{method:'POST',body:{items:[{name:'Synthetic brake check',price:5000}],expectedVersion:order.version},id:'quote'});
   assert.equal(quote.status,200);order=quote.data.data;
   assert.equal(order.status,'pending');assert.equal(order.quote.total,5500);
 });
 await check('R46 LINE verification plus DB line-member link permits customer own quote',async()=>{
   const x=await call(BASE+'/'+order.id+'/decision',{method:'POST',actor:'customer',
    body:{decision:'approved',reason:'',expectedVersion:order.version},id:'approve'});
   assert.equal(x.status,200);order=x.data.data;assert.equal(order.status,'approved');
 });
 await check('revoked LINE customer link prevents further reads',async()=>{
   await pool.query("UPDATE public.ksh_demo_customers SET status='解除済み' WHERE id=$1",[CUSTOMER]);
   assert.equal((await call(BASE+'/'+order.id,{actor:'customer'})).status,401);
   await pool.query("UPDATE public.ksh_demo_customers SET status='LINE連携済み' WHERE id=$1",[CUSTOMER]);
 });
 await check('staff completes and final state is stored in PostgreSQL',async()=>{
   const x=await call(BASE+'/'+order.id+'/complete',{method:'POST',body:{expectedVersion:order.version},id:'complete'});
   assert.equal(x.status,200);assert.equal(x.data.data.status,'completed');
   const db=await pool.query('SELECT status FROM public.ksh_car02_work_orders WHERE id=$1',[order.id]);
   assert.equal(db.rows[0].status,'completed');
   assert.equal((await call(BASE+'/'+order.id+'/history',{actor:'customer'})).status,200);
 });
 await check('photo traffic and unsupported nonprefixed route remain disabled',async()=>{
   assert.equal((await call(BASE+'/photos/'+order.id)).status,404);
   assert.equal((await call('/api/car02/'+order.id)).status,404);
 });
 await check('closing review gate after use returns 503',async()=>{
   reviews=false;
   assert.equal((await call(BASE+'/'+order.id)).status,503);
   assert.ok(staffVerifications>=3);assert.ok(lineVerifications>=2);
 });
 console.log('R258_VERIFIED_IDENTITY_R46_EDGE_R13_PG17_SYNTHETIC_PASS '+n+'/'+n+' NO_GO HOLD');
}catch(e){console.error('R258_VERIFY_FAILURE',e.code||e.message);process.exitCode=1}
finally{await pool.end()}
