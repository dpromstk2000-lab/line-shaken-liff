// DPRO CAR02 R101: disposable PostgreSQL 17 session reuse and atomic RLS challenge.
// Synthetic two-tenant fixture only. NO Supabase, production, LINE, Worker, or deploy.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {R100_DB,R100_USERS,R100_SCHEMA,assertR100RoleIdentity,assertR100Scoped} from './car02-r100-pg17-tenant-rls-qa.mjs';

export const R101_EXPECTED_ENV=Object.freeze({R101_DISPOSABLE_SESSION_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',PGDATABASE:R100_DB});
export const R101_POLICY=Object.freeze({mode:'disposable_pg17',source:'R100_SYNTHETIC_FIXTURE',
  loginRoles:2,productionRlsConnected:false,productionReady:false,deployAuthorized:false,
  releaseDecision:'NO_GO',migrationDecision:'HOLD'});
export function assertR101Environment(env){
 for(const [key,value] of Object.entries(R101_EXPECTED_ENV))assert.equal(env?.[key],value,`R101_DISPOSABLE_ONLY_${key}`);
 return true;
}
export function assertR101Principal(row,user){
 assertR100RoleIdentity(row,user);
 assert.ok(Number.isInteger(row.pid)&&row.pid>0,'R101_INVALID_BACKEND_PID');
 assert.equal(row.row_security,'on','R101_RLS_DISABLED_IN_SESSION');
 return true;
}
async function identity(client){
 const {rows}=await client.query(`SELECT current_database() AS db,
  current_setting('server_version_num')::integer AS pg,
  current_user AS user_name,session_user AS session_name,
  r.rolsuper AS superuser,r.rolbypassrls AS bypass_rls,r.rolinherit AS inherits,
  to_regclass('public.ksh_car02_photos') IS NULL AS no_live,
  pg_backend_pid() AS pid,current_setting('row_security') AS row_security
  FROM pg_roles r WHERE r.rolname=current_user`);
 assert.equal(rows.length,1,'R101_IDENTITY_NOT_UNIQUE');return rows[0];
}
async function scoped(client,shop,label){
 const {rows}=await client.query(`SELECT shop_code FROM ${R100_SCHEMA}.r100_tenant_probe ORDER BY id`);
 assertR100Scoped(rows,shop,label);
 assert.equal(rows.length,1,`R101_SCOPE_ROW_COUNT_${label}`);
}
async function expectSqlstate(client,sql,params,codes,label){
 let error;
 try{await client.query(sql,params)}catch(e){error=e;}
 assert.ok(error,`R101_NOT_BLOCKED_${label}`);
 assert.ok(codes.includes(error.code),`R101_BAD_SQLSTATE_${label}_${error.code}`);
}
export async function runR101SessionReuse({tenantPool,adminPool}={}){
 assert.equal(typeof tenantPool,'function','R101_TENANT_FACTORY_REQUIRED');
 assert.ok(adminPool&&typeof adminPool.query==='function','R101_ADMIN_REQUIRED');
 const before=(await adminPool.query(`SELECT id,shop_code,payload FROM ${R100_SCHEMA}.r100_tenant_probe ORDER BY id`)).rows;
 assert.deepEqual(before,[
  {id:'a_original',shop_code:'street_house_kitsuki',payload:'a_secret'},
  {id:'b_original',shop_code:'other_shop',payload:'b_secret'}], 'R101_FIXTURE_BASELINE_MISMATCH');
 let checks=0;
 for(const {user,shop,other} of R100_USERS){
  const pool=tenantPool(user);
  assert.ok(pool&&typeof pool.connect==='function','R101_POOL_REQUIRED');
  // max:1 is enforced by the entry point. Verify same backend was actually reused.
  let first=await pool.connect();let original;
  try{
   original=await identity(first);assertR101Principal(original,user);checks++;
   // A caller-controlled session GUC must never become tenant identity.
   await first.query(`SELECT set_config('car02.tenant',$1,false)`,[other]);
   await scoped(first,shop,'forged_guc_before_release');checks++;
  }finally{first.release()}
  const second=await pool.connect();
  try{
   const reused=await identity(second);assertR101Principal(reused,user);
   assert.equal(reused.pid,original.pid,'R101_BACKEND_NOT_REUSED');checks++;
   assert.equal((await second.query(`SELECT current_setting('car02.tenant',true) AS spoof`)).rows[0].spoof,other,
    'R101_FORGED_GUC_NOT_PERSISTED');checks++;
   await scoped(second,shop,'forged_guc_after_release');checks++;
   // RESET session-controlled identity before returning to pool, regardless of failures.
  }finally{
   try{await second.query('RESET car02.tenant')}finally{second.release()}
  }
  const third=await pool.connect();
  try{
   assertR101Principal(await identity(third),user);checks++;
   await scoped(third,shop,'post_guc_reset');checks++;
   await third.query('BEGIN');
   try{
    await third.query('SET LOCAL row_security=off');
    await expectSqlstate(third,`SELECT id FROM ${R100_SCHEMA}.r100_tenant_probe`,[],['42501'],'rls_off');checks++;
   }finally{await third.query('ROLLBACK')}
   assertR101Principal(await identity(third),user);checks++;
   await scoped(third,shop,'row_security_rollback');checks++;
   // Multi-row INSERT: first tuple is valid, second tries to write foreign tenant.
   // Reject entire SQL statement without partial write (including after tx abort).
   const a=`${user}_mixed_own`,b=`${user}_mixed_foreign`;
   await third.query('BEGIN');
   try{
    await expectSqlstate(third,`INSERT INTO ${R100_SCHEMA}.r100_tenant_probe(id,shop_code,payload)
     VALUES($1,$2,'candidate'),($3,$4,'denied') RETURNING id`,[a,shop,b,other],['42501'],'mixed_insert');checks++;
   }finally{await third.query('ROLLBACK')}
   const {rows:post}=await adminPool.query(`SELECT id FROM ${R100_SCHEMA}.r100_tenant_probe WHERE id=$1 OR id=$2`,[a,b]);
   assert.deepEqual(post,[],'R101_PARTIAL_BATCH_WRITE');checks++;
   // Neither a poisoned search_path nor a caller-supplied tenant GUC changes RLS.
   await third.query('BEGIN');
   try{
    await third.query(`SET LOCAL search_path=pg_temp,public`);
    await third.query(`SELECT set_config('car02.tenant',$1,true)`,[other]);
    await scoped(third,shop,'search_path_and_guc_spoof');checks++;
   }finally{await third.query('ROLLBACK')}
  }finally{third.release()}
 }
 const after=(await adminPool.query(`SELECT id,shop_code,payload FROM ${R100_SCHEMA}.r100_tenant_probe ORDER BY id`)).rows;
 assert.deepEqual(after,before,'R101_FIXTURE_MUTATED');checks++;
 console.log('R101_POOLED_SESSION_IDENTITY_PRESERVED_PASS');
 console.log('R101_FORGED_GUC_CANNOT_SWITCH_TENANT_PASS');
 console.log('R101_RLS_OFF_ROLLBACK_RECOVERY_PASS');
 console.log('R101_MIXED_TENANT_BATCH_ATOMIC_REJECTION_PASS');
 console.log('R101_DISPOSABLE_SESSION_RLS_QA_PASS');
 return Object.freeze({checks,roles:2,productionReady:false,releaseDecision:'NO_GO',migrationDecision:'HOLD'});
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 assertR101Environment(process.env);
 const {default:pg}=await import('pg');
 const pools=[];
 const connect=user=>{
  assert.ok(user==='postgres'||R100_USERS.some(x=>x.user===user),'R101_ROLE_DENIED');
  const pool=new pg.Pool({host:'127.0.0.1',port:5432,database:R100_DB,user,
   password:user==='postgres'?'disposable-r93s-ci-only':'r100-local-test-role-only',
   max:1,connectionTimeoutMillis:3000,idleTimeoutMillis:30000,
   application_name:'car02_r101_disposable_only'});
  pools.push(pool);return pool;
 };
 const admin=connect('postgres');const tenantPools=new Map();
 try{await runR101SessionReuse({adminPool:admin,tenantPool:user=>{
   if(!R100_USERS.some(x=>x.user===user))throw Error('R101_ROLE_DENIED');
   if(!tenantPools.has(user))tenantPools.set(user,connect(user));return tenantPools.get(user);
 }});}finally{await Promise.all(pools.map(x=>x.end()))}
}
