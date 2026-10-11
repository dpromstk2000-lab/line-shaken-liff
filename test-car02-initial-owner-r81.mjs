import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCar02InitialOwnerIsolatedR81} from './car02-initial-owner-r81.mjs';
const SHOP='street_house_kitsuki';
const ID='22222222-2222-4222-8222-222222222222';
const R1='11111111-1111-4111-8111-111111111111';
const R2='33333333-3333-4333-8333-333333333333';
const REQUEST='44444444-4444-4444-8444-444444444444';
const T=1800000000;
const input={candidateUserSub:ID,requestId:REQUEST,reason:'Initial owner registration after independent written review'};
const identity=()=>({verified:true,userSub:ID,active:true,isAnonymous:false,deleted:false,banned:false,source:'SUPABASE_AUTH_SERVER'});
const approvals=()=>({verified:true,source:'CENTRAL_VERIFIED_REVIEW',shopCode:SHOP,candidateUserSub:ID,requestId:REQUEST,issuedAtSec:T-300,expiresAtSec:T+300,approvers:[
  {userSub:R1,verified:true,role:'central_reviewer',approvedAtSec:T-250},
  {userSub:R2,verified:true,role:'central_reviewer',approvedAtSec:T-200}
]});
function dbMock({dbName='car02_r81_qa_pg17',shopExists=true,staffRows=0,grantWrong=false,auditFail=false,auditMissing=false,driverFail=false,connectFail=false,identityDbMissing=false}={}) {
 const calls=[];let commits=0,rollbacks=0,connections=0,releases=0, grantCount=staffRows,auditRows=0,snapshot;
 const query=async (sql,params=[]) => {
  calls.push({sql,params});
  if(sql==='BEGIN'){snapshot={grantCount,auditRows};return {rows:[]}}
  if(sql==='ROLLBACK'){rollbacks++;({grantCount,auditRows}=snapshot);return {rows:[]}}
  if(sql==='COMMIT'){commits++;return {rows:[]}}
  if(sql.startsWith('SET LOCAL'))return {rows:[]};
  if(sql.includes('current_database()'))return {rows: identityDbMissing?[]:[{name:dbName}]};
  if(sql.includes('FROM public.ksh_demo_shop_settings'))return {rows:shopExists?[{shop_code:SHOP}]:[]};
  if(sql.includes('count(*)::integer AS n'))return {rows:[{n:grantCount}]};
  if(sql.startsWith('INSERT INTO public.ksh_car02_staff_access')){
    if(driverFail)throw Error('simulated driver details/secret');
    grantCount++;
    return {rows:[{shop_code:SHOP,user_sub:ID,staff_role:grantWrong?'staff':'owner',active:true}]};
  }
  if(sql.startsWith('INSERT INTO public.ksh_car02_owner_bootstrap_audit')){
    if(auditFail)throw Error('secret audit failure');
    auditRows++;return {rows:[auditMissing?{}:{id:1}]};
  }
  throw Error('Unexpected SQL '+sql);
 };
 const pool={connect:async()=>{if(connectFail)throw Error('private connection string');connections++;return {query,release(){releases++}}}};
 return {pool,calls,get count(){return grantCount},get auditCount(){return auditRows},get stats(){return {commits,rollbacks,connections,releases}}};
}
const service=(db=dbMock(),opt={})=>createCar02InitialOwnerIsolatedR81({pool:db.pool,shopCode:SHOP,verifyCandidateAuth:async()=>identity(),loadTrustedApprovals:async()=>approvals(),nowSeconds:()=>T,...opt});
const denied=async (promise,code) => assert.rejects(promise,e=>e?.message===code);

test('R81 bootstrap requires two independent server-side reviewers',async()=>{
 const db=dbMock();const result=await service(db)(input);
 assert.deepEqual({...result},{initialized:true,shopCode:SHOP,ownerUserSub:ID,reviewOnly:true});
 assert.equal(db.count,1);assert.equal(db.auditCount,1);
 assert.deepEqual(db.stats,{commits:1,rollbacks:0,connections:1,releases:1});
 assert.deepEqual(db.calls.find(x=>x.sql.startsWith('INSERT INTO public.ksh_car02_owner_bootstrap_audit')).params,[SHOP,ID,REQUEST,R1,R2,input.reason]);
 assert.ok(db.calls.some(x=>x.sql.includes('FOR UPDATE')));
 assert.equal(db.calls.findIndex(x=>x.sql.includes('current_database()'))<db.calls.findIndex(x=>x.sql.includes('FROM public.ksh_demo_shop_settings')),true);
});
test('R81 never attempts query before trusted identity and approvals',async()=>{
 let a=0,b=0;const db=dbMock();
 await service(db,{verifyCandidateAuth:async()=>{a++;return identity()},loadTrustedApprovals:async()=>{b++;return approvals()}})(input);
 assert.equal(a,1);assert.equal(b,1);
});
test('R81 rejects production-named database before any grant',async()=>{
 for(const name of ['postgres','liff-salon-reserve','car02_r81_qa','car02_r81_qa_PRODUCTION','car02_r81_qa_p;DROP TABLE x']){
  const db=dbMock({dbName:name});await denied(service(db)(input),'CAR02_R81_ISOLATION_REQUIRED');
  assert.equal(db.count,0);assert.equal(db.auditCount,0);assert.equal(db.stats.rollbacks,1);
 }
});
test('R81 rejects missing current_database response',async()=>{const db=dbMock({identityDbMissing:true});await denied(service(db)(input),'CAR02_R81_ISOLATION_REQUIRED');assert.equal(db.count,0)});
test('R81 rejects absent shop with rollback',async()=>{const db=dbMock({shopExists:false});await denied(service(db)(input),'CAR02_R81_SHOP_NOT_FOUND');assert.equal(db.stats.rollbacks,1)});
test('R81 refuses second bootstrap even with INACTIVE existing staff row',async()=>{const db=dbMock({staffRows:1});await denied(service(db)(input),'CAR02_R81_ALREADY_INITIALIZED');assert.equal(db.count,1);assert.equal(db.auditCount,0)});
test('R81 rejects malformed candidate UUID before connecting',async()=>{const db=dbMock();await denied(service(db)({...input,candidateUserSub:'bad'}),'CAR02_R81_INPUT_INVALID');assert.equal(db.stats.connections,0)});
test('R81 rejects malformed request UUID before connecting',async()=>{const db=dbMock();await denied(service(db)({...input,requestId:'bad'}),'CAR02_R81_INPUT_INVALID');assert.equal(db.stats.connections,0)});
test('R81 rejects empty or short reason',async()=>{for(const reason of ['', 'short',' untrimmed','bad\nreason']){const db=dbMock();await denied(service(db)({...input,reason}),'CAR02_R81_REASON_REQUIRED');assert.equal(db.stats.connections,0)}});
test('R81 rejects unexpected shop code at configuration',()=>assert.throws(()=>service(dbMock(),{shopCode:'other shop'}),/CAR02_R81_CONFIG_INVALID/));
test('R81 rejects callback misconfiguration',()=>assert.throws(()=>service(dbMock(),{loadTrustedApprovals:null}),/CAR02_R81_CONFIG_INVALID/));
test('R81 identity: rejects invalid active, anonymous, deleted, banned, unverified, wrong identity',async()=>{
 const invalid=[{verified:false},{active:false},{isAnonymous:true},{isAnonymous:null},{deleted:true},{banned:true},{source:'BROWSER'}, {userSub:R1}];
 for(const d of invalid){const db=dbMock();await denied(service(db,{verifyCandidateAuth:async()=>({...identity(),...d})})(input),'CAR02_R81_IDENTITY_REJECTED');assert.equal(db.stats.connections,0)}
});
test('R81 identity verifier failure does not leak error',async()=>{const db=dbMock();await denied(service(db,{verifyCandidateAuth:async()=>{throw Error('SECRET_SUPABASE_KEY')}})(input),'CAR02_R81_IDENTITY_REJECTED');assert.equal(db.stats.connections,0)});
test('R81 approvals verifier failure does not leak error',async()=>{const db=dbMock();await denied(service(db,{loadTrustedApprovals:async()=>{throw Error('SECRET_SIGNING_KEY')}})(input),'CAR02_R81_APPROVAL_REQUIRED');assert.equal(db.stats.connections,0)});
test('R81 rejects wrong tenant/request/target in signed approval',async()=>{
 for(const d of [{shopCode:'other_shop'},{requestId:R1},{candidateUserSub:R1},{source:'CLIENT_SUBMITTED'},{verified:false}]){
  const db=dbMock();await denied(service(db,{loadTrustedApprovals:async()=>({...approvals(),...d})})(input),'CAR02_R81_APPROVAL_REQUIRED');assert.equal(db.stats.connections,0);
 }
});
test('R81 requires exactly two distinct reviewers',async()=>{
 const a=approvals();
 for(const reviewers of [[],[a.approvers[0]], [...a.approvers,a.approvers[1]],[a.approvers[0],a.approvers[0]]]){
  const db=dbMock();await denied(service(db,{loadTrustedApprovals:async()=>({...a,approvers:reviewers})})(input),'CAR02_R81_APPROVAL_REQUIRED');assert.equal(db.stats.connections,0);
 }
});
test('R81 reviewers cannot be candidate, unverified or fake roles',async()=>{
 for(const d of [{userSub:ID},{verified:false},{role:'owner'},{approvedAtSec:T+10},{approvedAtSec:T-400}]){
  const a=approvals();a.approvers[1]={...a.approvers[1],...d};const db=dbMock();
  await denied(service(db,{loadTrustedApprovals:async()=>a})(input),'CAR02_R81_APPROVAL_REQUIRED');assert.equal(db.stats.connections,0);
 }
});
test('R81 rejects expired, future-dated, and overlong approval windows',async()=>{
 for(const d of [{expiresAtSec:T},{issuedAtSec:T+1},{issuedAtSec:T-86401},{expiresAtSec:T+100000}]){
  const db=dbMock();await denied(service(db,{loadTrustedApprovals:async()=>({...approvals(),...d})})(input),'CAR02_R81_APPROVAL_REQUIRED');assert.equal(db.stats.connections,0);
 }
});
test('R81 rechecks approval after lock and at commit',async()=>{
 let i=0;const db=dbMock();const nowSeconds=()=>T+(i++>1?400:0);
 await denied(service(db,{nowSeconds})(input),'CAR02_R81_APPROVAL_REQUIRED');
 assert.equal(db.stats.rollbacks,1);assert.equal(db.count,0);assert.equal(db.auditCount,0);
});
test('R81 grant mismatch triggers rollback of changes',async()=>{const db=dbMock({grantWrong:true});await denied(service(db)(input),'CAR02_R81_GRANT_FAILED');assert.equal(db.stats.rollbacks,1);assert.equal(db.count,0)});
test('R81 failed audit atomically rolls back grant',async()=>{const db=dbMock({auditFail:true});await denied(service(db)(input),'CAR02_R81_BOOTSTRAP_BLOCKED');assert.equal(db.stats.rollbacks,1);assert.equal(db.count,0)});
test('R81 invalid audit return rolls back grant',async()=>{const db=dbMock({auditMissing:true});await denied(service(db)(input),'CAR02_R81_AUDIT_FAILED');assert.equal(db.count,0);assert.equal(db.auditCount,0)});
test('R81 database driver errors never reveal secret',async()=>{const db=dbMock({driverFail:true});await denied(service(db)(input),'CAR02_R81_BOOTSTRAP_BLOCKED');assert.equal(db.count,0)});
test('R81 connection errors never reveal connection string',async()=>{const db=dbMock({connectFail:true});await denied(service(db)(input),'CAR02_R81_BOOTSTRAP_BLOCKED');assert.equal(db.stats.connections,0)});
test('R81 no HTTP handlers, browser credentials, or release overrides in module',()=>{
 const text=readFileSync(new URL('./car02-initial-owner-r81.mjs',import.meta.url),'utf8');
 assert.ok(!/export\s+default\s*\{|createServer\(|\.listen\(|request\.headers/.test(text));
 assert.ok(!/CAR02_RELEASE_LOCK\s*=\s*false/.test(text));
 assert.ok(!/fetch\(|service_role_key|SUPABASE_SERVICE_ROLE_KEY/.test(text));
});
test('R81 SQL includes strong disposable database identity guard',()=>{
 const sql=readFileSync(new URL('./R81_INITIAL_OWNER_BOOTSTRAP_QA_ONLY.sql',import.meta.url),'utf8');
 assert.match(sql,/current_database\(\)/);assert.match(sql,/RAISE EXCEPTION 'CAR02_R81_ISOLATION_REQUIRED'/);
 assert.match(sql,/UNIQUE \(shop_code\)/);assert.match(sql,/UNIQUE \(request_id\)/);
 assert.match(sql,/REVOKE ALL .* FROM PUBLIC, anon, authenticated/);
 assert.doesNotMatch(sql,/GRANT (?:UPDATE|DELETE) ON public\.ksh_car02_owner_bootstrap_audit/);
});
test('R81 module performs zero database queries on rejected identity/approval',async()=>{
 const db=dbMock();await denied(service(db,{loadTrustedApprovals:async()=>({})})(input),'CAR02_R81_APPROVAL_REQUIRED');assert.equal(db.calls.length,0);
});
test('R81 fails closed for missing prior staff schema through rollback',async()=>{
 const db=dbMock({driverFail:true});await denied(service(db)(input),'CAR02_R81_BOOTSTRAP_BLOCKED');assert.equal(db.stats.rollbacks,1);
});
