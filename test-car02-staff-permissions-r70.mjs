import test from 'node:test';
import assert from 'node:assert/strict';
import {createCar02StaffPermissionsR70} from './car02-staff-permissions-r70.mjs';

const SHOP='street_house_kitsuki';
const OWNER='11111111-1111-4111-8111-111111111111';
const TARGET='22222222-2222-4222-8222-222222222222';
const actor=Object.freeze({verified:true,role:'owner',shopCode:SHOP,subject:'staff:'+OWNER});
const request={actor,targetUserSub:TARGET,expectedRole:'staff',expectedActive:true,nextRole:'staff',nextActive:false,reason:'退職によるスタッフ権限の停止'};
const verified=async({userSub})=>({verified:true,userSub,active:true,isAnonymous:false});
function mock({ownerActive=true,targetRole='staff',targetActive=true,ownerCount=2,shopExists=true,targetExists=true,ownerRole='owner',failAudit=false,writeError=false,missingAuditId=false}={}){
 const queries=[],audit=[],state={targetRole,targetActive,ownerCount};
 let connected=0,committed=0,rolledBack=0,released=0,before;
 const query=async(sql,params=[])=>{
  queries.push({sql,params});
  if(sql==='BEGIN'){before={...state};return {rows:[]}}
  if(sql==='COMMIT'){committed++;return {rows:[]}}
  if(sql==='ROLLBACK'){rolledBack++;Object.assign(state,before);audit.length=0;return {rows:[]}}
  if(sql.startsWith('SET LOCAL'))return {rows:[]};
  if(sql.includes('FROM public.ksh_demo_shop_settings'))return {rows:shopExists?[{shop_code:SHOP}]:[]};
  if(sql.includes('FROM public.ksh_car02_staff_access')&&sql.includes('user_sub=$2')){
    if(params[1]===OWNER)return {rows:[{user_sub:OWNER,staff_role:ownerRole,active:ownerActive}]};
    return {rows:targetExists?[{user_sub:TARGET,staff_role:state.targetRole,active:state.targetActive}]:[]};
  }
  if(sql.includes('count(*)::integer AS n'))return {rows:[{n:state.ownerCount}]};
  if(sql.startsWith('UPDATE public.ksh_car02_staff_access')){
    if(writeError)throw Error('DB_DRIVER_SECRET');
    state.targetRole=params[2];state.targetActive=params[3];return {rows:[{shop_code:SHOP,user_sub:TARGET,staff_role:params[2],active:params[3]}]};
  }
  if(sql.startsWith('INSERT INTO public.ksh_car02_staff_access_audit')){
    if(failAudit)throw Error('AUDIT_DB_SECRET');
    audit.push(params);return {rows:[missingAuditId?{}:{id:1}]};
  }
  throw Error('Unexpected SQL: '+sql);
 };
 const pool={connect:async()=>{connected++;return {query,release:()=>{released++}}}};
 return {pool,queries,audit,state,get stats(){return {connected,committed,rolledBack,released}}};
}
const service=(db,verifyTargetIdentity=verified)=>createCar02StaffPermissionsR70({pool:db.pool,shopCode:SHOP,verifyTargetIdentity});
const denies=async(run,code)=>assert.rejects(run, e=>e?.message===code);

test('R70 owner can revoke active staff; permission mutation and audit share one transaction',async()=>{
 const db=mock();const result=await service(db)(request);
 assert.deepEqual({...result},{changed:true,shopCode:SHOP,targetUserSub:TARGET,role:'staff',active:false});
 assert.equal(db.state.targetActive,false);
 assert.equal(db.audit.length,1);
 assert.deepEqual(db.audit[0],[SHOP,TARGET,OWNER,'staff',true,'staff',false,request.reason]);
 assert.deepEqual(db.stats,{connected:1,committed:1,rolledBack:0,released:1});
 assert.ok(db.queries.find(x=>x.sql.includes('shop_code=$1 FOR UPDATE')));
 assert.ok(db.queries.find(x=>x.sql.includes('staff_access')&&x.sql.includes('FOR UPDATE')));
});

test('R70 revoked or deleted Auth user can still be disabled',async()=>{
 const db=mock();let called=0;
 await service(db,async()=>{called++;throw Error('auth deleted')})(request);
 assert.equal(called,0);assert.equal(db.state.targetActive,false);
});

test('R70 reenabling inactive staff requires verified active nonanonymous Auth user',async()=>{
 const options={...request,expectedActive:false,nextActive:true,reason:'勤務復帰に伴う権限の再有効化'};
 for(const verify of [async()=>({verified:false,userSub:TARGET,active:true}),async()=>({verified:true,userSub:TARGET,active:false}),async()=>({verified:true,userSub:TARGET,active:true,isAnonymous:true}),async()=>({verified:true,userSub:OWNER,active:true}),async()=>{throw Error('remote failure')}]){
   const db=mock({targetActive:false});await denies(service(db,verify)(options),'CAR02_IDENTITY_REJECTED');assert.equal(db.stats.connected,0);
 }
 const db=mock({targetActive:false});await service(db)(options);assert.equal(db.state.targetActive,true);
});

test('R70 self-revocation forbidden even if authenticated owner',async()=>{
 const db=mock();await denies(service(db)({...request,targetUserSub:OWNER}),'CAR02_OWNER_SELF_CHANGE_DENIED');assert.equal(db.stats.connected,0);
});

test('R70 cannot rely on role claimed by client: owner role and server-authenticated principal required',async()=>{
 for(const identity of [{...actor,verified:false},{...actor,role:'staff'},{...actor,shopCode:'another_shop'},{...actor,subject:'staff:bad-id'},{...actor,subject:'line:'+OWNER},null]){
  const db=mock();await denies(service(db)({...request,actor:identity}),'CAR02_OWNER_REQUIRED');assert.equal(db.stats.connected,0);
 }
});

test('R70 requires current active owner grant in DB even with verified Supabase JWT',async()=>{
 for(const opt of [{ownerActive:false},{ownerRole:'staff'}]){
  const db=mock(opt);await denies(service(db)(request),'CAR02_OWNER_REQUIRED');assert.equal(db.stats.rolledBack,1);assert.equal(db.audit.length,0);
 }
});

test('R70 missing tenant or missing target grant never silently provisions staff',async()=>{
 for(const [opt,code] of [[{shopExists:false},'CAR02_SHOP_NOT_FOUND'],[{targetExists:false},'CAR02_STAFF_NOT_FOUND']]){
  const db=mock(opt);await denies(service(db)(request),code);assert.equal(db.stats.rolledBack,1);assert.equal(db.audit.length,0);
 }
});

test('R70 last active owner cannot be disabled or demoted',async()=>{
 for(const change of [{nextRole:'staff',nextActive:true},{nextRole:'owner',nextActive:false}]){
  const db=mock({targetRole:'owner',targetActive:true,ownerCount:1});
  await denies(service(db)({...request,expectedRole:'owner',...change}),'CAR02_OWNER_LAST_ACTIVE_REQUIRED');
  assert.equal(db.stats.rolledBack,1);assert.equal(db.audit.length,0);
 }
});

test('R70 demotion of owner with two active owners records audit',async()=>{
 const db=mock({targetRole:'owner',ownerCount:2});
 await service(db)({...request,expectedRole:'owner',nextRole:'staff',nextActive:true,reason:'管理責任者の交代による権限変更'});
 assert.equal(db.state.targetRole,'staff');assert.equal(db.audit.length,1);
 assert.equal(db.stats.committed,1);
});

test('R70 stale expected role or active value fails before mutation',async()=>{
 for(const patch of [{expectedRole:'owner'},{expectedActive:false}]){
 const db=mock();await denies(service(db)({...request,...patch}),'CAR02_GRANT_STALE_VERSION');
 assert.equal(db.stats.rolledBack,1);assert.equal(db.audit.length,0);
 }
});

test('R70 identical repeat is idempotent, no new audit row or update',async()=>{
 const db=mock({targetActive:false});const res=await service(db)({...request,expectedActive:false});
 assert.equal(res.changed,false);assert.equal(db.audit.length,0);
 assert.equal(db.stats.committed,1);assert.ok(!db.queries.some(x=>x.sql.startsWith('UPDATE')));
});

test('R70 audit insert failure rolls back the permission update atomically',async()=>{
 for(const options of [{failAudit:true},{missingAuditId:true}]){
 const db=mock(options);await denies(service(db)(request),options.failAudit?'CAR02_GRANT_BLOCKED':'CAR02_AUDIT_WRITE_FAILED');
 assert.equal(db.state.targetActive,true);assert.equal(db.stats.rolledBack,1);assert.equal(db.stats.committed,0);
 assert.equal(db.stats.released,1);
 }
});

test('R70 update error is sanitized and transaction rolls back',async()=>{
 const db=mock({writeError:true});await denies(service(db)(request),'CAR02_GRANT_BLOCKED');assert.equal(db.stats.rolledBack,1);
});

test('R70 reason, tenant and role validation rejects malformed values before DB transaction',async()=>{
 for(const patch of [{reason:''},{reason:'ok'},{reason:'  has spaces'},{reason:'break\nline'},{nextRole:'admin'},{nextActive:'false'},{targetUserSub:'other'},{expectedRole:'superadmin'}]){
  const db=mock(); await assert.rejects(service(db)({...request,...patch}));assert.equal(db.stats.connected,0);
 }
});

test('R70 shop lock is acquired before membership queries and transaction commit',async()=>{
 const db=mock();await service(db)(request);
 const all=db.queries.map(x=>x.sql);
 const shop=all.findIndex(x=>x.includes('FROM public.ksh_demo_shop_settings'));
 const member=all.findIndex(x=>x.includes('FROM public.ksh_car02_staff_access'));
 const mutation=all.findIndex(x=>x.startsWith('UPDATE public.ksh_car02_staff_access'));
 const audit=all.findIndex(x=>x.startsWith('INSERT INTO public.ksh_car02_staff_access_audit'));
 const commit=all.findIndex(x=>x==='COMMIT');
 assert.ok(shop>0&&member>shop&&mutation>member&&audit>mutation&&commit>audit);
});

test('R70 fails closed without transaction pool and trusted identity verifier',()=>{
 assert.throws(()=>createCar02StaffPermissionsR70({pool:{query:async()=>{}},shopCode:SHOP,verifyTargetIdentity:verified}),/CAR02_GRANT_CONFIG_INVALID/);
 assert.throws(()=>createCar02StaffPermissionsR70({pool:mock().pool,shopCode:SHOP}),/CAR02_GRANT_CONFIG_INVALID/);
});

test('R70 reviewed audit schema has no frontend access, enables RLS, and is not production automation',async()=>{
 const {readFileSync}=await import('node:fs');
 const sql=readFileSync(new URL('./R70_STAFF_PERMISSION_AUDIT_QA_ONLY.sql',import.meta.url),'utf8');
 assert.match(sql,/DO NOT APPLY TO PRODUCTION/);
 assert.match(sql,/CREATE TABLE public\.ksh_car02_staff_access_audit/);
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/REVOKE ALL ON public\.ksh_car02_staff_access_audit FROM PUBLIC, anon, authenticated/);
 assert.match(sql,/GRANT SELECT,INSERT ON public\.ksh_car02_staff_access_audit TO service_role/);
 assert.doesNotMatch(sql,/GRANT[^;]*\b(?:anon|authenticated)\b\s*;/i);
});
