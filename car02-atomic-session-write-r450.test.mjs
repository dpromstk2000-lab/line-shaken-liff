import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CAR02_V450_RELEASE_LOCK,CAR02_V450_ATOMIC_SQL,createCar02OfflineAtomicSessionWriteR450} from './car02-atomic-session-write-r450.mjs';
const shop='qa_shop_a',user='00000000-0000-0000-0000-000000004501';
const session='00000000-0000-0000-0000-000000004502';
const order='00000000-0000-0000-0000-000000004503';
const issuer='https://car02-qa.supabase.co/auth/v1',now=2_000_000_000_000;
const req=(t='synthetic-signed-token-450',mixed=false)=>new Request('https://car02.test/offline-touch',{headers:{authorization:'Bearer '+t,...(mixed?{'x-line-id-token':'synthetic-mix'}:{})}});
const params={request:req(),orderId:order,expectedVersion:1};
const denied=p=>assert.rejects(p,e=>e?.code==='CAR02_UNAUTHORIZED'&&e.status===401);
function fixture({shopCode=shop,auth=true,mode='isolated_qa',jwtValid=true,issuerOverride=issuer,
 audience='authenticated',role='authenticated',tokenExpired=false,dbThrows=false,
 rows=null,dbDelayedCommit=false,wrongSub=false,wrongSession=false}={}){
 const calls=[];let version=1,memberActive=true,sessionActive=true,fence=now-30000,sessionCreated=now-10000;
 const stored={query:async(sql,args)=>{
    calls.push({sql,args});
    if(dbThrows)throw Error('postgres network or commit ack lost');
    if(sql!==CAR02_V450_ATOMIC_SQL)throw Error('UNEXPECTED_SQL');
    if(rows)return {rows};
    const [s,u,sid,o,expected]=args;
    if(s!==shop||u!==user||sid!==session||o!==order||!memberActive||!sessionActive||
       sessionCreated<=fence||expected!==version)return {rows:[]};
    version++;
    if(dbDelayedCommit)throw Error('ack lost AFTER database committed');
    return {rows:[{applied:true,new_version:version}]};
 }};
 const api=createCar02OfflineAtomicSessionWriteR450({store:stored,expectedIssuer:issuer,nowMs:()=>now,
  authorizeShop:async()=>({verified:auth,mode,shopCode}),
  verifyJwt:async()=>({verified:jwtValid,sub:wrongSub?'00000000-0000-0000-0000-000000004509':user,
    sessionId:wrongSession?'00000000-0000-0000-0000-000000004508':session,
    issuer:issuerOverride,audience,role,expMs:tokenExpired?now:now+300000})});
 return {api,calls,get version(){return version},set active(v){memberActive=v},set sessionActive(v){sessionActive=v},set fence(v){fence=v},set sessionCreated(v){sessionCreated=v}};
}
test('V450 hard release-lock, only one exact static SQL statement',()=>{
 assert.equal(CAR02_V450_RELEASE_LOCK,true);
 assert.equal(CAR02_V450_ATOMIC_SQL,'SELECT applied,new_version FROM v450_private.qa_atomic_session_touch($1::text,$2::uuid,$3::uuid,$4::uuid,$5::integer)');
 assert.throws(()=>createCar02OfflineAtomicSessionWriteR450(),/TRUSTED_OFFLINE_CONFIG_REQUIRED/);
});
test('valid JWT + DB provider session + matching tenant CAS atomically update synthetic order',async()=>{
 const f=fixture(),r=await f.api.touch(params);
 assert.deepEqual(r,{status:'applied_review_only',newVersion:2});
 assert.ok(Object.isFrozen(r));assert.equal(f.version,2);
 assert.deepEqual(f.calls,[{sql:CAR02_V450_ATOMIC_SQL,args:[shop,user,session,order,1]}]);
});
test('repeating the same request does not double apply the synthetic business update',async()=>{
 const f=fixture();assert.equal((await f.api.touch(params)).status,'applied_review_only');
 assert.deepEqual(await f.api.touch(params),{status:'indeterminate'});
 assert.equal(f.version,2);assert.equal(f.calls.length,2);
});
test('membership revocation denies while token signature remains verified',async()=>{
 const f=fixture();f.active=false;
 assert.equal((await f.api.touch(params)).status,'indeterminate');assert.equal(f.version,1);
});
test('old provider session after renewed fence cannot authorize',async()=>{
 const f=fixture();f.fence=now+1;
 assert.equal((await f.api.touch(params)).status,'indeterminate');assert.equal(f.version,1);
});
test('provider session at fence equality is denied',async()=>{
 const f=fixture();f.fence=now-10000;
 assert.equal((await f.api.touch(params)).status,'indeterminate');assert.equal(f.version,1);
});
test('server-side terminated provider session refuses update',async()=>{
 const f=fixture();f.sessionActive=false;
 assert.equal((await f.api.touch(params)).status,'indeterminate');assert.equal(f.version,1);
});
test('other tenant or another order UUID is not applied',async()=>{
 const f=fixture({shopCode:'qa_shop_b'});
 assert.equal((await f.api.touch(params)).status,'indeterminate');assert.equal(f.version,1);
 const g=fixture();assert.equal((await g.api.touch({...params,orderId:'00000000-0000-0000-0000-000000004599'})).status,'indeterminate');
 assert.equal(g.version,1);
});
test('JWT wrong subject or session does not bind to DB',async()=>{
 for(const cfg of [{wrongSub:true},{wrongSession:true}]){
  const f=fixture(cfg);assert.equal((await f.api.touch(params)).status,'indeterminate');assert.equal(f.version,1);
 }
});
test('invalid JWT issuer, audience, role, signature and expiry stop before DB',async()=>{
 for(const cfg of [{jwtValid:false},{issuerOverride:'https://evil.supabase.co/auth/v1'},
 {audience:'anon'},{role:'service_role'},{tokenExpired:true}]){
  const f=fixture(cfg);await denied(f.api.touch(params));assert.equal(f.calls.length,0);
 }
});
test('mixed LINE staff credential cannot be used',async()=>{
 const f=fixture();await denied(f.api.touch({...params,request:req('synthetic-signed-token-450',true)}));
 assert.equal(f.calls.length,0);
});
test('untrusted shop, no route authorization, or non-isolated mode stop before DB',async()=>{
 for(const cfg of [{auth:false},{mode:'production'},{shopCode:'../other'}]){
  const f=fixture(cfg);await denied(f.api.touch(params));assert.equal(f.calls.length,0);
 }
});
test('bad bearer, version, and invalid order rejected before database call',async()=>{
 const f=fixture();for(const args of [
  {...params,request:new Request('https://car02.test')},
  {...params,expectedVersion:0},{...params,expectedVersion:2.5},
  {...params,expectedVersion:2147483647},{...params,orderId:'forged'}]){
    await denied(f.api.touch(args));
  }assert.equal(f.calls.length,0);
});
test('untrusted database rows never turn into success',async()=>{
 for(const rows of [[],[{applied:'true',new_version:2}],
 [{applied:true,new_version:3}],[{applied:true,new_version:2},{applied:true,new_version:2}]]){
  assert.equal((await fixture({rows}).api.touch(params)).status,'indeterminate');
 }
});
test('database error before commit is indeterminate, never success',async()=>{
 const f=fixture({dbThrows:true});assert.deepEqual(await f.api.touch(params),{status:'indeterminate'});
 assert.equal(f.version,1);
});
test('lost ACK AFTER atomic commit returns indeterminate without automated replay',async()=>{
 const f=fixture({dbDelayedCommit:true});const r=await f.api.touch(params);
 assert.deepEqual(r,{status:'indeterminate'});assert.equal(f.version,2);assert.equal(f.calls.length,1);
});
test('single SQL statement excludes request-supplied nonce, role, shop and sessionId',async()=>{
 const f=fixture();await f.api.touch({...params,shopCode:'qa_shop_b',generationNonce:'bad',
  role:'owner',sessionId:'00000000-0000-0000-0000-000000004599'});
 assert.deepEqual(f.calls[0].args,[shop,user,session,order,1]);
});
test('V450 remains detached from production R52 with all original release locks',()=>{
 const orig=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
 assert.match(orig,/const\s+CAR02_RELEASE_LOCK\s*=\s*true/);
 assert.doesNotMatch(orig,/atomic-session-write-r450|v450_private/);
 for(const name of ['car02-supabase-session-boundary-r447.mjs','car02-postcommit-fence-r448.mjs','car02-cutover-reconcile-r449.mjs']){
  assert.match(readFileSync(new URL('./'+name,import.meta.url),'utf8'),/RELEASE_LOCK\s*=\s*true/);
 }
});
