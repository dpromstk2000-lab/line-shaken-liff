/** CAR02 V2.3 PostgreSQL 17 disposable QA ONLY.
 * Verify the synthetic R13 reservation fixture lacks lifecycle columns.
 * No schema changes, no production credentials, no case creation, no network outside local PG.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {auditCar02R13BookingLifecycleSchema as audit,reviewLegacyBookingLifecyclePreview as review} from './car02-legacy-booking-lifecycle-gate-isolated.mjs';
const expected={GITHUB_ACTIONS:'true',NODE_ENV:'test',CAR02_RELEASE_LOCK:'true',CAR02_BASIC_PG17_QA:'yes',
 PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGPASSWORD:'qa_only_local',PGDATABASE:'car02_qa'};
for(const [key,val] of Object.entries(expected))if(process.env[key]!==val)throw Error('CAR02_V23_PG17_DISPOSABLE_ONLY');
const entry=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
if(!/const\s+CAR02_RELEASE_LOCK\s*=\s*true;/.test(entry))throw Error('CAR02_V23_RELEASE_LOCK_MISSING');
const pool=new pg.Pool({host:'127.0.0.1',port:5432,database:'car02_qa',user:'postgres',password:'qa_only_local',max:2});
let readCount=0,count=0;
const readonly=async(sql,args=[])=>{
 if(typeof sql!=='string'||!/^\s*SELECT\b/i.test(sql)||/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|CALL)\b/i.test(sql))throw Error('CAR02_V23_READONLY_SQL_ONLY');
 readCount++;return pool.query(sql,args);
};
const pass=async(name,cb)=>{await cb();console.log(`PASS V23-LIFECYCLE-PG17 ${++count}: ${name}`)};
const counts=async()=>{
 const r=await readonly('SELECT (SELECT count(*)::int FROM public.ksh_demo_reservations) AS bookings,(SELECT count(*)::int FROM public.ksh_car02_work_orders) AS orders');
 return r.rows[0];
};
try{
 let columns,inspection,before;
 await pass('real PostgreSQL 17 disposable baseline initialized',async()=>{
  const x=await pool.query('SHOW server_version_num');assert.ok(Number(x.rows[0].server_version_num)>=170000);before=await counts()});
 await pass('read-only catalog query lists synthetic R13 reservation columns',async()=>{
  const r=await readonly("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position",['public','ksh_demo_reservations']);
  columns=r.rows.map(x=>x.column_name);assert.deepEqual(columns,['id','shop_code','customer_id','vehicle_id'])});
 await pass('R13 synthetic reservation is missing lifecycle and version fields',async()=>{
  inspection=audit(columns);assert.deepEqual(inspection.missing,['status','version','reservation_date','reservation_time']);assert.equal(inspection.schemaSupportsLifecycle,false)});
 await pass('missing DB lifecycle fields force not-ready, no send',async()=>{
  assert.equal(inspection.ready,false);assert.equal(inspection.sendable,false);assert.equal(inspection.release,'NO_GO');assert.equal(inspection.migration,'HOLD')});
 await pass('legacy UI apparently active booking stays unverified regardless of DB absence',async()=>{
  const x=review({branch:'ksh',row:{id:'66666666-6666-4666-8666-666666666666',reservation_date:'2026-10-20',reservation_time:'10:30',status:'入庫済み'}});
  assert.equal(x.candidate,true);assert.equal(x.sendable,false);assert.equal(x.requiresServerLifecycleCheck,true)});
 await pass('cancelled status blocks UI candidate even before DB verification',async()=>{
  const x=review({branch:'wangan',row:{id:'66666666-6666-4666-8666-666666666666',reservation_date:'2026-10-20',reservation_time:'10:30',status:'キャンセル'}});
  assert.equal(x.candidate,false);assert.ok(x.blockers.includes('LEGACY_BOOKING_TERMINAL'))});
 await pass('finished memo marker blocks candidate even with active display status',async()=>{
  const x=review({branch:'wangan',row:{id:'66666666-6666-4666-8666-666666666666',reservation_date:'2026-10-20',reservation_time:'10:30',status:'作業中',memo:'【進捗：引渡し完了】'}});
  assert.equal(x.candidate,false);assert.ok(x.blockers.includes('LEGACY_PROGRESS_MARKER_TERMINAL'))});
 await pass('fake lifecycle column presence never proves atomic server check',async()=>{
  const x=audit([...columns,'status','version','reservation_date','reservation_time']);assert.equal(x.schemaSupportsLifecycle,true);assert.equal(x.ready,false);assert.ok(x.blockers.includes('ATOMIC_SERVER_BOOKING_LIFECYCLE_CHECK_NOT_PROVEN'))});
 await pass('all lifecycle inspection SQL uses SELECT and source lock still closed',async()=>{
  assert.ok(readCount>=2);assert.match(entry,/const\s+CAR02_RELEASE_LOCK\s*=\s*true;/)});
 await pass('booking and work-order row counts unchanged after all inspections',async()=>{
  assert.deepEqual(await counts(),before)});
 console.log(`CAR02_V23_LIFECYCLE_R13_SCHEMA_GAP_PG17_PASS ${count}/${count} NOT_READY SYNTHETIC_ONLY NO_GO HOLD`);
}finally{await pool.end()}
