// DPRO CAR02 R95: transactional drift challenge, DISPOSABLE GitHub PostgreSQL 17 ONLY.
// Deliberately mutates only the restored QA database inside rollback-only transactions.
// Never execute against a production, Supabase, or a persistent/studio database.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {R94B_SCHEMA_ACL_SQL,normalizeR94BSchemaAcl} from './car02-r94b-schema-acl.mjs';

export const SOURCE='car02_r93q_qa_ci', RESTORE='car02_r94b_restore_ci';
export const R95_ENV=Object.freeze({
  R94B_DISPOSABLE_BACKUP_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',
  PGUSER:'postgres',PGPASSWORD:'disposable-r93s-ci-only',PGDATABASE:SOURCE,
});
const NS='car02_r93q_qa';
const ORDER=Object.freeze({staff:'shop_code,staff_id',work_orders:'id',reports:'id',
  photos:'id',upload_intents:'shop_code,intent_key',cleanup_jobs:'job_id'});

export function assertR95DisposableEnvironment(env){
 for(const [key,value] of Object.entries(R95_ENV))
  assert.equal(env[key],value,`R95_ENV_DENIED_${key}`);
 // Defense in depth; only the fixed disposable names and localhost are ever used.
 assert.deepEqual([SOURCE,RESTORE],['car02_r93q_qa_ci','car02_r94b_restore_ci']);
}
export function assertR95SnapshotMatch(expected,actual,label='SOURCE_RESTORE'){
 assert.deepEqual(actual,expected,`R95_DRIFT_${label}`);
}
export const R95_PROBES=Object.freeze([
  Object.freeze({name:'STAFF_DATA_CHANGE',sql:"UPDATE car02_r93q_qa.staff SET active=NOT active WHERE shop_code='street_house_kitsuki' AND staff_id='11111111-1111-4111-8111-111111111111'"}),
  Object.freeze({name:'TRIGGER_DISABLED',sql:'ALTER TABLE car02_r93q_qa.photos DISABLE TRIGGER car02_r93q_guard'}),
  Object.freeze({name:'PUBLIC_SCHEMA_USAGE',sql:'GRANT USAGE ON SCHEMA car02_r93q_qa TO PUBLIC'}),
  Object.freeze({name:'RLS_POLICY_DRIFT',sql:'ALTER TABLE car02_r93q_qa.photos ENABLE ROW LEVEL SECURITY'}),
]);

async function assertR95Connection(p,db){
 const {rows}=await p.query(`SELECT current_database() AS db,
   current_setting('server_version_num')::integer AS pg,
   to_regclass('public.ksh_car02_photos') IS NULL AS no_live,
   to_regclass('car02_r93q_qa.upload_intents') IS NOT NULL AS has_intents,
   to_regclass('car02_r93q_qa.photos') IS NOT NULL AS has_photos`);
 assert.equal(rows.length,1,'R95_DB_GUARD_MISSING');
 assert.equal(rows[0].db,db,'R95_WRONG_DATABASE');
 assert.ok(rows[0].pg>=170000 && rows[0].pg<180000,'R95_PG17_ONLY');
 assert.equal(rows[0].no_live,true,'R95_LIVE_TABLE_DETECTED');
 assert.equal(rows[0].has_intents,true,'R95_NO_ISOLATED_FIXTURE');
 assert.equal(rows[0].has_photos,true,'R95_NO_ISOLATED_PHOTOS');
}

export async function snapshotR95(p){
 const tables={};
 for(const [table,order] of Object.entries(ORDER)){
  // SQL identifiers are from hard-coded frozen local constants, never user input.
  tables[table]=(await p.query(`SELECT * FROM ${NS}.${table} ORDER BY ${order}`)).rows;
 }
 const relations=(await p.query(`SELECT c.relname AS name, c.relkind AS kind,
    c.relrowsecurity AS rls, c.relforcerowsecurity AS rls_forced,
    own.rolname AS owner
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   JOIN pg_roles own ON own.oid=c.relowner
   WHERE n.nspname=$1 AND c.relkind IN ('r','p') ORDER BY c.relname`,[NS])).rows;
 const indexes=(await p.query(`SELECT tablename,indexname,indexdef FROM pg_indexes
    WHERE schemaname=$1 ORDER BY tablename,indexname`,[NS])).rows;
 const constraints=(await p.query(`SELECT c.relname AS table_name,t.conname,t.contype,
    pg_get_constraintdef(t.oid,true) AS definition, t.convalidated
   FROM pg_constraint t JOIN pg_class c ON c.oid=t.conrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname=$1 ORDER BY c.relname,t.conname`,[NS])).rows;
 const triggers=(await p.query(`SELECT c.relname AS table_name,t.tgname,t.tgenabled,
    pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t
   JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname=$1 AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,[NS])).rows;
 const functions=(await p.query(`SELECT p.proname,pg_get_functiondef(p.oid) AS definition
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname=$1 ORDER BY p.proname`,[NS])).rows;
 const tableAcls=(await p.query(`SELECT c.relname AS object_name,own.rolname AS owner,
   CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE COALESCE(gr.rolname,'MISSING_GRANTEE') END AS grantee,
   CASE WHEN x.grantor=0 THEN 'PUBLIC' ELSE COALESCE(gn.rolname,'MISSING_GRANTOR') END AS grantor,
   x.privilege_type,x.is_grantable
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   JOIN pg_roles own ON own.oid=c.relowner
   CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) x
   LEFT JOIN pg_roles gr ON gr.oid=x.grantee
   LEFT JOIN pg_roles gn ON gn.oid=x.grantor
   WHERE n.nspname=$1 AND c.relkind IN ('r','p')
   ORDER BY c.relname,owner,grantee,grantor,x.privilege_type,x.is_grantable`,[NS])).rows;
 const schemaAcls=normalizeR94BSchemaAcl((await p.query(R94B_SCHEMA_ACL_SQL)).rows);
 assert.equal(relations.length,6,'R95_RELATION_COUNT');
 assert.ok(indexes.length>=6,'R95_INDEX_COUNT');
 assert.ok(constraints.length>=6,'R95_CONSTRAINT_COUNT');
 assert.ok(triggers.length>=2,'R95_TRIGGER_COUNT');
 assert.ok(functions.length>=2,'R95_FUNCTION_COUNT');
 assert.ok(tableAcls.length>=6,'R95_ACL_COUNT');
 assert.equal(tables.photos.length,3,'R95_PHOTO_FIXTURE_COUNT');
 assert.equal(tables.photos.filter(x=>x.upload_state==='ready').length,2,'R95_READY_FIXTURE_COUNT');
 assert.equal(tables.photos.filter(x=>x.upload_state==='deleted').length,1,'R95_TOMBSTONE_FIXTURE_COUNT');
 assert.equal(tables.upload_intents.length,3,'R95_INTENT_COUNT');
 assert.equal(tables.cleanup_jobs.length,1,'R95_OUTBOX_COUNT');
 return {tables,relations,indexes,constraints,triggers,functions,tableAcls,schemaAcls};
}

export async function challengeR95RestoredDatabase(source,restored){
 const sourceBaseline=await snapshotR95(source);
 const restoredBaseline=await snapshotR95(restored);
 assertR95SnapshotMatch(sourceBaseline,restoredBaseline,'RESTORE_BASELINE');
 for(const {name,sql} of R95_PROBES){
  const client=await restored.connect();
  try{
   await client.query('BEGIN');
   try{
    await client.query(sql);
    const changed=await snapshotR95(client);
    let caught=false;
    try{assertR95SnapshotMatch(restoredBaseline,changed,name);}
    catch(error){
     if(error.code==='ERR_ASSERTION' && error.message.includes(`R95_DRIFT_${name}`))caught=true;
     else throw error;
    }
    assert.equal(caught,true,`R95_DRIFT_NOT_DETECTED_${name}`);
   }finally{await client.query('ROLLBACK');}
  }finally{client.release();}
  assertR95SnapshotMatch(restoredBaseline,await snapshotR95(restored),`ROLLBACK_${name}`);
  console.log(`R95_PROBE_${name}_PASS`);
 }
 assertR95SnapshotMatch(sourceBaseline,await snapshotR95(source),'SOURCE_IMMUTABILITY');
 assertR95SnapshotMatch(restoredBaseline,await snapshotR95(restored),'RESTORE_IMMUTABILITY');
 const fingerprint=createHash('sha256').update(JSON.stringify(restoredBaseline)).digest('hex');
 console.log(`R95_RESTORE_DRIFT_${R95_PROBES.length}_${R95_PROBES.length}_PASS`);
 console.log(`R95_DISPOSABLE_RESTORE_FINGERPRINT_SHA256=${fingerprint}`);
 return {probes:R95_PROBES.length,fingerprint};
}

if(process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url){
 assertR95DisposableEnvironment(process.env);
 const {default:pg}=await import('pg');
 const pools=[];
 function pool(db){
  assert.ok([SOURCE,RESTORE].includes(db),'R95_UNEXPECTED_DB_NAME');
  const p=new pg.Pool({host:R95_ENV.PGHOST,port:Number(R95_ENV.PGPORT),
   user:R95_ENV.PGUSER,password:R95_ENV.PGPASSWORD,database:db,
   max:2,connectionTimeoutMillis:2500,idleTimeoutMillis:1000,
   application_name:'car02_r95_disposable_only'});
  pools.push(p);return p;
 }
 try{
  const source=pool(SOURCE),restored=pool(RESTORE);
  await assertR95Connection(source,SOURCE);
  await assertR95Connection(restored,RESTORE);
  await challengeR95RestoredDatabase(source,restored);
 }finally{await Promise.all(pools.map(p=>p.end()));}
}
