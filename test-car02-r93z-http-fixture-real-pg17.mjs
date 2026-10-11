// R93Z: verified HTTP semantics and actual disposable PostgreSQL 17 in one call chain.
// No Supabase Storage, production DB, Cloudflare Worker, LINE, remote network or secrets.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createR93YInProcessStorageFixture,createR93YIsolatedStorageProtocol} from './car02-r93y-qa-storage-http-fixture.mjs';
import {createR93SDurableUploadIntentQA} from './car02-r93s-durable-upload-intent-isolated.mjs';
import {createR93XIsolatedPgReadyPort} from './car02-r93x-pg-ready-port-isolated.mjs';
import {createR93XIsolatedVerifiedStorageLifecycle} from './car02-r93x-verified-storage-lifecycle-isolated.mjs';
import {createCar02R93VIsolatedIdempotencyBridge} from './car02-r93v-idempotency-http-bridge-isolated.mjs';
import {buildR93WDurableEnvelope} from './car02-r93w-durable-http-reservation-isolated.mjs';
const DB='car02_r93q_qa_ci', SHOP='street_house_kitsuki';
const ORDER='22222222-2222-4222-8222-222222222222', REPORT='33333333-3333-4333-8333-333333333333';
const STAFF='11111111-1111-4111-8111-111111111111';
const KEYS=n=>`88888888-8888-4888-8888-${String(n).padStart(12,'0')}`;
const BYTES=new Uint8Array([255,216,255,224,21,22,23,24,25,26]);
const ORIGIN='https://r93z-fixture-client.invalid';
const ACTOR=()=>({verified:true,shopCode:SHOP,role:'staff',subject:`staff:${STAFF}`});
if(process.env.R93Z_DISPOSABLE_PG17_QA!=='yes'||process.env.PGHOST!=='127.0.0.1'||
  process.env.PGPORT!=='5432'||process.env.PGUSER!=='postgres'||
  process.env.PGDATABASE!==DB||process.env.PGPASSWORD!=='disposable-r93s-ci-only')
  throw Error('R93Z_DISPOSABLE_PG17_ENV_REQUIRED');
const {default:pg}=await import('pg');
const pool=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',password:'disposable-r93s-ci-only',
 database:DB,max:4,connectionTimeoutMillis:2000,idleTimeoutMillis:1000,application_name:'car02_r93z_disposable_only'});
function input(n){return {actor:ACTOR(),shop:SHOP,orderId:ORDER,reportId:REPORT,
 mimeType:'image/jpeg',bytes:new Uint8Array(BYTES),intentKey:KEYS(n)};}
async function reset(){await pool.query('TRUNCATE car02_r93q_qa.upload_intents,car02_r93q_qa.cleanup_jobs,car02_r93q_qa.photos RESTART IDENTITY CASCADE');}
async function states(){const a=await pool.query(`SELECT upload_state,count(*)::int AS n FROM car02_r93q_qa.photos GROUP BY upload_state`);
 const jobs=await pool.query('SELECT count(*)::int AS n FROM car02_r93q_qa.cleanup_jobs');
 const intents=await pool.query('SELECT count(*)::int AS n FROM car02_r93q_qa.upload_intents');
 return {photos:a.rows.reduce((s,r)=>s+Number(r.n),0), ready:Number(a.rows.find(x=>x.upload_state==='ready')?.n||0),
 deleted:Number(a.rows.find(x=>x.upload_state==='deleted')?.n||0),jobs:Number(jobs.rows[0].n),intents:Number(intents.rows[0].n)};}
function rig(config={}, opts={}){
 const fixture=createR93YInProcessStorageFixture(config);
 const storage=createR93YIsolatedStorageProtocol({environment:'isolated_qa',dbName:DB,fixture});
 const gate=async()=>opts.open!==false;
 const common={environment:'isolated_qa',dbName:DB,shopCode:SHOP,pool,reviewGate:gate};
 const intents=createR93SDurableUploadIntentQA(common);
 const readyPort=createR93XIsolatedPgReadyPort(common);
 const durableUpload=createR93XIsolatedVerifiedStorageLifecycle({environment:'isolated_qa',dbName:DB,
   shopCode:SHOP,intents,readyPort,storage,reviewGate:gate});
 const handle=createCar02R93VIsolatedIdempotencyBridge({environment:'isolated_qa',dbName:DB,
   shopCode:SHOP,releaseEnabled:gate,authenticate:async()=>ACTOR(),durableUpload,origins:[ORIGIN]});
 function request(n,body=new Uint8Array(BYTES)){
  return new Request(`${ORIGIN}/api/car02/uploads/${ORDER}/${REPORT}`,{method:'POST',
    headers:{origin:ORIGIN,authorization:'Bearer 123456789abcdef','content-type':'image/jpeg',
      'idempotency-key':KEYS(n)},body});
 }
 return {fixture,storage,intents,readyPort,durableUpload,handle,request};
}
try{
 const db=await pool.query(`SELECT current_database() AS db,current_setting('server_version_num')::int AS pg,
   to_regclass('public.ksh_car02_photos') IS NULL AS no_live,
   to_regclass('car02_r93q_qa.upload_intents') IS NOT NULL AS intents`);
 assert.equal(db.rows[0].db,DB);assert.ok(db.rows[0].pg>=170000);
 assert.equal(db.rows[0].no_live,true);assert.equal(db.rows[0].intents,true);
 await test('R93Z 1: HTTP fixture + real PG: successful upload requires READY proof',async()=>{
   await reset();const r=rig();const response=await r.handle(r.request(1));
   assert.equal(response.status,201);assert.equal((await response.json()).state,'ready');
   assert.deepEqual(await states(),{photos:1,ready:1,deleted:0,jobs:0,intents:1});
   assert.equal(r.fixture.posts,1);
 });
 await test('R93Z 2: HTTP retry after success returns same photo without repost',async()=>{
   await reset();const r=rig();const a=await r.handle(r.request(2)),aBody=await a.json();
   const b=await r.handle(r.request(2)),bBody=await b.json();
   assert.equal(a.status,201);assert.equal(b.status,201);
   assert.equal(aBody.photoId,bBody.photoId);assert.equal(r.fixture.posts,1);
   assert.deepEqual(await states(),{photos:1,ready:1,deleted:0,jobs:0,intents:1});
 });
 for(const [n,config] of [
  [3,{postAckLost:true}], [4,{postFailedButWritten:true}]
 ]){
  await test(`R93Z ${n}: lost/failed HTTP POST acknowledgement with readback stays single READY`,async()=>{
   await reset();const r=rig(config);const a=await r.handle(r.request(n));
   assert.equal(a.status,201);assert.equal((await a.json()).state,'ready');
   assert.equal(r.fixture.posts,1);assert.equal((await states()).ready,1);assert.equal((await states()).jobs,0);
  });
 }
 for(const [n,config] of [
  [5,{postFailure:true}], [6,{postConflict:true}], [7,{ambiguousMissing:true}],
  [8,{corruptRead:true}], [9,{wrongMime:true}], [10,{readTruncated:true}],
  [11,{readFailure:true}], [12,{oversizeRead:true}], [13,{readRedirect:true}]
 ]){
  await test(`R93Z ${n}: unsafe HTTP Storage response cannot return 201 or READY`,async()=>{
   await reset();const r=rig(config),a=await r.handle(r.request(n));
   assert.notEqual(a.status,201);
   const s=await states();assert.equal(s.ready,0);assert.equal(s.photos,1);
   assert.equal(s.deleted,1);assert.equal(s.jobs,1);assert.equal(s.intents,1);
  });
 }
 for(const [n,config] of [[14,{publicBucket:true}],[15,{bucketMalformed:true}],
    [16,{bucketRedirect:true}],[17,{offline:true}]]){
  await test(`R93Z ${n}: invalid private bucket or offline must fail before DB reservation`,async()=>{
   await reset();const r=rig(config),res=await r.handle(r.request(n));
   assert.notEqual(res.status,201);assert.equal(r.fixture.posts,0);
   assert.deepEqual(await states(),{photos:0,ready:0,deleted:0,jobs:0,intents:0});
  });
 }
 await test('R93Z 18: closed release gate stops all HTTP, DB, and Storage work',async()=>{
  await reset();const r=rig({}, {open:false});const res=await r.handle(r.request(18));
  assert.equal(res.status,503);assert.equal(r.fixture.calls.length,0);
  assert.deepEqual(await states(),{photos:0,ready:0,deleted:0,jobs:0,intents:0});
 });
 await test('R93Z 19: pre-existing outbox prevents READY even if Storage responds 201',async()=>{
  await reset();const r=rig(),x=input(19),env=buildR93WDurableEnvelope(x);
  const p=await r.intents.reserve(env);
  await pool.query(`INSERT INTO car02_r93q_qa.cleanup_jobs(photo_id,shop_code,storage_path,state,reason)
    VALUES($1,'corrupted_tenant','corrupted_path','queued','UPLOAD_UNCERTAIN')`,[p.photoId]);
  const a=await r.handle(r.request(19));assert.notEqual(a.status,201);
  const s=await states();assert.equal(s.ready,0);assert.equal(s.jobs,1);assert.equal(s.photos,1);
 });
 await test('R93Z 20: key reuse with a changed payload is rejected without extra row',async()=>{
  await reset();const r=rig();const ok=await r.handle(r.request(20));assert.equal(ok.status,201);
  const bytes=new Uint8Array(BYTES);bytes[bytes.length-1]^=3;
  const bad=await r.handle(r.request(20,bytes));assert.notEqual(bad.status,201);
  const s=await states();assert.equal(s.photos,1);assert.equal(s.ready,1);assert.equal(s.intents,1);
 });
 console.log('R93Z_REAL_PG17_HTTP_STORAGE_PROTOCOL_E2E_PASS');
}finally{await pool.end()}
