// DPRO CAR02 R109 - disposable PostgreSQL quarantine ledger candidate ONLY.
// No real Storage delete, external network, migrations or live credentials.
import assert from 'node:assert/strict';
const DB='car02_r109_qa_ci', TABLE='car02_r109_qa.quarantine_ledger';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const PATH=/^[a-z0-9][a-z0-9_-]{1,63}\/(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/){2}[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(?:jpg|png|webp)$/;
const USERS=Object.freeze({car02_r109_a_ci:'street_house_kitsuki',car02_r109_b_ci:'other_shop'});
const KEYS=Object.freeze(['shop','jobId','photoId','path','sha256','reason']);
const REASONS=new Set(['UPLOAD_UNCERTAIN','STORAGE_DELETE_UNVERIFIED','ACK_LOST']);
const deny=x=>{throw Object.assign(new Error(x),{code:x})};
export const R109_CONTRACT=Object.freeze({system:'CAR02',mode:'isolated_pg17_only',
 durableCandidate:true,liveSupabaseTested:false,realStorageDeletion:false,
 productionReady:false,deleteApproved:false,releaseDecision:'NO_GO',migrationDecision:'HOLD'});
export function assertR109Env(env){
 for(const [k,v] of Object.entries({R109_DISPOSABLE_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',
  PGDATABASE:DB}))assert.equal(env?.[k],v,'R109_ENV_'+k);
 return true;
}
export function validateR109Request(input){
 if(input===null||typeof input!=='object'||Array.isArray(input)||
    Object.getPrototypeOf(input)!==Object.prototype||
    Object.keys(input).sort().join('|')!==KEYS.slice().sort().join('|')||
    !SHOP.test(input.shop)||!UUID.test(input.jobId)||!UUID.test(input.photoId)||
    !SHA.test(input.sha256)||!REASONS.has(input.reason)||
    typeof input.path!=='string'||input.path.length>280||!PATH.test(input.path)||
    !input.path.startsWith(input.shop+'/')) deny('R109_INVALID_SCOPE');
 return Object.freeze({...input});
}
export function checkR109RoleIdentity(row,expectedUser){
 assert.equal(row?.db,DB,'R109_BAD_DB');
 assert.ok(Number.isInteger(row?.pg)&&row.pg>=170000&&row.pg<180000,'R109_NOT_PG17');
 assert.equal(row?.user_name,expectedUser,'R109_BAD_ROLE');
 assert.equal(row?.session_name,expectedUser,'R109_BAD_SESSION');
 assert.equal(row?.superuser,false,'R109_SUPERUSER');
 assert.equal(row?.bypass_rls,false,'R109_BYPASS_RLS');
 assert.equal(row?.inherits,false,'R109_INHERITS');
 assert.equal(row?.live_table_absent,true,'R109_LIVE_DB_DETECTED');
 return true;
}
export function matchR109Ledger(row,input){
 return row?.job_id===input.jobId.toLowerCase() && row.shop_code===input.shop &&
  row.photo_id===input.photoId.toLowerCase() && row.storage_path===input.path &&
  row.sha256===input.sha256 && row.reason===input.reason &&
  row.bucket==='ksh-car02-private-photos' && row.state==='QUARANTINED';
}
export function createR109Ledger({environment,dbName,pgPool,expectedUser}={}){
 if(environment!=='isolated_qa'||dbName!==DB||!pgPool||typeof pgPool.connect!=='function'||
    !Object.hasOwn(USERS,expectedUser))deny('R109_DISPOSABLE_ONLY');
 return Object.freeze({mode:'disposable_ledger',noStorageDelete:true,
  async enqueue(raw){
   const input=validateR109Request(raw);
   if(input.shop!==USERS[expectedUser])deny('R109_WRONG_TENANT');
   const client=await pgPool.connect();let began=false,discard=false;
   try{
    await client.query('BEGIN');began=true;
    const identity=await client.query(`SELECT current_database() AS db,
      current_setting('server_version_num')::int AS pg,current_user AS user_name,
      session_user AS session_name,rolsuper AS superuser,rolbypassrls AS bypass_rls,
      rolinherit AS inherits,to_regclass('public.ksh_car02_photos') IS NULL AS live_table_absent
      FROM pg_roles WHERE rolname=current_user`);
    assert.equal(identity.rows.length,1,'R109_SESSION_MISSING');
    checkR109RoleIdentity(identity.rows[0],expectedUser);
    const inserted=await client.query(`INSERT INTO ${TABLE}
      (job_id,shop_code,photo_id,storage_path,sha256,reason)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (job_id) DO NOTHING RETURNING job_id`,
     [input.jobId,input.shop,input.photoId,input.path,input.sha256,input.reason]);
    const existing=await client.query(`SELECT job_id::text,shop_code,photo_id::text,storage_path,sha256,reason,bucket,state
      FROM ${TABLE} WHERE job_id=$1 AND shop_code=$2`,[input.jobId,input.shop]);
    if(existing.rows.length!==1||!matchR109Ledger(existing.rows[0],input))deny('R109_REBIND_OR_SCOPE_DENIED');
    await client.query('COMMIT');began=false;
    return Object.freeze({status:'QUARANTINED',duplicate:inserted.rowCount===0});
   }catch(e){if(began){try{await client.query('ROLLBACK')}catch{discard=true}}throw e;}
   finally{client.release(discard);}
  },
  async count(){
   const client=await pgPool.connect();
   try{const r=await client.query(`SELECT count(*)::int AS n FROM ${TABLE}`);return r.rows[0].n;}
   finally{client.release();}
  }
 });
}
// No request-based production bypass or network transport exists.
export const R109_TEST_USERS=USERS;
