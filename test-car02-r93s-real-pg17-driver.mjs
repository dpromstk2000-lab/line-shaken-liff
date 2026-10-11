// R93S QA: real Node.js pg driver tests on disposable PG17 only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createR93SDurableUploadIntentQA} from './car02-r93s-durable-upload-intent-isolated.mjs';
const DB='car02_r93q_qa_ci',SHOP='street_house_kitsuki';
const ORDER='22222222-2222-4222-8222-222222222222';
const REPORT='33333333-3333-4333-8333-333333333333';
const STAFF='11111111-1111-4111-8111-111111111111';
const BUCKET='ksh-car02-private-photos';
const ACTOR={verified:true,shopCode:SHOP,role:'staff',subject:`staff:${STAFF}`};
const id=n=>`77777777-7777-4777-8777-${String(n).padStart(12,'0')}`;
const intent=n=>`88888888-8888-4888-8888-${String(n).padStart(12,'0')}`;
const input=n=>({actor:{...ACTOR},shopCode:SHOP,orderId:ORDER,reportId:REPORT,
  intentKey:intent(n),bucket:BUCKET,path:`${SHOP}/${ORDER}/${REPORT}/${id(n)}.jpg`,
  mimeType:'image/jpeg',byteSize:200,sha256:'a'.repeat(64)});
if(process.env.R93S_DISPOSABLE_DRIVER_QA!=='yes'||process.env.PGHOST!=='127.0.0.1'||
 process.env.PGPORT!=='5432'||process.env.PGUSER!=='postgres'||
 process.env.PGDATABASE!==DB||process.env.PGPASSWORD!=='disposable-r93s-ci-only')
 throw Error('R93S_LOCAL_DISPOSABLE_PG17_REQUIRED');
const {default:pg}=await import('pg');
const pool=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',password:'disposable-r93s-ci-only',database:DB,
 max:4,connectionTimeoutMillis:2000,idleTimeoutMillis:1500,application_name:'dpro_car02_r93s_qa'});
const create=(p=pool)=>createR93SDurableUploadIntentQA({environment:'isolated_qa',dbName:DB,
 shopCode:SHOP,pool:p,reviewGate:async()=>true});
const reset=()=>pool.query('TRUNCATE car02_r93q_qa.upload_intents,car02_r93q_qa.cleanup_jobs,car02_r93q_qa.photos RESTART IDENTITY CASCADE');
const count=async(table)=>Number((await pool.query(`SELECT count(*)::integer AS n FROM car02_r93q_qa.${table}`)).rows[0].n);
try{
 const first=await pool.query(`SELECT current_database() db,current_setting('server_version_num')::int version,
 to_regclass('public.ksh_car02_photos') IS NULL no_live,
 to_regclass('car02_r93q_qa.upload_intents') IS NOT NULL intents`);
 assert.equal(first.rows[0].db,DB);assert.equal(first.rows[0].intents,true);
 assert.equal(first.rows[0].no_live,true);assert.ok(first.rows[0].version>=170000);
 await test('reserve twice with same intent after restart returns the SAME photo',async()=>{
  await reset();const x=input(1);const a=await create().reserve(x);
  const b=await create().reserve(x);const c=await create().resume(x);
  assert.equal(a.photoId,b.photoId);assert.equal(a.photoId,c.photoId);
  assert.equal(b.action,'VERIFY_STORAGE_OR_COMPENSATE');
  assert.equal(await count('photos'),1);assert.equal(await count('upload_intents'),1);
 });
 await test('lost commit ACK is safely reconciled by another process',async()=>{
  await reset();let lost=false;
  const proxy={async connect(){const c=await pool.connect();return {
   async query(sql,args){if(sql==='COMMIT'){await c.query(sql,args);lost=true;throw Error('ACK_LOST_AFTER_COMMIT');}
    return c.query(sql,args);},release(){c.release()}}}};
  const x=input(2);await assert.rejects(create(proxy).reserve(x),{code:'R93S_DATABASE_UNAVAILABLE'});
  assert.equal(lost,true);const result=await create().reserve(x);
  assert.equal(result.state,'pending');assert.equal(await count('photos'),1);
 });
 await test('concurrent reserve for same key is serialized across pg connections',async()=>{
  await reset();const x=input(3);
  const answers=await Promise.all([create().reserve(x),create().reserve(x),create().reserve(x)]);
  assert.equal(new Set(answers.map(a=>a.photoId)).size,1);
  assert.equal(await count('photos'),1);assert.equal(await count('upload_intents'),1);
 });
 await test('same intent key with different metadata or actor is rejected',async()=>{
  await reset();const x=input(4);await create().reserve(x);
  for(const change of [y=>y.sha256='b'.repeat(64),y=>y.byteSize=202,
    y=>y.path=y.path.replace('.jpg','.png') /* invalid validPath */,y=>y.actor.subject=`staff:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee`]){
    const y=structuredClone(x);change(y);
    await assert.rejects(create().reserve(y));
  }
  assert.equal(await count('photos'),1);
 });
 await test('existing intent retry succeeds when three-photo limit reached, fourth key rejected',async()=>{
  await reset();for(let n=5;n<=7;n++)await create().reserve(input(n));
  assert.equal((await create().reserve(input(5))).state,'pending');
  await assert.rejects(create().reserve(input(8)),{code:'R93S_THREE_PHOTO_LIMIT'});
  assert.equal(await count('photos'),3);
 });
 await test('resume across restart observes READY but does not reupload',async()=>{
  await reset();const x=input(9);const reserved=await create().reserve(x);
  await pool.query(`UPDATE car02_r93q_qa.photos SET upload_state='ready' WHERE id=$1`,[reserved.photoId]);
  const resumed=await create().resume(x);
  assert.equal(resumed.state,'ready');assert.equal(resumed.action,'DO_NOT_REUPLOAD');
 });
 await test('any outbox job with same photo_id vetoes resume',async()=>{
  await reset();const x=input(10);const r=await create().reserve(x);
  await pool.query(`INSERT INTO car02_r93q_qa.cleanup_jobs(photo_id,shop_code,storage_path,state,reason)
    VALUES($1,'incorrect_shop','incorrect_path','queued','UPLOAD_UNCERTAIN')`,[r.photoId]);
  await assert.rejects(create().resume(x),{code:'R93S_OUTBOX_CONFLICT'});
  await assert.rejects(create().reserve(x),{code:'R93S_OUTBOX_CONFLICT'});
 });
 await test('deleted photo cannot be reopened after restart',async()=>{
  await reset();const x=input(11);const r=await create().reserve(x);
  await pool.query(`UPDATE car02_r93q_qa.photos SET upload_state='deleted' WHERE id=$1`,[r.photoId]);
  await assert.rejects(create().resume(x),{code:'R93S_TERMINAL_PHOTO'});
 });
 await test('durable intent receipt cannot be edited or deleted after creation',async()=>{
  await reset();const x=input(15);await create().reserve(x);
  await assert.rejects(pool.query(`UPDATE car02_r93q_qa.upload_intents SET storage_path='tampered' WHERE shop_code=$1 AND intent_key=$2`,[SHOP,x.intentKey]));
  await assert.rejects(pool.query(`DELETE FROM car02_r93q_qa.upload_intents WHERE shop_code=$1 AND intent_key=$2`,[SHOP,x.intentKey]));
  assert.equal(await count('upload_intents'),1);
 });
 await test('revoked staff cannot resume persisted intent',async()=>{
  await reset();const x=input(12);await create().reserve(x);
  await pool.query(`UPDATE car02_r93q_qa.staff SET active=false WHERE shop_code=$1 AND staff_id=$2`,[SHOP,STAFF]);
  try{await assert.rejects(create().resume(x),{code:'R93S_STAFF_REVOKED'});}
  finally{await pool.query(`UPDATE car02_r93q_qa.staff SET active=true WHERE shop_code=$1 AND staff_id=$2`,[SHOP,STAFF]);}
 });
 await test('missing intent is explicitly NOT FOUND and does not create a photo',async()=>{
  await reset();await assert.rejects(create().resume(input(13)),{code:'R93S_INTENT_NOT_FOUND'});
  assert.equal(await count('photos'),0);
 });
 await test('failed intent insertion rolls back photo insert',async()=>{
  await reset();await pool.query(`CREATE OR REPLACE FUNCTION car02_r93q_qa.r93s_fail_intents() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'R93S_FORCED_INTENT_INSERT_FAILURE'; END $$`);
  await pool.query(`CREATE TRIGGER r93s_fail_intents BEFORE INSERT ON car02_r93q_qa.upload_intents
    FOR EACH ROW EXECUTE FUNCTION car02_r93q_qa.r93s_fail_intents()`);
  try{await assert.rejects(create().reserve(input(14)),{code:'R93S_DATABASE_UNAVAILABLE'});
    assert.equal(await count('photos'),0);assert.equal(await count('upload_intents'),0);}
  finally{await pool.query(`DROP TRIGGER r93s_fail_intents ON car02_r93q_qa.upload_intents`);
    await pool.query(`DROP FUNCTION car02_r93q_qa.r93s_fail_intents()`);}
 });
 await reset();
 console.log('R93S_REAL_PG17_DURABLE_INTENT_PASS');
}finally{await pool.end();}
