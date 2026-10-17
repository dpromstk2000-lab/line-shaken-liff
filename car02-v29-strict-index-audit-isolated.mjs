/** DPRO CAR02 V2.9: PostgreSQL index semantics preflight, QA-only.
 * A UNIQUE index mentioning reservation_id is NOT sufficient: INCLUDE keys,
 * partial predicates and extra key columns can leave duplicate bookings legal.
 * No real DB, Worker, Line, storage, migration, approval or changes authorized.
 */
import {createHash} from 'node:crypto';

export const V29_MODE=Object.freeze({mode:'disposable_pg17_read_only_catalog',liveChecked:false,
 realSchemaVerified:false,productionReady:false,sendable:false,release:'NO_GO',migration:'HOLD'});
const ALLOW_TABLES=Object.freeze(['ksh_car02_work_orders','car02_v29_qa_index_probe']);
const fail=code=>{throw Object.assign(new Error(code),{code})};
const count=x=>{
 if((typeof x!=='string'&&typeof x!=='number')||!/^(0|[1-9][0-9]*)$/.test(String(x))||
    Number(x)>Number.MAX_SAFE_INTEGER)fail('CAR02_V29_COUNT_INVALID');
 return Number(x);
};
/** Always catalog-only SQL; parameter $1 is the exact, allowlisted relname. */
export const V29_CATALOG_SQL=`WITH idx AS (
 SELECT i.indisunique, i.indisvalid, i.indisready, i.indexprs IS NULL AS plain_keys,
        i.indnkeyatts, pg_get_expr(i.indpred, i.indrelid) AS predicate,
        ARRAY(SELECT pg_get_indexdef(i.indexrelid, n, true)
              FROM generate_series(1, i.indnkeyatts) AS n ORDER BY n) AS key_columns,
        pg_get_indexdef(i.indexrelid) AS definition
 FROM pg_index AS i
 JOIN pg_class AS c ON c.oid=i.indrelid
 JOIN pg_namespace AS ns ON ns.oid=c.relnamespace
 WHERE ns.nspname='public' AND c.relname=$1 AND c.relkind IN ('r','p')
)
SELECT count(*)::bigint AS index_count,
       count(*) FILTER (WHERE indisunique AND definition ILIKE '%reservation_id%')::bigint AS unique_mention_count,
       count(*) FILTER (WHERE indisunique AND indisvalid AND indisready AND plain_keys
         AND (key_columns=ARRAY['reservation_id']::text[]
              OR key_columns=ARRAY['shop_code','reservation_id']::text[]
              OR key_columns=ARRAY['reservation_id','shop_code']::text[])
         AND (predicate IS NULL OR predicate IN ('(reservation_id IS NOT NULL)', 'reservation_id IS NOT NULL')))::bigint AS effective_index_count
FROM idx`;
export const V29_SQL_HASH=createHash('sha256').update(V29_CATALOG_SQL,'utf8').digest('hex');
export function verifyV29Sql(sql){
 if(typeof sql!=='string'||createHash('sha256').update(sql,'utf8').digest('hex')!==V29_SQL_HASH)
  fail('CAR02_V29_SQL_DRIFT');
 return Object.freeze({pinned:true,readOnly:true,productionAuthorized:false});
}
export function assessV29IndexCatalog(row,{table}={}){
 if(!ALLOW_TABLES.includes(table)||!row||typeof row!=='object'||Array.isArray(row)||
    Object.getPrototypeOf(row)!==Object.prototype||
    Object.keys(row).sort().join('|')!=='effective_index_count|index_count|unique_mention_count')
   fail('CAR02_V29_CATALOG_INVALID');
 const indexes=count(row.index_count),mentions=count(row.unique_mention_count),effective=count(row.effective_index_count);
 if(mentions>indexes||effective>mentions)fail('CAR02_V29_COUNTS_CONTRADICTORY');
 return Object.freeze({table,inspectedIndexes:indexes,uniqueIndexesMentioningReservation:mentions,
    structurallyEffectiveIndexCount:effective,
    positiveCatalogSignal:effective>0,
    // Even a valid unique index does not verify booking status, staff auth,
    // existing data, migration backups, safe release or tenant mapping.
    realSchemaVerified:false,productionReady:false,sendable:false,
    release:'NO_GO',migration:'HOLD',
    next:effective>0?'HOLD_REQUIRE_REAL_BACKUP_AUTH_AND_DATA_REVIEW':'HOLD_UNIQUENESS_NOT_PROVEN'});
}
export function createV29QaIndexCatalogReader({pool,env,environment,allowDisposableQa=false}={}){
 const expected={GITHUB_ACTIONS:'true',NODE_ENV:'test',CAR02_RELEASE_LOCK:'true',
   CAR02_BASIC_PG17_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',
   PGPASSWORD:'qa_only_local',PGDATABASE:'car02_qa'};
 const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
 if(environment!=='disposable_qa'||allowDisposableQa!==true||!plain(env)||!pool||
    typeof pool.connect!=='function'||!plain(pool.options))fail('CAR02_V29_DISPOSABLE_ONLY');
 for(const [k,v] of Object.entries(expected))if(env[k]!==v)fail('CAR02_V29_DISPOSABLE_ONLY');
 for(const [k,v] of Object.entries({host:'127.0.0.1',user:'postgres',password:'qa_only_local',database:'car02_qa'}))
    if(pool.options[k]!==v)fail('CAR02_V29_DISPOSABLE_ONLY');
 if(String(pool.options.port)!=='5432')fail('CAR02_V29_DISPOSABLE_ONLY');
 return Object.freeze({async inspect(table){
   if(!ALLOW_TABLES.includes(table))fail('CAR02_V29_TABLE_NOT_ALLOWED');
   let c,open=false;
   try{
     c=await pool.connect();
     await c.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');open=true;
     const guard=await c.query('SHOW transaction_read_only');
     if(guard?.rows?.length!==1||guard.rows[0].transaction_read_only!=='on')fail('CAR02_V29_NOT_READONLY');
     const q=await c.query(V29_CATALOG_SQL,[table]);
     if(q?.rows?.length!==1)fail('CAR02_V29_CATALOG_RESULT_INVALID');
     const result=assessV29IndexCatalog(q.rows[0],{table});
     await c.query('COMMIT');open=false;return result;
   }catch{if(open&&c){try{await c.query('ROLLBACK')}catch{}}
     fail('CAR02_V29_READONLY_QUERY_FAILED');
   }finally{if(c)c.release();}
 }});
}
