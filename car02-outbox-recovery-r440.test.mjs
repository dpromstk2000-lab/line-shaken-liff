import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCar02OfflineOutboxRecoveryR440,CAR02_V440_QUARANTINE_SQL,CAR02_V440_COUNTS_SQL,CAR02_V440_RELEASE_LOCK} from './car02-outbox-recovery-r440.mjs';
const shop='qa_shop_a', event='00000000-0000-0000-0000-000000004401';
function fixture({noEvent=false,badRows=false,throws=false,wrongState=false,duplicate=false,badCounts=false}={}){
 const queries=[];
 const store={query:async(sql,params)=>{
   queries.push({sql,params});if(throws)throw Error('sensitive-db-error');
   if(sql===CAR02_V440_QUARANTINE_SQL){
     if(noEvent)return {rows:[]};
     if(duplicate)return {rows:[{event_id:event,review_state:'manual_review'},{event_id:event,review_state:'manual_review'}]};
     return {rows:[{event_id:badRows?'not-uuid':event,review_state:wrongState?'delivered':'manual_review'}]};
   }
   if(sql===CAR02_V440_COUNTS_SQL){
     return {rows:badCounts?[{status:'pending',total:-1}]:[
      {status:'pending',total:1},{status:'dispatching',total:2},{status:'manual_review',total:3},{status:'delivered',total:4}]};
   }
   throw Error('UNEXPECTED_SQL');
 }};
 return {monitor:createCar02OfflineOutboxRecoveryR440({store}),queries};
}
test('release lock, only two strict parameterized queries',()=>{
 assert.equal(CAR02_V440_RELEASE_LOCK,true);
 assert.equal(CAR02_V440_QUARANTINE_SQL,'SELECT event_id,review_state FROM public.v440_qa_quarantine_next($1::text)');
 assert.equal(CAR02_V440_COUNTS_SQL,'SELECT status,total FROM public.v440_qa_status_counts($1::text)');
 assert.throws(()=>createCar02OfflineOutboxRecoveryR440(),/CAR02_V440_REVIEW_STORE_REQUIRED/);
});
test('one stale synthetic event becomes manual review without transport call',async()=>{
 const f=fixture();const value=await f.monitor.quarantineOne(shop);
 assert.deepEqual(value,{status:'manual_review',eventId:event});
 assert.equal(f.queries.length,1);assert.deepEqual(f.queries[0],{sql:CAR02_V440_QUARANTINE_SQL,params:[shop]});
 assert.ok(Object.isFrozen(value));
});
test('no stuck row returns idle (never auto requeue)',async()=>{
 const f=fixture({noEvent:true});assert.deepEqual(await f.monitor.quarantineOne(shop),{status:'idle'});
});
test('invalid shop rejected without reading DB',async()=>{
 const f=fixture();for(const name of ['', ' bad','qa_shop_a;DROP','../x','a'.repeat(65)]){
 assert.equal((await f.monitor.quarantineOne(name)).status,'denied');
 assert.equal((await f.monitor.statusCounts(name)).status,'denied');
 }assert.equal(f.queries.length,0);
});
test('invalid quarantine row fails closed rather than returning wrong delivery',async()=>{
 for(const opt of [{badRows:true},{wrongState:true},{duplicate:true}]){
  assert.equal((await fixture(opt).monitor.quarantineOne(shop)).status,'indeterminate');
 }
});
test('database disconnect never treats quarantine as successful',async()=>{
 const f=fixture({throws:true});assert.deepEqual(await f.monitor.quarantineOne(shop),{status:'indeterminate'});
});
test('statusCounts returns immutable counts for one tenant without payloads',async()=>{
 const f=fixture();const result=await f.monitor.statusCounts(shop);
 assert.equal(result.status,'ok');assert.deepEqual({...result.counts},{pending:1,dispatching:2,manual_review:3,delivered:4});
 assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.counts));
 assert.deepEqual(f.queries[0].params,[shop]);
 assert.equal(Object.keys(result.counts).includes('payload'),false);
});
test('incomplete/untrusted counts fail closed without exposure',async()=>{
 for(const opt of [{badCounts:true},{throws:true}]){
  assert.equal((await fixture(opt).monitor.statusCounts(shop)).status,'indeterminate');
 }
});
test('missing, duplicate or hostile count categories not accepted',async()=>{
 const make=(rows)=>createCar02OfflineOutboxRecoveryR440({store:{query:async()=>({rows})}});
 for(const rows of [[],[{status:'pending',total:1},{status:'pending',total:2},{status:'manual_review',total:3},{status:'delivered',total:4}],
 [{status:'pending',total:1},{status:'dispatching',total:2},{status:'manual_review',total:3},{status:'secret',total:4}]]){
  assert.equal((await make(rows).statusCounts(shop)).status,'indeterminate');
 }
});
test('live entry remains permanently locked and detached',()=>{
 const entry=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
 assert.match(entry,/const\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/);
 assert.doesNotMatch(entry,/car02-outbox-recovery-r440|v440_qa_/);
});
