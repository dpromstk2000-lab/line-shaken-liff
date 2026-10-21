import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCar02OfflineReleaseReadinessR459,CAR02_V459_RELEASE_LOCK,
 CAR02_V459_READ_SQL,CAR02_V459_MANDATORY_CONTROLS as controls} from './car02-release-readiness-r459.mjs';
const shop='qa_shop_a';
const rows=()=>controls.map(control_code=>({control_code,evidence_source:'synthetic_fixture',review_state:'pending'}));
const denied=p=>assert.rejects(p,e=>e?.code==='CAR02_RELEASE_AUDIT_UNAUTHORIZED'&&e.status===401);
function fixture({verified=true,role='auditor',mode='isolated_qa',shopCode=shop,
 data=rows(),failConnect=false,failRead=false,failBegin=false,failRollback=false,
 missingRelease=false,missingQuery=false}={}){
 const q=[],released=[];let connects=0;
 const pool={connect:async()=>{connects++;
  if(failConnect)throw Error('sensitive network error');
  const client={query:async(sql,params=[])=>{
   q.push({sql,params});
   if(failBegin&&sql.startsWith('BEGIN'))throw Error('begin error');
   if(failRead&&sql===CAR02_V459_READ_SQL)throw Error('sensitive read error');
   if(failRollback&&sql==='ROLLBACK')throw Error('rollback transport loss');
   if(sql===CAR02_V459_READ_SQL)return{rows:data};return {rows:[]};
  },release:e=>released.push(Boolean(e))};
  if(missingRelease)delete client.release;
  if(missingQuery)delete client.query;
  return client;
 }};
 const api=createCar02OfflineReleaseReadinessR459({pool,authorizeAuditor:async()=>({verified,role,mode,shopCode})});
 return {api,q,released,get connects(){return connects}};
}
test('V459 release lock cannot be disabled, fixed parameterized read SQL',()=>{
 assert.equal(CAR02_V459_RELEASE_LOCK,true);
 assert.equal(CAR02_V459_READ_SQL,'SELECT control_code,evidence_source,review_state FROM v459_private.qa_release_controls($1::text)');
 assert.throws(()=>createCar02OfflineReleaseReadinessR459(),/ISOLATED_ADAPTERS_REQUIRED/);
});
test('seven distinct commercial blockers have stable non-empty names',()=>{
 assert.equal(controls.length,7);assert.equal(new Set(controls).size,7);
 assert.ok(Object.isFrozen(controls));
});
test('synthetic PG fixture reports NO_GO and all pending controls',async()=>{
 const f=fixture(),result=await f.api.inspect();
 assert.deepEqual(result,{status:'no_go',releasePermitted:false,reason:'external_validation_missing',pendingControls:controls});
 assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.pendingControls));
});
test('read-only repeatable-read snapshot is rolled back and no business writes',async()=>{
 const f=fixture();await f.api.inspect();
 assert.deepEqual(f.q.map(v=>v.sql),['BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
   "SET LOCAL statement_timeout = '15s'","SET LOCAL lock_timeout = '2s'",CAR02_V459_READ_SQL,'ROLLBACK']);
 assert.deepEqual(f.q[3].params,[shop]);assert.deepEqual(f.released,[false]);
});
test('forged all-green external attestations still NO_GO without independent proof',async()=>{
 const data=rows().map(x=>({...x,evidence_source:'external_claim',review_state:'observed'}));
 const r=await fixture({data}).api.inspect();
 assert.equal(r.releasePermitted,false);assert.equal(r.reason,'external_claims_not_independently_verified');
 assert.equal(r.pendingControls.length,7);
});
test('one green-looking synthetic control is insufficient',async()=>{
 const data=rows();data[0]={...data[0],review_state:'observed'};
 assert.equal((await fixture({data}).api.inspect()).status,'no_go');
});
test('missing control yields fail-closed audit',async()=>{
 const r=await fixture({data:rows().slice(1)}).api.inspect();
 assert.equal(r.reason,'incomplete_or_untrusted_audit');assert.equal(r.releasePermitted,false);
});
test('duplicated control yields fail-closed audit',async()=>{
 const data=rows();data[6]={...data[0]};
 assert.equal((await fixture({data}).api.inspect()).reason,'incomplete_or_untrusted_audit');
});
test('unknown additional code cannot replace a mandatory control',async()=>{
 const data=rows();data[3]={...data[3],control_code:'fake_product_ready'};
 assert.equal((await fixture({data}).api.inspect()).reason,'incomplete_or_untrusted_audit');
});
test('malformed origin and state cannot authorize release',async()=>{
 for(const change of [{evidence_source:'verified_by_browser'},{review_state:'passed'},
  {control_code:'BAD>'},{evidence_source:42}]){
  const data=rows();data[1]={...data[1],...change};
  const r=await fixture({data}).api.inspect();assert.equal(r.releasePermitted,false);
  assert.equal(r.reason,'incomplete_or_untrusted_audit');
 }
});
test('empty rows and duplicate rows fail closed',async()=>{
 for(const data of [[],[...rows(),rows()[0]]]){
  assert.equal((await fixture({data}).api.inspect()).reason,'incomplete_or_untrusted_audit');
 }
});
test('spoofed auditor cannot open database',async()=>{
 for(const opt of [{verified:false},{role:'owner'},{role:'staff'},{role:'dispatcher'},{mode:'production'}]){
  const f=fixture(opt);await denied(f.api.inspect());assert.equal(f.connects,0);
 }
});
test('untrusted route shop invalid before database',async()=>{
 const f=fixture({shopCode:'../other'});await denied(f.api.inspect());assert.equal(f.connects,0);
});
test('server authorized shop overrides any request-supplied shop',async()=>{
 const f=fixture();await f.api.inspect({request:{shopCode:'qa_shop_b',role:'owner',verified:true}});
 assert.deepEqual(f.q[3].params,[shop]);
});
test('connection or query interruption is never proof of GO',async()=>{
 for(const opt of [{failConnect:true},{failRead:true},{failBegin:true}]){
  const f=fixture(opt),r=await f.api.inspect();assert.equal(r.releasePermitted,false);
  assert.equal(r.reason,'incomplete_or_untrusted_audit');
 }
});
test('rollback response lost invalidates entire observation',async()=>{
 const f=fixture({failRollback:true}),r=await f.api.inspect();
 assert.equal(r.reason,'incomplete_or_untrusted_audit');assert.deepEqual(f.released,[true]);
});
test('bad connection adapters never grant GO',async()=>{
 for(const opt of [{missingRelease:true},{missingQuery:true}]){
  const r=await fixture(opt).api.inspect();assert.equal(r.releasePermitted,false);
 }
});
test('no public methods to grant release or touch LIVE providers',()=>{
 const api=fixture().api;
 assert.deepEqual(Object.keys(api),['inspect']);
 assert.equal(api.goLive,undefined);assert.equal(api.sendLine,undefined);
});
test('R52 original unchanged and hard locked, V459 is detached from production',()=>{
 const source=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
 assert.match(source,/const\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/);
 assert.doesNotMatch(source,/release-readiness-r459|v459_private/);
});
