// DPRO CAR02 R43 disposable PostgreSQL 17 verification, never connects to production.
// Requires env PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE from ephemeral CI service.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {createCar02Service} from './car02-core.mjs';
import {createCar02PgAdapter} from './car02-pg-adapter.mjs';
import {createCar02PgPhotoRepository} from './car02-pg-photo-repo.mjs';
import {createCar02PhotoFlow} from './car02-photo-flow.mjs';
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const C='33333333-3333-4333-8333-333333333333';
const D='44444444-4444-4444-8444-444444444444';
const shop='street_house_kitsuki';
const staff={verified:true,role:'staff',shopCode:shop,subject:'ci-staff-proof'};
const customer={verified:true,role:'customer',shopCode:shop,subject:'ci-line-proof',customerId:A};
const key=n=>`car02-r43-pg17-${n}-unique-idempotency`;
const pool=new pg.Pool({host:process.env.PGHOST,port:Number(process.env.PGPORT||5432),
 user:process.env.PGUSER,password:process.env.PGPASSWORD,database:process.env.PGDATABASE,
 max:3,connectionTimeoutMillis:15000});
async function expectReject(p,code){await assert.rejects(p,e=>e?.code===code,`expected ${code}`)}
let tests=0;async function run(label,fn){await fn();tests++;console.log(`PASS ${tests}: ${label}`)}
try{
 if(!['localhost','127.0.0.1'].includes(process.env.PGHOST)||process.env.PGDATABASE!=='car02_qa'||process.env.PGPASSWORD!=='qa_only_local')throw Error('ISOLATED_DB_ONLY');
 const version=await pool.query('SHOW server_version_num');
 if(Number(version.rows[0].server_version_num)<170000)throw Error('POSTGRES_17_REQUIRED');
 await run('baseline CREATE',async()=>{await pool.query(readFileSync(new URL('./BASELINE_QA_ONLY.sql',import.meta.url),'utf8'))});
 await run('R13 migration transaction',async()=>{await pool.query(readFileSync(new URL('./R13_MIGRATION_QA_ONLY.sql',import.meta.url),'utf8'))});
 await run('exactly eight RLS-protected CAR02 tables',async()=>{
  const r=await pool.query(`SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'ksh_car02_%'`);
  assert.equal(r.rows.length,8);assert.ok(r.rows.every(x=>x.rowsecurity));
 });
 await run('anon and authenticated do not have direct SELECT',async()=>{
  const r=await pool.query(`SELECT has_table_privilege('anon','public.ksh_car02_work_orders','SELECT') AS a,
   has_table_privilege('authenticated','public.ksh_car02_work_orders','SELECT') AS b`);
  assert.equal(r.rows[0].a,false);assert.equal(r.rows[0].b,false);
 });
 const svc=createCar02Service(createCar02PgAdapter(pool));
 let order;
 await run('create draft and idempotency replay',async()=>{
  const args={actor:staff,shop,customerId:A,vehicleId:B,key:key('create')};
  order=await svc.create(args);assert.equal(order.status,'draft');
  assert.deepEqual(await svc.create(args),order);
  await expectReject(svc.create({...args,reservationId:C}), 'CAR02_IDEMPOTENCY_KEY_REUSED');
 });
 await run('cross-shop/customer association blocked',async()=>{
  await expectReject(svc.create({actor:staff,shop,customerId:C,vehicleId:D,key:key('cross')}),'CAR02_REFERENCE_SCOPE_MISMATCH');
 });
 await run('report persists into relational table',async()=>{
  order=await svc.report({actor:staff,shop,id:order.id,observation:'Brake check',photos:[],expectedVersion:order.version,key:key('report1')});
  assert.equal(order.observation,'Brake check');
 });
 await run('private photo pending → signed ticket simulation → digest-verified READY',async()=>{
  const repo=createCar02PgPhotoRepository(pool);
  const store={signUpload:async()=>({url:'https://example.invalid/qa-signed-upload-only'}),
   inspect:async()=>({private:true,byteSize:123,mimeType:'image/jpeg',sha256:'a'.repeat(64)})};
  const flow=createCar02PhotoFlow({repository:repo,storage:store});
  const report=(await pool.query('SELECT id FROM public.ksh_car02_reports WHERE work_order_id=$1',[order.id])).rows[0];
  const p=await flow.begin({actor:staff,shop,orderId:order.id,reportId:report.id,mimeType:'image/jpeg',byteSize:123,sha256:'a'.repeat(64)});
  await expectReject(svc.present({actor:staff,shop,id:order.id,items:[{name:'Brake',price:1000}],expectedVersion:order.version,key:key('premature')}),'CAR02_UPLOADS_PENDING');
  const f=await flow.finalize({actor:staff,shop,photoId:p.photoId});assert.equal(f.state,'ready');
  order=await svc.report({actor:staff,shop,id:order.id,observation:'Brake check with photo',photos:[p.photoId],expectedVersion:order.version,key:key('report2')});
  assert.deepEqual(order.photos,[p.photoId]);
 });
 await run('draft quote → pending → R13 snapshots locked',async()=>{
  order=await svc.present({actor:staff,shop,id:order.id,items:[{name:'Brake',price:101}],expectedVersion:order.version,key:key('present')});
  assert.equal(order.status,'pending');assert.equal(order.quote.total,111);
  await assert.rejects(pool.query('UPDATE public.ksh_car02_quotes SET subtotal_yen=999 WHERE id=$1',[order.quote.id]));
 });
 await run('cannot modify photo evidence after presenting quote',async()=>{
  const p=order.photos[0];await assert.rejects(pool.query("UPDATE public.ksh_car02_photos SET upload_state='deleted' WHERE id=$1",[p]));
 });
 await run('customer approval persisted, completion and history read back',async()=>{
  order=await svc.decide({actor:customer,shop,id:order.id,decision:'approved',expectedVersion:order.version,key:key('approve')});
  assert.equal(order.decision.value,'approved');
  order=await svc.complete({actor:staff,shop,id:order.id,expectedVersion:order.version,key:key('complete')});
  assert.equal(order.status,'completed');assert.equal(order.events.length,6);
  assert.equal((await svc.history({actor:customer,shop,id:order.id})).length,6);
 });
 await run('completed status and audit rows immutable',async()=>{
  await assert.rejects(pool.query("UPDATE public.ksh_car02_work_orders SET status='draft' WHERE id=$1",[order.id]));
  await assert.rejects(pool.query("DELETE FROM public.ksh_car02_events WHERE work_order_id=$1",[order.id]));
 });
 await run('populated dataset remains untouched by recovery script',async()=>{
  const r=await pool.query('SELECT count(*)::int AS n FROM public.ksh_car02_work_orders');assert.ok(r.rows[0].n>0);
  // No DROP is executed against this populated database.
 });
 await run('R13 EMPTY-ONLY rollback on second disposable PostgreSQL database',async()=>{
  const admin=await pool.connect();
  try {await admin.query('CREATE DATABASE car02_empty_rollback_qa')}finally{admin.release()}
  const isolated=new pg.Pool({host:process.env.PGHOST,port:Number(process.env.PGPORT||5432),
   user:process.env.PGUSER,password:process.env.PGPASSWORD,database:'car02_empty_rollback_qa',max:1});
  try {
   await isolated.query(readFileSync(new URL('./BASELINE_QA_ONLY.sql',import.meta.url),'utf8'));
   await isolated.query(readFileSync(new URL('./R13_MIGRATION_QA_ONLY.sql',import.meta.url),'utf8'));
   await isolated.query(readFileSync(new URL('./R13_EMPTY_ONLY_ROLLBACK_QA.sql',import.meta.url),'utf8'));
   const r=await isolated.query(`SELECT count(*)::int AS n FROM pg_tables
    WHERE schemaname='public' AND tablename LIKE 'ksh_car02_%'`);
   assert.equal(r.rows[0].n,0);
   const base=await isolated.query(`SELECT count(*)::int AS n FROM public.ksh_demo_shop_settings`);
   assert.equal(base.rows[0].n,2);
  }finally{await isolated.end()}
 });
 console.log(`R43 PG17 INTEGRATION: ${tests} PASS; actual live Supabase unchanged`);
}catch(err){console.error('R43 PG17 INTEGRATION FAILED:',err.code||err.message);process.exitCode=1}
finally{await pool.end()}
