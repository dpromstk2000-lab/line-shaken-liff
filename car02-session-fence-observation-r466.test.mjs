import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CAR02_V466_RELEASE_LOCK,CAR02_V466_QUERY,createCar02OfflineSessionFenceR466} from './car02-session-fence-observation-r466.mjs';
const SHOP='qa_shop_a',OTHER='qa_shop_b',SUB='00000000-0000-0000-0000-000000004661',
 SESSION='00000000-0000-0000-0000-000000004662',NOW=1800000000;
const happy={proof_state:'eligible_for_review_only',session_seen:true,membership_seen:true,fence_verified:true};
const deny=(code,observed=0)=>({status:'no_go',reason:code,checksObserved:observed,releasePermitted:false,
 businessWriteAllowed:false,lineDispatchAllowed:false,realProviderSessionVerified:false});
function setup({identity={},environment={},attestation={},result=happy,rows,
  throwConnect=false,throwQuery=false,throwRollback=false,badDbClient=false,
  authFailure=false,envFailure=false,proofFailure=false,clock=NOW}={}){
 const calls=[],releases=[];let connects=0;
 const pool={connect:async()=>{connects++;if(throwConnect)throw Error('secret');if(badDbClient)return{query:null,release(){}};
  return {query:async(sql,args=[])=>{calls.push([sql,args]);if(throwQuery&&sql===CAR02_V466_QUERY)throw Error('secret SQL');
    if(throwRollback&&sql==='ROLLBACK')throw Error('connection lost');
    if(sql===CAR02_V466_QUERY)return{rows:rows??[result]};return{rows:[]};},
   release:(e)=>releases.push(Boolean(e))};}};
 const api=createCar02OfflineSessionFenceR466({pool,
  authorizeInspector:async()=>{if(authFailure)throw Error('internal auth');return{verified:true,mode:'isolated_qa',role:'session_auditor',shopCode:SHOP,...identity}},
  inspectIsolation:async()=>{if(envFailure)throw Error('internal env');return{verified:true,environment:'disposable_pg17',database:'car02_v466_disposable',testOnly:true,...environment}},
  getSignedSessionObservation:async()=>{if(proofFailure)throw Error('internal provider');return{source:'isolated_mock',verified:true,subject:SUB,sessionId:SESSION,audience:'authenticated',role:'authenticated',expiresAtSec:NOW+100,...attestation}},
  nowSeconds:()=>clock});
 return{api,calls,releases,get connects(){return connects}};
}
const take=f=>f.api.inspect({request:{shopCode:OTHER,subject:'faked',sessionId:'faked'}});
test('release lock enabled and SQL is a single parameterized read statement',()=>{
 assert.equal(CAR02_V466_RELEASE_LOCK,true);assert.match(CAR02_V466_QUERY,/^SELECT proof_state/);
 assert.match(CAR02_V466_QUERY,/\$1::text,\$2::uuid,\$3::uuid,\$4::bigint/);
 assert.doesNotMatch(CAR02_V466_QUERY,/INSERT|DELETE|UPDATE|ALTER/i);
});
test('rejects missing trusted adapters',()=>assert.throws(()=>createCar02OfflineSessionFenceR466(),/ADAPTERS_REQUIRED/));
test('best-case synthetic positive evidence still hard NO_GO and no write methods',async()=>{
 const f=setup();const r=await take(f);assert.deepEqual(r,deny('synthetic_session_and_fence_consistent_still_no_go',3));
 assert.ok(Object.isFrozen(r));assert.equal(f.api.authorize,undefined);assert.equal(f.api.send,undefined);
});
test('read-only transaction exactly contains parameterized trusted scope and credentials are not returned',async()=>{
 const f=setup();await take(f);assert.deepEqual(f.calls.map(x=>x[0]),[
 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',"SET LOCAL statement_timeout = '5s'", "SET LOCAL lock_timeout = '1s'",CAR02_V466_QUERY,'ROLLBACK']);
 assert.deepEqual(f.calls[3][1],[SHOP,SUB,SESSION,NOW]);assert.deepEqual(f.releases,[false]);
});
test('tenant override in request ignored and scope from server only',async()=>{
 const f=setup();await f.api.inspect({request:{shopCode:OTHER,subject:SESSION,sessionId:SUB}});
 assert.deepEqual(f.calls[3][1],[SHOP,SUB,SESSION,NOW]);
});
test('rejected session revocation is NO_GO not permission',async()=>{
 const f=setup({result:{proof_state:'session_rejected',session_seen:false,membership_seen:false,fence_verified:false}});
 assert.deepEqual(await take(f),deny('session_rejected'));
});
test('missing membership is NO_GO',async()=>{
 const f=setup({result:{proof_state:'membership_rejected',session_seen:true,membership_seen:false,fence_verified:false}});
 assert.deepEqual(await take(f),deny('membership_rejected',1));
});
test('new generation fence blocks old session',async()=>{
 const f=setup({result:{proof_state:'generation_rejected',session_seen:true,membership_seen:true,fence_verified:false}});
 assert.deepEqual(await take(f),deny('generation_rejected',2));
});
test('wrong synthetic role fails before connect',async()=>{for(const role of ['staff','owner','dispatcher','']){
 const f=setup({identity:{role}});assert.deepEqual(await take(f),deny('untrusted_isolation'));assert.equal(f.connects,0);
}});
test('wrong source mode fails before connect',async()=>{for(const mode of ['production','stage','']){
 const f=setup({identity:{mode}});assert.deepEqual(await take(f),deny('untrusted_isolation'));assert.equal(f.connects,0);
}});
test('invalid identity shop or verification fails before connect',async()=>{for(const identity of [{verified:false},{shopCode:'../bad'},{shopCode:'X'.repeat(65)},{shopCode:''}]){
 const f=setup({identity});assert.equal((await take(f)).status,'no_go');assert.equal(f.connects,0);
}});
test('claims from a production or wrong disposable db rejected',async()=>{for(const environment of [{environment:'production'},{database:'postgres'},{testOnly:false},{verified:false}]){
 const f=setup({environment});assert.equal((await take(f)).releasePermitted,false);assert.equal(f.connects,0);
}});
test('real provider source never accepted as fake test evidence',async()=>{
 const f=setup({attestation:{source:'independent_provider_read'}});assert.deepEqual(await take(f),deny('untrusted_attestation'));assert.equal(f.connects,0);
});
test('unsigned attestation or wrong roles never reaches DB',async()=>{for(const attestation of [
 {verified:false},{audience:'anonymous'},{role:'service_role'}, {subject:'bad'},{sessionId:'bad'}]){
 const f=setup({attestation});assert.deepEqual(await take(f),deny('untrusted_attestation'));assert.equal(f.connects,0);
}});
test('expired session tokens fail before connecting',async()=>{
 const f=setup({attestation:{expiresAtSec:NOW}});assert.deepEqual(await take(f),deny('expired_or_invalid_clock'));assert.equal(f.connects,0);
});
test('clock failure fails before connecting',async()=>{
 const f=setup({clock:0});assert.deepEqual(await take(f),deny('expired_or_invalid_clock'));assert.equal(f.connects,0);
});
test('each injected trust failure fails closed without DB access',async()=>{
 for(const x of ['authFailure','envFailure','proofFailure']){
 const f=setup({[x]:true});assert.deepEqual(await take(f),deny('untrusted_isolation_or_attestation'));assert.equal(f.connects,0);
 }});
test('connect failure fails closed and hides connection details',async()=>{
 const f=setup({throwConnect:true});assert.deepEqual(await take(f),deny('untrusted_snapshot_or_database'));assert.deepEqual(f.releases,[]);
});
test('query failure rollback and client is discarded',async()=>{
 const f=setup({throwQuery:true});assert.deepEqual(await take(f),deny('untrusted_snapshot_or_database'));
 assert.equal(f.calls.at(-1)[0],'ROLLBACK');assert.deepEqual(f.releases,[true]);
});
test('rollback failure rejects even apparently valid evidence',async()=>{
 const f=setup({throwRollback:true});assert.deepEqual(await take(f),deny('untrusted_snapshot_or_database'));assert.deepEqual(f.releases,[true]);
});
test('malformed client rejected with no authorization',async()=>{
 const f=setup({badDbClient:true});assert.deepEqual(await take(f),deny('untrusted_snapshot_or_database'));
});
test('missing/duplicate database evidence rejected',async()=>{for(const rows of [[],[happy,happy]]){
 const f=setup({rows});assert.deepEqual(await take(f),deny('untrusted_snapshot_or_database'));assert.deepEqual(f.releases,[true]);
}});
test('unknown database verdict rejected',async()=>{
 const f=setup({result:{...happy,proof_state:'delivered'}});assert.deepEqual(await take(f),deny('untrusted_snapshot_or_database'));
});
test('boolean strings are not trusted',async()=>{
 const f=setup({result:{...happy,session_seen:'true'}});assert.deepEqual(await take(f),deny('untrusted_snapshot_or_database'));
});
test('positive verdict missing a fence is untrusted',async()=>{
 const f=setup({result:{...happy,fence_verified:false}});assert.deepEqual(await take(f),deny('untrusted_snapshot_or_database'));
});
test('contradictory negative states are untrusted',async()=>{
 for(const result of [{proof_state:'session_rejected',session_seen:true,membership_seen:false,fence_verified:false},
 {proof_state:'membership_rejected',session_seen:true,membership_seen:true,fence_verified:false},
 {proof_state:'generation_rejected',session_seen:false,membership_seen:true,fence_verified:false}]){
 const f=setup({result});assert.deepEqual(await take(f),deny('untrusted_snapshot_or_database'));
}});
test('R46 actual verifier has no session-id binding, R52 hard release lock untouched',()=>{
 const auth=readFileSync(new URL('./car02-auth-seam-audit-r461.mjs',import.meta.url),'utf8');
 const r52=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
 assert.match(auth,/R46 currently returns sub\/exp only/);
 assert.match(r52,/const\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/);
 assert.doesNotMatch(r52,/session-fence-observation-r466|v466_private/);
});
