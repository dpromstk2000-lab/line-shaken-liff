/**
 * DPRO CAR02 V4.65 — metadata-only, FAIL-CLOSED disposable-PG17 schema inventory.
 * This checks *column shapes*, NOT Supabase session validity or authorization.
 * The caller MUST independently prove that pool points to a DISPOSABLE DB.
 * `inspectIsolation` and `authorizeInspector` are test doubles until real,
 * separately trusted infrastructure is reviewed. Never deploy or use live DB.
 * No data-row SELECT, no credentials, no session values, no mutations, no GO.
 * R44/R46/R50/R51/R52 remain unchanged and R52 hard release lock stays true.
 */
export const CAR02_V465_RELEASE_LOCK = true;
export const CAR02_V465_REQUIRED_COLUMNS = Object.freeze({
  'auth.sessions': Object.freeze({id:'uuid',user_id:'uuid',created_at:'timestamp with time zone'}),
  'public.ksh_car02_staff_access': Object.freeze({shop_code:'text',user_sub:'uuid',staff_role:'text',active:'boolean'})
});
export const CAR02_V465_CATALOG_SQL = `SELECT n.nspname AS schema_name, c.relname AS table_name,
  a.attname AS column_name, pg_catalog.format_type(a.atttypid,a.atttypmod) AS type_name,
  a.attnotnull AS is_not_null
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
WHERE ((n.nspname='auth' AND c.relname='sessions') OR
       (n.nspname='public' AND c.relname='ksh_car02_staff_access'))
  AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
ORDER BY n.nspname,c.relname,a.attnum`;
const SNAP='BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY';
const close=reason=>Object.freeze({status:'no_go',reason,metadataOnly:true,
  releasePermitted:false,writeAuthorized:false,providerSessionVerified:false});
const report=(reason,missing)=>Object.freeze({status:'no_go',reason,metadataOnly:true,
  releasePermitted:false,writeAuthorized:false,providerSessionVerified:false,
  missingColumns:Object.freeze(missing)});
function validate(rows){
  if(!Array.isArray(rows)||rows.length>128)throw Error('CATALOG_SHAPE_UNTRUSTED');
  const names=new Map();
  for(const row of rows){
    if(!row || typeof row!=='object'||Array.isArray(row)||
      !['auth','public'].includes(row.schema_name)||typeof row.table_name!=='string'||
      typeof row.column_name!=='string'||typeof row.type_name!=='string'||
      typeof row.is_not_null!=='boolean')throw Error('CATALOG_SHAPE_UNTRUSTED');
    const table=row.schema_name+'.'+row.table_name;
    if(!Object.hasOwn(CAR02_V465_REQUIRED_COLUMNS,table)||
      !/^[a-z][a-z0-9_]{0,62}$/.test(row.column_name)||
      !/^[A-Za-z0-9_ (),.\[\]]{1,96}$/.test(row.type_name))throw Error('CATALOG_SHAPE_UNTRUSTED');
    const k=table+'.'+row.column_name;
    if(names.has(k))throw Error('CATALOG_DUPLICATE_COLUMN');
    names.set(k,row.type_name);
  }
  const missing=[];
  for(const [table,cols] of Object.entries(CAR02_V465_REQUIRED_COLUMNS))
    for(const [column,type] of Object.entries(cols))
      if(names.get(table+'.'+column)!==type)missing.push(table+'.'+column);
  return missing;
}
/** The returned shape can NEVER be used as permission to release/deploy/write. */
export function createCar02OfflineStagingSchemaProbeR465({pool,authorizeInspector,inspectIsolation}={}){
  if(CAR02_V465_RELEASE_LOCK!==true||typeof pool?.connect!=='function'||
     typeof authorizeInspector!=='function'||typeof inspectIsolation!=='function')
     throw Error('CAR02_V465_OFFLINE_ADAPTERS_REQUIRED');
  async function inspect({request}={}){
    try{
      const [auth,isolated]=await Promise.all([authorizeInspector({request}),inspectIsolation()]);
      if(auth?.verified!==true||auth.mode!=='isolated_qa'||auth.role!=='schema_auditor'||
        auth.dataAccess!=='catalog_only'||isolated?.verified!==true||
        isolated.environment!=='disposable_pg17'||isolated.database!=='car02_v465_disposable'||
        isolated.testOnly!==true)return close('isolation_or_inspector_unverified');
    }catch{return close('isolation_or_inspector_unverified');}
    let client,started=false,finished=false;
    try{
      client=await pool.connect();
      if(typeof client?.query!=='function'||typeof client?.release!=='function')throw Error('CATALOG_CLIENT_INVALID');
      await client.query(SNAP);started=true;
      await client.query("SET LOCAL statement_timeout = '5s'");
      await client.query("SET LOCAL lock_timeout = '1s'");
      const result=await client.query(CAR02_V465_CATALOG_SQL);
      const missing=validate(result?.rows);
      await client.query('ROLLBACK');started=false;finished=true;
      return report(missing.length?'required_columns_absent':'metadata_review_only',missing);
    }catch{
      if(started&&typeof client?.query==='function')try{await client.query('ROLLBACK');}catch{}
      return close('catalog_untrusted_or_unavailable');
    }finally{
      if(typeof client?.release==='function')try{
        client.release(finished?undefined:new Error('CAR02_V465_UNVERIFIED_READ_DISCARD'));
      }catch{}
    }
  }
  return Object.freeze({inspect});
}
