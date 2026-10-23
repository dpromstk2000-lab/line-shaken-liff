import test from 'node:test';
import assert from 'node:assert/strict';
import {CAR02_V500_MODE, buildOwnerReservationList, selectOwnerReservation, returnToOwnerList}
  from './car02-existing-owner-navigation-v500-isolated.mjs';

const reservation = (id, time = '10:30:00', shop = 'street_house_kitsuki') => ({
  id, shop_code: shop,
  customer_id: '22222222-2222-4222-8222-222222222222',
  vehicle_id: '33333333-3333-4333-8333-333333333333',
  reservation_date: '2026-10-26', reservation_time: time,
  status: time ? '入庫予定' : '仮入庫',
  work_type: '車検', customer: {name: '架空のお客様'}, vehicle: {car_name: '架空車両'},
});
const idA = '11111111-1111-4111-8111-111111111111';
const idB = '44444444-4444-4444-8444-444444444444';
const list = rows => buildOwnerReservationList({response: {reservations: rows}, trustedShopCode: 'street_house_kitsuki'});

test('既存のUUIDでオーナー→予約→オーナーの選択を保持する', () => {
  const data = list([reservation(idA)]);
  const detail = selectOwnerReservation({list: data, reservationId: idA});
  assert.equal(detail.detail.reservationId, idA);
  assert.equal(detail.selectedCar02CaseId, null);
  assert.equal(detail.canCancel, false);
  assert.deepEqual(returnToOwnerList({selection: detail}), {tab: 'owner', selectedReservationId: idA});
});

test('未確定で時間未定の予約もオーナー一覧から消えない', () => {
  const data = list([reservation(idA), reservation(idB, null)]);
  assert.equal(data.items.length, 2);
  assert.equal(data.items[1].timeNeedsConfirmation, true);
  assert.equal(data.items[1].start, null);
  assert.match(data.items[1].displayStart, /時間未定/);
  assert.equal(selectOwnerReservation({list: data, reservationId: idB}).canReschedule, false);
});

test('店舗相違と予約ID重複は一覧全体を拒否する', () => {
  assert.throws(() => list([reservation(idA, '10:30:00', 'other_shop')]), /SHOP_MISMATCH/);
  assert.throws(() => list([reservation(idA), reservation(idA)]), /DUPLICATE_RESERVATION/);
});

test('存在しない予約・不正時刻を拒否し、書込みは行わない', () => {
  const data = list([reservation(idA)]);
  assert.throws(() => selectOwnerReservation({list: data, reservationId: idB}), /NOT_FOUND/);
  assert.throws(() => list([reservation(idB, '10:15:00')]), /HALF_HOUR_REQUIRED/);
  assert.equal(CAR02_V500_MODE.liveOwnerAuthConnected, false);
  assert.equal(CAR02_V500_MODE.writes, false);
  assert.equal(CAR02_V500_MODE.release, 'NO_GO');
});
