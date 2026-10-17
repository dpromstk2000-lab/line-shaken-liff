/** CAR02 V2.7 PG17, disposable-only reproduction and uniqueness experiment.
 * Does not read or write live services. NEVER deploy. R13 production SQL unchanged.
 * Works on synthetic R13 schema ONLY after existing CI R13/R45/V25 steps.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {auditCar02V27R13UniquenessSource,V27_QA_UNIQUE_INDEX_SQL,
 verifyCar02V27QaIndexDefinition} from './car02-v27-order-uniqueness-audit-isolated.mjs';
const env=process.env;
const REQUIRED={GITHUB_ACTIONS:'true',NODE_ENV:'test',CAR02_RELEASE_LOCK:'true',
 CAR02_BASIC_PG17_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',
 PGPASSWORD:'qa_only_local',PGDATABASE:'car02_qa'};
for(const [k,v] of Object.entries(REQUIRED))if(env[k]!==v)throw Error('CAR02_V27_DISPOSABLE_ONLY');
const entry=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
if(!/const\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/.test(entry))throw Error('CAR02_V27_R52_LOCK_REQUIRED');
const sql=readFileSync(new URL('./R13_MIGRATION_QA_ONLY.sql',import.meta.url),'utf8');
const adapter=readFileSync(new URL('./car02-pg-adapter.mjs',import.meta.url),'utf8');
const sourceAudit=auditCar02V27R13UniquenessSource({r13:sql,adapter});
if(!sourceAudit.sourceConsistent||sourceAudit.uniqueBookingConstraintVerified)
 throw Error('CAR02_V27_BASELINE_UNEXPECTED');
verifyCar02V27QaIndexDefinition(V27_QA_UNIQUE_INDEX_SQL);
const pool=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',password:'qa_only_local',database:'car02_qa',max:15});
const SHOP='street_house_kitsuki',OTHER='other_shop';
const C='11111111-1111-4111-8111-111111111111',V='22222222-2222-4222-8222-222222222222';
const B=randomUUID(),B2=randomUUID();
const index='car02_v27_qa_one_order_per_reservation';
const INSERT_ORDER=`INSERT INTO public.ksh_car02_work_orders
 (shop_code,customer_id,vehicle_id,reservation_id,status,state_version)
 VALUES ($1,$2::uuid,$3::uuid,$4::uuid,'draft',1) RETURNING id`;
const INSERT_BOOK=`INSERT INTO public.ksh_demo_reservations(id,shop_code,customer_id,vehicle_id)
 VALUES($1::uuid,$2,$3::uuid,$4::uuid)`;
const COUNT_BOOK=`SELECT count(*)::int AS n FROM public.ksh_car02_work_orders WHERE shop_code=$1 AND reservation_id=$2::uuid`;
const baseline=async()=>{
 const z=await pool.query(`SELECT
   (SELECT count(*)::int FROM public.ksh_demo_reservations) AS bookings,
   (SELECT count(*)::int FROM public.ksh_car02_work_orders) AS orders`);
 return z.rows[0];
};
let original=null,originalSnapshot=null,cases=0,indexCreated=false;
const pass=async(label,fn)=>{await fn();console.log(`PASS V27-ONE-ORDER-PG17 ${++cases}: ${label}`);};
async function cleanup(){
 if(original===null)return;
 await pool.query(`DELETE FROM public.ksh_car02_work_orders WHERE reservation_id=$1::uuid OR reservation_id=$2::uuid`,[B,B2]);
 await pool.query(`DELETE FROM public.ksh_demo_reservations WHERE id=$1::uuid OR id=$2::uuid`,[B,B2]);
 if(indexCreated){await pool.query(`DROP INDEX IF EXISTS public.${index}`);indexCreated=false;}
 if(originalSnapshot){assert.deepEqual(await baseline(),originalSnapshot);console.log('CAR02_V27_DISPOSABLE_FIXTURE_RESTORED');}
}
try{
 await pass('PostgreSQL 17 disposable only with R52 lock',async()=>{
  const r=await pool.query('SHOW server_version_num');assert.ok(Number(r.rows[0].server_version_num)>=170000);
  originalSnapshot=await baseline();original=originalSnapshot;
 });
 await pass('R13 source has ordinary nonunique reservation lookup only',async()=>{
  assert.equal(sourceAudit.r13HasOnlyNonuniqueBookingIndex,true);
  assert.equal(sourceAudit.r45HasScopedIdempotency,true);
  assert.equal(sourceAudit.productionReady,false);
 });
 await pass('database catalog confirms no booking unique index in old R13 QA schema',async()=>{
  const t=await pool.query(`SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='ksh_car02_work_orders'`);
  assert.ok(t.rows.some(x=>/CREATE INDEX ksh_car02_work_orders_reservation_idx/.test(x.indexdef)));
  assert.ok(!t.rows.some(x=>/CREATE UNIQUE INDEX/i.test(x.indexdef)&&/\breservation_id\b/i.test(x.indexdef)));
 });
 await pass('two orders with distinct operations can share booking in old R13 QA schema',async()=>{
  const c=await pool.connect();try{
   await c.query('BEGIN');
   try{
    await c.query(INSERT_BOOK,[B,SHOP,C,V]);
    await c.query(INSERT_ORDER,[SHOP,C,V,B]);
    await c.query(INSERT_ORDER,[SHOP,C,V,B]);
    const r=await c.query(COUNT_BOOK,[SHOP,B]);assert.equal(r.rows[0].n,2);
   }finally{await c.query('ROLLBACK');}
  }finally{c.release();}
 });
 await pass('reproduction rollback leaves no uncommitted synthetic order',async()=>{
  assert.deepEqual(await baseline(),originalSnapshot);
 });
 await pass('new scoped synthetic bookings exist only inside disposable PG17',async()=>{
  await pool.query(INSERT_BOOK,[B,SHOP,C,V]);
  await pool.query(INSERT_BOOK,[B2,SHOP,C,V]);
  const n=await pool.query('SELECT count(*)::int AS n FROM public.ksh_demo_reservations WHERE id IN ($1::uuid,$2::uuid)',[B,B2]);
  assert.equal(n.rows[0].n,2);
 });
 await pass('existing fixture contains no contradictory duplicate bookings',async()=>{
  const r=await pool.query(`SELECT shop_code,reservation_id,count(*) AS n
   FROM public.ksh_car02_work_orders WHERE reservation_id IS NOT NULL
   GROUP BY shop_code,reservation_id HAVING count(*)>1 LIMIT 1`);
  assert.equal(r.rows.length,0);
 });
 await pass('QA-only unique index added to disposable R13 work-orders table',async()=>{
  await pool.query(V27_QA_UNIQUE_INDEX_SQL);indexCreated=true;
 });
 await pass('database catalog confirms exact partial unique constraint for linked booking',async()=>{
  const r=await pool.query(`SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='ksh_car02_work_orders' AND indexname=$1`,[index]);
  assert.equal(r.rows.length,1);assert.match(r.rows[0].indexdef,/CREATE UNIQUE INDEX/);
  assert.match(r.rows[0].indexdef,/shop_code, reservation_id/);
  assert.match(r.rows[0].indexdef,/reservation_id IS NOT NULL/);
 });
 await pass('12 competing transactions for same booking permit exactly one order',async()=>{
  const all=await Promise.allSettled(Array.from({length:12},()=>pool.query(INSERT_ORDER,[SHOP,C,V,B])));
  assert.equal(all.filter(x=>x.status==='fulfilled').length,1);
  const fail=all.filter(x=>x.status==='rejected');assert.equal(fail.length,11);
  assert.ok(fail.every(x=>x.reason?.code==='23505'));
 });
 await pass('database count proves exactly one order for one booking',async()=>{
  const r=await pool.query(COUNT_BOOK,[SHOP,B]);assert.equal(r.rows[0].n,1);
 });
 await pass('second distinct operation on already booked reservation rejects duplicate',async()=>{
  await assert.rejects(pool.query(INSERT_ORDER,[SHOP,C,V,B]),e=>e.code==='23505');
 });
 await pass('other booking with same customer and shop remains valid',async()=>{
  const r=await pool.query(INSERT_ORDER,[SHOP,C,V,B2]);assert.equal(r.rowCount,1);
 });
 await pass('other booking cannot steal the first booking identity',async()=>{
  const r=await pool.query(COUNT_BOOK,[SHOP,B2]);assert.equal(r.rows[0].n,1);
 });
 await pass('cross tenant forged order reference rejected by original R13 trigger',async()=>{
  await assert.rejects(pool.query(INSERT_ORDER,[OTHER,C,V,B2]),e=>e.code==='23514');
 });
 await pass('wrong customer vehicle booking tuple rejected by original R13 trigger',async()=>{
  await assert.rejects(pool.query(INSERT_ORDER,[SHOP,C,'44444444-4444-4444-8444-444444444444',B2]),e=>e.code==='23514');
 });
 await pass('QA constraint does not grant public release or real transaction readiness',async()=>{
  assert.equal(sourceAudit.realTransactionVerified,false);
  assert.equal(sourceAudit.release,'NO_GO');assert.equal(sourceAudit.migration,'HOLD');
  assert.match(entry,/const\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/);
 });
 await pass('both synthetic bookings are represented by one order each',async()=>{
  const r=await pool.query(`SELECT reservation_id::text AS id,count(*)::int AS n FROM public.ksh_car02_work_orders
   WHERE reservation_id IN ($1::uuid,$2::uuid) GROUP BY reservation_id ORDER BY id`,[B,B2]);
  assert.equal(r.rows.length,2);assert.ok(r.rows.every(x=>x.n===1));
 });
 await pass('remove only V2.7 disposable fixtures and QA index',async()=>{await cleanup();});
 await pass('existing bookings and work orders unchanged, R52 hard locked',async()=>{
  assert.deepEqual(await baseline(),originalSnapshot);
  assert.match(entry,/const\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/);
 });
 console.log(`CAR02_V27_ONE_ORDER_PER_BOOKING_PG17_PASS ${cases}/${cases} SYNTHETIC_ONLY NO_GO HOLD`);
}finally{try{await cleanup()}finally{await pool.end()}}
