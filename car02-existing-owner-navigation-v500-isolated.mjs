/**
 * V5.00 common-owner integration seam for an already authenticated, tenant-
 * scoped reservation-list response. This module never performs network I/O.
 * The trustedShopCode MUST come from independently verified server auth.
 */
import {mapExistingReservationForOwner} from './car02-existing-reservation-map-v499-isolated.mjs';

const fail = code => { throw Object.assign(new Error(code), {code}); };

export const CAR02_V500_MODE = Object.freeze({
  environment: 'isolated_review',
  release: 'NO_GO',
  dbMigration: 'HOLD',
  liveOwnerAuthConnected: false,
  networkCalls: false,
  writes: false,
});

/** The existing adapter returns {reservations:[...]}; do not infer tenant scope. */
export function buildOwnerReservationList({response, trustedShopCode} = {}) {
  if (!response || !Array.isArray(response.reservations)) fail('CAR02_OWNER_LIST_INVALID');
  const seen = new Set();
  const items = response.reservations.map(row => {
    const item = mapExistingReservationForOwner({row, trustedShopCode});
    if (seen.has(item.reservationId)) fail('CAR02_OWNER_DUPLICATE_RESERVATION');
    seen.add(item.reservationId);
    return item;
  });
  return Object.freeze({
    source: 'AUTHENTICATED_RESERVATION_RESPONSE_ONLY',
    items: Object.freeze(items),
    readOnly: true,
    liveConnected: false,
  });
}

/** Owner-list -> booking-detail, keyed on the ORIGINAL reservation UUID. */
export function selectOwnerReservation({list, reservationId} = {}) {
  if (list?.source !== 'AUTHENTICATED_RESERVATION_RESPONSE_ONLY') fail('CAR02_OWNER_LIST_UNTRUSTED');
  const item = list.items.find(x => x.reservationId === reservationId);
  if (!item) fail('CAR02_OWNER_RESERVATION_NOT_FOUND');
  return Object.freeze({
    tab: 'booking',
    selectedReservationId: item.reservationId,
    selectedCar02CaseId: null,
    detail: item,
    canReschedule: false,
    canCancel: false,
    canCreateCase: false,
  });
}

/** Booking-detail -> owner-list without losing the selected reservation. */
export function returnToOwnerList({selection} = {}) {
  if (selection?.tab !== 'booking' || !selection.selectedReservationId ||
      selection.detail?.reservationId !== selection.selectedReservationId)
    fail('CAR02_OWNER_RETURN_SELECTION_INVALID');
  return Object.freeze({tab: 'owner', selectedReservationId: selection.selectedReservationId});
}
