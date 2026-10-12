// CAR02 R111: read-only inbox for isolated PostgreSQL 17 ONLY. No Storage, no deletion, no release.
import assert from 'node:assert/strict';
const DB='car02_r109_qa_ci', VIEW='car02_r109_qa.r111_review_inbox';
const USERS=Object.freeze({car02_r111_a_ci:'street_house_kitsuki',car02_r111_b_ci:'other_shop'});
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const CURSOR_KEYS=['createdAt','jobId'];
const fail=(code)=>{throw Object.assign(new Error(code),{code})};
export const R111_CONTRACT=Object.freeze({mode:'disposable_pg17_only',productionReady:false,
  readOnly:true,storageDeleteAuthorized:false,mutationsAuthorized:false,
  releaseDecision:'NO_GO',migrationDecision:'HOLD'});
export const R111_USERS=USERS;
export const R111_PUBLIC_KEYS=Object.freeze(['jobId','state','reason','createdAt','reviewCount','escalated','latestEventKind','latestRecordedAt']);
export function assertR111Env(e){
 for(const [k,v] of Object.entries({R111_DISPOSABLE_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',PGDATABASE:DB}))
  assert.equal(e?.[k],v,'R111_ENV_'+k);
}
export function validateR111Query(input){
 if(input===null||typeof input!=='object'||Array.isArray(input)||Object.getPrototypeOf(input)!==Object.prototype||
    Object.keys(input).some(k=>!['limit','cursor','escalatedOnly'].includes(k)))fail('R111_QUERY_INVALID');
 const limit=input.limit??20;
 if(!Number.isInteger(limit)||limit<1||limit>50||
    (input.escalatedOnly!==undefined&&typeof input.escalatedOnly!=='boolean'))fail('R111_QUERY_INVALID');
 const cursor=input.cursor??null;
 if(cursor!==null){
  if(typeof cursor!=='object'||Array.isArray(cursor)||Object.getPrototypeOf(cursor)!==Object.prototype||
   Object.keys(cursor).sort().join('|')!==CURSOR_KEYS.slice().sort().join('|')||
   !UUID.test(cursor.jobId)||typeof cursor.createdAt!=='string'||
   !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(cursor.createdAt)||
   !Number.isFinite(Date.parse(cursor.createdAt))||new Date(cursor.createdAt).toISOString()!==cursor.createdAt)
   fail('R111_CURSOR_INVALID');
 }
 return Object.freeze({limit,escalatedOnly:input.escalatedOnly===true,
  cursor:cursor?Object.freeze({createdAt:cursor.createdAt,jobId:cursor.jobId.toLowerCase()}):null});
}
export function checkR111Identity(row,user){
 assert.equal(row?.db,DB,'R111_BAD_DATABASE');
 assert.ok(Number.isInteger(row?.pg)&&row.pg>=170000&&row.pg<180000,'R111_NOT_PG17');
 assert.equal(row?.user_name,user,'R111_BAD_ROLE');assert.equal(row?.session_name,user,'R111_BAD_SESSION');
 assert.equal(row?.superuser,false,'R111_SUPERUSER');assert.equal(row?.bypass_rls,false,'R111_BYPASS_RLS');
 assert.equal(row?.inherits,false,'R111_ROLE_INHERIT');assert.equal(row?.live_table_absent,true,'R111_LIVE_DATA_FOUND');
}
export function safeR111Row(row,shop){
 assert.equal(row?.shop_code,shop,'R111_ROW_TENANT_MISMATCH');
 assert.ok(UUID.test(row.job_id)||UUID.test(row.job_id?.toString?.()),'R111_BAD_JOB');
 assert.equal(row.state,'QUARANTINED','R111_NOT_QUARANTINED');
 assert.ok(['UPLOAD_UNCERTAIN','STORAGE_DELETE_UNVERIFIED','ACK_LOST'].includes(row.reason),'R111_BAD_REASON');
 assert.ok(Number.isInteger(row.review_count)&&row.review_count>=0,'R111_BAD_COUNT');
 assert.equal(typeof row.escalated,'boolean','R111_BAD_FLAG');
 assert.ok(row.created_at instanceof Date&&!isNaN(row.created_at.valueOf()),'R111_BAD_TIME');
 assert.ok(row.latest_recorded_at===null||row.latest_recorded_at instanceof Date&&!isNaN(row.latest_recorded_at.valueOf()),'R111_BAD_REVIEW_TIME');
 assert.ok(row.latest_event_kind===null||['EVIDENCE_HASH_RECORDED','ESCALATED_FOR_REVIEW'].includes(row.latest_event_kind),'R111_BAD_EVENT');
 return Object.freeze({jobId:String(row.job_id).toLowerCase(),state:row.state,reason:row.reason,
  createdAt:row.created_at.toISOString(),reviewCount:row.review_count,escalated:row.escalated,
  latestEventKind:row.latest_event_kind,latestRecordedAt:row.latest_recorded_at?.toISOString()??null});
}
export function createR111ReadonlyInbox({environment,dbName,pgPool,expectedUser}={}){
 if(environment!=='isolated_qa'||dbName!==DB||typeof pgPool?.connect!=='function'||
  !Object.hasOwn(USERS,expectedUser))fail('R111_DISPOSABLE_ONLY');
 return Object.freeze({readOnly:true,storageDeleteAuthorized:false,async list(request={}){
  const q=validateR111Query(request),client=await pgPool.connect();let started=false,discard=false;
  try{
   await client.query('BEGIN READ ONLY');started=true;
   const auth=await client.query(`SELECT current_database() AS db,
    current_setting('server_version_num')::int AS pg,current_user AS user_name,
    session_user AS session_name,rolsuper AS superuser,rolbypassrls AS bypass_rls,
    rolinherit AS inherits,to_regclass('public.ksh_car02_photos') IS NULL AS live_table_absent
    FROM pg_roles WHERE rolname=current_user`);
   assert.equal(auth.rows.length,1,'R111_IDENTITY_MISSING');checkR111Identity(auth.rows[0],expectedUser);
   // PostgreSQL enforces tenant isolation in both source tables via RLS & invoker view.
   const rows=await client.query(`SELECT job_id::text,state,reason,created_at,review_count,escalated,
     latest_event_kind,latest_recorded_at,shop_code FROM ${VIEW}
     WHERE ($1::boolean = false OR escalated = true)
      AND ($2::timestamptz IS NULL OR (created_at,job_id)<($2::timestamptz,$3::uuid))
     ORDER BY created_at DESC,job_id DESC LIMIT $4`,
     [q.escalatedOnly,q.cursor?.createdAt??null,q.cursor?.jobId??null,q.limit+1]);
   const hasMore=rows.rows.length>q.limit;
   const subset=rows.rows.slice(0,q.limit).map(row=>safeR111Row(row,USERS[expectedUser]));
   await client.query('COMMIT');started=false;
   const last=subset.at(-1);
   return Object.freeze({items:Object.freeze(subset),hasMore,
    nextCursor:hasMore&&last?Object.freeze({createdAt:last.createdAt,jobId:last.jobId}):null,
    releaseDecision:'NO_GO',migrationDecision:'HOLD'});
  }catch(e){if(started)try{await client.query('ROLLBACK')}catch{discard=true};throw e}
  finally{client.release(discard)}
 }});
}
