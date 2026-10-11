// DPRO CAR02 R71 / real isolated PostgreSQL 17 staff + audit integration.
// CI DISPOSABLE DATABASE ONLY. No real identity, production URLs, or external tokens.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import {createCar02StaffPermissionsR70} from './car02-staff-permissions-r70.mjs';
import {createDbStaffMembershipLookupR46} from './car02-auth-providers-r46.mjs';

const GUARD=process.env.GITHUB_ACTIONS==='true' &&
  process.env.CAR02_CI_EPHEMERAL_R71==='1' &&
  process.env.PGDATABASE==='car02_qa' &&
  ['127.0.0.1','localhost'].includes(process.env.PGHOST) &&
  process.env.PGUSER==='postgres' &&
  Number(process.env.PGPORT)==5432;
if(!GUARD)throw Error('R71_EPHEMERAL_GITHUB_ACTIONS_ONLY');

const shop='street_house_kitsuki', otherShop='other_shop';
const OWNER='11111111-1111-4111-8111-111111111111';
const TARGET='22222222-2222-4222-8222-222222222222';
const SECOND_OWNER='33333333-3333-4333-8333-333333333333';
const OTHER='44444444-4444-4444-8444-444444444444';
const reason='スタッフ権限変更のR71実DB検証';
const actor=Object.freeze({verified:true,role:'owner',shopCode:shop,subject:`staff:${OWNER}`});
const verifyTargetIdentity=async({userSub})=>({verified:true,userSub,active:true,isAnonymous:false});
const pool=new pg.Pool({host:process.env.PGHOST,port:5432,user:'postgres',database:'car02_qa',password:process.env.PGPASSWORD,max:4,connectionTimeoutMillis:4000,idleTimeoutMillis:4000});
let passed=0;
const ok=(label)=>console.log(`PASS R71 PG17 ${++passed}: ${label}`);
const assertCode=async(promise,code)=>assert.rejects(promise,error=>error?.message===code);
const sql=async(query,params=[])=>pool.query(query,params);
const read=async()=> (await sql(`SELECT staff_role,active FROM public.ksh_car02_staff_access WHERE shop_code=$1 AND user_sub=$2`,[shop,TARGET])).rows[0];
const auditCount=async()=>Number((await sql(`SELECT count(*)::integer AS count FROM public.ksh_car02_staff_access_audit WHERE shop_code=$1 AND target_user_sub=$2`,[shop,TARGET])).rows[0].count);
const expected=(expectedRole,expectedActive,nextRole,nextActive)=>({actor,targetUserSub:TARGET,expectedRole,expectedActive,nextRole,nextActive,reason});
const service=createCar02StaffPermissionsR70({pool,shopCode:shop,verifyTargetIdentity});

try{
  const context=await sql('SELECT current_database() AS db, current_user AS db_user, inet_server_addr()::text AS ip, version() AS version');
  assert.equal(context.rows[0].db,'car02_qa');assert.equal(context.rows[0].db_user,'postgres');
  assert.match(context.rows[0].version,/PostgreSQL 17\./);
  // Dockerized postgres:17 reports its container/bridge interface here, not
  // necessarily loopback. Safety is enforced by exact PGHOST, database,
  // account and GitHub-only CI env checks above, before connecting.
  ok('local ephemeral PostgreSQL 17 safety guard');

  for(const filename of ['BASELINE_QA_ONLY.sql','R13_MIGRATION_QA_ONLY.sql','R46_STAFF_GRANTS_QA_ONLY.sql','R70_STAFF_PERMISSION_AUDIT_QA_ONLY.sql']){
    const source=readFileSync(new URL(`./${filename}`,import.meta.url),'utf8');
    if(!source.includes('QA') && filename!=='BASELINE_QA_ONLY.sql')throw Error('R71_NON_QA_SCHEMA_REJECTED');
    await sql(source);
  }
  ok('R13 + R46 + R70 isolated schema chain applied without production access');

  const guards=await sql(`SELECT
    (SELECT relrowsecurity FROM pg_class WHERE oid='public.ksh_car02_staff_access_audit'::regclass) AS audit_rls,
    (SELECT relrowsecurity FROM pg_class WHERE oid='public.ksh_car02_staff_access'::regclass) AS membership_rls,
    has_table_privilege('anon','public.ksh_car02_staff_access_audit','SELECT') AS anon_read,
    has_table_privilege('authenticated','public.ksh_car02_staff_access_audit','INSERT') AS auth_write,
    has_table_privilege('service_role','public.ksh_car02_staff_access_audit','INSERT') AS server_insert,
    has_table_privilege('service_role','public.ksh_car02_staff_access_audit','DELETE') AS server_delete`);
  assert.deepEqual(guards.rows[0],{audit_rls:true,membership_rls:true,anon_read:false,auth_write:false,server_insert:true,server_delete:false});
  ok('membership/audit RLS enabled and frontend audit access forbidden');

  await sql(`INSERT INTO public.ksh_car02_staff_access(shop_code,user_sub,staff_role,active) VALUES
    ($1,$2,'owner',true),($1,$3,'staff',true),($1,$4,'owner',true),($5,$6,'owner',true)`,
    [shop,OWNER,TARGET,SECOND_OWNER,otherShop,OTHER]);
  assert.equal((await read()).active,true);
  ok('synthetic two-owner, one-staff, two-tenant fixture created');

  const removed=await service(expected('staff',true,'staff',false));
  assert.equal(removed.changed,true); assert.deepEqual(await read(),{staff_role:'staff',active:false});
  assert.equal(await auditCount(),1);
  const audit=(await sql(`SELECT actor_user_sub::text AS actor,target_user_sub::text AS target,before_role,before_active,after_role,after_active,reason FROM public.ksh_car02_staff_access_audit WHERE shop_code=$1 AND target_user_sub=$2`,[shop,TARGET])).rows[0];
  assert.deepEqual(audit,{actor:OWNER,target:TARGET,before_role:'staff',before_active:true,after_role:'staff',after_active:false,reason});
  ok('real transaction revokes staff and writes exact actor/previous/current audit');

  const lookup=createDbStaffMembershipLookupR46({pool});
  await assertCode(lookup({shopCode:shop,userSub:TARGET}),'CAR02_IDENTITY_REJECTED');
  ok('revoked staff blocked by authoritative DB membership resolver');

  const before=await auditCount();
  assert.equal((await service(expected('staff',false,'staff',false))).changed,false);
  assert.equal(await auditCount(),before);
  ok('identical replay does not mutate grant or duplicate audit');

  await assertCode(service(expected('staff',true,'staff',false)),'CAR02_GRANT_STALE_VERSION');
  assert.equal(await auditCount(),before);
  ok('stale expected version denied with unchanged audit count');

  const back=await service(expected('staff',false,'staff',true));
  assert.equal(back.changed,true);assert.equal((await read()).active,true);assert.equal(await auditCount(),before+1);
  ok('verified staff reactivation is audited');

  const neverActive=createCar02StaffPermissionsR70({pool,shopCode:shop,verifyTargetIdentity:async()=>({verified:true,userSub:TARGET,active:false,isAnonymous:false})});
  await service(expected('staff',true,'staff',false));
  const x=await auditCount();
  await assertCode(neverActive(expected('staff',false,'staff',true)),'CAR02_IDENTITY_REJECTED');
  assert.equal(await auditCount(),x);assert.equal((await read()).active,false);
  ok('disabled target Auth identity fails before reactivation');

  await assertCode(service({...expected('staff',false,'staff',true),actor:{...actor,role:'staff'}}),'CAR02_OWNER_REQUIRED');
  await assertCode(service({...expected('staff',false,'staff',true),actor:{...actor,shopCode:otherShop}}),'CAR02_OWNER_REQUIRED');
  assert.equal(await auditCount(),x);
  ok('staff role spoof and cross-tenant owner actor both rejected');

  await service(expected('staff',false,'staff',true));
  assert.equal((await lookup({shopCode:shop,userSub:TARGET})).role,'staff');
  await assertCode(lookup({shopCode:otherShop,userSub:TARGET}),'CAR02_IDENTITY_REJECTED');
  ok('reactivated staff allowed only for its own shop');

  await sql(`CREATE FUNCTION public.ksh_car02_r71_test_audit_reject() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'R71_FAKE_AUDIT_DOWN'; END $$ LANGUAGE plpgsql`);
  await sql(`CREATE TRIGGER ksh_car02_r71_test_audit_reject BEFORE INSERT ON public.ksh_car02_staff_access_audit
      FOR EACH ROW EXECUTE FUNCTION public.ksh_car02_r71_test_audit_reject()`);
  const preAudit=await auditCount();
  try{
    await assertCode(service(expected('staff',true,'staff',false)),'CAR02_GRANT_BLOCKED');
    assert.equal((await read()).active,true); assert.equal(await auditCount(),preAudit);
    ok('actual failing audit trigger rolls back real membership update');
  } finally {
    await sql('DROP TRIGGER IF EXISTS ksh_car02_r71_test_audit_reject ON public.ksh_car02_staff_access_audit');
    await sql('DROP FUNCTION IF EXISTS public.ksh_car02_r71_test_audit_reject()');
  }

  const elevate=await service(expected('staff',true,'owner',true));
  assert.equal(elevate.role,'owner');assert.equal((await read()).staff_role,'owner');
  ok('owner promotion records a grant and audit in same transaction');
  await service(expected('owner',true,'staff',true));
  assert.equal((await read()).staff_role,'staff');
  ok('owner demotion with remaining active owners passes and is audited');

  const parallel=await Promise.allSettled([
    service(expected('staff',true,'staff',false)),
    service(expected('staff',true,'staff',false))
  ]);
  assert.equal(parallel.filter(p=>p.status==='fulfilled').length,1);
  assert.equal(parallel.filter(p=>p.status==='rejected'&&p.reason?.message==='CAR02_GRANT_STALE_VERSION').length,1);
  assert.equal((await read()).active,false);
  ok('concurrent stale double submit results in exactly one accepted revocation');

  const privileged=await sql(`SELECT count(*)::integer AS n FROM public.ksh_car02_staff_access_audit WHERE shop_code=$1`,[otherShop]);
  assert.equal(privileged.rows[0].n,0);
  ok('audit rows never cross synthetic shop boundary');

  console.log(`R71 STAFF AUDIT PG17: ${passed} PASS; temporary postgres:17 only, production untouched`);
}catch(error){
  console.error('R71 STAFF AUDIT PG17 FAILED:',error?.message || error?.code || 'UNKNOWN');
  process.exitCode=1;
}finally{
  await pool.end();
}
