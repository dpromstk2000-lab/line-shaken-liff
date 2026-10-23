import test from 'node:test';
import assert from 'node:assert/strict';
import {CAR02_V499_MODE, EXISTING_RESERVATION_ROUTE_MAP, mapExistingReservationForOwner} from './car02-existing-reservation-map-v499-isolated.mjs';

const example = () => ({
  shop_code: 'street_house_kitsuki',
  id: '11111111-1111-4111-8111-111111111111',
  customer_id: '22222222-2222-4222-8222-222222222222',
  vehicle_id: '33333333-3333-4333-8333-333333333333',
  reservation_date: '2026-10-26',
  reservation_time: '10:30:00',
  work_type: '車検',
  status: '入庫予定',
  customer: {name: '架空顧客A'},
  vehicle: {car_name: 'デモ車両A'},
});

test('existing reservation maps to a read-only owner card with original UUID', () => {
  const model = mapExistingReservationForOwner({row: example(), trustedShopCode: 'street_house_kitsuki'});
  assert.equal(model.start, '2026-10-26T10:30');
  assert.equal(model.reservationId, example().id);
  assert.equal(model.car02CaseId, null);
  assert.equal(model.customerLabel, '架空顧客A');
  assert.equal(model.sendable, false);
});

test('tenant mismatch fails closed', () => {
  assert.throws(() => mapExistingReservationForOwner({row: example(), trustedShopCode: 'wangan'}), /CAR02_RESERVATION_SHOP_MISMATCH/);
});

test('untrusted reference and off-grid time fail closed', () => {
  const broken = example(); broken.customer_id = 'demo-customer';
  assert.throws(() => mapExistingReservationForOwner({row: broken, trustedShopCode: broken.shop_code}), /REFERENCE_INVALID/);
  const offGrid = example(); offGrid.reservation_time = '10:15:00';
  assert.throws(() => mapExistingReservationForOwner({row: offGrid, trustedShopCode: offGrid.shop_code}), /HALF_HOUR_REQUIRED/);
});

test('public inquiry is not equivalent to a confirmed reservation', () => {
  assert.equal(EXISTING_RESERVATION_ROUTE_MAP.intakeInquiry.scope, 'customer_intake_only');
  assert.notEqual(EXISTING_RESERVATION_ROUTE_MAP.create.path, EXISTING_RESERVATION_ROUTE_MAP.intakeInquiry.path);
  assert.equal(CAR02_V499_MODE.businessWrites, false);
  assert.equal(CAR02_V499_MODE.release, 'NO_GO');
});
