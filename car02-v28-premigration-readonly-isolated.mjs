/** DPRO CAR02 V2.8 — pinned SQL, aggregate-only pre-migration audit.
 * Disposable PG17 CI only. No production credentials or connections. No schema
 * changes, booking updates, migrations, notifications, or release permissions.
 * This does NOT authorize running either query against a live database.
 */
import {createHash} from 'node:crypto';
export const V28_MODE=Object.freeze({mode:'disposable_qa_premigration_readonly',
  productionReady:false,realDbInspected:false,sendable:false,release:'NO_GO',migration:'HOLD'});
export const V28_SQL_SHA256=Object.freeze({
  catalog:'f8b20eced807b890ce1968cba226b3cf714b8b4fb662ff3d4e52cfdbc4880df0',
  duplicates:'61aed568d1b974e0b5c28973e03658a5e8e7265d9e2a434a79ae0e20c018259d'});
const REQUIRED=Object.freeze({GITHUB_ACTIONS:'true',NODE_ENV:'test',CAR02_RELEASE_LOCK:'true',
  CAR02_BASIC_PG17_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',
  PGPASSWORD:'qa_only_local',PGDATABASE:'car02_qa'});
const BOOLEANS=Object.freeze(['legacy_reservations_table_exists','car02_orders_table_exists',
  'expected_order_columns_present','expected_reservation_columns_present','some_reservation_unique_index_exists']);
const NUMBERS=Object.freeze(['total_orders','orders_without_reservation','duplicate_booking_groups',
  'orders_in_duplicate_groups','largest_group']);
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const deny=(code)=>{throw Object.assign(new Error(code),{code});};
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
/** SHA-locked query text only: do not accept arbitrary SQL even for QA. */
export function verifyV28ReadOnlySql(catalogSql,duplicatesSql){
 if(typeof catalogSql!=='string'||typeof duplicatesSql!=='string'||
    sha(catalogSql)!==V28_SQL_SHA256.catalog||sha(duplicatesSql)!==V28_SQL_SHA256.duplicates)
    deny('CAR02_V28_SQL_DRIFT_DENIED');
 return Object.freeze({pinned:true,readOnly:true,productionPermission:false});
}
export function assessV28Catalog(row){
 if(!plain(row)||Object.keys(row).sort().join('|')!==[...BOOLEANS].sort().join('|')||
   BOOLEANS.some(k=>typeof row[k]!=='boolean'))deny('CAR02_V28_CATALOG_INVALID');
 const safe=BOOLEANS.slice(0,4).every(k=>row[k]);
 return Object.freeze({catalog:Object.freeze({...row}),schemaReadyForAggregate:safe,
   review:'HOLD',next:safe?'QA_AGGREGATE_ONLY':'STOP_SCHEMA_MISSING',
   realSchemaVerified:false,release:'NO_GO',migration:'HOLD'});
}
const nonnegativeInt=x=>{
 if(typeof x!=='string'&&typeof x!=='number'&&typeof x!=='bigint')deny('CAR02_V28_COUNT_INVALID');
 const s=String(x);
 if(!/^(?:0|[1-9][0-9]*)$/.test(s))deny('CAR02_V28_COUNT_INVALID');
 const v=BigInt(s);
 if(v>BigInt(Number.MAX_SAFE_INTEGER))deny('CAR02_V28_COUNT_OVERFLOW');
 return Number(v);
};
export function assessV28Aggregate(row){
 if(!plain(row)||Object.keys(row).sort().join('|')!==[...NUMBERS,'review_gate'].sort().join('|'))
   deny('CAR02_V28_COUNTS_INVALID');
 const values=Object.fromEntries(NUMBERS.map(k=>[k,nonnegativeInt(row[k])]));
 const {total_orders:total,orders_without_reservation:missing,
        duplicate_booking_groups:groups,orders_in_duplicate_groups:inGroups,largest_group:largest}=values;
 if(missing>total||inGroups>total-missing||(groups===0)!==(inGroups===0)||
    (groups===0)!==(largest===0)||groups>Math.floor(inGroups/2)||
    (groups>0&&(largest<2||largest>inGroups)))deny('CAR02_V28_COUNTS_CONTRADICTORY');
 const expected=groups>0?'HOLD_MANUAL_RECONCILIATION_REQUIRED':'HOLD_OTHER_RELEASE_GATES_STILL_REQUIRED';
 if(row.review_gate!==expected)deny('CAR02_V28_REVIEW_GATE_INVALID');
 return Object.freeze({...values,review_gate:expected,realWorldDuplicatesProven:false,
   release:'NO_GO',migration:'HOLD',productionReady:false});
}
const frozenStop=(catalog,reason)=>Object.freeze({catalog,aggregates:null,
  reason,query02Executed:false,productionReady:false,release:'NO_GO',migration:'HOLD'});
export function createCar02V28ReadOnlyAudit({pool,env,environment,allowDisposableQa=false}={}){
 if(environment!=='disposable_qa'||allowDisposableQa!==true||!plain(env)||!pool||
    typeof pool.connect!=='function'||!plain(pool.options))deny('CAR02_V28_DISPOSABLE_ONLY');
 for(const [k,v] of Object.entries(REQUIRED))if(env[k]!==v)deny('CAR02_V28_DISPOSABLE_ONLY');
 for(const [k,v] of Object.entries({host:'127.0.0.1',user:'postgres',password:'qa_only_local',database:'car02_qa'}))
   if(pool.options[k]!==v)deny('CAR02_V28_DISPOSABLE_ONLY');
 if(String(pool.options.port)!=='5432')deny('CAR02_V28_DISPOSABLE_ONLY');
 return Object.freeze({
   async inspect({catalogSql,duplicatesSql}={}){
     verifyV28ReadOnlySql(catalogSql,duplicatesSql);
     let client,opened=false;
     try{
       client=await pool.connect();
       await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');opened=true;
       const state=await client.query('SHOW transaction_read_only');
       if(state?.rows?.length!==1||state.rows[0].transaction_read_only!=='on')
         deny('CAR02_V28_DB_READONLY_NOT_PROVEN');
       const c=await client.query(catalogSql);
       if(c?.rows?.length!==1)deny('CAR02_V28_CATALOG_RESULT_INVALID');
       const catalog=assessV28Catalog(c.rows[0]);
       if(!catalog.schemaReadyForAggregate){
         await client.query('COMMIT');opened=false;
         return frozenStop(catalog,'QA_SCHEMA_MISSING');
       }
       const d=await client.query(duplicatesSql);
       if(d?.rows?.length!==1)deny('CAR02_V28_AGGREGATE_RESULT_INVALID');
       const aggregates=assessV28Aggregate(d.rows[0]);
       await client.query('COMMIT');opened=false;
       return Object.freeze({catalog,aggregates,reason:aggregates.review_gate,
         query02Executed:true,productionReady:false,release:'NO_GO',migration:'HOLD'});
     }catch(err){
       if(opened&&client){try{await client.query('ROLLBACK')}catch{}}
       deny('CAR02_V28_QA_READONLY_AUDIT_FAILED');
     }finally{if(client)client.release();}
   }
 });
}
