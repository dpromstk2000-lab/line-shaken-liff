import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CAR02_V467_RELEASE_LOCK,CAR02_V467_DRYRUN_SQL,
 createCar02OfflineAtomicSessionCasR467} from './car02-atomic-session-cas-r467.mjs';
const shop='qa_shop_a',sub='00000000-0000-0000-0000-000000004661',
 session='00000000-0000-0000-0000-000000004662',job='00000000-0000-0000-0000-000000004670';
function setup({identity={},isolation={},auth={},intent={},outcome='synthetic_cas_advanced',next_version=1,
 rows=null,failAt='',badClient=false,badRelease=false,now=1800000000}={}){
 const calls=[],releases=[];let connections=0;
 const db={query:async(sql,params=[])=>{
  calls.push({sql,params});if(failAt&&sql.includes(failAt))throw Error('secret db failure');
  if(sql===CAR02_V467_DRYRUN_SQL)return {rows:rows??[{outcome,next_version}]};
  return {rows:[]};
 },release:(err)=>{releases.push(err)}};
 const pool={connect:async()=>{connections++;if(failAt==='connect')throw Error('no database');
   return badClient?{query:null,release:db.release}:badRelease?{query:db.query}:db;}};
 const api=createCar02OfflineAtomicSessionCasR467({pool,nowSeconds:()=>now,
  authorizeQaOperator:async()=>({verified:true,mode:'isolated_qa',role:'cas_tester',shopCode:shop,...identity}),
  inspectIsolation:async()=>({verified:true,environment:'disposable_pg17',database:'car02_v466_disposable',testOnly:true,...isolation}),
  getMockSession:async()=>({verified:true,source:'isolated_mock',subject:sub,sessionId:session,expiresAtSec:1800000600,...auth}),
  getSyntheticJobIntent:async()=>({verified:true,source:'isolated_job_fixture',shopCode:shop,jobId:job,expectedVersion:0,...intent})
 });
 return {api,calls,releases,get connections(){return connections}};
}
const check=f=>f.api.inspect({request:{shopCode:'qa_shop_b',sessionId:'bogus',jobId:'wrong'}});
test('V467 hard release lock fixed SQL and no server adapters denied',()=>{
 assert.equal(CAR02_V467_RELEASE_LOCK,true);
 assert.match(CAR02_V467_DRYRUN_SQL,/^SELECT outcome,next_version FROM v467_private\.qa_atomic_dryrun/);
 assert.throws(()=>createCar02OfflineAtomicSessionCasR467(),/DISPOSABLE_ADAPTERS_REQUIRED/);
});
test('positive fixture updates only inside mandatory rolled-back synthetic transaction',async()=>{
 const f=setup(),result=await check(f);
 assert.deepEqual(result,{status:'no_go',reason:'synthetic_cas_rolled_back_no_go',releasePermitted:false,
  businessWriteAllowed:false,lineDispatchAllowed:false,transactionRolledBack:true,realSupabaseSessionVerified:false});
 assert.ok(Object.isFrozen(result));assert.equal(f.connections,1);
 assert.deepEqual(f.calls.map(x=>x.sql),['BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED',
  "SET LOCAL statement_timeout = '5s'","SET LOCAL lock_timeout = '1s'",CAR02_V467_DRYRUN_SQL,'ROLLBACK']);
 assert.deepEqual(f.calls[3].params,[shop,sub,session,job,0,1800000000]);
 assert.equal(f.releases.length,1);assert.equal(f.releases[0],undefined);
});
test('synthetic DB check never grants actual business routes or LINE dispatch',async()=>{
 const f=setup();assert.equal(typeof f.api.send,'undefined');assert.equal(typeof f.api.write,'undefined');
 assert.equal((await check(f)).releasePermitted,false);
});
test('session revoked rejects with no authorization',async()=>{
 const f=setup({outcome:'session_rejected',next_version:null});assert.equal((await check(f)).reason,'session_rejected');
});
test('staff disabled rejects with no authorization',async()=>{
 const f=setup({outcome:'membership_rejected',next_version:null});assert.equal((await check(f)).reason,'membership_rejected');
});
test('generation mismatch rejects with no authorization',async()=>{
 const f=setup({outcome:'generation_rejected',next_version:null});assert.equal((await check(f)).reason,'generation_rejected');
});
test('stale synthetic job compare-and-swap rejects',async()=>{
 const f=setup({outcome:'version_conflict',next_version:null});assert.equal((await check(f)).reason,'version_conflict');
});
test('wrong operator role, mode or verification refused before connect',async()=>{
 for(const identity of [{role:'owner'},{mode:'production'},{verified:false},{shopCode:'../../etc'},{shopCode:'QA-UPPER'}]){
  const f=setup({identity});assert.equal((await check(f)).status,'no_go');assert.equal(f.connections,0);
 }
});
test('live or unproved database cannot be consulted',async()=>{
 for(const isolation of [{testOnly:false},{verified:false},{environment:'production'},{database:'shared'}]){
  const f=setup({isolation});assert.equal((await check(f)).reason,'isolation_identity_or_intent_unverified');assert.equal(f.connections,0);
 }
});
test('provider token claiming real origin is refused',async()=>{
 const f=setup({auth:{source:'supabase_auth'}});assert.equal((await check(f)).status,'no_go');assert.equal(f.connections,0);
});
test('wrong signed identity and expired session refused',async()=>{
 for(const auth of [{subject:'bad'},{sessionId:'bad'},{verified:false},{expiresAtSec:1799999999}]){
  const f=setup({auth});assert.equal((await check(f)).status,'no_go');assert.equal(f.connections,0);
 }
});
test('bad trusted job intent cannot access DB',async()=>{
 for(const intent of [{verified:false},{shopCode:'qa_shop_b'},{jobId:'bad'},{expectedVersion:-1},{expectedVersion:1.2},{expectedVersion:1000001},{source:'browser'}]){
  const f=setup({intent});assert.equal((await check(f)).status,'no_go');assert.equal(f.connections,0);
 }
});
test('request injected tenant, session and job cannot override trusted values',async()=>{
 const f=setup();await check(f);assert.deepEqual(f.calls[3].params,[shop,sub,session,job,0,1800000000]);
});
test('invalid clock cannot proceed to transaction',async()=>{
 for(const now of [0,1800000700,Infinity,Number.NaN]){
  const f=setup({now});assert.equal((await check(f)).status,'no_go');assert.equal(f.connections,0);
 }
});
test('DB connect refusal remains no_go with no release',async()=>{
 const f=setup({failAt:'connect'});assert.equal((await check(f)).reason,'atomic_snapshot_untrusted');assert.equal(f.releases.length,0);
});
test('begin failure discards client',async()=>{
 const f=setup({failAt:'BEGIN'});assert.equal((await check(f)).reason,'atomic_snapshot_untrusted');assert.ok(f.releases[0] instanceof Error);
});
test('DB statement failure rolls back before returning no_go',async()=>{
 const f=setup({failAt:'qa_atomic_dryrun'});assert.equal((await check(f)).reason,'atomic_snapshot_untrusted');
 assert.equal(f.calls.at(-1).sql,'ROLLBACK');assert.equal(f.releases[0],undefined);
});
test('failed required ROLLBACK never grants success and forces discard',async()=>{
 const f=setup({failAt:'ROLLBACK'});assert.equal((await check(f)).reason,'atomic_snapshot_untrusted');
 assert.ok(f.releases[0] instanceof Error);
});
test('mis-shaped DB responses and inconsistent version discarded',async()=>{
 for(const rows of [[],[{outcome:'synthetic_cas_advanced',next_version:2}],
  [{outcome:'session_rejected',next_version:1}],
  [{outcome:'unknown',next_version:null}],
  [{outcome:'version_conflict',next_version:null},{outcome:'version_conflict',next_version:null}]]){
  const f=setup({rows});assert.equal((await check(f)).reason,'atomic_snapshot_untrusted');
  assert.equal(f.calls.at(-1).sql,'ROLLBACK');
 }
});
test('bad DB client fails closed and no business write leaks',async()=>{
 const f=setup({badClient:true});assert.equal((await check(f)).status,'no_go');assert.ok(f.releases[0] instanceof Error);
});
test('missing safe client release fails closed',async()=>{
 const f=setup({badRelease:true});assert.equal((await check(f)).status,'no_go');
});
test('R52 genuine hard release lock and V466 source remain unchanged',()=>{
 const r52=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
 const prev=readFileSync(new URL('./car02-session-fence-observation-r466.mjs',import.meta.url),'utf8');
 assert.match(r52,/const\s+CAR02_RELEASE_LOCK=true;/);assert.match(prev,/CAR02_V466_RELEASE_LOCK\s*=\s*true/);
 assert.doesNotMatch(r52,/atomic-session-cas-r467|v467_private/);
});
