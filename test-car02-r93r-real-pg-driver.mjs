// CAR02 R93R: test the ACTUAL R93Q Node.js adapter over a real isolated PostgreSQL 17 driver.
// This test is CI-only; it refuses missing test gate, nonlocal host or any other DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createR93QIsolatedPgPhotoLifecycle,R93Q_CONTRACT} from './car02-r93q-single-schema-lifecycle-isolated.mjs';

const DB='car02_r93q_qa_ci';
const SHOP='street_house_kitsuki';
const ORDER='22222222-2222-4222-8222-222222222222';
const REPORT='33333333-3333-4333-8333-333333333333';
const STAFF='11111111-1111-4111-8111-111111111111';
const ACTOR=Object.freeze({verified:true,role:'staff',subject:`staff:${STAFF}`,shopCode:SHOP});
const BUCKET='ksh-car02-private-photos';
const PATH=(id)=>`${SHOP}/${ORDER}/${REPORT}/${id}.jpg`;
const mk=(id)=>({actor:ACTOR,shopCode:SHOP,orderId:ORDER,reportId:REPORT,bucket:BUCKET,
 path:PATH(id),mimeType:'image/jpeg',byteSize:850,sha256:'a'.repeat(64)});
const req=(meta,photoId)=>({actor:ACTOR,shopCode:SHOP,photoId,orderId:ORDER,reportId:REPORT,
 bucket:BUCKET,path:meta.path,expectedState:'pending'});
const service=(pool,gate=async()=>true)=>createR93QIsolatedPgPhotoLifecycle({environment:'isolated_qa',dbName:DB,shopCode:SHOP,pool,reviewGate:gate});
const reset=async(pool)=>pool.query('TRUNCATE car02_r93q_qa.cleanup_jobs,car02_r93q_qa.photos RESTART IDENTITY CASCADE');
const count=async(pool,table,where='',params=[])=>Number((await pool.query(`SELECT count(*)::integer AS n FROM car02_r93q_qa.${table} ${where}`,params)).rows[0].n);

if(process.env.R93R_ISOLATED_PG17_DRIVER_QA!=='yes' || process.env.PGHOST!=='127.0.0.1' ||
   process.env.PGDATABASE!==DB || process.env.PGUSER!=='postgres' ||
   process.env.PGPORT!=='5432' || process.env.PGPASSWORD!=='disposable-r93r-ci-only') {
 throw Error('R93R_DISPOSABLE_POSTGRES17_DRIVER_ONLY');
}
const {default:pg}=await import('pg');
const pool = new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',password:'disposable-r93r-ci-only',
 database:DB,max:3,connectionTimeoutMillis:2000,idleTimeoutMillis:1500,
 application_name:'dpro_car02_r93r_disposable_qa'});
const uuid=(last)=>`99999999-9999-4999-8999-${last}`;

try {
 const db=await pool.query(`SELECT current_database() db, current_setting('server_version_num')::int pg,
   to_regclass('public.ksh_car02_photos') IS NULL no_live,
   to_regclass('car02_r93q_qa.photos') IS NOT NULL qa_photos`);
 assert.equal(db.rows.length,1);
 assert.deepEqual({db:db.rows[0].db,no_live:db.rows[0].no_live,qa_photos:db.rows[0].qa_photos},{db:DB,no_live:true,qa_photos:true});
 assert.ok(db.rows[0].pg>=170000);
 assert.equal(R93Q_CONTRACT.productionReady,false);
 await test('real PostgreSQL driver: reserve/markReady/fresh separate transaction proves READY',async()=>{
  await reset(pool);
  const a=service(pool),x=mk(uuid('000000000001'));
  const r=await a.reserve(x);assert.equal(r.state,'pending');
  assert.equal(await a.markReady(req(x,r.photoId)),true);
  assert.equal(count instanceof Function,true);
  assert.equal(await count(pool,'photos',"WHERE upload_state='ready'"),1);
  assert.equal(await count(pool,'cleanup_jobs'),0);
 });
 await test('real driver: uncertainty tombstone and cleanup job commit atomically',async()=>{
  await reset(pool);
  const a=service(pool),x=mk(uuid('000000000002'));
  const r=await a.reserve(x);
  assert.equal(await a.tombstoneAndEnqueue({...req(x,r.photoId),reason:'UPLOAD_UNCERTAIN'}),true);
  assert.equal(await count(pool,'photos',"WHERE upload_state='deleted'"),1);
  assert.equal(await count(pool,'cleanup_jobs','WHERE photo_id=$1',[r.photoId]),1);
  await assert.rejects(a.markReady(req(x,r.photoId)),{code:'R93Q_NOT_PENDING'});
 });
 await test('real driver: outbox unique collision rolls back state change, never half-commits',async()=>{
  await reset(pool);
  const a=service(pool),x=mk(uuid('000000000003'));
  const r=await a.reserve(x);
  await pool.query(`INSERT INTO car02_r93q_qa.cleanup_jobs(photo_id,shop_code,storage_path,state,reason)
   VALUES($1,$2,$3,'queued','UPLOAD_UNCERTAIN')`,[r.photoId,'wrong-shop','wrong/path.jpg']);
  await assert.rejects(a.tombstoneAndEnqueue({...req(x,r.photoId),reason:'UPLOAD_UNCERTAIN'}),{code:'R93Q_DATABASE_UNAVAILABLE'});
  assert.equal(await count(pool,'photos',"WHERE upload_state='pending'"),1);
  assert.equal(await count(pool,'cleanup_jobs'),1);
  await assert.rejects(a.markReady(req(x,r.photoId)),{code:'R93Q_OUTBOX_CONFLICT'});
 });
 await test('real driver: unknown COMMIT response reconciles committed ready in new transaction',async()=>{
  await reset(pool);
  let commits=0,spoofed=false;
  const interceptPool={async connect(){
   const client=await pool.connect();
   return {async query(sql,params){
    if(sql==='COMMIT'){
     commits++;
     const response=await client.query(sql,params);
     if(commits===2){spoofed=true;throw Error('R93R_SIMULATED_ACK_LOSS_AFTER_REAL_COMMIT');}
     return response;
    }
    return client.query(sql,params);
   },release(){client.release()}};
  }};
  const a=service(interceptPool),x=mk(uuid('000000000004'));
  const r=await a.reserve(x);
  assert.equal(await a.markReady(req(x,r.photoId)),true);
  assert.equal(spoofed,true);
  assert.equal(commits,3); // reserve, ambiguous ready COMMIT, independent proof.
  assert.equal(await count(pool,'photos',"WHERE upload_state='ready'"),1);
  assert.equal(await count(pool,'cleanup_jobs'),0);
 });
 await test('real driver: revoked staff and changed path cannot pass scope gate',async()=>{
  await reset(pool);
  const a=service(pool),x=mk(uuid('000000000005'));
  const r=await a.reserve(x);
  await assert.rejects(a.markReady({...req(x,r.photoId),path:'bad/path.jpg'}),{code:'R93Q_RECEIPT_MISMATCH'});
  await pool.query('UPDATE car02_r93q_qa.staff SET active=false WHERE shop_code=$1 AND staff_id=$2',[SHOP,STAFF]);
  try {await assert.rejects(a.markReady(req(x,r.photoId)),{code:'R93Q_STAFF_DENIED'});}
  finally {await pool.query('UPDATE car02_r93q_qa.staff SET active=true WHERE shop_code=$1 AND staff_id=$2',[SHOP,STAFF]);}
  assert.equal(await count(pool,'photos',"WHERE upload_state='pending'"),1);
 });
 await test('real driver: 3-active-photo upper bound persists across separate instances',async()=>{
  await reset(pool);
  const serviceA=service(pool),serviceB=service(pool);
  for(let i=6;i<=8;i++){
   const x=mk(uuid(String(i).padStart(12,'0')));
   const s=i%2?serviceB:serviceA;
   assert.equal((await s.reserve(x)).state,'pending');
  }
  await assert.rejects(service(pool).reserve(mk(uuid('000000000009'))),{code:'R93Q_THREE_PHOTO_LIMIT'});
  assert.equal(await count(pool,'photos',"WHERE upload_state='pending'"),3);
 });
 await reset(pool);
 console.log('R93R_REAL_NODE_PG17_DRIVER_PASS');
} finally {await pool.end();}
