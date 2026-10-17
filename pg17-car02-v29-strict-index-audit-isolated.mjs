/** DPRO CAR02 V2.9 disposable PG17 catalog semantics proof.
 * Read-only on actual R13. Writes ONLY to a dedicated disposable fixture table.
 */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {V29_MODE,createV29QaIndexCatalogReader,verifyV29Sql,V29_CATALOG_SQL}
  from './car02-v29-strict-index-audit-isolated.mjs';
const env=process.env;
const REQUIRED={GITHUB_ACTIONS:'true',NODE_ENV:'test',CAR02_RELEASE_LOCK:'true',
 CAR02_BASIC_PG17_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',
 PGPASSWORD:'qa_only_local',PGDATABASE:'car02_qa'};
for(const [k,v] of Object.entries(REQUIRED))if(env[k]!==v)throw Error('CAR02_V29_DISPOSABLE_ONLY');
const lock=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
if(!/const\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/.test(lock))throw Error('CAR02_V29_RELEASE_LOCK_REQUIRED');
const pool=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',password:'qa_only_local',database:'car02_qa',max:4});
const reader=createV29QaIndexCatalogReader({pool,env:{...REQUIRED},environment:'disposable_qa',allowDisposableQa:true});
const TABLE='public.car02_v29_qa_index_probe',tname='car02_v29_qa_index_probe',booking=randomUUID();
const counts=async()=>{
 const q=await pool.query(`SELECT
   (SELECT count(*)::int FROM public.ksh_demo_reservations) AS bookings,
   (SELECT count(*)::int FROM public.ksh_car02_work_orders) AS orders`);
 return q.rows[0];
};
const inspect=()=>reader.inspect(tname);
let baseline,created=false,cases=0;
const pass=async(msg,fn)=>{await fn();console.log(`PASS V29-PG17 ${++cases}: ${msg}`)};
try{
 await pass('only disposable PostgreSQL 17 is permitted',async()=>{
  const v=await pool.query('SHOW server_version_num');assert.ok(Number(v.rows[0].server_version_num)>=170000);
 });
 await pass('R52 stays locked and inspection never approves production',async()=>{
  assert.equal(V29_MODE.release,'NO_GO');assert.equal(V29_MODE.migration,'HOLD');
 });
 await pass('catalog SQL is SHA-pinned and read-only',async()=>{
  assert.equal(verifyV29Sql(V29_CATALOG_SQL).productionAuthorized,false);
 });
 await pass('existing R13 source work-order indexes are not misclassified as unique',async()=>{
  baseline=await counts();const r=await reader.inspect('ksh_car02_work_orders');
  assert.equal(r.structurallyEffectiveIndexCount,0);assert.equal(r.productionReady,false);
 });
 await pass('create only dedicated disposable empty QA probe table',async()=>{
  await pool.query(`CREATE TABLE ${TABLE}(id uuid NOT NULL,shop_code text NOT NULL,reservation_id uuid)`);
  created=true;
 });
 await pass('no indexes returns no structural coverage',async()=>{
  const r=await inspect();assert.equal(r.inspectedIndexes,0);assert.equal(r.positiveCatalogSignal,false);
 });
 await pass('unique index on unrelated id is ignored',async()=>{
  await pool.query(`CREATE UNIQUE INDEX v29_probe_id ON ${TABLE}(id)`);
  const r=await inspect();assert.equal(r.uniqueIndexesMentioningReservation,0);
 });
 await pass('INCLUDE reservation_id is not a uniqueness key',async()=>{
  await pool.query(`CREATE UNIQUE INDEX v29_probe_include ON ${TABLE}(id) INCLUDE(reservation_id)`);
  const r=await inspect();assert.ok(r.uniqueIndexesMentioningReservation>=1);assert.equal(r.structurallyEffectiveIndexCount,0);
 });
 await pass('partial index constrained to a single shop does not cover all shops',async()=>{
  await pool.query(`CREATE UNIQUE INDEX v29_probe_tenant_only ON ${TABLE}(reservation_id) WHERE shop_code='other_shop'`);
  const r=await inspect();assert.equal(r.structurallyEffectiveIndexCount,0);
 });
 await pass('extra id key leaves same reservation duplicates legal',async()=>{
  await pool.query(`CREATE UNIQUE INDEX v29_probe_extra ON ${TABLE}(reservation_id,id)`);
  const r=await inspect();assert.ok(r.uniqueIndexesMentioningReservation>=3);
  assert.equal(r.structurallyEffectiveIndexCount,0);
 });
 await pass('multiple superficially relevant indexes never approve migration',async()=>{
  const r=await inspect();assert.equal(r.release,'NO_GO');assert.equal(r.next,'HOLD_UNIQUENESS_NOT_PROVEN');
 });
 await pass('two rows with one booking are still legal under inadequate indexes',async()=>{
  await pool.query(`INSERT INTO ${TABLE}(id,shop_code,reservation_id) VALUES($1,'street_house_kitsuki',$3),($2,'street_house_kitsuki',$3)`,
   [randomUUID(),randomUUID(),booking]);
  const r=await pool.query(`SELECT count(*)::int AS n FROM ${TABLE} WHERE reservation_id=$1`,[booking]);
  assert.equal(r.rows[0].n,2);
 });
 await pass('only test-table rows cleared without touching R13',async()=>{
  await pool.query(`DELETE FROM ${TABLE} WHERE reservation_id=$1`,[booking]);
  assert.deepEqual(await counts(),baseline);
 });
 await pass('add effective composite unique index only on QA probe table',async()=>{
  await pool.query(`CREATE UNIQUE INDEX v29_probe_effective ON ${TABLE}(shop_code,reservation_id) WHERE reservation_id IS NOT NULL`);
 });
 await pass('Postgres index metadata now proves exact coverage',async()=>{
  const r=await inspect();assert.equal(r.structurallyEffectiveIndexCount,1);
  assert.equal(r.positiveCatalogSignal,true);assert.equal(r.release,'NO_GO');
 });
 await pass('effective index enforces one order per booking in QA table',async()=>{
  await pool.query(`INSERT INTO ${TABLE}(id,shop_code,reservation_id) VALUES($1,'street_house_kitsuki',$2)`,[randomUUID(),booking]);
  await assert.rejects(pool.query(`INSERT INTO ${TABLE}(id,shop_code,reservation_id) VALUES($1,'street_house_kitsuki',$2)`,[randomUUID(),booking]),e=>e.code==='23505');
 });
 await pass('another reservation remains independently allowed',async()=>{
  await pool.query(`INSERT INTO ${TABLE}(id,shop_code,reservation_id) VALUES($1,'street_house_kitsuki',$2)`,[randomUUID(),randomUUID()]);
  const q=await pool.query(`SELECT count(*)::int AS n FROM ${TABLE}`);assert.equal(q.rows[0].n,2);
 });
 await pass('dropping the effective index restores fail-closed catalog result',async()=>{
  await pool.query('DROP INDEX public.v29_probe_effective');
  const r=await inspect();assert.equal(r.positiveCatalogSignal,false);
 });
 await pass('global unique booking index is structurally effective but not release authority',async()=>{
  await pool.query(`CREATE UNIQUE INDEX v29_probe_global ON ${TABLE}(reservation_id)`);
  const r=await inspect();assert.equal(r.structurallyEffectiveIndexCount,1);assert.equal(r.productionReady,false);
 });
 await pass('remove only QA table and preserve R13 source counts',async()=>{
  await pool.query(`DROP TABLE ${TABLE}`);created=false;
  assert.deepEqual(await counts(),baseline);
  assert.match(lock,/const\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/);
 });
 console.log(`CAR02_V29_STRICT_INDEX_PG17_PASS ${cases}/${cases} QA_PROBE_ONLY NO_GO HOLD`);
}finally{
 if(created)try{await pool.query(`DROP TABLE IF EXISTS ${TABLE}`)}catch{}
 await pool.end();
}
