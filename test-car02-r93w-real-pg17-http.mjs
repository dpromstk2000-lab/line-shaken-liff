// R93W real Node + pg17 driver integration. Disposable GitHub Actions DB ONLY.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createR93WIsolatedDurableHttpPort} from './car02-r93w-durable-http-reservation-isolated.mjs';
import {createCar02R93VIsolatedIdempotencyBridge} from './car02-r93v-idempotency-http-bridge-isolated.mjs';
import {createCar02R93UIsolatedStagingRouter} from './car02-r93u-staging-upload-route-isolated.mjs';
import {createR93SDurableUploadIntentQA} from './car02-r93s-durable-upload-intent-isolated.mjs';
const DB='car02_r93q_qa_ci',SHOP='street_house_kitsuki',ORIGIN='https://qa.example.test';
const O='22222222-2222-4222-8222-222222222222',R='33333333-3333-4333-8333-333333333333';
const STAFF='11111111-1111-4111-8111-111111111111';
const actor={verified:true,shopCode:SHOP,role:'staff',subject:`staff:${STAFF}`};
const png=Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3,4]);
const key=n=>`88888888-8888-4888-8888-${String(n).padStart(12,'0')}`;
const url=`${ORIGIN}/functions/v1/dpro-car02-stage/api/car02/uploads/${O}/${R}`;
const raw=k=>new Request(url,{method:'POST',headers:{origin:ORIGIN,'content-type':'image/png',
 authorization:'Bearer disposable-ci-fake-token', 'idempotency-key':k},body:png});
if(process.env.R93W_DISPOSABLE_DRIVER_QA!=='yes'||process.env.PGHOST!=='127.0.0.1'||
 process.env.PGPORT!=='5432'||process.env.PGUSER!=='postgres'||
 process.env.PGDATABASE!==DB||process.env.PGPASSWORD!=='disposable-r93s-ci-only')
 throw Error('R93W_DISPOSABLE_DRIVER_QA_ONLY');
const {default:pg}=await import('pg');
const pool=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',password:'disposable-r93s-ci-only',database:DB,
 max:5,connectionTimeoutMillis:2000,idleTimeoutMillis:1200,application_name:'car02_r93w_disposable_qa'});
const dbService=()=>createR93SDurableUploadIntentQA({environment:'isolated_qa',dbName:DB,shopCode:SHOP,pool,reviewGate:async()=>true});
const routes=({gate=true,staff=actor}={})=>{
 const bridge=createCar02R93VIsolatedIdempotencyBridge({environment:'isolated_qa',dbName:DB,shopCode:SHOP,
 releaseEnabled:async()=>gate,authenticate:async()=>staff,
 durableUpload:createR93WIsolatedDurableHttpPort({environment:'isolated_qa',dbName:DB,shopCode:SHOP,intents:dbService()}),
 origins:[ORIGIN]});
 return createCar02R93UIsolatedStagingRouter({environment:'isolated_qa',dbName:DB,
  reviewGate:async()=>gate,createUploadHandler:async()=>bridge,
  createBusinessHandler:async()=>async()=>new Response('no business mutation')});
};
const reset=()=>pool.query('TRUNCATE car02_r93q_qa.upload_intents,car02_r93q_qa.cleanup_jobs,car02_r93q_qa.photos RESTART IDENTITY CASCADE');
const count=async(table)=>Number((await pool.query(`SELECT count(*)::integer AS n FROM car02_r93q_qa.${table}`)).rows[0].n);
const post=async(n,opt)=>routes(opt)(raw(key(n)));
try{
 const check=(await pool.query(`SELECT current_database() db,current_setting('server_version_num')::integer version,
 to_regclass('car02_r93q_qa.upload_intents') IS NOT NULL intents,
 to_regclass('public.ksh_car02_photos') IS NULL no_live`)).rows[0];
 assert.equal(check.db,DB);assert.ok(check.version>=170000);assert.equal(check.intents,true);assert.equal(check.no_live,true);
 await test('first R93U-R93V-R82-R93W-R93S HTTP request persists ONE pending photo, not fake success',async()=>{
  await reset();const response=await post(1);
  assert.equal(response.status,503);assert.equal((await response.json()).code,'CAR02_PHOTO_UPLOAD_UNAVAILABLE');
  assert.equal(await count('photos'),1);assert.equal(await count('upload_intents'),1);
  const row=(await pool.query('SELECT upload_state,storage_path FROM car02_r93q_qa.photos')).rows[0];
  assert.equal(row.upload_state,'pending');assert.ok(row.storage_path.endsWith('/'+key(1)+'.png'));
 });
 await test('repeated HTTP request with same key even after router reconstruction never creates second photo',async()=>{
  await reset();for(let i=0;i<3;i++){const res=await post(2);assert.equal(res.status,503);}
  assert.equal(await count('photos'),1);assert.equal(await count('upload_intents'),1);
 });
 await test('concurrent HTTP calls from distinct routers reserve just one durable intent',async()=>{
  await reset();const replies=await Promise.all([post(3),post(3),post(3)]);
  assert.ok(replies.every(v=>v.status===503));assert.equal(await count('photos'),1);
 });
 await test('different intent key makes a second photo but not more than three',async()=>{
  await reset();await post(4);await post(5);await post(6);
  const denied=await post(7);assert.equal(denied.status,503);assert.equal(await count('photos'),3);
 });
 await test('revoked staff cannot reserve persistent photo',async()=>{
  await reset();await pool.query(`UPDATE car02_r93q_qa.staff SET active=false WHERE shop_code=$1 AND staff_id=$2`,[SHOP,STAFF]);
  try{const res=await post(8);assert.equal(res.status,503);assert.equal(await count('photos'),0);}
  finally{await pool.query(`UPDATE car02_r93q_qa.staff SET active=true WHERE shop_code=$1 AND staff_id=$2`,[SHOP,STAFF]);}
 });
 await test('closed gate creates NO photo or durable intent',async()=>{
  await reset();const res=await post(9,{gate:false});assert.equal(res.status,503);
  assert.equal(await count('photos'),0);assert.equal(await count('upload_intents'),0);
 });
 await test('already READY photo is not reported as successfully uploaded just by durable receipt',async()=>{
  await reset();await post(10);const x=(await pool.query('SELECT id FROM car02_r93q_qa.photos')).rows[0];
  await pool.query(`UPDATE car02_r93q_qa.photos SET upload_state='ready' WHERE id=$1`,[x.id]);
  const res=await post(10);assert.equal(res.status,503);assert.equal(await count('photos'),1);
 });
 await test('outbox job veto on same photo causes no other inserts and no success',async()=>{
  await reset();await post(11);const x=(await pool.query('SELECT id FROM car02_r93q_qa.photos')).rows[0];
  await pool.query(`INSERT INTO car02_r93q_qa.cleanup_jobs(photo_id,shop_code,storage_path,state,reason)
   VALUES($1,'wrong_shop','wrong_path','queued','UPLOAD_UNCERTAIN')`,[x.id]);
  const res=await post(11);assert.equal(res.status,503);assert.equal(await count('photos'),1);
 });
 await reset();console.log('R93W_REAL_HTTP_TO_PG17_INTENT_PORT_PASS');
}finally{await pool.end();}
