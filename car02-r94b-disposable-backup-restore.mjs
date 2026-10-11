// CAR02 R94B: backup/restore evidence ONLY for two disposable PostgreSQL 17 databases.
// Never connect to Supabase, existing studio data, or public Worker environments.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {createR93YInProcessStorageFixture,createR93YIsolatedStorageProtocol} from './car02-r93y-qa-storage-http-fixture.mjs';
import {createCar02R94AFullStagingPipeline} from './car02-r94a-full-staging-pipeline-isolated.mjs';

const SOURCE='car02_r93q_qa_ci', RESTORE='car02_r94b_restore_ci';
const SHOP='street_house_kitsuki', ORIGIN='https://r94b-fixture-client.invalid';
const ORDER='22222222-2222-4222-8222-222222222222';
const REPORT='33333333-3333-4333-8333-333333333333';
const STAFF='11111111-1111-4111-8111-111111111111';
const BYTES=new Uint8Array([255,216,255,224,21,22,23,24,25,26]);
const mode=process.argv[2];
assert.ok(['seed','verify'].includes(mode),'R94B_MODE_REQUIRED');
assert.equal(process.env.R94B_DISPOSABLE_BACKUP_QA,'yes','R94B_NOT_DISPOSABLE');
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGPORT,'5432');
assert.equal(process.env.PGUSER,'postgres');
assert.equal(process.env.PGPASSWORD,'disposable-r93s-ci-only');
assert.equal(process.env.PGDATABASE,SOURCE);
const {default:pg}=await import('pg');
const pools=[];
function pool(db){
 assert.ok([SOURCE,RESTORE].includes(db));
 const p=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',password:'disposable-r93s-ci-only',database:db,
 max:3,connectionTimeoutMillis:2500,idleTimeoutMillis:1000,application_name:'car02_r94b_disposable_only'});
 pools.push(p);return p;
}
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function ensureDb(p,name){
 const {rows}=await p.query(`SELECT current_database() AS db, current_setting('server_version_num')::int AS pg,
 to_regclass('public.ksh_car02_photos') IS NULL AS no_live,
 to_regclass('car02_r93q_qa.upload_intents') IS NOT NULL AS has_intents`);
 assert.equal(rows[0].db,name);assert.ok(rows[0].pg>=170000);assert.equal(rows[0].no_live,true);
 assert.equal(rows[0].has_intents,true);
}
async function snapshot(p){
 const tables={};
 for(const [name,order] of [['staff','shop_code,staff_id'],['work_orders','id'],['reports','id'],
   ['photos','id'],['upload_intents','shop_code,intent_key'],['cleanup_jobs','job_id']]){
  assert.ok(/^[a-z_]+$/.test(name));
  const {rows}=await p.query(`SELECT * FROM car02_r93q_qa.${name} ORDER BY ${order}`);
  tables[name]=rows;
 }
 const {rows:triggers}=await p.query(`SELECT c.relname AS table_name,t.tgname,
 t.tgenabled,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t
 JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='car02_r93q_qa' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`);
 const {rows:funcs}=await p.query(`SELECT p.proname,pg_get_functiondef(p.oid) AS definition
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='car02_r93q_qa' ORDER BY p.proname`);
 const {rows:acls}=await p.query(`SELECT nspacl::text AS acl FROM pg_namespace WHERE nspname='car02_r93q_qa'`);
 return {tables,triggers,funcs,acls};
}
async function rejected(client,name,sql,params,sqlstates){
 await client.query('SAVEPOINT r94b_probe');
 let failure;
 try{await client.query(sql,params);}catch(err){failure=err;}
 await client.query('ROLLBACK TO SAVEPOINT r94b_probe');
 await client.query('RELEASE SAVEPOINT r94b_probe');
 assert.ok(failure,`${name}: action was incorrectly allowed`);
 assert.ok(sqlstates.includes(failure.code),`${name}: unexpected SQLSTATE ${failure.code}`);
}
async function checkInvariants(p){
 const client=await p.connect();
 try{
  await client.query('BEGIN');
  await rejected(client,'hard delete ready',`DELETE FROM car02_r93q_qa.photos WHERE upload_state='ready'`,[],['23514']);
  await rejected(client,'downgrade READY',`UPDATE car02_r93q_qa.photos SET upload_state='deleted' WHERE upload_state='ready'`,[],['23514']);
  await rejected(client,'mutation of photo path',`UPDATE car02_r93q_qa.photos SET storage_path='different_path' WHERE upload_state='ready'`,[],['23514']);
  await rejected(client,'mutate durable upload intent',`UPDATE car02_r93q_qa.upload_intents SET role='owner'`,[],['23514']);
  await rejected(client,'delete durable upload intent',`DELETE FROM car02_r93q_qa.upload_intents`,[],['23514']);
  await rejected(client,'duplicate durable upload intent',`INSERT INTO car02_r93q_qa.upload_intents
   SELECT * FROM car02_r93q_qa.upload_intents LIMIT 1`,[],['23505']);
  await rejected(client,'undo tombstone',`UPDATE car02_r93q_qa.photos SET upload_state='ready' WHERE upload_state='deleted'`,[],['23514']);
 }finally{await client.query('ROLLBACK');client.release();}
}
try{
 const source=pool(SOURCE);
 await ensureDb(source,SOURCE);
 if(mode==='seed'){
  const {rows}=await source.query('SELECT count(*)::int AS n FROM car02_r93q_qa.photos');
  assert.equal(rows[0].n,0,'R94B_EXPECTED_EMPTY_DISPOSABLE_FIXTURE');
  let next=401;
  const make=async(config={})=>{
   const fixture=createR93YInProcessStorageFixture(config);
   const storage=createR93YIsolatedStorageProtocol({environment:'isolated_qa',dbName:SOURCE,fixture});
   const gate=async()=>true;
   const handle=createCar02R94AFullStagingPipeline({environment:'isolated_qa',dbName:SOURCE,
    shopCode:SHOP,pool:source,storage,reviewGate:gate,
    authenticate:async()=>({verified:true,shopCode:SHOP,role:'staff',subject:`staff:${STAFF}`}),origins:[ORIGIN]});
   const key=`88888888-8888-4888-8888-${String(next++).padStart(12,'0')}`;
   const req=new Request(`${ORIGIN}/functions/v1/dpro-car02-stage/api/car02/uploads/${ORDER}/${REPORT}`,{
    method:'POST',headers:{origin:ORIGIN,authorization:'Bearer disposable-only-token',
    'content-type':'image/jpeg','idempotency-key':key},body:new Uint8Array(BYTES)});
   const res=await handle(req);
   return {status:res.status,body:await res.json()};
  };
  const a=await make(),b=await make(),c=await make({postFailure:true});
  assert.equal(a.status,201);assert.equal(b.status,201);assert.notEqual(c.status,201);
  const state=await snapshot(source);
  assert.equal(state.tables.photos.length,3);
  assert.equal(state.tables.photos.filter(x=>x.upload_state==='ready').length,2);
  assert.equal(state.tables.photos.filter(x=>x.upload_state==='deleted').length,1);
  assert.equal(state.tables.upload_intents.length,3);
  assert.equal(state.tables.cleanup_jobs.length,1);
  assert.equal(state.tables.cleanup_jobs[0].photo_id,state.tables.photos.find(x=>x.upload_state==='deleted').id);
  await checkInvariants(source);
  console.log('R94B_DISPOSABLE_SOURCE_SEED_AND_GUARDS_PASS');
 }else{
  const restored=pool(RESTORE);
  await ensureDb(restored,RESTORE);
  const a=await snapshot(source),b=await snapshot(restored);
  assert.equal(a.tables.photos.length,3);
  assert.equal(a.tables.upload_intents.length,3);
  assert.equal(a.tables.cleanup_jobs.length,1);
  assert.deepEqual(a,b,'R94B_RESTORED_SCHEMA_DATA_OR_GUARDS_DIFFER');
  await checkInvariants(restored);
  const after=await snapshot(restored);
  assert.deepEqual(after,b,'R94B_PROBES_MUTATED_RESTORED_DATA');
  console.log('R94B_DISPOSABLE_BACKUP_RESTORE_VERIFIED_PASS');
  console.log('R94B_SNAPSHOT_SHA256='+sha(a));
 }
}finally{await Promise.all(pools.map(p=>p.end()));}
