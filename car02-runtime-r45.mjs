// DPRO CAR02 R45 — Node/PostgreSQL staging assembly for disposable QA ONLY.
// Not a Cloudflare Worker bundle. Not a production endpoint or a substitute for
// cryptographically authoritative LINE/Supabase staff verification.
// No default auth, demo token, default approval, or fallback tenant is provided.
import { createCar02Api } from './car02-api.mjs';
import { createCar02Service } from './car02-core.mjs';
import { createCar02Authenticator, createCar02ReleaseGate } from './car02-identity-r44.mjs';
import { createCar02PgAdapter } from './car02-pg-adapter.mjs';

export function createCar02RuntimeR45({
  pool, shopCode, lineClientId, verifyLineIdToken, verifyStaffJwt,
  resolveLineCustomer, resolveStaffAccess, releaseState, allowedOrigins = [],
  nowSeconds
} = {}) {
  if (!pool || typeof pool.connect !== 'function') throw Error('CAR02_POOL_REQUIRED');
  if (!Array.isArray(allowedOrigins) || allowedOrigins.some(x => typeof x !== 'string' || !/^https:\/\//.test(x)))
    throw Error('CAR02_ORIGIN_ALLOWLIST_INVALID');
  // The callbacks MUST be implemented by a trusted server; callers MUST NOT
  // derive their return values from JSON, request query parameters or demo tokens.
  const authenticate = createCar02Authenticator({
    shopCode, lineClientId, verifyLineIdToken, verifyStaffJwt,
    resolveLineCustomer, resolveStaffAccess, ...(nowSeconds ? {nowSeconds} : {})
  });
  if (releaseState === undefined) throw Error('CAR02_RELEASE_GATE_REQUIRED');
  const releaseEnabled = createCar02ReleaseGate(releaseState);
  const service = createCar02Service(createCar02PgAdapter(pool));
  return createCar02Api({service, authenticate, releaseEnabled, allowedOrigins});
}
