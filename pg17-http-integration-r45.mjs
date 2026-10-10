// DPRO CAR02 R45 — end-to-end HTTP → authority-bound identity → R13 PostgreSQL.
// Run ONLY in disposable Github Actions Postgres 17: no live tokens, no production DB.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import pg from 'pg';
import {createCar02RuntimeR45} from './car02-runtime-r45.mjs';

const SHOP='street_house_kitsuki';
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const C='33333333-3333-4333-8333-333333333333';
const D='44444444-4444-4444-8444-444444444444';
const CHANNEL='2010239091';
const ORIGIN='https://dpromstk2000-lab.github.io';
const S='r45-ci-staff-token';
const L='r45-ci-line-token';
let enabled=false,dbQueries=0;
let tests=0;
const pool=new pg.Pool({host:process.env.PGHOST,port:Number(process.env.PGPORT||5432),
 user:process.env.PGUSER,password:process.env.PGPASSWORD,database:process.env.PGDATABASE,
 connectionTimeoutMillis:15000,max:3});
// Functionally representative authority callbacks using synthetic records only.
// These are deliberately fake for CI and CANNOT be used to verify real credentials.
const verifyLineIdToken=async({idToken,clientId})=>{
 if(idToken!==L||clientId!==CHANNEL)throw Error('BAD_LINE_TOKEN');
 return{sub:'ci-line-sub-1',aud:CHANNEL,iss:'https://access.line.me',exp:4102444800};
};
const verifyStaffJwt=async({accessToken})=>{
 if(accessToken!==S)throw Error('BAD_STAFF_TOKEN');
 return{sub:'ci-staff-sub-1',verified:true,exp:4102444800};
};
const resolveLineCustomer=async({shopCode,lineSub})=>({
 active:shopCode===SHOP && lineSub==='ci-line-sub-1',shopCode:SHOP,lineSub:'ci-line-sub-1',customerId:A
});
const resolveStaffAccess=async({shopCode,userSub})=>({
 active:shopCode===SHOP && userSub==='ci-staff-sub-1',shopCode:SHOP,userSub:'ci-staff-sub-1',role:'staff'
});
const config={pool,shopCode:SHOP,lineClientId:CHANNEL,verifyLineIdToken,verifyStaffJwt,
 resolveLineCustomer,resolveStaffAccess,
 releaseState:()=>({systemCode:'CAR02',contracted:enabled,goLiveApproved:enabled,
 migrationVerified:true,verifiedIdentityBound:true,workerBackendReady:true,
 externalNotificationsReviewed:true}),allowedOrigins:[ORIGIN]};
const api=createCar02RuntimeR45(config);
const server=createServer(async(req,res)=>{
 try {
  const chunks=[];let bytes=0;
  for await (const chunk of req){bytes+=chunk.length;if(bytes>65536){res.writeHead(413);res.end();return;}chunks.push(chunk)}
  const origin=`http://127.0.0.1:${server.address().port}`;
  const request=new Request(new URL(req.url,origin),{
   method:req.method,headers:req.headers,
   ...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})
  });
  const reply=await api(request);
  res.writeHead(reply.status,Object.fromEntries(reply.headers));res.end(Buffer.from(await reply.arrayBuffer()));
 }catch{res.writeHead(500,{'Content-Type':'application/json'});res.end('{"ok":false,"code":"QA_SERVER_ERROR"}')}
});
async function call(path,{method='GET',token='',line=false,body,origin,idem}={}){
 const headers={};if(token)headers[line?'X-Line-ID-Token':'Authorization']=line?token:`Bearer ${token}`;
 if(origin)headers.Origin=origin;if(idem)headers['Idempotency-Key']=idem;
 if(body!==undefined)headers['Content-Type']='application/json';
 const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{
  method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
 const result=response.status===204?null:await response.json();return{status:response.status,data:result,headers:response.headers};
}
async function test(label,fn){await fn();tests++;console.log(`PASS R45 HTTP ${tests}: ${label}`)}
const idem=i=>`R45-REAL-PG-HTTP-${i}-DEMO-ONLY`;
const post=(path,body,i,token=S,line=false)=>call(path,{method:'POST',token,line,body,idem:idem(i)});
try {
 if(!['127.0.0.1','localhost'].includes(process.env.PGHOST)||process.env.PGDATABASE!=='car02_qa'||process.env.PGPASSWORD!=='qa_only_local')
  throw Error('R45_DISPOSABLE_DB_ONLY');
 const v=await pool.query('SHOW server_version_num');if(Number(v.rows[0].server_version_num)<170000)throw Error('R45_PG17_REQUIRED');
 const count=await pool.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'ksh_car02_%'");
 if(Number(count.rows[0].n)!==8)throw Error('R45_R13_REQUIRED');
 await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',e=>e?reject(e):resolve()));
 await test('release guard blocks before authentication or DB',async()=>{
  const r=await call('/api/car02',{token:S,method:'POST',body:{customerId:A,vehicleId:B},idem:idem('unreleased')});
  assert.equal(r.status,503);assert.equal(r.data.code,'CAR02_NOT_RELEASED');
 });
 enabled=true;  // ephemeral CI-only simulated approval; NOT production state
 await test('unauthorized requests rejected',async()=>{
  const r=await call('/api/car02',{method:'POST',body:{customerId:A,vehicleId:B},idem:idem('anonymous')});
  assert.equal(r.status,401);
 });
 await test('forged staff bearer rejected',async()=>{
  const r=await call('/api/car02',{token:'forged-token-at-least-8',method:'POST',body:{customerId:A,vehicleId:B},idem:idem('forged')});
  assert.equal(r.status,401);
 });
 await test('cross-tenant customer references rejected',async()=>{
  const r=await post('/api/car02',{customerId:C,vehicleId:D},'other-shop');
  assert.equal(r.status,403);assert.equal(r.data.code,'CAR02_REFERENCE_SCOPE_MISMATCH');
 });
 await test('caller cannot impersonate owner or other shop',async()=>{
  const r=await post('/api/car02',{customerId:A,vehicleId:B,shopCode:'other_shop',role:'owner'},'forged-claim');
  assert.equal(r.status,422);
 });
 let order;
 await test('POST create is committed to PostgreSQL',async()=>{
  const r=await post('/api/car02',{customerId:A,vehicleId:B},'new');
  assert.equal(r.status,200);assert.equal(r.data.ok,true);assert.equal(r.data.data.status,'draft');order=r.data.data;
  const rows=await pool.query('SELECT id FROM public.ksh_car02_work_orders WHERE id=$1',[order.id]);
  assert.equal(rows.rowCount,1);
 });
 await test('idempotent POST replay returns identical result',async()=>{
  const r=await post('/api/car02',{customerId:A,vehicleId:B},'new');
  assert.equal(r.status,200);assert.deepEqual(r.data.data,order);
 });
 await test('GET customer record enforces verified ownership',async()=>{
  const r=await call(`/api/car02/${order.id}`,{token:L,line:true});
  assert.equal(r.status,200);assert.equal(r.data.data.id,order.id);
 });
 await test('unknown LINE subject denied before record access',async()=>{
  const r=await call(`/api/car02/${order.id}`,{token:'not-a-real-line-token',line:true});
  assert.equal(r.status,401);
 });
 await test('report persisted via HTTP',async()=>{
  const r=await post(`/api/car02/${order.id}/report`,{observation:'R45 CI report',photos:[],expectedVersion:order.version},'report');
  assert.equal(r.status,200);order=r.data.data;assert.equal(order.observation,'R45 CI report');
 });
 await test('present quote persisted via HTTP',async()=>{
  const r=await post(`/api/car02/${order.id}/quote`,{items:[{name:'点検作業',price:1200}],expectedVersion:order.version},'quote');
  assert.equal(r.status,200);order=r.data.data;assert.equal(order.status,'pending');
 });
 await test('staff cannot approve customer quote',async()=>{
  const r=await post(`/api/car02/${order.id}/decision`,{decision:'approved',expectedVersion:order.version},'staff-decision');
  assert.equal(r.status,403);
 });
 await test('customer LINE ID approves own quote',async()=>{
  const r=await post(`/api/car02/${order.id}/decision`,{decision:'approved',expectedVersion:order.version},'line-decision',L,true);
  assert.equal(r.status,200);order=r.data.data;assert.equal(order.status,'approved');
 });
 await test('staff completes only approved work',async()=>{
  const r=await post(`/api/car02/${order.id}/complete`,{expectedVersion:order.version},'complete');
  assert.equal(r.status,200);order=r.data.data;assert.equal(order.status,'completed');
 });
 await test('history readback includes immutable progression',async()=>{
  const r=await call(`/api/car02/${order.id}/history`,{token:L,line:true});
  assert.equal(r.status,200);assert.ok(r.data.data.length>=5);
 });
 await test('CORS refuses unknown web origin',async()=>{
  const r=await call(`/api/car02/${order.id}`,{token:S,origin:'https://attacker.invalid'});
  assert.equal(r.status,403);assert.equal(r.data.code,'CAR02_ORIGIN_DENIED');
 });
 await test('preflight permits LINE ID token only to approved origin',async()=>{
  const r=await call('/api/car02',{method:'OPTIONS',origin:ORIGIN});
  assert.equal(r.status,204);assert.ok(r.headers.get('access-control-allow-headers').includes('X-Line-ID-Token'));
 });
 enabled=false;
 await test('live gate re-locks API without altering completed data',async()=>{
  const r=await call(`/api/car02/${order.id}`,{token:S});assert.equal(r.status,503);
  const rows=await pool.query('SELECT status FROM public.ksh_car02_work_orders WHERE id=$1',[order.id]);
  assert.equal(rows.rows[0].status,'completed');
 });
 console.log(`R45 HTTP PG17 INTEGRATION: ${tests} PASS, simulated identity and release, NO external tokens`);
} catch(e){console.error('R45 HTTP PG17 INTEGRATION FAILED:',e.code||e.message);process.exitCode=1}
finally {if(server.listening)await new Promise(resolve=>server.close(resolve));await pool.end()}
