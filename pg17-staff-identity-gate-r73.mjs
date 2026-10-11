// DPRO CAR02 R73 — R72 identity fail-closed gate on disposable PostgreSQL 17.
// QA ONLY; creates no external data and MUST NOT execute against Supabase/production.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {createCar02StaffPermissionsR70} from './car02-staff-permissions-r70.mjs';

const guarded = process.env.GITHUB_ACTIONS==='true' &&
  process.env.CAR02_CI_EPHEMERAL_R73==='1' &&
  process.env.PGHOST==='127.0.0.1' &&
  process.env.PGDATABASE==='car02_qa' &&
  process.env.PGUSER==='postgres' &&
  process.env.PGPORT==='5432' &&
  process.env.PGPASSWORD==='qa_only_local' &&
  !process.env.DATABASE_URL && !process.env.SUPABASE_DB_URL;
if(!guarded)throw Error('R73_DISPOSABLE_GITHUB_ACTIONS_ONLY');

const SHOP='street_house_kitsuki';
const OWNER='11111111-1111-4111-8111-111111111111';
const STAFF='22222222-2222-4222-8222-222222222222';
const actor=Object.freeze({verified:true,role:'owner',shopCode:SHOP,subject:`staff:${OWNER}`});
const enable=Object.freeze({actor,targetUserSub:STAFF,nextRole:'staff',nextActive:true,expectedRole:'staff',expectedActive:false,reason:'R73レビュー環境での権限再有効化'});
const disable=Object.freeze({...enable,expectedActive:true,nextActive:false,reason:'R73レビュー環境での退職無効化'});
const good=()=>({verified:true,userSub:STAFF,active:true,isAnonymous:false});
const db=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',password:'qa_only_local',database:'car02_qa',max:3,connectionTimeoutMillis:4000});
let passed=0;
const mark=name=>console.log(`PASS R73 PG17 ${++passed}: ${name}`);
const sql=(q,args=[])=>db.query(q,args);
const state=async()=>{
  const [s,a]=await Promise.all([
    sql('SELECT staff_role,active FROM public.ksh_car02_staff_access WHERE shop_code=$1 AND user_sub=$2',[SHOP,STAFF]),
    sql('SELECT count(*)::integer AS n FROM public.ksh_car02_staff_access_audit WHERE shop_code=$1 AND target_user_sub=$2',[SHOP,STAFF])
  ]);
  return {role:s.rows[0]?.staff_role,active:s.rows[0]?.active,audits:a.rows[0]?.n};
};
const service=(verifyTargetIdentity,onConnect=()=>{})=>createCar02StaffPermissionsR70({
  shopCode:SHOP,verifyTargetIdentity,pool:{connect:async()=>{onConnect();return db.connect()}}
});
const denyCode=(request,code)=>assert.rejects(request,error=>error?.message===code);
const strictCases=[
  ['missing isAnonymous',()=>{const p=good();delete p.isAnonymous;return p}],
  ['undefined isAnonymous',()=>({...good(),isAnonymous:undefined})],
  ['null isAnonymous',()=>({...good(),isAnonymous:null})],
  ['anonymous true',()=>({...good(),isAnonymous:true})],
  ['string false',()=>({...good(),isAnonymous:'false'})],
  ['numeric zero',()=>({...good(),isAnonymous:0})],
  ['object isAnonymous',()=>({...good(),isAnonymous:{}})],
  ['inactive identity',()=>({...good(),active:false})],
  ['wrong identity UUID',()=>({...good(),userSub:OWNER})],
];

try{
  const meta=(await sql('SELECT current_database() AS db, current_user AS dbuser, version() AS pg_version')).rows[0];
  assert.equal(meta.db,'car02_qa');assert.equal(meta.dbuser,'postgres');assert.match(meta.pg_version,/PostgreSQL 17\./);
  mark('disposable PostgreSQL 17 environment verified');

  // Synthetic schemas copied from the repository; no connection to Supabase or real shops.
  for(const file of ['BASELINE_QA_ONLY.sql','R13_MIGRATION_QA_ONLY.sql','R46_STAFF_GRANTS_QA_ONLY.sql','R70_STAFF_PERMISSION_AUDIT_QA_ONLY.sql']){
    const body=readFileSync(new URL(`./${file}`,import.meta.url),'utf8');
    assert.match(body,/QA|TEST ONLY/i);
    await sql(body);
  }
  mark('isolated R13 / R46 / R70 schemas loaded');

  await sql(`INSERT INTO public.ksh_car02_staff_access(shop_code,user_sub,staff_role,active)
    VALUES($1,$2,'owner',true),($1,$3,'staff',false)`,[SHOP,OWNER,STAFF]);
  assert.deepEqual(await state(),{role:'staff',active:false,audits:0});
  mark('staff initially inactive with empty audit history');

  for(const [label,profile] of strictCases){
    let connects=0,calls=0;
    const fn=service(async({userSub})=>{calls++;assert.equal(userSub,STAFF);return profile()},()=>connects++);
    await denyCode(fn(enable),'CAR02_IDENTITY_REJECTED');
    assert.equal(calls,1);assert.equal(connects,0);
    assert.deepEqual(await state(),{role:'staff',active:false,audits:0});
    mark(`${label} rejected before DB connection; grant/audit unchanged`);
  }
  let connectOnFailure=0;
  await denyCode(service(async()=>{throw Error('AUTH_UPSTREAM_PRIVATE_MESSAGE')},()=>connectOnFailure++)(enable),'CAR02_IDENTITY_REJECTED');
  assert.equal(connectOnFailure,0);assert.deepEqual(await state(),{role:'staff',active:false,audits:0});
  mark('upstream identity exception sanitized; DB untouched');

  const grant=service(async()=>good());
  assert.equal((await grant(enable)).changed,true);
  assert.deepEqual(await state(),{role:'staff',active:true,audits:1});
  mark('explicit verified active nonanonymous identity enables grant with one audit');

  // Repeating an unchanged grant must not append history; stale client state must fail.
  assert.equal((await grant({...enable,expectedActive:true})).changed,false);
  assert.deepEqual(await state(),{role:'staff',active:true,audits:1});
  await denyCode(grant(enable),'CAR02_GRANT_STALE_VERSION');
  assert.deepEqual(await state(),{role:'staff',active:true,audits:1});
  mark('idempotent repeat and stale state never duplicate audit');

  let unexpectedVerify=0;
  const revoke=service(async()=>{unexpectedVerify++;throw Error('deleted_auth_subject')});
  assert.equal((await revoke(disable)).changed,true);
  assert.equal(unexpectedVerify,0);
  assert.deepEqual(await state(),{role:'staff',active:false,audits:2});
  mark('revocation works after Auth deletion and remains audited');

  const grants=(await sql(`SELECT relrowsecurity FROM pg_class WHERE oid='public.ksh_car02_staff_access_audit'::regclass`)).rows[0];
  assert.equal(grants.relrowsecurity,true);
  const blocked=(await sql(`SELECT has_table_privilege('anon','public.ksh_car02_staff_access_audit','SELECT') AS anon_read,
   has_table_privilege('authenticated','public.ksh_car02_staff_access_audit','INSERT') AS authenticated_write`)).rows[0];
  assert.deepEqual(blocked,{anon_read:false,authenticated_write:false});
  mark('audit RLS and no browser-facing table permissions');
  console.log(`R73 STAFF IDENTITY PG17: ${passed} PASS; ephemeral postgres only, production untouched`);
}catch(err){console.error('R73 STAFF IDENTITY PG17 FAILED:',err?.message||String(err));process.exitCode=1;}
finally{await db.end();}
