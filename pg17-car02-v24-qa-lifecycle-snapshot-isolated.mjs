/** CAR02 V2.4: disposable PostgreSQL 17 synthetic lifecycle sidecar QA ONLY.
 * Creates a QA-only sidecar fixture in the ephemeral `car02_qa` database.
 * NEVER changes existing R13 booking/work-order rows, migrations, Worker or LINE.
 * A consistent snapshot does NOT authorize or atomically create an order.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {createCar02V24QaLifecycleReader,V24_MODE} from './car02-v24-qa-lifecycle-snapshot-isolated.mjs';
const env=process.env;
// process.env has a Node-specific prototype. The core reader intentionally
// accepts only plain objects, so copy ONLY the inspected CI-only variables.
// This preserves every exact-value isolation gate and never weakens the reader.
const REQUIRED_QA_ENV=Object.freeze({GITHUB_ACTIONS:'true',NODE_ENV:'test',CAR02_RELEASE_LOCK:'true',
 CAR02_BASIC_PG17_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',
 PGPASSWORD:'qa_only_local',PGDATABASE:'car02_qa'});
for(const [k,v] of Object.entries(REQUIRED_QA_ENV))if(env[k]!==v)throw Error('CAR02_V24_DISPOSABLE_ONLY');
const verifiedQaEnv=Object.fromEntries(Object.keys(REQUIRED_QA_ENV).map(k=>[k,env[k]]));
const lock=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
if(!/const\s+CAR02_RELEASE_LOCK\s*=\s*true;/.test(lock))throw Error('CAR02_V24_RELEASE_LOCK_MISSING');
const POOL=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',password:'qa_only_local',database:'car02_qa',max:3});
const SHOP='street_house_kitsuki',OTHER='other_shop';
const ID='66666666-6666-4666-8666-666666666666',FOREIGN='77777777-7777-4777-8777-777777777777';
const fakeActor=(shop=SHOP)=>({verified:true,role:'staff',subject:'synthetic-v24-actor',shopCode:shop});
const reader=createCar02V24QaLifecycleReader({pool:POOL,env:verifiedQaEnv,environment:'disposable_qa',allowDisposableQa:true,
 branchBindings:{ksh:SHOP,wangan:OTHER}});
const request=(change={})=>({actor:fakeActor(),branch:'ksh',reservationId:ID,expectedVersion:4,...change});
let cases=0;const pass=async(label,fn)=>{await fn();console.log(`PASS V24-SNAPSHOT-PG17 ${++cases}: ${label}`)};
const countCore=async()=>{
 const o=await POOL.query('SELECT (SELECT count(*)::int FROM public.ksh_demo_reservations) reservations,(SELECT count(*)::int FROM public.ksh_car02_work_orders) work_orders');return o.rows[0];
};
try {
 let before;
 await pass('real disposable PG17 and expected R13 reservation exist',async()=>{
  const v=await POOL.query('SHOW server_version_num');assert.ok(Number(v.rows[0].server_version_num)>=170000);
  const r=await POOL.query('SELECT 1 FROM public.ksh_demo_reservations WHERE id=$1::uuid AND shop_code=$2',[ID,SHOP]);assert.equal(r.rows.length,1);
  before=await countCore();
 });
 await pass('synthetic lifecycle columns created in separate disposable QA sidecar only',async()=>{
  await POOL.query(`CREATE TABLE public.car02_v24_qa_lifecycle (
    reservation_id uuid PRIMARY KEY REFERENCES public.ksh_demo_reservations(id),
    shop_code text NOT NULL,status text NOT NULL,
    version integer NOT NULL CHECK(version>=1),
    reservation_date date NOT NULL,reservation_time time without time zone NOT NULL)`);
  await POOL.query(`INSERT INTO public.car02_v24_qa_lifecycle
     (reservation_id,shop_code,status,version,reservation_date,reservation_time) VALUES
     ($1,$2,'入庫予定',4,'2026-10-20','10:30'),($3,$4,'入庫済み',2,'2026-10-21','11:00')`,[ID,SHOP,FOREIGN,OTHER]);
  assert.deepEqual(await countCore(),before);
 });
 await pass('QA snapshot finds currently matching tenant booking version and status',async()=>{
  const x=await reader.inspect(request());assert.equal(x.result,'CONSISTENT_QA_SNAPSHOT');assert.equal(x.snapshotConsistent,true);
 });
 await pass('even consistent snapshot cannot authorize real order creation',async()=>{
  const x=await reader.inspect(request());assert.equal(x.safeToCreateOrder,false);assert.equal(x.sendable,false);
  assert.equal(x.atomicWriteProven,false);assert.equal(x.realAuthVerified,false);
  assert.equal(x.release,'NO_GO');assert.equal(x.migration,'HOLD');
 });
 await pass('browser stale version denied by PostgreSQL state',async()=>{
  const x=await reader.inspect(request({expectedVersion:3}));assert.equal(x.result,'HOLD');assert.ok(x.checks.includes('QA_STALE_OR_INVALID_VERSION'));
 });
 await pass('unknown UUID cannot gain access from display',async()=>{
  const x=await reader.inspect(request({reservationId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}));assert.equal(x.result,'HOLD');
 });
 await pass('foreign tenant UUID cannot cross ksh branch even when UUID is real',async()=>{
  const x=await reader.inspect(request({reservationId:FOREIGN}));assert.equal(x.result,'HOLD');
 });
 await pass('trusted other branch is isolated and only synthetic',async()=>{
  const x=await reader.inspect(request({actor:fakeActor(OTHER),branch:'wangan',reservationId:FOREIGN,expectedVersion:2}));
  assert.equal(x.result,'CONSISTENT_QA_SNAPSHOT');assert.equal(x.sendable,false);
 });
 await pass('browser branch tampering denied before SQL',async()=>{
  await assert.rejects(reader.inspect(request({branch:'wangan'})),/BRANCH_BINDING_DENIED/);
 });
 await pass('cancelled booking from DB state must HOLD',async()=>{
  await POOL.query(`UPDATE public.car02_v24_qa_lifecycle SET status='キャンセル',version=version+1 WHERE reservation_id=$1::uuid`,[ID]);
  const x=await reader.inspect(request({expectedVersion:5}));assert.equal(x.result,'HOLD');assert.ok(x.checks.includes('QA_STATUS_NOT_ELIGIBLE'));
 });
 await pass('stale view cannot pass after a version change',async()=>{
  const x=await reader.inspect(request());assert.equal(x.result,'HOLD');assert.ok(x.checks.includes('QA_STALE_OR_INVALID_VERSION'));
 });
 await pass('finished booking state blocks even if version matches',async()=>{
  await POOL.query(`UPDATE public.car02_v24_qa_lifecycle SET status='作業完了',version=version+1 WHERE reservation_id=$1::uuid`,[ID]);
  const x=await reader.inspect(request({expectedVersion:6}));assert.equal(x.result,'HOLD');
 });
 await pass('half-hour slot validation rejects inconsistent DB fixture',async()=>{
  await POOL.query(`UPDATE public.car02_v24_qa_lifecycle SET status='入庫予定',version=version+1,reservation_time='10:15' WHERE reservation_id=$1::uuid`,[ID]);
  const x=await reader.inspect(request({expectedVersion:7}));assert.equal(x.result,'HOLD');assert.ok(x.checks.includes('QA_SLOT_INVALID'));
 });
 await pass('snapshot-only reader cannot write to its own transaction',async()=>{
  const client=await POOL.connect();try{
   await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   await assert.rejects(client.query(`UPDATE public.car02_v24_qa_lifecycle SET version=999 WHERE reservation_id=$1::uuid`,[ID]),/read-only transaction/);
   await client.query('ROLLBACK');
  }finally{client.release()}
 });
 await pass('two parallel QA snapshots are still non-sendable, not atomic creation',async()=>{
  await POOL.query(`UPDATE public.car02_v24_qa_lifecycle SET status='入庫予定',reservation_time='10:30',version=8 WHERE reservation_id=$1::uuid`,[ID]);
  const both=await Promise.all([reader.inspect(request({expectedVersion:8})),reader.inspect(request({expectedVersion:8}))]);
  assert.equal(both.length,2);assert.ok(both.every(x=>x.snapshotConsistent&&x.sendable===false&&x.atomicWriteProven===false));
 });
 await pass('QA sidecar does not change R13 reservations or CAR02 work orders',async()=>{
  assert.deepEqual(await countCore(),before);
 });
 await pass('R52 stays locked, fixture only, no methods to send or deploy',async()=>{
  assert.match(lock,/const\s+CAR02_RELEASE_LOCK\s*=\s*true;/);
  assert.equal(typeof reader.send,'undefined');assert.equal(typeof reader.deploy,'undefined');
  assert.equal(V24_MODE.productionReady,false);
 });
 console.log(`CAR02_V24_LIFECYCLE_SNAPSHOT_PG17_PASS ${cases}/${cases} QA_SIDECAR_ONLY NON_SENDABLE NO_GO HOLD`);
} finally { await POOL.end(); }
