import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CAR02_V449_RELEASE_LOCK,CAR02_V449_READ_SQL,
 createCar02OfflineCutoverReconcilerR449} from './car02-cutover-reconcile-r449.mjs';
const shop='qa_shop_a',sub='00000000-0000-0000-0000-000000004491';
const nonce='00000000-0000-0000-0000-000000004498';
const scope=()=>({shopCode:shop,userSub:sub,expectedVersion:2,generationNonce:nonce});
const denied=p=>assert.rejects(p,x=>x?.code==='CAR02_UNAUTHORIZED'&&x?.status===401);
function fixture({phase='fenced',gen=3,rows=null,validOperator=true,mode='isolated_qa',shopCode=shop,
  failConnect=false,failRead=false,failBegin=false,failRollback=false,missingClient=false,
  missingRelease=false,oddOperator=false,configScope=scope()}={}){
 let connects=0;const calls=[],released=[];
 const pool={connect:async()=>{
  connects++;if(failConnect)throw Error('network offline');
  if(missingClient)return {query:null,release:()=>{}};
  return {query:async(sql,params=[])=>{
    calls.push({sql,params});
    if(sql.startsWith('BEGIN')&&failBegin)throw Error('BEGIN refused');
    if(sql===CAR02_V449_READ_SQL){if(failRead)throw Error('sensitive DB error');
      return {rows:rows??[{phase,observed_version:gen}]};}
    if(sql==='ROLLBACK'&&failRollback)throw Error('transport dropped during rollback');
    return {rows:[]};
   },...(missingRelease?{}:{release:e=>released.push(Boolean(e))})};
 }};
 const authorizeOperator=async()=> oddOperator?null:({verified:validOperator,mode,shopCode});
 const observer=createCar02OfflineCutoverReconcilerR449({pool,authorizeOperator,scope:configScope});
 return{observer,calls,released,get connects(){return connects}};
}
test('V449 locked review-only, literal read-only query, requires server-owned scope',()=>{
 assert.equal(CAR02_V449_RELEASE_LOCK,true);
 assert.equal(CAR02_V449_READ_SQL,
 'SELECT phase,observed_version FROM v449_private.qa_reconcile_cutover($1::text,$2::uuid,$3::integer,$4::uuid)');
 assert.throws(()=>createCar02OfflineCutoverReconcilerR449(),/CONFIG_REQUIRED/);
 for(const s of [{...scope(),bad:'x'},{...scope(),shopCode:'../bad'},
    {...scope(),expectedVersion:0},{...scope(),generationNonce:'forged'},
    Object.assign(Object.create(null),scope())]){
   assert.throws(()=>createCar02OfflineCutoverReconcilerR449({pool:{connect:async()=>{}},authorizeOperator:async()=>{},scope:s}),/SERVER_SCOPE_REQUIRED/);
 }
});
test('after ambiguous phase-1 COMMIT, NEW read-only snapshot observes committed but unfenced',async()=>{
 const f=fixture({phase:'committed_unfenced'}),r=await f.observer.inspect({request:{}});
 assert.deepEqual(r,{observation:'observed_cutover_unfenced'});
 assert.equal(f.connects,1);
 assert.deepEqual(f.calls.map(x=>x.sql),[
 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
 "SET LOCAL statement_timeout = '15s'","SET LOCAL lock_timeout = '2s'",CAR02_V449_READ_SQL,'ROLLBACK']);
 assert.deepEqual(f.calls[3].params,[shop,sub,2,nonce]);
 assert.deepEqual(f.released,[false]);
 assert.ok(Object.isFrozen(r));
});
test('after ambiguous phase-2 COMMIT, observed fenced state is NOT authentication',async()=>{
 const f=fixture({phase:'fenced'}),out=await f.observer.inspect();
 assert.deepEqual(out,{observation:'observed_fenced'});
 assert.equal(Object.keys(out).includes('authorized'),false);
 assert.equal(Object.keys(out).includes('nonce'),false);
 assert.equal(typeof f.observer.authenticate,'undefined');
});
test('old generation after ambiguous COMMIT is an observation, NOT proof of rollback',async()=>{
 assert.deepEqual(await fixture({phase:'prior_generation',gen:2}).observer.inspect(),
  {observation:'observed_prior_generation'});
});
test('revoked or superseded generation is not mistaken for a usable fence',async()=>{
 assert.deepEqual(await fixture({phase:'superseded',gen:4}).observer.inspect(),
  {observation:'observed_superseded'});
});
test('snapshot row count zero or duplicate is indeterminate',async()=>{
 for(const rows of [[],[{phase:'fenced',observed_version:3},{phase:'fenced',observed_version:3}]]){
  assert.equal((await fixture({rows}).observer.inspect()).observation,'indeterminate');
 }
});
test('mismatched phase/version combinations are rejected rather than reported',async()=>{
 for(const [phase,gen] of [['fenced',2],['committed_unfenced',4],['prior_generation',3],['mystery',3]]){
   assert.equal((await fixture({phase,gen}).observer.inspect()).observation,'indeterminate');
 }
});
test('non integer, negative and missing version cannot be observed',async()=>{
 for(const gen of [0,-1,3.2,'3',undefined]){
  assert.equal((await fixture({rows:[{phase:'fenced',observed_version:gen}]}).observer.inspect()).observation,'indeterminate');
 }
});
test('spoofed, wrong-shop and non-isolated operator cannot open any connection',async()=>{
 for(const config of [{validOperator:false},{shopCode:'qa_shop_b'},{mode:'production'},{oddOperator:true}]){
  const f=fixture(config);await denied(f.observer.inspect());assert.equal(f.connects,0);
 }
});
test('connection interruption returns indeterminate without leaking database error',async()=>{
 const f=fixture({failConnect:true}),r=await f.observer.inspect();
 assert.deepEqual(r,{observation:'indeterminate'});assert.equal(JSON.stringify(r).includes('network'),false);
});
test('read query failure triggers ROLLBACK and discards client',async()=>{
 const f=fixture({failRead:true});assert.equal((await f.observer.inspect()).observation,'indeterminate');
 assert.deepEqual(f.released,[true]);assert.equal(f.calls.at(-1).sql,'ROLLBACK');
});
test('begin transaction failure fails closed',async()=>{
 const f=fixture({failBegin:true}),o=await f.observer.inspect();
 assert.equal(o.observation,'indeterminate');assert.equal(f.calls.some(x=>x.sql===CAR02_V449_READ_SQL),false);
});
test('ROLLBACK transport failure cannot be reported as reliable observation',async()=>{
 const f=fixture({failRollback:true});assert.equal((await f.observer.inspect()).observation,'indeterminate');
 assert.deepEqual(f.released,[true]);
});
test('incompatible client does not produce a positive observation',async()=>{
 for(const cfg of [{missingClient:true},{missingRelease:true}]){
  const f=fixture(cfg);assert.equal((await f.observer.inspect()).observation,'indeterminate');
 }
});
test('even a correct view does not open a connection for any business mutation',async()=>{
 const f=fixture(),r=await f.observer.inspect();
 assert.equal(r.observation,'observed_fenced');
 assert.equal(f.calls.some(x=>/\bUPDATE\b|\bINSERT\b|\bCOMMIT\b|\bDELETE\b/.test(x.sql)),false);
});
test('server-side bound shop, nonce and generation remain immutable after factory initialization',async()=>{
 const s=scope(),f=fixture({configScope:s});s.shopCode='qa_shop_b';s.generationNonce='00000000-0000-0000-0000-000000009999';
 assert.equal((await f.observer.inspect()).observation,'observed_fenced');
 assert.deepEqual(f.calls[3].params,[shop,sub,2,nonce]);
});
test('release lock in original R52 and V448 remains true; V449 is not wired into production',()=>{
 const orig=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
 const prev=readFileSync(new URL('./car02-postcommit-fence-r448.mjs',import.meta.url),'utf8');
 assert.match(orig,/const\s+CAR02_RELEASE_LOCK\s*=\s*true/);
 assert.match(prev,/CAR02_V448_RELEASE_LOCK\s*=\s*true/);
 assert.doesNotMatch(orig,/cutover-reconcile-r449|v449_private/);
});
