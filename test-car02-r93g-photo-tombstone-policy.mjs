import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateR93GPhotoMutation as evaluate, R93G_INVARIANTS as inv} from './car02-r93g-photo-tombstone-policy-isolated.mjs';
const uuid=n=>`${n.repeat(8)}-${n.repeat(4)}-${n.repeat(4)}-${n.repeat(4)}-${n.repeat(12)}`;
const SHOP='street_house_kitsuki',ORDER=uuid('2'),REPORT=uuid('3'),PHOTO=uuid('4'),BLOB=uuid('7');
const base=()=>({id:PHOTO,shopCode:SHOP,orderId:ORDER,reportId:REPORT,
 storageBucket:'ksh-car02-private-photos',storagePath:`${SHOP}/${ORDER}/${REPORT}/${BLOB}.jpg`,
 mimeType:'image/jpeg',byteSize:777,sha256:'a'.repeat(64),uploadState:'pending',createdAt:'2026-10-11T06:00:00.000Z'});
const decide=(before,after,extra={})=>evaluate({before,after,authorized:true,...extra});
const blocked=(x)=>{assert.match(x.decision,/^DENY_/);assert.equal(x.productionReady,false);assert.equal(x.releaseDecision,'NO_GO');assert.equal(x.migrationDecision,'HOLD');assert.equal(x.storageOperations,0);return x};
test('R93G does not authorize production, migration, network, storage or direct DB mutation',()=>{
 assert.deepEqual([inv.liveWiring,inv.productionMigrationReviewed],[false,false]);
 assert.equal(inv.tombstoneOutboxAtomicRequired,true);
});
for(const [oldState,newState,decision] of [
 ['pending','pending','ALLOW_NO_CLEANUP'],['pending','ready','ALLOW_NO_CLEANUP'],
 ['pending','deleted','ALLOW_ATOMIC_TOMBSTONE_AND_OUTBOX'],['ready','ready','ALLOW_NO_CLEANUP'],
 ['ready','deleted','ALLOW_ATOMIC_TOMBSTONE_AND_OUTBOX'],['ready','pending','DENY_STATE_REGRESSION'],
 ['deleted','pending','DENY_TERMINAL_TOMBSTONE'],['deleted','ready','DENY_TERMINAL_TOMBSTONE'],
 ['deleted','deleted','DENY_TERMINAL_TOMBSTONE']
 ])test(`state ${oldState} -> ${newState}: ${decision}`,()=>{
 const b={...base(),uploadState:oldState},a={...b,uploadState:newState};
 const r=decide(b,a);assert.equal(r.decision,decision);
 if(decision.startsWith('ALLOW'))assert.equal(r.mustEnqueue,newState==='deleted');
 else assert.equal(r.mustEnqueue,undefined);
 if(r.mustEnqueue){assert.equal(r.tombstone.photoId,PHOTO);assert.equal(r.tombstone.storagePath,b.storagePath)}
});
for(const field of ['id','shopCode','orderId','reportId','storageBucket','storagePath','mimeType','byteSize','sha256','createdAt'])
 test(`immutable ${field} cannot change`,()=>{
  const b=base(),a={...b,uploadState:'deleted', [field]:({byteSize:6,shopCode:'other_shop',storageBucket:'other-bucket',
  mimeType:'image/png',sha256:'b'.repeat(64),createdAt:'2026-10-11T06:00:01.000Z',
  storagePath:`${SHOP}/${ORDER}/${REPORT}/${uuid('8')}.jpg`})[field]||uuid('8')};
  assert.notEqual(decide(b,a).decision,'ALLOW_ATOMIC_TOMBSTONE_AND_OUTBOX');
 });
for(const state of ['pending','ready','deleted'])
 test(`hard DELETE denied, from ${state}`,()=>{const b={...base(),uploadState:state};blocked(evaluate({before:b,operation:'DELETE',authorized:true}))});
for(const operation of ['INSERT','TRUNCATE','DELETE','PATCH','ALTER'])
 test(`untrusted operation ${operation} rejected`,()=>blocked(evaluate({before:base(),after:base(),operation,authorized:true})));
for(const authorized of [false,null,undefined,0,1,'true'])
 test(`authorization must equal explicit true: ${String(authorized)}`,()=>blocked(evaluate({before:base(),after:{...base(),uploadState:'deleted'},authorized})));
for(const value of [null,{},[],Object.create(null),{...base(),userRole:'owner'},
 {...base(),sha256:'invalid'}, {...base(),byteSize:5242881}, {...base(),storagePath:'../wrong.jpg'},
 {...base(),createdAt:'2026-99-99T06:00:00.000Z'}, {...base(),storagePath:`${SHOP}/${ORDER}/${REPORT}/${PHOTO}.svg`}])
 test(`invalid photo row fails closed: ${JSON.stringify(value)?.slice(0,30)}`,()=>blocked(decide(value,{...base(),uploadState:'deleted'})));
test('invalid output row is denied',()=>blocked(decide(base(),{...base(),reportId:'bad',uploadState:'deleted'})));
test('isolation: changing the blob to another photo in same report is denied',()=>{
 const before=base(),after={...before,storagePath:`${SHOP}/${ORDER}/${REPORT}/${uuid('8')}.jpg`,uploadState:'deleted'};
 blocked(decide(before,after));
});
test('idempotent stale deleted replay never creates a second outbox job',()=>{
 const x={...base(),uploadState:'deleted'};const r=decide(x,x);blocked(r);
});
test('returned read-only tombstone cannot be edited or mislabeled as live',()=>{
 const before=base(),after={...before,uploadState:'deleted'},r=decide(before,after);
 assert.equal(Object.isFrozen(r),true);assert.equal(r.productionReady,false);assert.equal(r.migrationDecision,'HOLD');
});
