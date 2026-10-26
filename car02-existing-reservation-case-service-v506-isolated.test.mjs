import test from 'node:test';
import assert from 'node:assert/strict';
import {bindExistingReservationCaseService, CAR02_V501_MODE} from './car02-existing-reservation-case-service-v506-isolated.mjs';

const R = '11111111-1111-4111-8111-111111111111';
const C = '22222222-2222-4222-8222-222222222222';
const V = '33333333-3333-4333-8333-333333333333';
const KEY = 'car02-r501-req-00001';
const actor = Object.freeze({verified: true, role: 'owner', subject: 'qa-owner', shopCode: 'demo_shop'});
const row = Object.freeze({id: R, shop_code: 'demo_shop', customer_id: C, vehicle_id: V,
  reservation_date: '2026-10-30', reservation_time: '10:30:00', status: '入庫予定'});
class TestCar02Error extends Error {
  constructor(code, status = 400) {super(code); this.code = code; this.status = status;}
}

function rig(overrides = {}) {
  const calls = [];
  const service = {
    async create(input) {
      calls.push(['create', input]);
      return {id: '44444444-4444-4444-8444-444444444444', ...input};
    },
    get: () => 'original-get-unchanged',
  };
  const wrapped = bindExistingReservationCaseService({
    service,
    releaseEnabled: async () => { calls.push(['release']); return true; },
    assertAtomicUniqueLink: async scope => { calls.push(['unique', scope]); return true; },
    resolveReservationForShop: async scope => { calls.push(['lookup', scope]); return row; },
    findCaseByReservation: async scope => { calls.push(['linked', scope]); return null; },
    Car02ErrorClass: TestCar02Error,
    ...overrides,
  });
  return {wrapped, calls};
}
const input = (extra = {}) => ({actor, shop: actor.shopCode, reservationId: R, key: KEY, ...extra});
const expectCode = async (action, code) => assert.rejects(action, err => err.code === code);

test('01 linked create: actual server-scoped reservation supplies both IDs and keeps original UUID', async () => {
  const {wrapped, calls} = rig();
  const result = await wrapped.create(input());
  assert.equal(result.reservationId, R);
  assert.equal(result.customerId, C);
  assert.equal(result.vehicleId, V);
  assert.deepEqual(calls.map(x => x[0]), ['release', 'unique', 'lookup', 'linked', 'create']);
  assert.deepEqual(calls[4][1], {actor, shop: 'demo_shop', customerId: C, vehicleId: V,
    reservationId: R, key: KEY});
  assert.equal(wrapped.get(), 'original-get-unchanged');
});

test('02 release lock blocks even reservation lookup', async () => {
  const calls = [];
  const {wrapped} = rig({releaseEnabled: async () => {calls.push('lock'); return false;},
    resolveReservationForShop: async () => {calls.push('lookup'); return row;}});
  await expectCode(() => wrapped.create(input()), 'CAR02_NOT_RELEASED');
  assert.deepEqual(calls, ['lock']);
});

test('03 unique DB link is not yet proven: fail closed before touching reservation', async () => {
  const {wrapped, calls} = rig({assertAtomicUniqueLink: async () => false});
  await expectCode(() => wrapped.create(input()), 'CAR02_V501_ATOMIC_UNIQUE_LINK_NOT_VERIFIED');
  assert.deepEqual(calls.map(x => x[0]), ['release']);
});

test('04 only verified owner/staff can initiate linked cases', async () => {
  const {wrapped, calls} = rig();
  await expectCode(() => wrapped.create(input({actor: {...actor, role: 'customer'}})), 'CAR02_V501_STAFF_AUTH_REQUIRED');
  await expectCode(() => wrapped.create(input({shop: 'different_shop'})), 'CAR02_V501_STAFF_AUTH_REQUIRED');
  assert.equal(calls.some(x => x[0] === 'lookup'), false);
});

test('05 backend refuses row from another shop even if response was injected', async () => {
  const {wrapped, calls} = rig({resolveReservationForShop: async () => ({...row, shop_code: 'other_shop'})});
  await expectCode(() => wrapped.create(input()), 'CAR02_V501_RESERVATION_NOT_FOUND');
  assert.equal(calls.some(x => x[0] === 'create'), false);
});

test('06 provisional, cancelled, missing time, off-grid and invalid date are not linked', async () => {
  for (const changed of [
    {status: '仮入庫'}, {status: '作業完了'}, {status: 'キャンセル'}, {reservation_time: null},
    {reservation_time: '10:15'}, {reservation_date: '2026-02-30'},
  ]) {
    const {wrapped, calls} = rig({resolveReservationForShop: async () => ({...row, ...changed})});
    await expectCode(() => wrapped.create(input()), 'CAR02_V501_RESERVATION_NOT_CONFIRMED');
    assert.equal(calls.some(x => x[0] === 'create'), false);
  }
});

test('07 customer and vehicle references must be real UUIDs from server', async () => {
  const {wrapped} = rig({resolveReservationForShop: async () => ({...row, vehicle_id: null})});
  await expectCode(() => wrapped.create(input()), 'CAR02_V501_REFERENCES_INCOMPLETE');
});

test('08 stale/malicious browser customer ID cannot override server booking', async () => {
  const {wrapped, calls} = rig();
  await expectCode(() => wrapped.create(input({customerId: V})), 'CAR02_V501_CLIENT_REFERENCE_MISMATCH');
  assert.equal(calls.some(x => x[0] === 'create'), false);
});

test('09 already linked booking under a NEW key is rejected by DB unique and normalized to 409', async () => {
  const attempts = [];
  const {wrapped} = rig({
    findCaseByReservation: async () => ({id: '44444444-4444-4444-8444-444444444444'}),
    service: {async create(payload) {
      attempts.push(payload);
      throw Object.assign(new Error('unique conflict'), {code: '23505'});
    }},
  });
  await expectCode(() => wrapped.create(input()), 'CAR02_V501_CASE_ALREADY_LINKED');
  assert.equal(attempts.length, 1);
});

test('10 resolver failure and missing unique guard never fall back to unsafe create', async () => {
  const {wrapped, calls} = rig({resolveReservationForShop: async () => {throw Error('DB offline');}});
  await expectCode(() => wrapped.create(input()), 'CAR02_V501_RESERVATION_LOOKUP_FAILED');
  assert.equal(calls.some(x => x[0] === 'create'), false);
  assert.throws(() => bindExistingReservationCaseService({service: {create(){}}}),
    err => err.code === 'CAR02_V501_SERVER_WIRING_REQUIRED');
});

test('11 different idempotency keys cannot bypass the existing-link check', async () => {
  const attempts = [];
  const {wrapped} = rig({
    findCaseByReservation: async () => ({id: '44444444-4444-4444-8444-444444444444'}),
    service: {async create(payload) {
      attempts.push(payload);
      throw Object.assign(new Error('unique conflict'), {code: '23505'});
    }},
  });
  await expectCode(() => wrapped.create(input({key: 'another-safe-key-0002'})),
    'CAR02_V501_CASE_ALREADY_LINKED');
  assert.equal(attempts.length, 1);
});

test('12 ordinary unlinked R43 case-create remains delegated; no new production routes', async () => {
  const {wrapped, calls} = rig();
  const data = {actor, shop: 'demo_shop', customerId: C, vehicleId: V, key: KEY};
  const out = await wrapped.create(data);
  assert.equal(out.customerId, C);
  assert.deepEqual(calls.map(x => x[0]), ['release', 'create']);
  assert.deepEqual(CAR02_V501_MODE, {environment:'isolated_review',productionReady:false,
    release:'NO_GO',dbMigration:'HOLD',releaseLock:true,networkCalls:false,directDbWrites:false});
});

test('13 even legacy unlinked create cannot bypass locked release', async () => {
  const {wrapped, calls} = rig({releaseEnabled: async () => false});
  await expectCode(() => wrapped.create({actor, shop: actor.shopCode,
    customerId: C, vehicleId: V, key: KEY}), 'CAR02_NOT_RELEASED');
  assert.equal(calls.some(x => x[0] === 'create'), false);
});

test('14 route receives the shared R43-compatible error class and HTTP status', async () => {
  const {wrapped} = rig({releaseEnabled: async () => false});
  await assert.rejects(() => wrapped.create(input()), err =>
    err instanceof TestCar02Error && err.code === 'CAR02_NOT_RELEASED' && err.status === 503);
});

test('15 current KSH DB status 入庫済み is accepted as a confirmed arrival', async () => {
  const {wrapped, calls} = rig({resolveReservationForShop: async () => ({...row, status: '入庫済み'})});
  const result = await wrapped.create(input());
  assert.equal(result.reservationId, R);
  assert.equal(result.customerId, C);
  assert.equal(result.vehicleId, V);
  // This test overrides the resolver directly, so it does not log 'lookup'.
  assert.deepEqual(calls.map(x => x[0]), ['release', 'unique', 'linked', 'create']);
});

test('16 same idempotency key may replay saved original case response without creating second case', async () => {
  const id = '44444444-4444-4444-8444-444444444444';
  const {wrapped, calls} = rig({findCaseByReservation: async () => ({id})});
  const result = await wrapped.create(input());
  assert.equal(result.id, id);
  assert.deepEqual(calls.map(x => x[0]), ['release','unique','lookup','create']);
});

test('17 existing link never accepts a service response for a different case ID', async () => {
  const {wrapped} = rig({findCaseByReservation: async () => ({id:'55555555-5555-4555-8555-555555555555'})});
  await expectCode(() => wrapped.create(input()), 'CAR02_V501_CASE_ALREADY_LINKED');
});

test('18 unrelated DB uniqueness error must not be mislabeled if reservation remains unlinked', async () => {
  const {wrapped} = rig({service: {async create() {
    throw Object.assign(new Error('other unique'),{code:'23505'});
  }}});
  await expectCode(() => wrapped.create(input()), '23505');
});
