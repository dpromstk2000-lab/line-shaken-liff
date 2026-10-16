/** V2.5 disposable PostgreSQL 17 ONLY. Demonstrates sidecar claim concurrency.
 * NO real work order, legacy API, Supabase, Worker, or LINE writes.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createCar02V25QaClaim,V25_MODE} from './car02-v25-concurrent-qa-claim-isolated.mjs';
const env=process.env;
const QA={GITHUB_ACTIONS:'true',NODE_ENV:'test',CAR02_RELEASE_LOCK:'true',CAR02_BASIC_PG17_QA:'yes',
 PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGPASSWORD:'qa_only_local',PGDATABASE:'car02_qa'};
for(const [key,v] of Object.entries(QA))if(env[key]!==v)throw Error('CAR02_V25_DISPOSABLE_ONLY');
if(!/const CAR02_RELEASE_LOCK=true;/.test(readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8')))
 throw Error('CAR02_V25_R52_HARD_LOCK_REQUIRED');
const verifiedEnv=Object.fromEntries(Object.keys(QA).map(key=>[key,env[key]]));
const pool=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',password:'qa_only_local',database:'car02_qa',max:12});
const SHOP='street_house_kitsuki',OTHER='other_shop';
const customer='11111111-1111-4111-8111-111111111111',vehicle='22222222-2222-4222-8222-222222222222';
const ordered='66666666-6666-4666-8666-666666666666';
const ids={solo:randomUUID(),parallel:randomUUID(),stale:randomUUID(),cancel:randomUUID(),completed:randomUUID(),badSlot:randomUUID(),keyCollision:randomUUID()};
const actor=Object.freeze({verified:true,role:'staff',subject:'v25-synthetic-actor',shopCode:SHOP});
const claim=createCar02V25QaClaim({pool,env:verifiedEnv,environment:'disposable_qa',allowDisposableQa:true,
 branchBindings:{ksh:SHOP,wangan:OTHER}});
const request=(which='solo',key='v25-synthetic-unique-claim-001',extra={})=>({
 actor,branch:'ksh',reservationId:ids[which],expectedVersion:4,idempotencyKey:key,...extra});
const countCore=async()=>(await pool.query(`SELECT
 (SELECT count(*)::int FROM public.ksh_demo_reservations) AS bookings,
 (SELECT count(*)::int FROM public.ksh_car02_work_orders) AS orders`)).rows[0];
const countClaims=async()=>(await pool.query('SELECT count(*)::int AS n FROM public.car02_v25_qa_claims')).rows[0].n;
let n=0;
const pass=async(label,fn)=>{await fn();console.log(`PASS V25-ATOMIC-PG17 ${++n}: ${label}`)};
try{
 let before,afterFixture;
 await pass('running on disposable PG17 and prior V2.4 fixture is present',async()=>{
  assert.ok(Number((await pool.query('SHOW server_version_num')).rows[0].server_version_num)>=170000);
  assert.equal((await pool.query("SELECT to_regclass('public.car02_v24_qa_lifecycle') AS t")).rows[0].t,'car02_v24_qa_lifecycle');
  assert.ok((await pool.query('SELECT 1 FROM public.ksh_car02_work_orders WHERE reservation_id=$1::uuid',[ordered])).rowCount>=1);
  before=await countCore();
 });
 await pass('create synthetic R13 bookings and statuses only on ephemeral runner',async()=>{
  for(const [name,id] of Object.entries(ids)){
   await pool.query('INSERT INTO public.ksh_demo_reservations (id,shop_code,customer_id,vehicle_id) VALUES ($1,$2,$3,$4)',[id,SHOP,customer,vehicle]);
   const status=name==='cancel'?'キャンセル':name==='completed'?'作業完了':'入庫予定';
   const time=name==='badSlot'?'10:15':'10:30';
   await pool.query(`INSERT INTO public.car02_v24_qa_lifecycle
     (reservation_id,shop_code,status,version,reservation_date,reservation_time) VALUES ($1,$2,$3,4,'2026-10-21',$4)`,[id,SHOP,status,time]);
  }
  afterFixture=await countCore();
  assert.equal(afterFixture.bookings,before.bookings+Object.keys(ids).length);
  assert.equal(afterFixture.orders,before.orders);
 });
 await pass('create only disposable uniquely indexed QA claim table',async()=>{
  await pool.query(`CREATE TABLE public.car02_v25_qa_claims (
    shop_code text NOT NULL,reservation_id uuid NOT NULL,
    idempotency_key text NOT NULL,version_at_claim integer NOT NULL,
    PRIMARY KEY(shop_code,reservation_id), UNIQUE(shop_code,idempotency_key),
    FOREIGN KEY(reservation_id) REFERENCES public.ksh_demo_reservations(id))`);
  assert.equal(await countClaims(),0);
 });
 await pass('single qualified booking inserts only synthetic claim',async()=>{
  const x=await claim.claim(request());assert.equal(x.result,'CLAIMED_QA');assert.equal(x.sendable,false);
  assert.equal(await countClaims(),1);
 });
 await pass('identical retry is read as synthetic replay without inserting again',async()=>{
  const x=await claim.claim(request());assert.equal(x.result,'REPLAY_QA');assert.equal(x.sendable,false);assert.equal(await countClaims(),1);
 });
 await pass('different key for same booking is rejected',async()=>{
  const x=await claim.claim(request('solo','v25-synthetic-other-claim-002'));
  assert.equal(x.result,'HOLD');assert.equal(x.reason,'BOOKING_ALREADY_CLAIMED');assert.equal(await countClaims(),1);
 });
 await pass('12 competing requests on one booking yield exactly one synthetic claim',async()=>{
  const results=await Promise.all(Array.from({length:12},(_,i)=>
    claim.claim(request('parallel','v25-parallel-claim-'+String(i).padStart(3,'0')))));
  assert.equal(results.filter(x=>x.result==='CLAIMED_QA').length,1);
  assert.equal(results.filter(x=>x.result==='HOLD').length,11);
  assert.ok(results.every(x=>x.sendable===false&&x.safeToCreateRealOrder===false));
  assert.equal(await countClaims(),2);
 });
 await pass('same booking parallel replay key causes only one claim and many replays',async()=>{
  const key='v25-parallel-claimed-same-key';
  const x=await Promise.all(Array.from({length:8},()=>claim.claim(request('stale',key))));
  assert.equal(x.filter(z=>z.result==='CLAIMED_QA').length,1);
  assert.equal(x.filter(z=>z.result==='REPLAY_QA').length,7);
  assert.equal(await countClaims(),3);
 });
 await pass('stale version after claim never replays a cancelled state',async()=>{
  await pool.query("UPDATE public.car02_v24_qa_lifecycle SET status='キャンセル',version=version+1 WHERE reservation_id=$1::uuid",[ids.stale]);
  const x=await claim.claim(request('stale','v25-parallel-claimed-same-key'));
  assert.equal(x.result,'HOLD');assert.equal(x.reason,'STALE_BOOKING_VERSION');
 });
 await pass('reuse of same idempotency key for another booking is rejected',async()=>{
  const x=await claim.claim(request('keyCollision','v25-synthetic-unique-claim-001'));
  assert.equal(x.result,'HOLD');assert.equal(x.reason,'CLAIM_CONFLICT');assert.equal(await countClaims(),3);
 });
 await pass('previously ordered R13 booking denied even without a QA claim',async()=>{
  const x=await claim.claim(request('solo','v25-already-ordered-claim',{reservationId:ordered}));
  assert.equal(x.result,'HOLD');assert.equal(x.reason,'REAL_ORDER_ALREADY_EXISTS');
 });
 await pass('wrong tenant UUID cannot pass scope validation',async()=>{
  const x=await claim.claim(request('solo','v25-wrong-tenant-key-003',{reservationId:'77777777-7777-4777-8777-777777777777'}));
  assert.equal(x.result,'HOLD');assert.equal(x.reason,'RESERVATION_NOT_FOUND');
 });
 await pass('branch tampering denied without any new claim',async()=>{
  await assert.rejects(claim.claim(request('solo','v25-branch-attempt-004',{branch:'wangan'})),/BRANCH_SCOPE_DENIED/);
  assert.equal(await countClaims(),3);
 });
 await pass('pre-cancelled booking denied before claim',async()=>{
  const x=await claim.claim(request('cancel','v25-cancelled-attempt-005'));
  assert.equal(x.result,'HOLD');assert.equal(x.reason,'BOOKING_NOT_ELIGIBLE');
 });
 await pass('completed booking denied before claim',async()=>{
  const x=await claim.claim(request('completed','v25-completed-attempt-006'));
  assert.equal(x.result,'HOLD');assert.equal(x.reason,'BOOKING_NOT_ELIGIBLE');
 });
 await pass('unapproved minute slot denied before claim',async()=>{
  const x=await claim.claim(request('badSlot','v25-slot-attempt-007'));
  assert.equal(x.result,'HOLD');assert.equal(x.reason,'SLOT_INVALID');
 });
 await pass('old display version cannot claim even if status looks active',async()=>{
  const x=await claim.claim(request('keyCollision','v25-old-version-attempt-008',{expectedVersion:3}));
  assert.equal(x.result,'HOLD');assert.equal(x.reason,'STALE_BOOKING_VERSION');
 });
 await pass('invalid customer claim in request is rejected before SQL',async()=>{
  await assert.rejects(claim.claim(request('solo','v25-customer-attempt-009',{customerId:customer})),/FIELDS_DENIED/);
 });
 await pass('R13 customer bookings and existing work orders remain unchanged after claims',async()=>{
  assert.deepEqual(await countCore(),afterFixture);
  assert.equal(await countClaims(),3);
  const a=await pool.query(`SELECT shop_code,reservation_id,version_at_claim FROM public.car02_v25_qa_claims`);
  assert.ok(a.rows.every(x=>x.shop_code===SHOP&&x.version_at_claim===4));
 });
 await pass('R52 is still locked and no callable production send method exists',async()=>{
  assert.equal(V25_MODE.realOrderWrite,false);assert.equal(V25_MODE.release,'NO_GO');
  assert.equal(typeof claim.send,'undefined');assert.equal(typeof claim.deploy,'undefined');
 });
 console.log(`CAR02_V25_CONCURRENT_QA_CLAIM_PG17_PASS ${n}/${n} QA_CLAIMS_ONLY NON_SENDABLE NO_GO HOLD`);
} finally {await pool.end()}
