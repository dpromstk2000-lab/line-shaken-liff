/**
 * DPRO CAR02 V4.35 — REVIEW-ONLY STAFF ACTOR ORIGIN BOUNDARY.
 * DO NOT DEPLOY. Never import this into R44/R46/R50/R52 or expose it via the browser.
 *
 * The V4.34 transaction assertion compares a version and role from an actor value,
 * but the object itself can be reconstructed by a caller. This isolated candidate
 * proves an additional same-process origin check before the V4.34 DB row lock.
 *
 * This is NOT a guarantee that the surrounding HTTP runtime passes only server-
 * issued actors, nor that SQL transaction boundaries are correctly implemented.
 * Real Supabase provider attestation and a trusted AFTER-COMMIT generation fence
 * do not exist in this module. Existing production release restrictions apply.
 */
import {
  CAR02_V434_RELEASE_LOCK,
  createCar02GenerationBoundStaffAuthR434,
  assertCar02StaffMutationGenerationR434
} from './car02-staff-generation-r434.mjs';

export const CAR02_V435_RELEASE_LOCK = true;
function unauthorized() {
  const err = new Error('CAR02_UNAUTHORIZED');
  err.code = 'CAR02_UNAUTHORIZED';
  err.status = 401;
  throw err;
}

/**
 * Review-only factory: issuance returns the original frozen V4.34 actor object.
 * The weak reference registry rejects JSON/copy/forged actors at the write gate.
 * A registry is scoped to this runtime; it is deliberately lost on restart.
 * After this check, a DB read with FOR UPDATE must still occur in the SAME
 * transaction as the protected business mutation and its COMMIT/ROLLBACK.
 */
export function createCar02ScopedStaffAuthorityR435(config = {}) {
  if (CAR02_V434_RELEASE_LOCK !== true || CAR02_V435_RELEASE_LOCK !== true) {
    throw new Error('CAR02_V435_RELEASE_LOCK_REQUIRED');
  }
  const authenticateR434 = createCar02GenerationBoundStaffAuthR434(config);
  const issuedActors = new WeakSet();

  async function authenticate(request) {
    const actor = await authenticateR434(request);
    if (!actor || typeof actor !== 'object' || !Object.isFrozen(actor) ||
        actor.verified !== true || !Object.hasOwn(actor, 'authVersion') ||
        !Object.hasOwn(actor, 'providerSessionId')) unauthorized();
    issuedActors.add(actor);
    return actor;
  }

  async function assertMutation({ transactionClient, actor, shopCode } = {}) {
    // Never trust an equivalent-looking actor supplied by JSON, a different
    // authority instance, a demo token, or a caller's role/body fields.
    if (!actor || typeof actor !== 'object' || !issuedActors.has(actor)) unauthorized();
    try {
      return await assertCar02StaffMutationGenerationR434({
        transactionClient, actor, shopCode
      });
    } catch { unauthorized(); }
  }

  return Object.freeze({ authenticate, assertMutation });
}
