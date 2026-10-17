import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCar02V28ReadOnlyAudit,assessV28Aggregate,assessV28Catalog,
  verifyV28ReadOnlySql,V28_MODE} from './car02-v28-premigration-readonly-isolated.mjs';
const sql01=readFileSync(new URL('./01_CATALOG_ONLY_READONLY.sql',import.meta.url),'utf8');
const sql02=readFileSync(new URL('./02_DUPLICATE_COUNTS_READONLY.sql',import.meta.url),'utf8');
const QA={GITHUB_ACTIONS:'true',NODE_ENV:'test',CAR02_RELEASE_LOCK:'true',
 CAR02_BASIC_PG17_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',
 PGPASSWORD:'qa_only_local',PGDATABASE:'car02_qa'};
const opts={host:'127.0.0.1',port:5432,user:'postgres',password:'qa_only_local',database:'car02_qa'};
const cat={legacy_reservations_table_exists:true,car02_orders_table_exists:true,
 expected_order_columns_present:true,expected_reservation_columns_present:true,
 some_reservation_unique_index_exists:false};
const counts={total_orders:'8',orders_without_reservation:'2',duplicate_booking_groups:'1',
 orders_in_duplicate_groups:'3',largest_group:'3',review_gate:'HOLD_MANUAL_RECONCILIATION_REQUIRED'};
const zero={total_orders:'0',orders_without_reservation:'0',duplicate_booking_groups:'0',
 orders_in_duplicate_groups:'0',largest_group:'0',review_gate:'HOLD_OTHER_RELEASE_GATES_STILL_REQUIRED'};
function mkPool({catalog=cat,aggregates=counts,readonly='on',fault='',options=opts}={}){
 const calls=[],pool={options:{...options},released:0};
 pool.connect=async()=>({
  async query(q){calls.push(q);
   if(fault&&q.includes(fault))throw Error('fixture-error');
   if(q.startsWith('SHOW '))return {rows:[{transaction_read_only:readonly}]};
   if(q===sql01)return {rows:[catalog]};
   if(q===sql02)return {rows:[aggregates]};
   return {rows:[]};
  },release(){pool.released++}
 });
 return {pool,calls};
}
const make=(pool,override={})=>createCar02V28ReadOnlyAudit({pool,env:{...QA},environment:'disposable_qa',allowDisposableQa:true,...override});
const inspect={catalogSql:sql01,duplicatesSql:sql02};

test('V2.8 NEVER grants production permission',()=>{assert.equal(V28_MODE.productionReady,false);assert.equal(V28_MODE.release,'NO_GO');assert.equal(V28_MODE.migration,'HOLD');});
test('only approved, byte-for-byte catalog and duplicate SQL can execute',()=>{assert.equal(verifyV28ReadOnlySql(sql01,sql02).readOnly,true)});
for(const [name,a,b] of [
 ['added SQL whitespace',sql01+'\n',sql02],['catalog comment drift',sql01+'-- comment',sql02],
 ['duplicate comment drift',sql01,sql02+'-- comment'],['injected DDL',sql01,sql02+';DROP TABLE x'],
 ['swapped SQL',sql02,sql01],['missing catalog','',sql02],['missing counts',sql01,''],
 ['string missing catalog',null,sql02],['string missing counts',sql01,undefined]]){
 test('reject unauthorized SQL: '+name,()=>assert.throws(()=>verifyV28ReadOnlySql(a,b),/CAR02_V28_SQL_DRIFT_DENIED/));
}
for(const k of Object.keys(cat)){
 test('catalog missing necessary key '+k,()=>{const c={...cat};delete c[k];assert.throws(()=>assessV28Catalog(c),/CATALOG_INVALID/)});
 test('catalog boolean types must be actual booleans '+k,()=>assert.throws(()=>assessV28Catalog({...cat,[k]:'true'}),/CATALOG_INVALID/));
}
test('catalog refuses extra business identifiers',()=>assert.throws(()=>assessV28Catalog({...cat,customer_id:'hidden'}),/CATALOG_INVALID/));
test('catalog malformed input rejected',()=>assert.throws(()=>assessV28Catalog([]),/CATALOG_INVALID/));
test('catalog complete but no unique index remains HOLD',()=>{const r=assessV28Catalog(cat);assert.equal(r.schemaReadyForAggregate,true);assert.equal(r.release,'NO_GO')});
test('catalog unique index present does not grant migration approval',()=>{const r=assessV28Catalog({...cat,some_reservation_unique_index_exists:true});assert.equal(r.release,'NO_GO');assert.equal(r.realSchemaVerified,false)});
for(const k of Object.keys(cat).slice(0,4))test('missing schema '+k+' stops second query',()=>assert.equal(assessV28Catalog({...cat,[k]:false}).next,'STOP_SCHEMA_MISSING'));
test('one or more duplicate booking groups always require manual reconciliation',()=>assert.equal(assessV28Aggregate(counts).review_gate,'HOLD_MANUAL_RECONCILIATION_REQUIRED'));
test('zero duplicates still remain HOLD for other release gates',()=>assert.equal(assessV28Aggregate(zero).review_gate,'HOLD_OTHER_RELEASE_GATES_STILL_REQUIRED'));
for(const k of Object.keys(counts).filter(x=>x!=='review_gate')){
 test('count cannot be negative '+k,()=>assert.throws(()=>assessV28Aggregate({...counts,[k]:'-1'}),/COUNT_INVALID/));
 test('count cannot contain decimal '+k,()=>assert.throws(()=>assessV28Aggregate({...counts,[k]:'1.2'}),/COUNT_INVALID/));
 test('count cannot overflow '+k,()=>assert.throws(()=>assessV28Aggregate({...counts,[k]:'9007199254740992'}),/COUNT_OVERFLOW/));
}
const contradictions=[
 {total_orders:'1'}, {orders_without_reservation:'9'}, {duplicate_booking_groups:'4'},
 {orders_in_duplicate_groups:'0'}, {largest_group:'0'}, {largest_group:'99'},
 {duplicate_booking_groups:'0'}, {orders_in_duplicate_groups:'1'},
 {review_gate:'READY'}, {review_gate:'HOLD_OTHER_RELEASE_GATES_STILL_REQUIRED'},
 {customer_id:'secret'}];
for(const [i,c] of contradictions.entries())test('aggregate contradiction '+(i+1),()=>assert.throws(()=>assessV28Aggregate({...counts,...c}),/INVALID|CONTRADICTORY/));
test('aggregate accepts numeric string and integer values only',()=>{const r=assessV28Aggregate({...counts,total_orders:8,largest_group:3n});assert.equal(r.total_orders,8);assert.equal(r.productionReady,false)});
for(const [name,change] of [
 ['missing QA env', {env:{}}],['production environment',{environment:'production'}],
 ['no explicit QA permission',{allowDisposableQa:false}],['process.env forbidden',{env:process.env}],
 ['caller can not use wrong branch env',{env:{...QA,PGDATABASE:'production'}}],
 ['wrong QA password',{env:{...QA,PGPASSWORD:'bad'}}],
 ['GITHUB_ACTIONS must be true',{env:{...QA,GITHUB_ACTIONS:'false'}}],
 ['R52 release lock must remain on',{env:{...QA,CAR02_RELEASE_LOCK:'false'}}]]){
 test('reject unsafe runtime '+name,()=>{const {pool}=mkPool();assert.throws(()=>make(pool,change),/CAR02_V28_DISPOSABLE_ONLY/)});
}
for(const [name,opt] of [['wrong postgres server',{host:'example.com'}],['wrong DB',{database:'prod'}],['wrong port',{port:5433}],['wrong user',{user:'admin'}],['wrong password',{password:'prod'}]]){
 test('reject non-disposable pg Pool '+name,()=>{const {pool}=mkPool({options:{...opts,...opt}});assert.throws(()=>make(pool),/DISPOSABLE_ONLY/)});
}
test('QA user gets aggregate-only report from same read-only transaction',async()=>{
 const {pool,calls}=mkPool();const result=await make(pool).inspect(inspect);
 assert.equal(result.query02Executed,true);assert.equal(result.aggregates.duplicate_booking_groups,1);
 assert.equal(result.release,'NO_GO');assert.equal(result.migration,'HOLD');
 assert.deepEqual(calls,['BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY','SHOW transaction_read_only',sql01,sql02,'COMMIT']);
 assert.equal(pool.released,1);assert.doesNotMatch(JSON.stringify(result),/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i);
});
test('schema missing: counts SQL never runs',async()=>{const {pool,calls}=mkPool({catalog:{...cat,car02_orders_table_exists:false}});const r=await make(pool).inspect(inspect);assert.equal(r.query02Executed,false);assert.equal(r.reason,'QA_SCHEMA_MISSING');assert.ok(!calls.includes(sql02));assert.equal(pool.released,1)});
test('schema columns missing: counts SQL never runs',async()=>{const {pool,calls}=mkPool({catalog:{...cat,expected_order_columns_present:false}});const r=await make(pool).inspect(inspect);assert.equal(r.query02Executed,false);assert.ok(!calls.includes(sql02))});
test('no duplicate groups still NO_GO',async()=>{const {pool}=mkPool({aggregates:zero});const r=await make(pool).inspect(inspect);assert.equal(r.aggregates.duplicate_booking_groups,0);assert.equal(r.productionReady,false)});
test('read-only flag MUST be on before any SQL probe',async()=>{const {pool,calls}=mkPool({readonly:'off'});await assert.rejects(make(pool).inspect(inspect),/QA_READONLY_AUDIT_FAILED/);assert.ok(!calls.includes(sql01));assert.ok(!calls.includes(sql02));assert.equal(calls.at(-1),'ROLLBACK');assert.equal(pool.released,1)});
test('SQL-drift failure makes zero DB calls',async()=>{const {pool,calls}=mkPool();await assert.rejects(make(pool).inspect({...inspect,catalogSql:sql01+'\n'}),/SQL_DRIFT_DENIED/);assert.equal(calls.length,0)});
test('query failure rolls back safely',async()=>{const {pool,calls}=mkPool({fault:'FROM public.ksh_car02_work_orders'});await assert.rejects(make(pool).inspect(inspect),/QA_READONLY_AUDIT_FAILED/);assert.equal(calls.at(-1),'ROLLBACK');assert.equal(pool.released,1)});
test('catalog failure rolls back safely',async()=>{const {pool,calls}=mkPool({fault:'pg_indexes'});await assert.rejects(make(pool).inspect(inspect),/QA_READONLY_AUDIT_FAILED/);assert.equal(calls.at(-1),'ROLLBACK');assert.equal(pool.released,1)});
test('unsupported SQL response never unlocks',async()=>{const {pool,calls}=mkPool({aggregates:{...counts,review_gate:'READY'}});await assert.rejects(make(pool).inspect(inspect),/QA_READONLY_AUDIT_FAILED/);assert.equal(calls.at(-1),'ROLLBACK')});
