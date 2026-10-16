import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CAR02_LEGACY_INBOX_MODE as MODE,projectCar02LegacyReservationInbox as project,
 createCar02LegacyInboxSelectionQa as make} from './car02-legacy-reservation-inbox-readonly-isolated.mjs';
const ID='66666666-6666-4666-8666-666666666666';
const OTHER='77777777-7777-4777-8777-777777777777';
const CUSTOMER='11111111-1111-4111-8111-111111111111';
const ACTOR=Object.freeze({role:'staff',verified:true,subject:'qa-only-staff',shopCode:'street_house_kitsuki'});
const row=(over={})=>({id:ID,reservation_date:'2026-10-20',reservation_time:'10:30:00',
 status:'入庫予定',customer_id:CUSTOMER,vehicle_id:'22222222-2222-4222-8222-222222222222',
 shop_code:'UNTRUSTED_SHOP',customer:{name:'SECRET_CUSTOMER'},
 vehicle:{plate_last4:'9876'},phone:'PRIVATE_PHONE',memo:'PRIVATE_NOTE',...over});
const snapshot=(rows=[row()],opts)=>project({ok:true,reservations:rows,pagination:{page:1}},opts);
const descriptor=Object.freeze({method:'POST',path:'/api/car02',body:{reservationId:ID,customerId:CUSTOMER,
 vehicleId:'22222222-2222-4222-8222-222222222222'},authorization:'SERVER_VERIFICATION_REQUIRED',
 sendable:false,readOnly:true,idempotencyKey:'qa-legacy-list-001'});
const fake=(calls=[],impl=async()=>descriptor)=>({prepare:async x=>{calls.push(x);return impl(x)}});
const select=(h=fake(),actor=ACTOR)=>make({handoff:h,actor,environment:'isolated_qa',allowIsolatedQa:true});
const req={reservationId:ID,idempotencyKey:'qa-legacy-list-001'};
const rejectsCode=(fn,code)=>assert.rejects(fn,new RegExp(code));

test('V2.1 is nondeployable QA read only',()=>{assert.equal(MODE.release,'NO_GO');assert.equal(MODE.migration,'HOLD');assert.equal(MODE.productionReady,false);assert.equal(MODE.realLegacyApiConnected,false)});
test('projects legacy reservations envelope and only display-safe metadata',()=>{const s=snapshot();assert.equal(s.total,1);assert.equal(s.items[0].reservationId,ID);assert.deepEqual(Object.keys(s.items[0]),['reservationId','day','time','status','reviewable','needsServerVerification','sendable','readOnly'])});
test('rejects PII and browser tenant from projected result',()=>{const s=snapshot();const txt=JSON.stringify(s);for(const secret of ['SECRET_CUSTOMER','PRIVATE_PHONE','PRIVATE_NOTE','9876','UNTRUSTED_SHOP',CUSTOMER])assert.ok(!txt.includes(secret),secret)});
test('the projection never certifies a browser row',()=>{const s=snapshot();assert.equal(s.clientVerified,false);assert.equal(s.sendable,false);assert.equal(s.items[0].needsServerVerification,true)});
test('projected items and list are frozen',()=>{const s=snapshot();assert.ok(Object.isFrozen(s));assert.ok(Object.isFrozen(s.items));assert.ok(Object.isFrozen(s.items[0]));});
test('upper case UUIDs normalize for matching',()=>{const s=snapshot([row({id:ID.toUpperCase()})]);assert.equal(s.items[0].reservationId,ID)});
test('legacy HH:MM:SS is normalized to HH:MM',()=>assert.equal(snapshot().items[0].time,'10:30'));
test('legacy HH:MM remains intact',()=>assert.equal(snapshot([row({reservation_time:'09:00'})]).items[0].time,'09:00'));
test('normal intake stage is reviewable display only',()=>assert.equal(snapshot([row({status:'仮入庫'})]).items[0].reviewable,true));
test('maintenance stage is reviewable display only',()=>assert.equal(snapshot([row({status:'点検中'})]).items[0].reviewable,true));
test('cancelled intake is excluded from selection',()=>assert.equal(snapshot([row({status:'キャンセル'})]).items[0].reviewable,false));
test('cancelled english status is excluded',()=>assert.equal(snapshot([row({status:'cancelled'})]).items[0].reviewable,false));
test('deleted intake is excluded',()=>assert.equal(snapshot([row({status:'削除済み'})]).items[0].reviewable,false));
test('delivered intake is excluded',()=>assert.equal(snapshot([row({status:'引渡し完了'})]).items[0].reviewable,false));
test('unknown status needs review instead of granting selection',()=>{const s=snapshot([row({status:'昇格済み'})]);assert.equal(s.items[0].status,'要確認');assert.equal(s.items[0].reviewable,false)});
test('status is not permitted to carry PII or markup',()=>{const s=snapshot([row({status:'<script>unsafe</script>'})]);assert.equal(s.items[0].status,'要確認')});
test('missing date fails closed',()=>{const s=snapshot([row({reservation_date:null})]);assert.equal(s.items[0].reviewable,false);assert.equal(s.items[0].day,null)});
test('calendar invalid date fails closed',()=>{const s=snapshot([row({reservation_date:'2026-02-30'})]);assert.equal(s.items[0].reviewable,false)});
test('non-ISO date fails closed',()=>{const s=snapshot([row({reservation_date:'10/20/2026'})]);assert.equal(s.items[0].reviewable,false)});
test('malformed time fails closed',()=>{const s=snapshot([row({reservation_time:'99:99'})]);assert.equal(s.items[0].reviewable,false)});
test('missing time fails closed',()=>{const s=snapshot([row({reservation_time:null})]);assert.equal(s.items[0].reviewable,false)});
test('legacy display-only reservation number is discarded',()=>{const s=snapshot([row({id:'DEMO-0001'})]);assert.equal(s.discarded,1);assert.equal(s.items.length,0)});
test('non-uuid integer legacy ID is discarded',()=>assert.equal(snapshot([row({id:123})]).discarded,1));
test('malformed row is discarded',()=>assert.equal(snapshot([null]).discarded,1));
test('duplicate UUIDs are rejected rather than resolving ambiguously',()=>assert.throws(()=>snapshot([row(),row()]),/DUPLICATE_ID/));
test('case-insensitive duplicate IDs are rejected',()=>assert.throws(()=>snapshot([row(),row({id:ID.toUpperCase()})]),/DUPLICATE_ID/));
test('list paging limit never grants browser authority',()=>{const s=snapshot([row(),row({id:OTHER})],{maxRows:1});assert.equal(s.items.length,1);assert.equal(s.limited,true);assert.equal(s.sendable,false)});
test('overlong list rejected',()=>assert.throws(()=>snapshot(Array.from({length:301},()=>({}))),/RESPONSE_INVALID/));
test('missing reservations list rejected',()=>assert.throws(()=>project({ok:true}),/RESPONSE_INVALID/));
test('non-object response rejected',()=>assert.throws(()=>project([]),/RESPONSE_INVALID/));
test('bad maxRows rejected',()=>assert.throws(()=>snapshot([row()],{maxRows:0}),/RESPONSE_INVALID/));
test('invalid maxRows above cap rejected',()=>assert.throws(()=>snapshot([row()],{maxRows:301}),/RESPONSE_INVALID/));
test('selection constructor rejects production',()=>assert.throws(()=>make({handoff:fake(),actor:ACTOR,environment:'production',allowIsolatedQa:true}),/ISOLATION_REQUIRED/));
test('selection constructor rejects unverified identity',()=>assert.throws(()=>select(fake(),{...ACTOR,verified:false}),/ISOLATION_REQUIRED/));
test('selection constructor rejects customer identity',()=>assert.throws(()=>select(fake(),{...ACTOR,role:'customer'}),/ISOLATION_REQUIRED/));
test('selection constructor rejects handler able to send',()=>assert.throws(()=>select({prepare:async()=>descriptor,send(){}}),/ISOLATION_REQUIRED/));
test('selected ID invokes ONLY the V2.0 server-side R13 recheck',async()=>{const calls=[];const x=await select(fake(calls)).prepareSelected(snapshot(),req);assert.equal(calls.length,1);assert.deepEqual(calls[0],{actor:ACTOR,reservationId:ID,idempotencyKey:req.idempotencyKey});assert.equal(x.sendable,false);assert.equal(x.displayVerified,false);assert.equal(x.authorization,'SERVER_VERIFICATION_REQUIRED')});
test('browser-injected shopCode is denied as an extra selection field',async()=>rejectsCode(()=>select().prepareSelected(snapshot(),{...req,shopCode:'attacker'}),'SELECTION_INVALID'));
test('browser-injected customerId is denied',async()=>rejectsCode(()=>select().prepareSelected(snapshot(),{...req,customerId:CUSTOMER}),'SELECTION_INVALID'));
test('unknown selected UUID cannot initiate a R13 recheck',async()=>{const calls=[];await rejectsCode(()=>select(fake(calls)).prepareSelected(snapshot(),{...req,reservationId:OTHER}),'NOT_REVIEWABLE');assert.equal(calls.length,0)});
test('display-only ID cannot initiate a R13 recheck',async()=>rejectsCode(()=>select().prepareSelected(snapshot(),{...req,reservationId:'DEMO-0001'}),'UUID_REQUIRED'));
test('closed status cannot initiate handoff',async()=>rejectsCode(()=>select().prepareSelected(snapshot([row({status:'キャンセル'})]),req),'NOT_REVIEWABLE'));
test('unknown status cannot initiate handoff',async()=>rejectsCode(()=>select().prepareSelected(snapshot([row({status:'UNVERIFIED'})]),req),'NOT_REVIEWABLE'));
test('server-side foreign shop denial is propagated without fallback',async()=>rejectsCode(()=>select(fake([],async()=>{throw Error('CAR02_LEGACY_HANDOFF_REFERENCE_NOT_FOUND')})).prepareSelected(snapshot(),req),'REFERENCE_NOT_FOUND'));
test('server-side output with sendable true is rejected',async()=>rejectsCode(()=>select(fake([],async()=>({...descriptor,sendable:true}))).prepareSelected(snapshot(),req),'BRIDGE_INVALID'));
test('server-side output with different reservation ID is rejected',async()=>rejectsCode(()=>select(fake([],async()=>({...descriptor,body:{...descriptor.body,reservationId:OTHER}}))).prepareSelected(snapshot(),req),'BRIDGE_INVALID'));
test('source module exposes no fetch, SQL writes or import of public network client',()=>{const src=readFileSync(new URL('./car02-legacy-reservation-inbox-readonly-isolated.mjs',import.meta.url),'utf8');assert.ok(!/\bfetch\s*\(|\b(?:INSERT|UPDATE|DELETE|DROP|ALTER)\s+(?:INTO|FROM|TABLE|DATABASE)\b|https?:\/\//.test(src))});
