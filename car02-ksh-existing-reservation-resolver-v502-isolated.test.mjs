import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAR02_V502_KSH_MODE,
  buildKshReservationByIdPath,
  makeKshReservationByIdResolver,
} from './car02-ksh-existing-reservation-resolver-v502-isolated.mjs';
import {
  bindExistingReservationCaseService,
} from './car02-existing-reservation-case-service-v501-isolated.mjs';

const shopCode = 'street_house_kitsuki';
const reservationId = '11111111-1111-4111-8111-111111111111';
const row = Object.freeze({
  id: reservationId,
  shop_code: shopCode,
  customer_id: '22222222-2222-4222-8222-222222222222',
  vehicle_id: '33333333-3333-4333-8333-333333333333',
  reservation_date: '2026-10-30',
  reservation_time: '09:30:00',
  status: '入庫予定',
});

test('01: review only and locked', () => {
  assert.equal(CAR02_V502_KSH_MODE.releaseLock, true);
  assert.equal(CAR02_V502_KSH_MODE.deployed, false);
  assert.equal(CAR02_V502_KSH_MODE.writes, false);
});

test('02: source-aligned KSH table, minimal columns, id plus tenant in query', () => {
  const path = buildKshReservationByIdPath({shopCode, reservationId});
  assert.match(path, /^ksh_demo_reservations\?select=id,shop_code,customer_id,vehicle_id,reservation_date,reservation_time,status&/);
  assert.match(path, /&id=eq\.11111111-1111-4111-8111-111111111111&shop_code=eq\.street_house_kitsuki&limit=1$/);
});

test('03: exact reservation resolves and client data cannot alter tenant', async () => {
  let selected;
  const resolve = makeKshReservationByIdResolver({readRows:async path => {
    selected = path;
    return [{...row, memo:'not returned to CAR02'}];
  }});
  const result = await resolve({shopCode, reservationId});
  assert.deepEqual(result, row);
  assert.ok(Object.isFrozen(result));
  assert.match(selected, /shop_code=eq\.street_house_kitsuki/);
});

test('04: missing reservation returns null, not an unauthorized fallback', async () => {
  const resolve = makeKshReservationByIdResolver({readRows:async () => []});
  assert.equal(await resolve({shopCode,reservationId}), null);
});

test('05: invalid tenant/id is rejected before any backend access', async () => {
  let reads=0;
  const resolve=makeKshReservationByIdResolver({readRows:async () => { reads++; return [row]; }});
  await assert.rejects(resolve({shopCode:'other/../../',reservationId}),/SCOPE_INVALID/);
  await assert.rejects(resolve({shopCode,reservationId:'not-a-uuid'}),/SCOPE_INVALID/);
  assert.equal(reads,0);
});

test('06: returned row must belong to exact shop and booking', async () => {
  const resolve=makeKshReservationByIdResolver({readRows:async () => [{...row,shop_code:'another_shop'}]});
  await assert.rejects(resolve({shopCode,reservationId}),/SCOPE_MISMATCH/);
});

test('07: malformed/ambiguous response and transport errors fail closed', async () => {
  await assert.rejects(makeKshReservationByIdResolver({readRows:async()=>({ok:true})})({shopCode,reservationId}),/RESPONSE_INVALID/);
  await assert.rejects(makeKshReservationByIdResolver({readRows:async()=>[row,row]})({shopCode,reservationId}),/RESPONSE_INVALID/);
  await assert.rejects(makeKshReservationByIdResolver({readRows:async()=>{throw Error('secret backend detail');}})({shopCode,reservationId}),/READ_FAILED/);
});

test('08: missing server-side reader cannot initialize', () => {
  assert.throws(()=>makeKshReservationByIdResolver(),/SERVER_READER_REQUIRED/);
});

test('09: actual V5.01 seam receives scoped KSH row and creates only its authoritative references', async () => {
  let createInput;
  class DomainError extends Error {constructor(code,status){super(code);this.code=code;this.status=status;}}
  const scopedResolver=makeKshReservationByIdResolver({readRows:async()=>[{...row}]});
  const combined=bindExistingReservationCaseService({
    service:{create:async input=>{createInput=input;return {ok:true};}},
    resolveReservationForShop:scopedResolver,
    findCaseByReservation:async()=>null,
    assertAtomicUniqueLink:async()=>true, // Only a controlled mock; NOT proven for the real DB.
    releaseEnabled:async()=>true,         // Only a controlled mock; production remains locked.
    Car02ErrorClass:DomainError,
  });
  const actor={verified:true,role:'owner',subject:'mock-owner',shopCode};
  const result=await combined.create({actor,shop:shopCode,reservationId,key:'test-key-ksh-resolver-2026'});
  assert.deepEqual(result,{ok:true});
  assert.equal(createInput.customerId,row.customer_id);
  assert.equal(createInput.vehicleId,row.vehicle_id);
  assert.equal(createInput.reservationId,row.id);
});

test('10: a KSH booking with no vehicle cannot become a CAR02 case', async () => {
  let writes=0;
  class DomainError extends Error {constructor(code,status){super(code);this.code=code;this.status=status;}}
  const combined=bindExistingReservationCaseService({
    service:{create:async()=>{writes++;}},
    resolveReservationForShop:makeKshReservationByIdResolver({readRows:async()=>[{...row,vehicle_id:null}]}),
    findCaseByReservation:async()=>null,
    assertAtomicUniqueLink:async()=>true,
    releaseEnabled:async()=>true,
    Car02ErrorClass:DomainError,
  });
  await assert.rejects(combined.create({
    actor:{verified:true,role:'staff',subject:'mock-staff',shopCode},
    shop:shopCode,reservationId,key:'test-key-no-vehicle-2026',
  }),error=>error.code==='CAR02_V501_REFERENCES_INCOMPLETE');
  assert.equal(writes,0);
});
