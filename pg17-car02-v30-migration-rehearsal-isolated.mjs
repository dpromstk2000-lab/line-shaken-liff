/** CAR02 V3.0 / disposable PG17 ONLY. Rehearses unique-index failure before
 * cleanup and success inside a transaction that is fully rolled back.
 * Original R13 tables, data, indexes and release lock remain untouched.
 */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {createCar02V28ReadOnlyAudit} from './car02-v28-premigration-readonly-isolated.mjs';
import {createV29QaIndexCatalogReader} from './car02-v29-strict-index-audit-isolated.mjs';
import {V30_QA_TABLE,V30_QA_INDEX,decideV30MigrationRehearsal,guardV30DisposableIndexExperiment,
 summarizeV30Aggregate,V30_MODE} from './car02-v30-migration-rehearsal-isolated.mjs';
const env=process.env;
const REQUIRED={GITHUB_ACTIONS:'true',NODE_ENV:'test',CAR02_RELEASE_LOCK:'true',
 CAR02_BASIC_PG17_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',
 PGPASSWORD:'qa_only_local',PGDATABASE:'car02_qa'};
for(const [k,v] of Object.entries(REQUIRED))if(env[k]!==v)throw Error('CAR02_V30_DISPOSABLE_ONLY');
const lock=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
if(!/const\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/.test(lock))throw Error('CAR02_V30_RELEASE_LOCK_REQUIRED');
const pool=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',password:'qa_only_local',database:'car02_qa',max:3});
const audit=createCar02V28ReadOnlyAudit({pool,env:{...REQUIRED},environment:'disposable_qa',allowDisposableQa:true});
const reader=createV29QaIndexCatalogReader({pool,env:{...REQUIRED},environment:'disposable_qa',allowDisposableQa:true});
const baseline=async()=>{
 const q=await pool.query(`SELECT
  (SELECT count(*)::int FROM public.ksh_demo_reservations) AS bookings,
  (SELECT count(*)::int FROM public.ksh_car02_work_orders) AS orders`);
 return q.rows[0];
};
const duplicates=async(client=pool)=>{
 const q=await client.query(`SELECT count(*)::int AS n FROM (
  SELECT shop_code,reservation_id FROM ${V30_QA_TABLE}
  WHERE reservation_id IS NOT NULL GROUP BY shop_code,reservation_id HAVING count(*)>1) x`);
 return q.rows[0].n;
};
const qaIndexExists=async(client=pool)=>{
 const q=await client.query(`SELECT count(*)::int AS n FROM pg_indexes
  WHERE schemaname='public' AND tablename='car02_v30_qa_migration_probe' AND indexname=$1`,[V30_QA_INDEX]);
 return q.rows[0].n;
};
const fixedGuard=(groups)=>guardV30DisposableIndexExperiment({environment:'disposable_qa',dbName:'car02_qa',
 table:V30_QA_TABLE,duplicateGroups:groups,releaseLock:true,allowDisposableQa:true});
const booking=randomUUID();const ids=[randomUUID(),randomUUID(),randomUUID()];
let created=false,cases=0,original,report,index,decision,client=null,transaction=false;
const pass=async(label,fn)=>{await fn();console.log(`PASS V30-REHEARSAL-PG17 ${++cases}: ${label}`)};
try {
 await pass('only disposable isolated CI database can be accessed',async()=>{
  assert.equal(env.PGDATABASE,'car02_qa');assert.equal(env.PGHOST,'127.0.0.1');
 });
 await pass('PostgreSQL 17 is active',async()=>{
  const q=await pool.query('SHOW server_version_num');assert.ok(Number(q.rows[0].server_version_num)>=170000);
 });
 await pass('R52 release gate stays closed throughout rehearsal',async()=>{
  assert.match(lock,/const\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/);assert.equal(V30_MODE.release,'NO_GO');
 });
 await pass('original R13 booking and work order counts captured',async()=>{original=await baseline();});
 await pass('R13 inventory is from V2.8 SHA-pinned readonly transaction',async()=>{
  const sql1=readFileSync(new URL('./01_CATALOG_ONLY_READONLY.sql',import.meta.url),'utf8');
  const sql2=readFileSync(new URL('./02_DUPLICATE_COUNTS_READONLY.sql',import.meta.url),'utf8');
  report=await audit.inspect({catalogSql:sql1,duplicatesSql:sql2});assert.equal(report.query02Executed,true);
 });
 await pass('actual original R13 index catalog is inspected read-only',async()=>{
  index=await reader.inspect('ksh_car02_work_orders');assert.equal(index.productionReady,false);
 });
 await pass('migration gate never authorizes production even for zero duplicates',async()=>{
  decision=decideV30MigrationRehearsal({catalogRow:report.catalog.catalog,
   aggregateRow:summarizeV30Aggregate(report.aggregates),indexRow:{
    index_count:String(index.inspectedIndexes),
    unique_mention_count:String(index.uniqueIndexesMentioningReservation),
    effective_index_count:String(index.structurallyEffectiveIndexCount)}});
  assert.equal(decision.productionReady,false);assert.equal(decision.migration,'HOLD');
 });
 await pass('preexisting synthetic R13 duplicates are never auto-deleted',async()=>{
  assert.equal(decision.manualReconciliationRequired,report.aggregates.duplicate_booking_groups>0);
  assert.deepEqual(await baseline(),original);
 });
 await pass('dedicated empty disposable QA clone is created',async()=>{
  await pool.query(`CREATE TABLE ${V30_QA_TABLE}(id uuid NOT NULL,shop_code text NOT NULL,reservation_id uuid)`);
  created=true;
 });
 await pass('two synthetic orders can share booking before unique index',async()=>{
  await pool.query(`INSERT INTO ${V30_QA_TABLE}(id,shop_code,reservation_id) VALUES
    ($1,'street_house_kitsuki',$3),($2,'street_house_kitsuki',$3)`,[ids[0],ids[1],booking]);
  assert.equal(await duplicates(),1);
 });
 await pass('preflight refuses index creation with existing duplicates',async()=>{
  const g=fixedGuard(await duplicates());assert.equal(g.allowed,false);assert.equal(g.ddl,null);
 });
 await pass('refused attempt preserves both preexisting synthetic records',async()=>{
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${V30_QA_TABLE}`)).rows[0].n,2);
  assert.equal(await qaIndexExists(),0);
 });
 await pass('native PostgreSQL rejects index build on duplicated QA rows',async()=>{
  const c=await pool.connect();let open=false;
  try{await c.query('BEGIN');open=true;await c.query('SAVEPOINT pre_index');
   await assert.rejects(c.query(fixedGuard(0).ddl),e=>e.code==='23505');
   await c.query('ROLLBACK TO SAVEPOINT pre_index');
  }finally{if(open)await c.query('ROLLBACK');c.release();}
 });
 await pass('failed native index build is fully rolled back',async()=>{
  assert.equal(await qaIndexExists(),0);assert.equal(await duplicates(),1);
 });
 await pass('start transactional QA-only manual-cleanup rehearsal',async()=>{
  client=await pool.connect();await client.query('BEGIN');transaction=true;
  await client.query(`DELETE FROM ${V30_QA_TABLE} WHERE id=$1`,[ids[1]]);
  assert.equal(await duplicates(client),0);
 });
 await pass('clean QA clone alone permits rehearsal DDL',async()=>{
  const g=fixedGuard(await duplicates(client));assert.equal(g.allowed,true);
  await client.query(g.ddl);assert.equal(await qaIndexExists(client),1);
 });
 await pass('unique index now refuses a second synthetic order in transaction',async()=>{
  await client.query('SAVEPOINT try_duplicate');
  await assert.rejects(client.query(`INSERT INTO ${V30_QA_TABLE}(id,shop_code,reservation_id)
    VALUES($1,'street_house_kitsuki',$2)`,[ids[2],booking]),e=>e.code==='23505');
  await client.query('ROLLBACK TO SAVEPOINT try_duplicate');
 });
 await pass('ROLLBACK removes rehearsed changes and generated unique index',async()=>{
  await client.query('ROLLBACK');transaction=false;client.release();client=null;
  assert.equal(await qaIndexExists(),0);assert.equal(await duplicates(),1);
 });
 await pass('remove only dedicated disposable clone and restore baseline',async()=>{
  await pool.query(`DROP TABLE ${V30_QA_TABLE}`);created=false;
  assert.deepEqual(await baseline(),original);
 });
 await pass('all release/migration permissions remain closed, R13 unchanged',async()=>{
  assert.equal(decision.release,'NO_GO');assert.equal(decision.migration,'HOLD');
  assert.equal(decision.realDataProven,false);assert.deepEqual(await baseline(),original);
 });
 console.log(`CAR02_V30_MIGRATION_REHEARSAL_PG17_PASS ${cases}/${cases} QA_CLONE_ROLLED_BACK NO_GO HOLD`);
}finally{
 if(client){try{if(transaction)await client.query('ROLLBACK')}finally{client.release()}}
 if(created)try{await pool.query(`DROP TABLE IF EXISTS ${V30_QA_TABLE}`)}catch{}
 await pool.end();
}
