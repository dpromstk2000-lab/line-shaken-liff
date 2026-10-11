// Executes ONLY on disposable PG17 GitHub Actions, never a live database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createR93SDurableUploadIntentQA} from './car02-r93s-durable-upload-intent-isolated.mjs';
import {createR93XIsolatedPgReadyPort} from './car02-r93x-pg-ready-port-isolated.mjs';
import {createR93XIsolatedVerifiedStorageLifecycle} from './car02-r93x-verified-storage-lifecycle-isolated.mjs';
import {buildR93WDurableEnvelope} from './car02-r93w-durable-http-reservation-isolated.mjs';
import {createCar02R93VIsolatedIdempotencyBridge} from './car02-r93v-idempotency-http-bridge-isolated.mjs';
const DB='car02_r93q_qa_ci', SHOP='street_house_kitsuki',O='22222222-2222-4222-8222-222222222222',
 R='33333333-3333-4333-8333-333333333333',STAFF='11111111-1111-4111-8111-111111111111',
 BUCKET='ksh-car02-private-photos';
if(process.env.R93X_DISPOSABLE_DRIVER_QA!=='yes'||process.env.PGHOST!=='127.0.0.1'||
 process.env.PGPORT!=='5432'||process.env.PGUSER!=='postgres'||process.env.PGDATABASE!==DB||
 process.env.PGPASSWORD!=='disposable-r93s-ci-only')throw Error('R93X_DISPOSABLE_PG17_ONLY');
const {default:pg}=await import('pg');
const pool=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',password:'disposable-r93s-ci-only',
 database:DB,max:4,connectionTimeoutMillis:2000,idleTimeoutMillis:1500,application_name:'dpro_car02_r93x_qa'});
const image=new Uint8Array([255,216,255,224,1,2,3,4,5,6]);
const actor=()=>({verified:true,shopCode:SHOP,role:'staff',subject:`staff:${STAFF}`});
const uuid=n=>`88888888-8888-4888-8888-${String(n).padStart(12,'0')}`;
const input=n=>({actor:actor(),shop:SHOP,orderId:O,reportId:R,mimeType:'image/jpeg',bytes:new Uint8Array(image),intentKey:uuid(n)});
const reset=async()=>pool.query('TRUNCATE car02_r93q_qa.upload_intents,car02_r93q_qa.cleanup_jobs,car02_r93q_qa.photos RESTART IDENTITY CASCADE');
const count=async table=>Number((await pool.query(`SELECT count(*)::integer AS n FROM car02_r93q_qa.${table}`)).rows[0].n);
function memStorage(config={}){
 const m=new Map();let posts=0;
 return {kind:'isolated_memory',testOnly:true,objects:m,get posts(){return posts},
  async verifyPrivateBucket(){return {id:BUCKET,public:false}},
  async inspectObject({bucket,path}){if(config.offlineInspect)return null;const blob=m.get(path);
   return blob?{found:true,private:true,bucket,path,mimeType:'image/jpeg',bytes:new Uint8Array(blob)}:
   {found:false,definitive:true};},
  async postObject({path,bytes,upsert}){posts++;assert.equal(upsert,false);
   if(config.failBeforeWrite)throw Error('OUTAGE');m.set(path,new Uint8Array(bytes));
   if(config.lostAck)throw Error('ACK_LOST');return {status:201};}
 };
}
function rig(storage=memStorage(),settings={}){
 const args={environment:'isolated_qa',dbName:DB,shopCode:SHOP,pool,reviewGate:async()=>true};
 const intents=createR93SDurableUploadIntentQA(args);
 const readyPort=createR93XIsolatedPgReadyPort({...args,pool:settings.readyPool||pool});
 const service=createR93XIsolatedVerifiedStorageLifecycle({environment:'isolated_qa',dbName:DB,
   shopCode:SHOP,intents,readyPort,storage,reviewGate:async()=>true});
 return {intents,readyPort,service,storage};
}
try{
 const db=await pool.query(`SELECT current_database() AS db,current_setting('server_version_num')::int AS v,
  to_regclass('public.ksh_car02_photos') IS NULL AS no_live,
  to_regclass('car02_r93q_qa.upload_intents') IS NOT NULL AS intents`);
 assert.equal(db.rows[0].db,DB);assert.equal(db.rows[0].no_live,true);
 assert.equal(db.rows[0].intents,true);assert.ok(db.rows[0].v>=170000);
 await test('R93X DB success: reserve, simulated Storage, atomic READY and independent proof',async()=>{
  await reset();const r=rig();const a=await r.service.upload(input(1));
  assert.equal(a.state,'ready');assert.equal(await count('photos'),1);assert.equal(await count('cleanup_jobs'),0);
  const photo=await pool.query('SELECT upload_state FROM car02_r93q_qa.photos WHERE id=$1',[a.photoId]);
  assert.equal(photo.rows[0].upload_state,'ready');assert.equal(r.storage.posts,1);
  const b=await r.service.upload(input(1));assert.equal(b.photoId,a.photoId);assert.equal(r.storage.posts,1);
 });
 await test('R93X Storage write ACK loss: verified readback recovers without double POST',async()=>{
  await reset();const s=memStorage({lostAck:true});const r=rig(s);
  const a=await r.service.upload(input(2));assert.equal(a.state,'ready');assert.equal(s.posts,1);
  assert.equal(await count('cleanup_jobs'),0);
 });
 await test('R93X Postgres COMMIT ACK loss after READY is independently recovered',async()=>{
  await reset();let lost=false;
  const proxy={async connect(){const c=await pool.connect();return {async query(sql,args){
   if(sql==='COMMIT'&&!lost){await c.query(sql,args);lost=true;throw Error('READY_COMMIT_ACK_LOST')}
   return c.query(sql,args);
  },release(){c.release()}}}};
  const r=rig(memStorage(),{readyPool:proxy});const a=await r.service.upload(input(3));
  assert.equal(lost,true);assert.equal(a.state,'ready');assert.equal(await count('cleanup_jobs'),0);
 });
 await test('R93X simulated Storage definite failure tombstones and enqueues atomically',async()=>{
  await reset();const r=rig(memStorage({failBeforeWrite:true}));
  await assert.rejects(r.service.upload(input(4)),{code:'R93X_RECOVERY_QUEUED'});
  const p=await pool.query('SELECT upload_state FROM car02_r93q_qa.photos');
  assert.equal(p.rows[0].upload_state,'deleted');assert.equal(await count('cleanup_jobs'),1);
 });
 await test('R93X can restart after pending reservation and prove existing saved blob',async()=>{
  await reset();const s=memStorage();const first=rig(s);const x=input(5);
  const env=buildR93WDurableEnvelope(x);
  const pending=await first.intents.reserve(env);assert.equal(pending.state,'pending');
  s.objects.set(env.path,new Uint8Array(image));
  const another=rig(s);const a=await another.service.upload(x);assert.equal(a.photoId,pending.photoId);
  assert.equal(s.posts,0);assert.equal(a.state,'ready');
 });
 await test('R93X same intent concurrent upload creates one photo',async()=>{
  await reset();const r=rig();const results=await Promise.allSettled([r.service.upload(input(6)),r.service.upload(input(6))]);
  // Whether one races into uncertain compensation or both finish, no second photo is allowed.
  assert.equal(await count('photos'),1);assert.equal(await count('upload_intents'),1);
  assert.ok(results.some(v=>v.status==='fulfilled'||v.status==='rejected'));
 });
 await test('R93X refuses READY when a cleanup job exists for identical photo ID',async()=>{
  await reset();const r=rig(),x=input(7),env=buildR93WDurableEnvelope(x);
  const a=await r.intents.reserve(env);
  await pool.query(`INSERT INTO car02_r93q_qa.cleanup_jobs(photo_id,shop_code,storage_path,state,reason)
    VALUES($1,'corrupted_shop','corrupted_path','queued','UPLOAD_UNCERTAIN')`,[a.photoId]);
  await assert.rejects(r.readyPort.markReady(env,a.photoId),{code:'R93X_OUTBOX_COLLISION'});
  await assert.rejects(r.service.upload(x));
  assert.equal(await count('photos'),1);assert.equal(await count('cleanup_jobs'),1);
 });
 await test('R93X revoked staff cannot commit READY or compensate',async()=>{
  await reset();const r=rig(),x=input(8),env=buildR93WDurableEnvelope(x),p=await r.intents.reserve(env);
  await pool.query('UPDATE car02_r93q_qa.staff SET active=false WHERE shop_code=$1 AND staff_id=$2',[SHOP,STAFF]);
  try{await assert.rejects(r.readyPort.markReady(env,p.photoId),{code:'R93X_STAFF_DENIED'});
      await assert.rejects(r.readyPort.enqueueUncertain(env,p.photoId),{code:'R93X_STAFF_DENIED'});}
  finally{await pool.query('UPDATE car02_r93q_qa.staff SET active=true WHERE shop_code=$1 AND staff_id=$2',[SHOP,STAFF]);}
  assert.equal(await count('cleanup_jobs'),0);
 });
 await test('R93X outbox INSERT failure rolls back deletion status',async()=>{
  await reset();const r=rig(),x=input(9),env=buildR93WDurableEnvelope(x),p=await r.intents.reserve(env);
  await pool.query(`CREATE FUNCTION car02_r93q_qa.r93x_fail_job() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN RAISE EXCEPTION 'R93X_FORCED_JOB_FAILURE';END $$`);
  await pool.query(`CREATE TRIGGER r93x_fail_job BEFORE INSERT ON car02_r93q_qa.cleanup_jobs
    FOR EACH ROW EXECUTE FUNCTION car02_r93q_qa.r93x_fail_job()`);
  try{await assert.rejects(r.readyPort.enqueueUncertain(env,p.photoId),{code:'R93X_DB_UNAVAILABLE'});
      const t=await pool.query('SELECT upload_state FROM car02_r93q_qa.photos WHERE id=$1',[p.photoId]);
      assert.equal(t.rows[0].upload_state,'pending');assert.equal(await count('cleanup_jobs'),0);}
  finally{await pool.query('DROP TRIGGER r93x_fail_job ON car02_r93q_qa.cleanup_jobs');
          await pool.query('DROP FUNCTION car02_r93q_qa.r93x_fail_job()');}
 });
 await test('R93X actual HTTP R93V->R82->R93X->PG17 with memory Storage returns 201 only after proof',async()=>{
  await reset();const r=rig();const bridge=createCar02R93VIsolatedIdempotencyBridge({environment:'isolated_qa',
   dbName:DB,shopCode:SHOP,releaseEnabled:async()=>true,authenticate:async()=>actor(),
   durableUpload:r.service,origins:['https://qa.example.invalid']});
  const url=`https://qa.example.invalid/api/car02/uploads/${O}/${R}`;
  const request=()=>new Request(url,{method:'POST',headers:{origin:'https://qa.example.invalid',authorization:'Bearer 123456789abcdef',
   'content-type':'image/jpeg','idempotency-key':uuid(10)},body:new Uint8Array(image)});
  const first=await bridge(request()),data=await first.json();
  assert.equal(first.status,201);assert.equal(data.state,'ready');assert.equal(await count('photos'),1);
  const again=await bridge(request());assert.equal(again.status,201);assert.equal(r.storage.posts,1);
 });
 await reset();
 console.log('R93X_REAL_PG17_ISOLATED_STORAGE_READY_PASS');
}finally{await pool.end()}
