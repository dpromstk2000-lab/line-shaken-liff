/** CAR02 V2.8 disposable PG17 read-only pre-migration inventory.
 * Audit never grants production release or touches live Supabase/Worker/LINE.
 * Runs AFTER approved V2.7 disposable tests in the same ephemeral GitHub job.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {createCar02V28ReadOnlyAudit,assessV28Catalog,assessV28Aggregate,
 verifyV28ReadOnlySql,V28_MODE} from './car02-v28-premigration-readonly-isolated.mjs';
const actualEnv=process.env;
const REQUIRED={GITHUB_ACTIONS:'true',NODE_ENV:'test',CAR02_RELEASE_LOCK:'true',
 CAR02_BASIC_PG17_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',
 PGPASSWORD:'qa_only_local',PGDATABASE:'car02_qa'};
for(const [k,v] of Object.entries(REQUIRED))if(actualEnv[k]!==v)throw Error('CAR02_V28_DISPOSABLE_ONLY');
const entry=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
if(!/const\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/.test(entry))throw Error('CAR02_V28_RELEASE_LOCK_REQUIRED');
const sql01=readFileSync(new URL('./01_CATALOG_ONLY_READONLY.sql',import.meta.url),'utf8');
const sql02=readFileSync(new URL('./02_DUPLICATE_COUNTS_READONLY.sql',import.meta.url),'utf8');
const pool=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',password:'qa_only_local',
  database:'car02_qa',max:3,connectionTimeoutMillis:3000});
const audit=createCar02V28ReadOnlyAudit({pool,env:{...REQUIRED},environment:'disposable_qa',allowDisposableQa:true});
let cases=0;const pass=async(label,fn)=>{await fn();console.log(`PASS V28-READONLY-PG17 ${++cases}: ${label}`)};
const measure=async()=>{const r=await pool.query(`SELECT
 (SELECT count(*)::int FROM public.ksh_demo_reservations) AS bookings,
 (SELECT count(*)::int FROM public.ksh_car02_work_orders) AS orders`);return r.rows[0]};
try {
 let before,report,independent;
 await pass('PG17 ephemeral CI verified and not a real production database',async()=>{
  const v=await pool.query('SHOW server_version_num');assert.ok(Number(v.rows[0].server_version_num)>=170000);
 });
 await pass('R52 is locked and pre-migration mode is never sendable',async()=>{
  assert.match(entry,/const\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/);
  assert.equal(V28_MODE.productionReady,false);assert.equal(V28_MODE.release,'NO_GO');
 });
 await pass('catalog probe pinned by SHA256 to approved SELECT-only text',async()=>{
  const r=verifyV28ReadOnlySql(sql01,sql02);assert.equal(r.pinned,true);assert.equal(r.productionPermission,false);
 });
 await pass('legacy R13 and work-order baseline captured without identifiers',async()=>{
  before=await measure();assert.ok(before.bookings>=2);assert.ok(before.orders>=1);
 });
 await pass('catalog and aggregate inventory run in REPEATABLE READ READ ONLY transaction',async()=>{
  report=await audit.inspect({catalogSql:sql01,duplicatesSql:sql02});assert.equal(report.query02Executed,true);
 });
 await pass('R13 reservation table exists in disposable fixture',async()=>{
  assert.equal(report.catalog.catalog.legacy_reservations_table_exists,true);
 });
 await pass('CAR02 work-order table exists in disposable fixture',async()=>{
  assert.equal(report.catalog.catalog.car02_orders_table_exists,true);
 });
 await pass('expected four order columns exist',async()=>{
  assert.equal(report.catalog.catalog.expected_order_columns_present,true);
 });
 await pass('expected four reservation columns exist',async()=>{
  assert.equal(report.catalog.catalog.expected_reservation_columns_present,true);
 });
 await pass('R13 original lacks verified unique reservation constraint',async()=>{
  assert.equal(report.catalog.catalog.some_reservation_unique_index_exists,false);
 });
 await pass('an aggregate inventory is never release approval',async()=>{
  assert.equal(report.productionReady,false);assert.equal(report.release,'NO_GO');
  assert.equal(report.migration,'HOLD');assert.equal(report.catalog.realSchemaVerified,false);
 });
 await pass('aggregate counts contain only nonnegative integers',async()=>{
  for(const k of ['total_orders','orders_without_reservation','duplicate_booking_groups',
    'orders_in_duplicate_groups','largest_group'])assert.ok(Number.isSafeInteger(report.aggregates[k])&&report.aggregates[k]>=0);
 });
 await pass('independent total order count equals read-only snapshot',async()=>{
  const r=await pool.query('SELECT count(*)::int AS n FROM public.ksh_car02_work_orders');
  assert.equal(r.rows[0].n,report.aggregates.total_orders);
 });
 await pass('independent unlinked count equals read-only snapshot',async()=>{
  const r=await pool.query('SELECT count(*)::int AS n FROM public.ksh_car02_work_orders WHERE reservation_id IS NULL');
  assert.equal(r.rows[0].n,report.aggregates.orders_without_reservation);
 });
 await pass('cross-check duplicate group count without exposing UUID or shop',async()=>{
  const r=await pool.query(`SELECT count(*)::int AS n FROM (
   SELECT shop_code,reservation_id FROM public.ksh_car02_work_orders WHERE reservation_id IS NOT NULL
   GROUP BY shop_code,reservation_id HAVING count(*)>1) q`);
  independent=r.rows[0].n;assert.equal(report.aggregates.duplicate_booking_groups,independent);
 });
 await pass('preexisting synthetic duplicates require manual review, never deletion',async()=>{
  assert.equal(report.aggregates.review_gate,independent>0?
   'HOLD_MANUAL_RECONCILIATION_REQUIRED':'HOLD_OTHER_RELEASE_GATES_STILL_REQUIRED');
  assert.equal(report.aggregates.realWorldDuplicatesProven,false);
 });
 await pass('the report contains no booking UUID or customer identity',async()=>{
  const out=JSON.stringify(report);
  assert.doesNotMatch(out,/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i);
  assert.doesNotMatch(out,/customer_id|vehicle_id|line_user_id|token|password/i);
 });
 await pass('missing schema still blocks SQL02 by contract',async()=>{
  const r=assessV28Catalog({ ...report.catalog.catalog,car02_orders_table_exists:false });
  assert.equal(r.schemaReadyForAggregate,false);assert.equal(r.next,'STOP_SCHEMA_MISSING');
 });
 await pass('contradictory aggregate state cannot authorize operation',async()=>{
  const {total_orders,orders_without_reservation,duplicate_booking_groups,
   orders_in_duplicate_groups,review_gate}=report.aggregates;
  const contradictory={total_orders,orders_without_reservation,duplicate_booking_groups,
   orders_in_duplicate_groups,largest_group:orders_in_duplicate_groups+1,review_gate};
  assert.throws(()=>assessV28Aggregate(contradictory),/CAR02_V28_COUNTS_CONTRADICTORY/);
 });
 await pass('no synthetic booking/order counts changed and R52 stays locked',async()=>{
  assert.deepEqual(await measure(),before);
  assert.match(entry,/const\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/);
 });
 console.log(`CAR02_V28_PREMIGRATION_READONLY_PG17_PASS ${cases}/${cases} AGGREGATE_ONLY NON_SENDABLE NO_GO HOLD`);
} finally {await pool.end();}
