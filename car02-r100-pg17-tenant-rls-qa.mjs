// DPRO CAR02 R100 - low-privilege tenant separation test, DISPOSABLE PG17 ONLY.
// No production credentials, Supabase, Worker, storage access or persistent writes.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
export const R100_DB='car02_r93q_qa_ci';
export const R100_SCHEMA='car02_r93q_qa';
export const R100_TABLES=Object.freeze(['staff','work_orders','reports','photos','upload_intents','cleanup_jobs','r100_tenant_probe']);
export const R100_USERS=Object.freeze([
 {user:'car02_r100_a_ci',shop:'street_house_kitsuki',other:'other_shop',staff:2},
 {user:'car02_r100_b_ci',shop:'other_shop',other:'street_house_kitsuki',staff:1}
]);
const EXPECTED=Object.freeze({R100_DISPOSABLE_RLS_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',PGDATABASE:R100_DB});
export function assertR100Disposable(env){for(const [k,v] of Object.entries(EXPECTED))assert.equal(env?.[k],v,`R100_ENV_${k}`);return true;}
export function assertR100RoleIdentity(row,user){
 assert.equal(row.db,R100_DB,'R100_WRONG_DATABASE');
 assert.ok(Number.isInteger(row.pg)&&row.pg>=170000&&row.pg<180000,'R100_NOT_PG17');
 assert.equal(row.user_name,user,'R100_USER_MISMATCH');
 assert.equal(row.session_name,user,'R100_IMPERSONATED_SESSION');
 assert.equal(row.superuser,false,'R100_SUPERUSER');
 assert.equal(row.bypass_rls,false,'R100_BYPASS_RLS');
 assert.equal(row.inherits,false,'R100_UNEXPECTED_INHERITANCE');
 assert.equal(row.no_live,true,'R100_LIVE_PHOTO_TABLE');
}
export function assertR100Scoped(rows,shop,table){
 assert.ok(Array.isArray(rows)&&rows.length>0,`R100_NO_OWN_FIXTURE_${table}`);
 assert.ok(rows.every(x=>x.shop_code===shop),`R100_CROSS_TENANT_LEAK_${table}`);
}
async function expectCode(p,query,params,codes,label){
 let err;
 try{await p.query(query,params)}catch(e){err=e;}
 assert.ok(err,`R100_UNEXPECTED_ALLOWED_${label}`);
 assert.ok(codes.includes(err.code),`R100_WRONG_REJECTION_${label}_${err.code}`);
}
async function count(p,table){return (await p.query(`SELECT shop_code FROM ${R100_SCHEMA}.${table}`)).rows;}
export async function runR100TenantChallenge(poolFor){
 assert.equal(typeof poolFor,'function');
 const admin=poolFor('postgres'),clients=R100_USERS.map(x=>({...x,p:poolFor(x.user)}));
 // Metadata audited through the disposable PostgreSQL administrator, not through client roles.
 const {rows:metadata}=await admin.query(`SELECT c.relname,c.relrowsecurity AS enabled,c.relforcerowsecurity AS forced,
  (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='r100_role_tenant_only') AS policies
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname=$1 AND c.relname=ANY($2::text[]) ORDER BY c.relname`,[R100_SCHEMA,R100_TABLES]);
 assert.equal(metadata.length,7,'R100_TABLE_LIST_INCOMPLETE');
 assert.ok(metadata.every(x=>x.enabled===true&&x.forced===true&&x.policies===1),'R100_RLS_POLICY_MISSING');
 let checks=0;
 for(const {user,shop,other,staff,p} of clients){
  const {rows:id}=await p.query(`SELECT current_database() AS db,current_setting('server_version_num')::int AS pg,
   current_user AS user_name,session_user AS session_name,r.rolsuper AS superuser,r.rolbypassrls AS bypass_rls,
   r.rolinherit AS inherits,to_regclass('public.ksh_car02_photos') IS NULL AS no_live
   FROM pg_roles r WHERE r.rolname=current_user`);
  assert.equal(id.length,1);assertR100RoleIdentity(id[0],user);checks++;
  for(const tbl of R100_TABLES){const rows=await count(p,tbl);assertR100Scoped(rows,shop,tbl);checks++;}
  assert.equal((await count(p,'staff')).length,staff);checks++;
  // Calling code must not claim a different tenant via arbitrary session variables.
  const gucClient=await p.connect();
  try{
   await gucClient.query('BEGIN');
   try{
    await gucClient.query(`SELECT set_config('car02.tenant',$1,true)`,[other]);
    assertR100Scoped(await count(gucClient,'r100_tenant_probe'),shop,'guc_spoof');checks++;
   }finally{await gucClient.query('ROLLBACK');}
  }finally{gucClient.release();}
  // Login role is not a member of the foreign tenant role; impersonation must fail.
  await expectCode(p,`SET ROLE ${R100_USERS.find(x=>x.user!==user).user}`,[],['42501'],'set_role');checks++;
  await expectCode(p,`SET SESSION AUTHORIZATION postgres`,[],['42501'],'session_auth');checks++;
  await expectCode(p,`ALTER TABLE ${R100_SCHEMA}.r100_tenant_probe DISABLE ROW LEVEL SECURITY`,[],['42501'],'disable_rls');checks++;
  const otherId=shop==='street_house_kitsuki'?'b_original':'a_original';
  assert.equal((await p.query(`SELECT id FROM ${R100_SCHEMA}.r100_tenant_probe WHERE id=$1`,[otherId])).rows.length,0);checks++;
  const update=(await p.query(`UPDATE ${R100_SCHEMA}.r100_tenant_probe SET payload='hijacked' WHERE id=$1`,[otherId]));
  assert.equal(update.rowCount,0,'R100_FOREIGN_UPDATE_NOT_FILTERED');checks++;
  const del=(await p.query(`DELETE FROM ${R100_SCHEMA}.r100_tenant_probe WHERE id=$1`,[otherId]));
  assert.equal(del.rowCount,0,'R100_FOREIGN_DELETE_NOT_FILTERED');checks++;
  await expectCode(p,`INSERT INTO ${R100_SCHEMA}.r100_tenant_probe(id,shop_code,payload) VALUES($1,$2,'attack')`,
   [`${user}_foreign_insert`,other],['42501'],'foreign_insert');checks++;
  const myId=shop==='street_house_kitsuki'?'a_original':'b_original';
  await expectCode(p,`UPDATE ${R100_SCHEMA}.r100_tenant_probe SET shop_code=$1 WHERE id=$2`,
   [other,myId],['42501'],'tenant_switch');checks++;
  // Disabling row security as an ordinary tenant must not permit a cross-tenant query.
  const securityClient=await p.connect();
  try{
   await securityClient.query('BEGIN');
   try{
    await securityClient.query('SET LOCAL row_security=off');
    await expectCode(securityClient,`SELECT id FROM ${R100_SCHEMA}.r100_tenant_probe`,[],['42501'],'row_security_off');checks++;
   }finally{await securityClient.query('ROLLBACK');}
  }finally{securityClient.release();}
  // Valid own-tenant insert works; the test uses transaction rollback, never persists data.
  const ownClient=await p.connect();
  try{
   await ownClient.query('BEGIN');
   try{
    await ownClient.query(`INSERT INTO ${R100_SCHEMA}.r100_tenant_probe(id,shop_code,payload) VALUES($1,$2,'qa')`,[`${user}_own`,shop]);
    const own=await ownClient.query(`SELECT id FROM ${R100_SCHEMA}.r100_tenant_probe WHERE id=$1`,[`${user}_own`]);
    assert.equal(own.rowCount,1);checks++;
   }finally{await ownClient.query('ROLLBACK');}
  }finally{ownClient.release();}
 }
 const {rows:finalRows}=await admin.query(`SELECT id,shop_code,payload FROM ${R100_SCHEMA}.r100_tenant_probe ORDER BY id`);
 assert.deepEqual(finalRows,[{id:'a_original',shop_code:'street_house_kitsuki',payload:'a_secret'},
  {id:'b_original',shop_code:'other_shop',payload:'b_secret'}]);checks++;
 console.log('R100_RLS_SEVEN_TABLES_ENABLED_FORCE_PASS');
 console.log('R100_TENANT_LOW_PRIVILEGE_ISOLATION_PASS');
 console.log('R100_GUC_SPOOF_ROLE_ESCALATION_BLOCKED_PASS');
 console.log('R100_RLS_WRITE_SCOPE_ROLLBACK_PASS');
 console.log('R100_DISPOSABLE_TENANT_RLS_QA_PASS');
 return {checks,roleCount:2,tableCount:R100_TABLES.length,productionReady:false,releaseDecision:'NO_GO',migrationDecision:'HOLD'};
}
export const R100_CONTRACT=Object.freeze({disposableOnly:true,simulatedRoles:true,usesActualLowPrivilegeLogins:true,
 productionRLSDeployed:false,storageWired:false,productionReady:false,releaseDecision:'NO_GO',migrationDecision:'HOLD'});
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 assertR100Disposable(process.env);
 const {default:pg}=await import('pg');const pools=[];
 const poolFor=user=>{assert.ok(user==='postgres'||R100_USERS.some(x=>x.user===user),'R100_UNAPPROVED_ROLE');
  const p=new pg.Pool({host:'127.0.0.1',port:5432,user,
   password:user==='postgres'?'disposable-r93s-ci-only':'r100-local-test-role-only',
   database:R100_DB,max:2,connectionTimeoutMillis:3000,idleTimeoutMillis:1000,
   application_name:'car02_r100_disposable_pg17_only'});pools.push(p);return p;};
 try{await runR100TenantChallenge(poolFor)}finally{await Promise.all(pools.map(p=>p.end()));}
}
