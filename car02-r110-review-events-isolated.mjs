// DPRO CAR02 R110 -- isolated PG17 review evidence ledger; NO REAL STORAGE DELETE.
import assert from 'node:assert/strict';
const DB='car02_r109_qa_ci',T='car02_r109_qa.quarantine_review_events';
const USERS=Object.freeze({car02_r110_a_ci:'street_house_kitsuki',car02_r110_b_ci:'other_shop'});
const KEYS=['eventId','shop','jobId','eventKind','proofSha256'];
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const TYPES=new Set(['EVIDENCE_HASH_RECORDED','ESCALATED_FOR_REVIEW']);
const fail=c=>{throw Object.assign(new Error(c),{code:c})};
export const R110_CONTRACT=Object.freeze({mode:'disposable_pg17_only',liveStorageDelete:false,
 productionReady:false,migrationAllowed:false,reviewIsAuthorization:false,
 releaseDecision:'NO_GO',migrationDecision:'HOLD'});
export const R110_REVIEW_USERS=USERS;
export function assertR110Environment(e){
 for(const [k,v] of Object.entries({R110_DISPOSABLE_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',PGDATABASE:DB}))
  assert.equal(e?.[k],v,'R110_ENV_'+k);
}
export function validateR110Event(input){
 if(input===null||typeof input!=='object'||Array.isArray(input)||Object.getPrototypeOf(input)!==Object.prototype||
  Object.keys(input).sort().join('|')!==KEYS.slice().sort().join('|')||
  !UUID.test(input.eventId)||!UUID.test(input.jobId)||!Object.values(USERS).includes(input.shop)||
  !TYPES.has(input.eventKind)||!SHA.test(input.proofSha256))fail('R110_REVIEW_EVENT_INVALID');
 return Object.freeze({...input});
}
export function checkR110Identity(row,user){
 assert.equal(row?.db,DB,'R110_BAD_DB');
 assert.ok(Number.isInteger(row?.pg)&&row.pg>=170000&&row.pg<180000,'R110_NOT_PG17');
 assert.equal(row?.user_name,user,'R110_BAD_ROLE');assert.equal(row?.session_name,user,'R110_BAD_SESSION');
 assert.equal(row?.superuser,false,'R110_SUPERUSER');assert.equal(row?.bypass_rls,false,'R110_BYPASS_RLS');
 assert.equal(row?.inherits,false,'R110_INHERITS');assert.equal(row?.live_table_absent,true,'R110_LIVE_DB');
}
export function eventIsIdentical(row,event){
 return row?.event_id===event.eventId.toLowerCase()&&row.shop_code===event.shop&&
  row.job_id===event.jobId.toLowerCase()&&row.event_kind===event.eventKind&&
  row.proof_sha256===event.proofSha256;
}
export function createR110ReviewLedger({environment,dbName,pgPool,expectedUser}={}){
 if(environment!=='isolated_qa'||dbName!==DB||!pgPool||typeof pgPool.connect!=='function'||
  !Object.hasOwn(USERS,expectedUser))fail('R110_DISPOSABLE_ONLY');
 return Object.freeze({noStorageDelete:true,noApprovalRoute:true,
  async record(raw){
   const ev=validateR110Event(raw);
   if(ev.shop!==USERS[expectedUser])fail('R110_CROSS_TENANT_REQUEST');
   const c=await pgPool.connect();let started=false,discard=false;
   try{
    await c.query('BEGIN');started=true;
    const id=await c.query(`SELECT current_database() AS db,
     current_setting('server_version_num')::int AS pg,current_user AS user_name,
     session_user AS session_name,rolsuper AS superuser,rolbypassrls AS bypass_rls,
     rolinherit AS inherits,to_regclass('public.ksh_car02_photos') IS NULL AS live_table_absent
     FROM pg_roles WHERE rolname=current_user`);
    assert.equal(id.rows.length,1,'R110_IDENTITY_MISSING');checkR110Identity(id.rows[0],expectedUser);
    const insert=await c.query(`INSERT INTO ${T}(event_id,shop_code,job_id,event_kind,proof_sha256)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [ev.eventId,ev.shop,ev.jobId,ev.eventKind,ev.proofSha256]);
    const selected=await c.query(`SELECT event_id::text,shop_code,job_id::text,event_kind,proof_sha256
     FROM ${T} WHERE event_id=$1 AND shop_code=$2`,[ev.eventId,ev.shop]);
    if(selected.rows.length!==1||!eventIsIdentical(selected.rows[0],ev))fail('R110_EVENT_REBIND_DENIED');
    await c.query('COMMIT');started=false;
    return Object.freeze({status:'RECORDED_NOT_AUTHORIZED',duplicate:insert.rowCount===0});
   }catch(e){if(started)try{await c.query('ROLLBACK')}catch{discard=true};throw e;}
   finally{c.release(discard);}
  },
  async count(){const c=await pgPool.connect();try{const r=await c.query(`SELECT count(*)::int AS n FROM ${T}`);return r.rows[0].n;}finally{c.release();}}
 });
}
