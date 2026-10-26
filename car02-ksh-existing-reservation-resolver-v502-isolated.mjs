/**
 * DPRO CAR02 V5.02 / CURRENT KSH WORKER SOURCE-ALIGNED READ-ONLY RESOLVER.
 *
 * Source observed 2026-10-26: ksh-line-demo-api deployed code, supplied by
 * owner as a text copy (health step KSH-PHONE-1-20260709).
 *
 * This module is NOT bound to the Worker, CAR02 router, auth or production DB.
 * It makes no network requests or database writes. The injected `readRows`
 * function must be the existing KSH Worker server-side `supabase(env, path)`
 * and must NEVER come from an untrusted browser request.
 *
 * Compatible with V5.01's `resolveReservationForShop({shopCode,reservationId})`
 * injection point. The caller must separately validate a real authenticated
 * owner/staff actor, release gate, one-case-per-reservation UNIQUE index and
 * tenant-scoped CAR02 case store. DASHBOARD_TOKEN alone is not an actor.
 */

export const CAR02_V502_KSH_MODE = Object.freeze({
  reviewOnly: true,
  deployed: false,
  releaseLock: true,
  release: 'NO_GO',
  dbMigration: 'HOLD',
  writes: false,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHOP = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const FIELDS = 'id,shop_code,customer_id,vehicle_id,reservation_date,reservation_time,status';

function plainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function requireScope(scope) {
  if (!plainRecord(scope) || typeof scope.shopCode !== 'string' ||
      !SHOP.test(scope.shopCode) || typeof scope.reservationId !== 'string' ||
      !UUID.test(scope.reservationId)) {
    throw new Error('CAR02_V502_KSH_SCOPE_INVALID');
  }
}

/** This returns a relative PostgREST table path, not a public URL. */
export function buildKshReservationByIdPath(scope) {
  requireScope(scope);
  const shop = encodeURIComponent(scope.shopCode);
  const id = encodeURIComponent(scope.reservationId);
  return `ksh_demo_reservations?select=${FIELDS}&id=eq.${id}&shop_code=eq.${shop}&limit=1`;
}

/**
 * @param {{readRows: (serverOnlyRelativePath:string)=>Promise<unknown>}} options
 * `readRows` must be bound in trusted Worker code after authentication.
 */
export function makeKshReservationByIdResolver({readRows} = {}) {
  if (typeof readRows !== 'function') throw new Error('CAR02_V502_KSH_SERVER_READER_REQUIRED');

  return async function resolveReservationForShop(scope) {
    const path = buildKshReservationByIdPath(scope);
    let rows;
    try {
      rows = await readRows(path);
    } catch {
      throw new Error('CAR02_V502_KSH_RESERVATION_READ_FAILED');
    }
    if (!Array.isArray(rows) || rows.length > 1)
      throw new Error('CAR02_V502_KSH_RESERVATION_RESPONSE_INVALID');
    if (rows.length === 0) return null;

    const row = rows[0];
    if (!plainRecord(row) || row.id !== scope.reservationId ||
        row.shop_code !== scope.shopCode) {
      throw new Error('CAR02_V502_KSH_RESERVATION_SCOPE_MISMATCH');
    }
    // Leave reference UUID, confirmed status and time checks to V5.01.
    // A KSH booking may legitimately have vehicle_id=null before completion.
    return Object.freeze({
      id: row.id,
      shop_code: row.shop_code,
      customer_id: row.customer_id,
      vehicle_id: row.vehicle_id,
      reservation_date: row.reservation_date,
      reservation_time: row.reservation_time,
      status: row.status,
    });
  };
}
