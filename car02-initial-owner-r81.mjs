// DPRO CAR02 R81 — initial-owner bootstrap, ISOLATED POSTGRES QA ONLY.
// NOT a production deployable module; NOT wired into R50/R52, Edge, browser, or LINE.
// This isolated transaction can run ONLY if PostgreSQL itself reports a designated
// QA database name. Replacing that guard requires a SEPARATE approved release review.
// Two approvals must be independently verified by a trusted SERVER-SIDE backoffice.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHOP = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const QA_DATABASE = /^car02_r81_qa_[a-z0-9_]{1,48}$/;
const fail = code => { throw Error(code); };
const validUuid = x => typeof x === 'string' && UUID.test(x);
const cleanError = e => {
  if (typeof e?.message === 'string' && /^CAR02_R81_[A-Z_]+$/.test(e.message)) return e;
  return Error('CAR02_R81_BOOTSTRAP_BLOCKED');
};
function validateInput(shopCode, {candidateUserSub, requestId, reason} = {}) {
  if (typeof shopCode !== 'string' || !SHOP.test(shopCode)) fail('CAR02_R81_SHOP_INVALID');
  if (!validUuid(candidateUserSub) || !validUuid(requestId)) fail('CAR02_R81_INPUT_INVALID');
  if (typeof reason !== 'string' || reason !== reason.trim() || reason.length < 12 || reason.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(reason)) fail('CAR02_R81_REASON_REQUIRED');
  return {candidateUserSub: candidateUserSub.toLowerCase(), requestId: requestId.toLowerCase(), reason};
}
function verifyCandidate(x, candidateUserSub) {
  // The callback MUST independently consult Supabase Auth's server-verified,
  // non-anonymous, non-deleted and non-banned user state (not client JWT claims).
  if (x?.verified !== true || x.userSub !== candidateUserSub || x.active !== true ||
      x.isAnonymous !== false || x.deleted !== false || x.banned !== false ||
      x.source !== 'SUPABASE_AUTH_SERVER') fail('CAR02_R81_IDENTITY_REJECTED');
}
function verifyApprovals(x, {shopCode,candidateUserSub,requestId}, now) {
  // loadTrustedApprovals must read a separately stored, signed-and-reviewed
  // authoritative approval record; no approval fields are accepted from the request.
  if (x?.verified !== true || x.source !== 'CENTRAL_VERIFIED_REVIEW' ||
      x.shopCode !== shopCode || x.candidateUserSub !== candidateUserSub || x.requestId !== requestId ||
      !Number.isSafeInteger(x.issuedAtSec) || !Number.isSafeInteger(x.expiresAtSec) ||
      x.issuedAtSec > now || x.issuedAtSec < now-86400 || x.expiresAtSec <= now ||
      x.expiresAtSec > x.issuedAtSec + 86400 ||
      !Array.isArray(x.approvers) || x.approvers.length !== 2) fail('CAR02_R81_APPROVAL_REQUIRED');
  const [a,b] = x.approvers;
  for (const reviewer of [a,b]) {
    if (!validUuid(reviewer?.userSub) || reviewer.userSub === candidateUserSub ||
        reviewer.verified !== true || reviewer.role !== 'central_reviewer' ||
        !Number.isSafeInteger(reviewer.approvedAtSec) ||
        reviewer.approvedAtSec < x.issuedAtSec || reviewer.approvedAtSec > now) fail('CAR02_R81_APPROVAL_REQUIRED');
  }
  if (a.userSub.toLowerCase() === b.userSub.toLowerCase()) fail('CAR02_R81_APPROVAL_REQUIRED');
  return {reviewer1: a.userSub.toLowerCase(), reviewer2: b.userSub.toLowerCase()};
}
/**
 * Isolated QA-only initial-owner grant. There is intentionally NO HTTP wrapper,
 * no browser token input, and no application runtime import.
 * This is NOT the future production bootstrap entrypoint.
 */
export function createCar02InitialOwnerIsolatedR81({pool,shopCode,verifyCandidateAuth,loadTrustedApprovals,nowSeconds=()=>Math.floor(Date.now()/1000)}={}) {
  if (!pool || typeof pool.connect !== 'function' || typeof verifyCandidateAuth !== 'function' ||
      typeof loadTrustedApprovals !== 'function' || typeof nowSeconds !== 'function' ||
      typeof shopCode !== 'string' || !SHOP.test(shopCode)) fail('CAR02_R81_CONFIG_INVALID');
  return async function bootstrapInitialOwner(input={}) {
    const {candidateUserSub,requestId,reason}=validateInput(shopCode,input);
    let user;
    try { user=await verifyCandidateAuth({userSub:candidateUserSub}); }
    catch { fail('CAR02_R81_IDENTITY_REJECTED'); }
    verifyCandidate(user,candidateUserSub);
    let approval;
    try { approval=await loadTrustedApprovals({shopCode,candidateUserSub,requestId}); }
    catch { fail('CAR02_R81_APPROVAL_REQUIRED'); }
    const reviewers=verifyApprovals(approval,{shopCode,candidateUserSub,requestId},nowSeconds());
    let client, started=false;
    try {
      client=await pool.connect();
      await client.query('BEGIN'); started=true;
      await client.query("SET LOCAL lock_timeout='2s'");
      await client.query("SET LOCAL statement_timeout='20s'");
      // Query identity INSIDE transaction, from the DB. Caller cannot override.
      const db=await client.query('SELECT current_database() AS name');
      if (db.rows?.length !== 1 || typeof db.rows[0]?.name !== 'string' ||
          !QA_DATABASE.test(db.rows[0].name)) fail('CAR02_R81_ISOLATION_REQUIRED');
      const sh=await client.query('SELECT shop_code FROM public.ksh_demo_shop_settings WHERE shop_code=$1 FOR UPDATE',[shopCode]);
      if (sh.rows?.length !== 1 || sh.rows[0]?.shop_code !== shopCode) fail('CAR02_R81_SHOP_NOT_FOUND');
      // Recheck expiry after acquiring the exclusive shop lock.
      verifyApprovals(approval,{shopCode,candidateUserSub,requestId},nowSeconds());
      // First owner only. Existing INACTIVE rows also block a second bootstrap.
      const existing=await client.query('SELECT count(*)::integer AS n FROM public.ksh_car02_staff_access WHERE shop_code=$1',[shopCode]);
      if (existing.rows?.length !== 1 || existing.rows[0]?.n !== 0) fail('CAR02_R81_ALREADY_INITIALIZED');
      const grant=await client.query(`INSERT INTO public.ksh_car02_staff_access
        (shop_code,user_sub,staff_role,active,grant_source)
        VALUES($1,$2,'owner',TRUE,'bootstrap-reviewed-r81')
        RETURNING shop_code,user_sub,staff_role,active`,[shopCode,candidateUserSub]);
      const g=grant.rows?.[0];
      if (grant.rows?.length !== 1 || g?.shop_code !== shopCode ||
          g?.user_sub !== candidateUserSub || g?.staff_role !== 'owner' || g?.active !== true)
        fail('CAR02_R81_GRANT_FAILED');
      const audit=await client.query(`INSERT INTO public.ksh_car02_owner_bootstrap_audit
        (shop_code,candidate_user_sub,request_id,reviewer_one_sub,reviewer_two_sub,reason)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [shopCode,candidateUserSub,requestId,reviewers.reviewer1,reviewers.reviewer2,reason]);
      if (audit.rows?.length !== 1 || !Number.isSafeInteger(Number(audit.rows[0]?.id)))
        fail('CAR02_R81_AUDIT_FAILED');
      // Recheck the trusted approvals at commit time (not only pre-lock).
      verifyApprovals(approval,{shopCode,candidateUserSub,requestId},nowSeconds());
      await client.query('COMMIT'); started=false;
      return Object.freeze({initialized:true,shopCode,ownerUserSub:candidateUserSub,reviewOnly:true});
    } catch(e) {
      if (started && client) { try { await client.query('ROLLBACK'); } catch {} }
      throw cleanError(e);
    } finally { try { client?.release(); } catch {} }
  };
}
