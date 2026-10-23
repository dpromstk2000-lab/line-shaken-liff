/**
 * DPRO CAR02 V5.01: reservation UUID -> CAR02 case, using the existing R43
 * service.create contract. This is an integration candidate, NOT a production
 * endpoint. It performs no I/O by itself and defaults to fail-closed.
 *
 * Wiring contract (trusted server only):
 *   createCar02Api({service: bindExistingReservationCaseService({
 *                      Car02ErrorClass: Car02Error, ...}),
 *                   authenticate: verifiedServerAuth, releaseEnabled})
 *
 * The server-side resolver, tenant scope, atomic unique constraint, credentials
 * and release gate must be independently verified before deployment. The UI
 * may send only {reservationId} to POST /api/car02; customer and vehicle IDs
 * are fetched from the authoritative reservation row, never guessed.
 */

export const CAR02_V501_MODE = Object.freeze({
  environment: 'isolated_review',
  productionReady: false,
  release: 'NO_GO',
  dbMigration: 'HOLD',
  releaseLock: true,
  networkCalls: false,
  directDbWrites: false,
});

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SHOP = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const KEY = /^[A-Za-z0-9_-]{12,150}$/;
const CONFIRMED = new Set([
  '入庫予定', '受付・入庫済み', '点検中', '見積作成中',
  'お客様確認待ち', '作業中', '最終確認', '引渡し可能',
]);

const fail = (code, status = 409) => {
  const e = new Error(code);
  e.code = code;
  e.status = status;
  throw e;
};
const isUuid = value => typeof value === 'string' && UUID.test(value);
const isPlain = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

function isValidDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isConfirmedHalfHour(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{2}):(00|30)(?::00)?$/.exec(value);
  return !!match && Number(match[1]) < 24;
}

/**
 * Add reservation-linked create to an existing CAR02 domain service without
 * replacing its case lifecycle methods. Direct (unlinked) create remains the
 * domain service's own authenticated operation.
 *
 * All injected functions are TRUSTED SERVER dependencies, never request data.
 * `assertAtomicUniqueLink` must verify the actual database has an enforceable
 * unique index on non-null reservation IDs; an application-side SELECT alone
 * cannot prevent concurrent duplicate cases.
 */
export function bindExistingReservationCaseService({
  service,
  resolveReservationForShop,
  findCaseByReservation,
  assertAtomicUniqueLink,
  releaseEnabled,
  Car02ErrorClass,
} = {}) {
  if (!service || typeof service.create !== 'function' ||
      typeof resolveReservationForShop !== 'function' ||
      typeof findCaseByReservation !== 'function' ||
      typeof assertAtomicUniqueLink !== 'function' ||
      typeof releaseEnabled !== 'function' ||
      typeof Car02ErrorClass !== 'function') fail('CAR02_V501_SERVER_WIRING_REQUIRED', 503);

  // R43 catches *instanceof Car02Error*. Inject the exact shared class so
  // 403/404/409/503 are not accidentally collapsed into a generic HTTP 500.
  const deny = (code, status = 409) => { throw new Car02ErrorClass(code, status); };

  return Object.freeze({
    ...service,
    async create(input) {
      // Fail closed before any lookup/write. Production releaseLock remains true.
      let unlocked = false;
      try { unlocked = (await releaseEnabled()) === true; } catch { /* fail closed */ }
      if (!unlocked) deny('CAR02_NOT_RELEASED', 503);

      // A caller without reservationId uses the existing R43 contract, but
      // never bypasses the service-level release gate.
      if (!input?.reservationId) return service.create(input);

      const actor = input.actor;
      if (!isPlain(actor) || actor.verified !== true ||
          !['owner', 'staff'].includes(actor.role) ||
          typeof actor.subject !== 'string' || !actor.subject.trim() ||
          typeof actor.shopCode !== 'string' || !SHOP.test(actor.shopCode) ||
          input.shop !== actor.shopCode) deny('CAR02_V501_STAFF_AUTH_REQUIRED', 403);
      if (!isUuid(input.reservationId)) deny('CAR02_V501_RESERVATION_UUID_REQUIRED', 422);
      if (typeof input.key !== 'string' || !KEY.test(input.key))
        deny('CAR02_V501_IDEMPOTENCY_REQUIRED', 422);

      const scope = Object.freeze({
        shopCode: actor.shopCode,
        reservationId: input.reservationId,
      });
      // Explicit DB proof is mandatory before case creation; R13 has only a
      // NON-unique reservation index in its review-only migration.
      let unique = false;
      try { unique = (await assertAtomicUniqueLink(scope)) === true; } catch { /* fail closed */ }
      if (!unique) deny('CAR02_V501_ATOMIC_UNIQUE_LINK_NOT_VERIFIED', 503);

      let row;
      try { row = await resolveReservationForShop(scope); }
      catch { deny('CAR02_V501_RESERVATION_LOOKUP_FAILED', 503); }
      if (!isPlain(row) || row.shop_code !== actor.shopCode ||
          row.id !== input.reservationId) deny('CAR02_V501_RESERVATION_NOT_FOUND', 404);
      if (!isUuid(row.customer_id) || !isUuid(row.vehicle_id))
        deny('CAR02_V501_REFERENCES_INCOMPLETE', 409);
      if (!CONFIRMED.has(row.status) || !isValidDay(row.reservation_date) ||
          !isConfirmedHalfHour(row.reservation_time))
        deny('CAR02_V501_RESERVATION_NOT_CONFIRMED', 409);

      // Optional client IDs only detect stale/mismatched UI state. They never
      // authorize or determine which customer/vehicle the work order uses.
      if ((input.customerId !== undefined && input.customerId !== row.customer_id) ||
          (input.vehicleId !== undefined && input.vehicleId !== row.vehicle_id))
        deny('CAR02_V501_CLIENT_REFERENCE_MISMATCH', 409);

      let existing;
      try { existing = await findCaseByReservation(scope); }
      catch { deny('CAR02_V501_EXISTING_LINK_LOOKUP_FAILED', 503); }
      if (existing) deny('CAR02_V501_CASE_ALREADY_LINKED', 409);

      // The R41 domain service runs assertLinks in its DB transaction. Combined
      // with the REQUIRED unique DB index, concurrent attempts cannot create a
      // second work order for this reservation even under distinct request keys.
      return service.create({
        actor,
        shop: actor.shopCode,
        customerId: row.customer_id,
        vehicleId: row.vehicle_id,
        reservationId: row.id,
        key: input.key,
      });
    },
  });
}
