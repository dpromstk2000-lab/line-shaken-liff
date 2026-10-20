/**
 * DPRO CAR02 V4.36 — review-only, single-use, transaction-scoped staff write gate.
 * NOT DEPLOYABLE. R44/R46/R50/R52 remain unchanged. The real session-attestation
 * adapter and trusted post-commit membership generation fence are NOT available.
 * Requires the V4.35 authority, whose issued objects cannot be reconstructed from
 * request JSON; neither module by itself establishes a production-ready session.
 *
 * This guard permits only static, reviewed UPDATE statements supplied at server
 * factory creation. The HTTP caller cannot provide SQL or change transaction steps.
 * The underlying pool and server-owned parameter factory are trusted; the SQL
 * pattern is a minimal safety invariant, NOT a comprehensive authorization proof.
 * No live DB, Worker, LINE, Supabase, or customer data is touched by the QA suite.
 */
export const CAR02_V436_RELEASE_LOCK = true;
const deny = () => {
  const error = new Error('CAR02_UNAUTHORIZED');
  error.code = 'CAR02_UNAUTHORIZED';
  error.status = 401;
  throw error;
};
const shopOK = x => typeof x === 'string' && x.length > 0 && x.length <= 256 && x.trim() === x;
function reviewedUpdate(sql) {
  if (typeof sql !== 'string' || sql.length > 2000) return false;
  if (/[;]|--|\/\*|\*\//.test(sql)) return false;
  const clean = sql.replace(/\s+/g, ' ').trim();
  return /^UPDATE public\.ksh_car02_work_orders SET /i.test(clean) &&
    /\bWHERE shop_code\s*=\s*\$1\b/i.test(clean) &&
    /\bRETURNING id\b/i.test(clean);
}
function prepareOperations(operations) {
  if (!operations || typeof operations !== 'object' || Array.isArray(operations))
    throw new Error('CAR02_V436_REVIEW_OPERATIONS_REQUIRED');
  const specs = new Map();
  for (const [name, item] of Object.entries(operations)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(name) || !reviewedUpdate(item?.sql) ||
        typeof item?.parameters !== 'function') {
      throw new Error('CAR02_V436_UNREVIEWED_SQL_REJECTED');
    }
    specs.set(name, Object.freeze({ sql: item.sql, parameters: item.parameters }));
  }
  if (!specs.size) throw new Error('CAR02_V436_REVIEW_OPERATIONS_REQUIRED');
  return specs;
}

/**
 * @param {object} options
 * @param {object} options.authority V4.35 createCar02ScopedStaffAuthorityR435 instance
 * @param {object} options.pool review-only pg-compatible pool
 * @param {object} options.operations server-owned static operation dictionary
 * @param {function} [options.nowMs] trusted server clock
 * @param {number} [options.capabilityMaxAgeMs=15000] short actor lifetime
 */
export function createCar02AtomicStaffWriteGateR436({
  authority, pool, operations, nowMs = () => Date.now(), capabilityMaxAgeMs = 15000
} = {}) {
  if (!CAR02_V436_RELEASE_LOCK || !authority ||
      typeof authority.authenticate !== 'function' ||
      typeof authority.assertMutation !== 'function' ||
      !pool || typeof pool.connect !== 'function' || typeof nowMs !== 'function' ||
      !Number.isSafeInteger(capabilityMaxAgeMs) || capabilityMaxAgeMs < 1 || capabilityMaxAgeMs > 60000) {
    throw new Error('CAR02_V436_SERVER_CONFIG_REQUIRED');
  }
  const specs = prepareOperations(operations);
  const issued = new WeakMap();
  const consumed = new WeakSet();
  const stillFresh = actor => {
    const recordedAt = issued.get(actor);
    const now = nowMs();
    return Number.isSafeInteger(now) && Number.isSafeInteger(recordedAt) &&
      now >= recordedAt && now - recordedAt < capabilityMaxAgeMs;
  };
  async function authenticate(request) {
    try {
      const actor = await authority.authenticate(request);
      if (!actor || typeof actor !== 'object' || !Object.isFrozen(actor) ||
          actor.verified !== true || !shopOK(actor.shopCode)) deny();
      const now = nowMs();
      if (!Number.isSafeInteger(now) || now <= 0) deny();
      issued.set(actor, now);
      return actor;
    } catch { deny(); }
  }
  async function mutate({ actor, shopCode, operation, input } = {}) {
    if (!actor || typeof actor !== 'object' || !issued.has(actor) || consumed.has(actor) ||
        !shopOK(shopCode) || actor.shopCode !== shopCode ||
        typeof operation !== 'string' || !specs.has(operation) || !stillFresh(actor)) deny();
    // Consumed BEFORE the first await so concurrent callbacks/replays cannot share
    // one actor. Even a rejected transaction cannot reuse its authorization.
    consumed.add(actor);
    let client, begun = false;
    try {
      client = await pool.connect();
      if (!client || typeof client.query !== 'function' || typeof client.release !== 'function') deny();
      await client.query('BEGIN');
      begun = true;
      await client.query("SET LOCAL lock_timeout = '2s'");
      await client.query("SET LOCAL statement_timeout = '15s'");
      await authority.assertMutation({ transactionClient: client, actor, shopCode });
      if (!stillFresh(actor)) deny();
      const spec = specs.get(operation);
      // Parameter mapping is predeclared by server code; never accept SQL or SQL
      // placeholders through the request, and always bind shop code at $1.
      const parameters = spec.parameters({ actor, shopCode, input });
      if (!Array.isArray(parameters) || parameters.length < 2 ||
          parameters[0] !== shopCode) deny();
      const result = await client.query(spec.sql, parameters);
      if (result?.rowCount !== 1) deny();
      await client.query('COMMIT');
      begun = false;
      return Object.freeze({ ok: true, operation, rowCount: 1 });
    } catch {
      if (begun && client && typeof client.query === 'function') {
        try { await client.query('ROLLBACK'); } catch { /* fail closed */ }
      }
      deny();
    } finally {
      if (client && typeof client.release === 'function') {
        try { client.release(); } catch { /* connection disposal handled by pool */ }
      }
    }
  }
  return Object.freeze({ authenticate, mutate });
}
