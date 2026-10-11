import test from 'node:test';
import assert from 'node:assert/strict';
import {createCar02StaffPermissionsR70} from './car02-staff-permissions-r70.mjs';

// Synthetic-only R72 regression. No network, no customer records, no production DB.
const shopCode='street_house_kitsuki';
const owner='11111111-1111-4111-8111-111111111111';
const subject='22222222-2222-4222-8222-222222222222';
const actor=Object.freeze({verified:true,shopCode,role:'owner',subject:`staff:${owner}`});
const good=()=>({verified:true,userSub:subject,active:true,isAnonymous:false});
const reactivate=Object.freeze({actor,targetUserSub:subject,expectedRole:'staff',expectedActive:false,nextRole:'staff',nextActive:true,reason:'休職終了による再有効化の確認'});
const revoke=Object.freeze({...reactivate,expectedActive:true,nextActive:false,reason:'退職によるスタッフ権限の無効化'});
function db(initialActive=false){
 let opened=0,commits=0,rolled=0,audits=0,state=initialActive;
 const queries=[];
 const pool={connect:async()=>{
  opened++;
  return {query:async(q,params=[])=>{
   queries.push({q,params});
   if(q==='BEGIN'||q.startsWith('SET LOCAL'))return {rows:[]};
   if(q==='COMMIT'){commits++;return {rows:[]}}
   if(q==='ROLLBACK'){rolled++;state=initialActive;return {rows:[]}}
   if(q.includes('FROM public.ksh_demo_shop_settings'))return {rows:[{shop_code:shopCode}]};
   if(q.includes('FROM public.ksh_car02_staff_access')&&q.includes('user_sub=$2')){
    if(params[1]===owner)return {rows:[{user_sub:owner,staff_role:'owner',active:true}]};
    return {rows:[{user_sub:subject,staff_role:'staff',active:state}]};
   }
   if(q.startsWith('UPDATE public.ksh_car02_staff_access')){state=params[3];return {rows:[{shop_code:shopCode,user_sub:subject,staff_role:'staff',active:state}]}}
   if(q.startsWith('INSERT INTO public.ksh_car02_staff_access_audit')){audits++;return {rows:[{id:audits}]}}
   throw Error('unexpected_sql');
  },release() {}};
 }};
 return {pool,queries,get stats(){return {opened,commits,rolled,audits,active:state}}};
}
async function denied(value){
 const x=db();let verified=0;
 const fn=createCar02StaffPermissionsR70({pool:x.pool,shopCode,verifyTargetIdentity:async()=>{verified++;return value}});
 await assert.rejects(fn(reactivate),e=>e?.message==='CAR02_IDENTITY_REJECTED');
 assert.deepEqual(x.stats,{opened:0,commits:0,rolled:0,audits:0,active:false},'invalid identity must not reach database');
 assert.equal(verified,1);
}
const failures=[
 ['missing isAnonymous',()=>{const x=good();delete x.isAnonymous;return x}],
 ['undefined isAnonymous',()=>({...good(),isAnonymous:undefined})],
 ['null isAnonymous',()=>({...good(),isAnonymous:null})],
 ['true isAnonymous',()=>({...good(),isAnonymous:true})],
 ['string false isAnonymous',()=>({...good(),isAnonymous:'false'})],
 ['numeric zero isAnonymous',()=>({...good(),isAnonymous:0})],
 ['array isAnonymous',()=>({...good(),isAnonymous:[]})],
 ['object isAnonymous',()=>({...good(),isAnonymous:{}})],
 ['nonverified profile',()=>({...good(),verified:false})],
 ['inactive profile',()=>({...good(),active:false})],
 ['wrong identity UUID',()=>({...good(),userSub:owner})],
];
for(const [name,factory] of failures){
 test(`R72 fail closed: ${name}`,async()=>denied(factory()));
}
test('R72 verified, active, explicit nonanonymous staff is reactivated and audited',async()=>{
 const x=db();let calls=0;
 const fn=createCar02StaffPermissionsR70({pool:x.pool,shopCode,verifyTargetIdentity:async({userSub})=>{
  calls++;assert.equal(userSub,subject);return good();
 }});
 const r=await fn(reactivate);
 assert.equal(r.changed,true);
 assert.deepEqual(x.stats,{opened:1,commits:1,rolled:0,audits:1,active:true});
 assert.equal(calls,1);
});
test('R72 revoked Auth identity still supports disabling an existing staff grant',async()=>{
 const x=db(true);let calls=0;
 const fn=createCar02StaffPermissionsR70({pool:x.pool,shopCode,verifyTargetIdentity:async()=>{
  calls++;throw Error('auth_account_deleted');
 }});
 const result=await fn(revoke);
 assert.equal(result.changed,true);
 assert.deepEqual(x.stats,{opened:1,commits:1,rolled:0,audits:1,active:false});
 assert.equal(calls,0);
});
test('R72 verifier exception returns safe domain error and no DB access',async()=>{
 const x=db();const fn=createCar02StaffPermissionsR70({pool:x.pool,shopCode,verifyTargetIdentity:async()=>{throw Error('sensitive_auth_provider_failure')}});
 await assert.rejects(fn(reactivate),e=>e?.message==='CAR02_IDENTITY_REJECTED');
 assert.equal(x.stats.opened,0);
});
