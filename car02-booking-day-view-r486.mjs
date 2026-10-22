/**
 * CAR02 V4.86 — bounded, synthetic, read-only booking-day view model.
 * It projects the exact V4.85 candidate rule into UI time rows; it does not
 * grant booking authority or query any real calendars or external services.
 */
import {
  CAR02_V485_RELEASE_LOCK,
  CAR02_V485_MAX_BOOKING_DAYS,
  CAR02_V485_SLOT_MINUTES,
  evaluateCar02BookingCalendarR485
} from './car02-booking-calendar-policy-r485.mjs';

export const CAR02_V486_RELEASE_LOCK = true;
export const CAR02_V486_SLOT_COUNT = 18;
export const CAR02_V486_FIRST_SLOT = '09:00';
export const CAR02_V486_LAST_SLOT = '17:30';

const expectedKeys = new Set(['day', 'calendar', 'now']);
const allowedResultReasons = new Set([
  'candidate_available_offline_only',
  'synthetic_slot_occupied',
  'booking_date_outside_open_window'
]);
const formatTime = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const TIMES = Object.freeze(Array.from({length: CAR02_V486_SLOT_COUNT}, (_, i) => formatTime(540 + i * 30)));

function hold(reason) {
  return Object.freeze({
    systemCode: 'CAR02', version: 'V4.86', environment: 'isolated_qa',
    decision: 'HOLD', commercialDecision: 'NO_GO_HOLD', releaseLock: true,
    reason, day: null, slots: Object.freeze([]), candidateTimes: Object.freeze([]),
    candidateCount: 0, displayCandidateSlots: false,
    bookingCreationAllowed: false, authenticatedCapacityVerified: false,
    nationalHolidayProviderChecked: false, ownerCalendarApprovalVerified: false,
    databaseMutationAllowed: false, lineDispatchAllowed: false,
    commercialProviderProofsVerified: 0, requiredCommercialProviderProofs: 7
  });
}

function completed(day, slots, candidateTimes) {
  return Object.freeze({
    systemCode: 'CAR02', version: 'V4.86', environment: 'isolated_qa',
    decision: 'HOLD', commercialDecision: 'NO_GO_HOLD', releaseLock: true,
    reason: 'synthetic_day_projection_only', day,
    slots: Object.freeze(slots), candidateTimes: Object.freeze(candidateTimes),
    candidateCount: candidateTimes.length, displayCandidateSlots: candidateTimes.length > 0,
    bookingCreationAllowed: false, authenticatedCapacityVerified: false,
    nationalHolidayProviderChecked: false, ownerCalendarApprovalVerified: false,
    databaseMutationAllowed: false, lineDispatchAllowed: false,
    commercialProviderProofsVerified: 0, requiredCommercialProviderProofs: 7
  });
}

function isSafeOptions(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return false;
  const entries = Object.entries(Object.getOwnPropertyDescriptors(input));
  return entries.length === expectedKeys.size &&
    entries.every(([key, desc]) => expectedKeys.has(key) && Object.hasOwn(desc, 'value'));
}

/** Returns only synthetic display candidates. Never executes a booking. */
export function buildCar02BookingDayViewR486(input) {
  try {
    if (!isSafeOptions(input)) return hold('input_shape_invalid');
    const {day, calendar, now} = input;
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day))
      return hold('day_shape_invalid');
    if (!(now instanceof Date) || Object.getPrototypeOf(now) !== Date.prototype ||
        Object.keys(now).length !== 0 || !Number.isFinite(Date.prototype.getTime.call(now)))
      return hold('clock_invalid');
    if (CAR02_V486_RELEASE_LOCK !== true || CAR02_V485_RELEASE_LOCK !== true ||
        CAR02_V485_SLOT_MINUTES !== 30 || CAR02_V485_MAX_BOOKING_DAYS !== 60)
      return hold('baseline_rule_unpinned');

    const slots = [], candidateTimes = [];
    for (const time of TIMES) {
      const result = evaluateCar02BookingCalendarR485({selection: {day, time}, calendar, now});
      if (result.releaseLock !== true || result.bookingCreationAllowed !== false ||
          result.commercialDecision !== 'NO_GO_HOLD' ||
          !allowedResultReasons.has(result.reason)) return hold(result.reason || 'baseline_denied');

      const state = result.reason === 'candidate_available_offline_only' ? 'candidate' :
        result.reason === 'synthetic_slot_occupied' ? 'occupied' : 'elapsed_or_out_of_window';
      slots.push(Object.freeze({time, state, selectableInOfflineUi: state === 'candidate'}));
      if (state === 'candidate') candidateTimes.push(time);
    }
    // Out-of-window days must not present a plausible calendar grid at all.
    if (slots.every(slot => slot.state === 'elapsed_or_out_of_window'))
      return hold('no_future_slots_in_booking_window');
    return completed(day, slots, candidateTimes);
  } catch {
    // A hostile proxy, getter, modified Date or malformed fixture is a HOLD.
    return hold('untrusted_input_rejected');
  }
}
