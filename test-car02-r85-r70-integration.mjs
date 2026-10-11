import test from 'node:test';
import assert from 'node:assert/strict';
import {createCar02StaffAccessHttpR85} from './car02-staff-access-http-r85.mjs';
import {createCar02StaffPermissionsR70} from './car02-staff-permissions-r70.mjs';
const SHOP='street_house_kitsuki', ORIGIN='https://staff.example.com';
const OWNER='11111111-1111-4111-8111-111111111111';
const TARGET='22222222-2222-4222-8222-222222222222';
const URL=`https://api.example.com/api/car02/staff/${TARGET}/access`;
const ACTOR=Object.freeze({verified:true,role:'owner',shopCode:SHOP,subject:'staff:'+OWNER});
const reason='退職手続きに伴うスタッフ権限変更';
const payload=(patch={})=>({...{expectedRole:'staff',expectedActive:true,nextRole:'staff',nextActive:false,reason},...patch});
function mockDb(config={}){
 const queries=[],state={targetRole:config.targetRole||'staff',targetActive:config.targetActive??true};
 const audits=[];let commits=0,rollbacks=0,releases=0,connected=0;
 const pool={async connect(){connected++;let before=null;return {
  release(){releases++},
  async query(sql,p=[]){
   queries.push({sql,p});
   if(sql==='BEGIN'){before={...state};return{rows:[]}}
   if(sql==='COMMIT'){commits++;return{rows:[]}}
   if(sql==='ROLLBACK'){rollbacks++;Object.assign(state,before);audits.length=0;return{rows:[]}}
   if(sql.startsWith('SET LOCAL'))return{rows:[]};
   if(sql==='SELECT shop_code FROM public.ksh_demo_shop_settings WHERE shop_code=$1 FOR UPDATE')
     return{rows:config.shopExists===false?[]:[{shop_code:SHOP}]};
   if(sql.includes('count(*)::integer AS n'))return{rows:[{n:config.ownerCount??2}]};
   if(sql.includes('FROM public.ksh_car02_staff_access')&&sql.includes('user_sub=$2')){
    if(p[1]===OWNER)return{rows:config.actorMissing?[]:[{user_sub:OWNER,staff_role:config.actorRole||'owner',active:config.actorActive??true}]};
    return{rows:config.targetMissing?[]:[{user_sub:TARGET,staff_role:state.targetRole,active:state.targetActive}]};
   }
   if(sql.startsWith('UPDATE public.ksh_car02_staff_access')){
    if(config.failUpdate)throw Error('super_secret_pg_dsn');
    state.targetRole=p[2];state.targetActive=p[3];
    return {rows:[{shop_code:SHOP,user_sub:TARGET,staff_role:p[2],active:p[3]}]};
   }
   if(sql.startsWith('INSERT INTO public.ksh_car02_staff_access_audit')){
    if(config.failAudit)throw Error('secret_service_key');
    audits.push(p);return{rows:config.badAuditId?[{}]:[{id:1}]};
   }
   throw Error('BAD_MOCK_SQL '+sql.slice(0,60));
  }
 }}};
 return{pool,queries,audits,state,get stats(){return{commits,rollbacks,releases,connected}}};
}
function combined(db,config={}){
 let authCount=0,verifyCount=0;
 const verifyTargetIdentity=async({userSub})=>{
  verifyCount++;
  if(config.badIdentity)throw Error('no valid auth');
  return{verified:true,userSub,active:true,isAnonymous:false};
 };
 const changeExistingStaffPermission=createCar02StaffPermissionsR70({pool:db.pool,shopCode:SHOP,verifyTargetIdentity});
 const route=createCar02StaffAccessHttpR85({shopCode:SHOP,allowedOrigins:[ORIGIN],
   releaseEnabled:async()=>config.released!==false,
   authenticate:async()=>{authCount++;return config.actor===undefined?ACTOR:config.actor},
   changeExistingStaffPermission});
 return{route,get authCount(){return authCount},get verifyCount(){return verifyCount}};
}
const request=(data=payload(),opts={})=>new Request(opts.url||URL,{method:'POST',headers:{
 origin:ORIGIN,authorization:'Bearer '+'x'.repeat(48),'content-type':'application/json',
 ...(opts.headers||{})},body:JSON.stringify(data)});
async function expectErr(route,req,status,code){const r=await route(req);assert.equal(r.status,status);assert.deepEqual(await r.json(),{ok:false,code})}

test('R85→R70 owner revoke commits permission and audit atomically',async()=>{
 const db=mockDb(),app=combined(db);const r=await app.route(request());
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true,changed:true,role:'staff',active:false});
 assert.equal(db.state.targetActive,false);assert.equal(db.audits.length,1);
 assert.deepEqual(db.audits[0],[SHOP,TARGET,OWNER,'staff',true,'staff',false,reason]);
 assert.deepEqual(db.stats,{commits:1,rollbacks:0,releases:1,connected:1});
 assert.equal(app.verifyCount,0);
 assert.ok(db.queries.some(x=>x.sql.includes('FOR UPDATE')));
});
test('R85→R70 no-op is idempotent: no second audit',async()=>{
 const db=mockDb();const app=combined(db);
 const response=await app.route(request(payload({expectedActive:true,nextActive:true})));
 assert.equal(response.status,200);assert.equal((await response.json()).changed,false);
 assert.equal(db.audits.length,0);assert.equal(db.stats.commits,1);
});
test('R85→R70 rejects stale optimistic version without any update',async()=>{
 const db=mockDb({targetActive:false});const app=combined(db);
 await expectErr(app.route,request(),409,'CAR02_PERMISSION_CONFLICT');
 assert.equal(db.state.targetActive,false);assert.equal(db.audits.length,0);assert.equal(db.stats.rollbacks,1)
});
test('R85→R70 rolls back privilege change if audit insert fails',async()=>{
 const db=mockDb({failAudit:true});const app=combined(db);
 await expectErr(app.route,request(),503,'CAR02_PERMISSION_CHANGE_UNAVAILABLE');
 assert.equal(db.state.targetActive,true);assert.equal(db.audits.length,0);assert.equal(db.stats.rollbacks,1)
});
test('R85→R70 rolls back privilege change if audit insert missing ID',async()=>{
 const db=mockDb({badAuditId:true});const app=combined(db);
 await expectErr(app.route,request(),503,'CAR02_PERMISSION_CHANGE_UNAVAILABLE');
 assert.equal(db.state.targetActive,true);assert.equal(db.stats.rollbacks,1)
});
test('R85→R70 rejects last active owner removal after database check',async()=>{
 const db=mockDb({targetRole:'owner',ownerCount:1});const app=combined(db);
 await expectErr(app.route,request(payload({expectedRole:'owner',nextRole:'staff'})),409,'CAR02_LAST_OWNER_PROTECTED');
 assert.equal(db.state.targetRole,'owner');assert.equal(db.audits.length,0)
});
test('R85→R70 blocks actor whose database owner grant is now inactive',async()=>{
 const db=mockDb({actorActive:false});const app=combined(db);
 await expectErr(app.route,request(),403,'CAR02_OWNER_REQUIRED');assert.equal(db.stats.rollbacks,1);assert.equal(db.audits.length,0)
});
test('R85→R70 blocks verified JWT role when authoritative database grants only staff',async()=>{
 const db=mockDb({actorRole:'staff'});const app=combined(db);
 await expectErr(app.route,request(),403,'CAR02_OWNER_REQUIRED');assert.equal(db.stats.rollbacks,1)
});
test('R85→R70 prevents nonexistent target grant creation',async()=>{
 const db=mockDb({targetMissing:true});const app=combined(db);
 await expectErr(app.route,request(),404,'CAR02_STAFF_NOT_FOUND');assert.equal(db.audits.length,0)
});
test('R85→R70 reactivation of staff requires independent nonanonymous active Auth identity',async()=>{
 const db=mockDb({targetActive:false});const app=combined(db);
 const r=await app.route(request(payload({expectedActive:false,nextActive:true,reason:'休職復帰に伴うスタッフ権限の再開'})));
 assert.equal(r.status,200);assert.equal(db.state.targetActive,true);assert.equal(app.verifyCount,1)
});
test('R85→R70 never reenables deleted or suspended identity',async()=>{
 const db=mockDb({targetActive:false}),app=combined(db,{badIdentity:true});
 await expectErr(app.route,request(payload({expectedActive:false,nextActive:true})),403,'CAR02_IDENTITY_REJECTED');
 assert.equal(db.stats.connected,0);assert.equal(db.audits.length,0)
});
test('R85 hard lock means no R70 database work even when actor would be approved',async()=>{
 const db=mockDb(),app=combined(db,{released:false});
 await expectErr(app.route,request(),503,'CAR02_NOT_RELEASED');assert.equal(db.stats.connected,0);assert.equal(app.authCount,0)
});
test('R85 cross-shop actor cannot contact R70 DB',async()=>{
 const db=mockDb(),app=combined(db,{actor:{...ACTOR,shopCode:'another_shop'}});
 await expectErr(app.route,request(),403,'CAR02_OWNER_REQUIRED');assert.equal(db.stats.connected,0)
});
test('R85 cannot self-modify even when actor is a valid owner',async()=>{
 const db=mockDb(),app=combined(db);
 await expectErr(app.route,request(payload(),{url:URL.replace(TARGET,OWNER)}),403,'CAR02_SELF_CHANGE_DENIED');
 assert.equal(db.stats.connected,0)
});
