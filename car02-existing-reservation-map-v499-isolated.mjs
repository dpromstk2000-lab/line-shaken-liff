/**
 * DPRO CAR02 V4.99: existing reservation -> common owner card adapter.
 * Isolated, read-only data mapping. Never fetches, inserts, patches or deletes.
 * A trusted server must independently enforce authentication and shop scope.
 */
export const CAR02_V499_MODE = Object.freeze({
  environment: 'isolated_review',
  productionReady: false,
  release: 'NO_GO',
  dbMigration: 'HOLD',
  networkCalls: false,
  businessWrites: false,
});

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHOP = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const safeText = (value, max = 150) => typeof value === 'string' && value.length <= max ? value : '';
const fail = code => { throw Object.assign(new Error(code), {code}); };
const isUuid = value => typeof value === 'string' && UUID.test(value);

function validDay(day) {
  if (typeof day !== 'string' || !DATE.test(day)) return false;
  const parsed = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}

function normalizeHalfHour(value) {
  // A provisional reservation can have no time yet. Keep it visible to the
  // owner, but never synthesize an available slot or an editable booking.
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') fail('CAR02_RESERVATION_TIME_INVALID');
  const match = /^(\d{2}):(\d{2})(?::00)?$/.exec(value);
  if (!match) fail('CAR02_RESERVATION_TIME_INVALID');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || (minute !== 0 && minute !== 30)) fail('CAR02_RESERVATION_HALF_HOUR_REQUIRED');
  return `${match[1]}:${match[2]}`;
}

/**
 * Input is a tenant-scoped row returned by the existing reservation backend,
 * not a browser-provided claim. `trustedShopCode` comes from a verified session.
 * The originating reservation UUID remains separate from the CAR02 case UUID.
 */
export function mapExistingReservationForOwner({row, trustedShopCode} = {}) {
  if (!SHOP.test(trustedShopCode || '')) fail('CAR02_TRUSTED_SHOP_REQUIRED');
  if (!row || typeof row !== 'object' || Array.isArray(row)) fail('CAR02_RESERVATION_ROW_INVALID');
  if (row.shop_code !== trustedShopCode) fail('CAR02_RESERVATION_SHOP_MISMATCH');
  if (!isUuid(row.id) || !isUuid(row.customer_id)) fail('CAR02_RESERVATION_REFERENCE_INVALID');
  if (row.vehicle_id !== null && row.vehicle_id !== undefined && !isUuid(row.vehicle_id))
    fail('CAR02_RESERVATION_VEHICLE_REFERENCE_INVALID');
  if (!validDay(row.reservation_date)) fail('CAR02_RESERVATION_DATE_INVALID');
  const time = normalizeHalfHour(row.reservation_time);
  return Object.freeze({
    source: 'EXISTING_RESERVATION_READONLY',
    reservationId: row.id,
    car02CaseId: null, // must be resolved by the trusted backend; never forge it
    customerId: row.customer_id,
    vehicleId: row.vehicle_id ?? null,
    shopCode: trustedShopCode,
    customerLabel: safeText(row.customer?.name || row.customer_name || ''),
    vehicleLabel: safeText(row.vehicle?.car_name || row.vehicle_name || row.car_name || ''),
    day: row.reservation_date,
    time,
    start: time === null ? null : `${row.reservation_date}T${time}`,
    displayStart: time === null ? `${row.reservation_date} 時間未定` : `${row.reservation_date} ${time}`,
    timeNeedsConfirmation: time === null,
    workType: safeText(row.work_type || '', 80),
    status: safeText(row.status || '', 40),
    readOnly: true,
    sendable: false,
  });
}

/** Document existing routes without constructing executable requests. */
export const EXISTING_RESERVATION_ROUTE_MAP = Object.freeze({
  list: Object.freeze({method: 'GET', path: '/api/reservations', scope: 'staff_verified'}),
  create: Object.freeze({method: 'POST', path: '/api/reservations', scope: 'staff_verified'}),
  edit: Object.freeze({method: 'PATCH', path: '/api/reservations/{reservationId}', scope: 'staff_verified'}),
  softDelete: Object.freeze({method: 'DELETE', path: '/api/reservations/{reservationId}', scope: 'staff_verified'}),
  intakeInquiry: Object.freeze({method: 'POST', path: '/api/inquiries', scope: 'customer_intake_only'}),
});
