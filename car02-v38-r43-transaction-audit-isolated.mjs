/**
 * DPRO CAR02 V3.8 — read-only R43 transaction/replay source gap assessment.
 * DO NOT DEPLOY. This is a static examination of source bytes, NOT a database,
 * lock, signed JWT, runtime authorization, nor penetration test.
 * A PASS means known release blockers were accurately detected and NO_GO held.
 */
export const V38_MODE = Object.freeze({environment:'isolated_qa',readOnly:true,
  productionReady:false,deployable:false,realDbTransaction:false,
  realSignedJwtVerifierBound:false,realMembershipLockBound:false,
  canAuthorizeReplays:false,release:'NO_GO',migration:'HOLD'});
export const V38_EXPECTED_BLOCKERS = Object.freeze([
  'R43_TX_TIME_STAFF_MEMBERSHIP_LOCK_NOT_PROVEN',
  'R43_REPLAY_REAUTHORIZATION_NOT_PROVEN',
  'STAFF_AUTH_VERSION_DB_BINDING_NOT_PROVEN',
  'LIVE_SIGNED_JWT_PROVIDER_NOT_PROVEN',
  'R52_PRODUCTION_RELEASE_LOCK_ACTIVE'
]);
const denied=(code='CAR02_V38_REVIEW_DENIED')=>{throw Object.assign(new Error(code),{code});};
const keys=['pg','identity','edge','replay'];
const has=(s,v)=>s.includes(v);
export function auditV38R43TransactionReplaySources(bundle,{environment,allowIsolatedQa=false}={}) {
  if(environment!=='isolated_qa'||allowIsolatedQa!==true||!bundle||
    Object.getPrototypeOf(bundle)!==Object.prototype||
    Object.keys(bundle).sort().join(',')!==keys.slice().sort().join(',')||
    keys.some(k=>typeof bundle[k]!=='string'||bundle[k].length<100||bundle[k].length>300000))denied();
  const {pg,identity,edge,replay}=bundle;
  const begin=pg.indexOf("await c.query('BEGIN')");
  const replayReturn=pg.indexOf('return obj(existing.response_snapshot);');
  const authSlice=begin>=0&&replayReturn>begin?pg.slice(begin,replayReturn):'';
  // Exact source expectations are PINNED by the runner; use conservative checks.
  // Not a proof that the negative regex has enumerated all possible mechanisms.
  const checks={
    r43IsolatedCandidate:has(pg,'offline implementation candidate ONLY')&&has(pg,'Never deploy R13'),
    r43TransactionEntry:has(pg,'async transaction({actor,shop,key,intent},fn)')&&begin>=0,
    r43HasTransactionLifecycle:has(pg,"await c.query('COMMIT')")&&has(pg,"await c.query('ROLLBACK')"),
    r43HasIdempotencyScopedLock:has(pg,'pg_advisory_xact_lock(hashtextextended($1,0))')&&has(pg,'const scope=`${actor.role}:${actor.subject}`'),
    r43ReadsCompletedSnapshotUnderLock:has(pg,'response_snapshot,completed_at')&&has(pg,'idempotency_key=$3 FOR UPDATE'),
    r43ReturnsCachedSnapshot:replayReturn>begin&&has(authSlice,'if(existing)')&&has(pg,'return obj(existing.response_snapshot);'),
    r43RealTxRecheckNotDemonstrated:!/(resolveStaffAccess|lockMembershipRow|verifiedMembershipWithinTx|authVersion\s*===|FOR UPDATE\s*\/\*\s*CAR02_STAFF_MEMBERSHIP_LOCK\s*\*\/)/.test(authSlice),
    r44UsesInjectedJwtVerifier:has(identity,'verifyStaffJwt({accessToken:token})')&&has(identity,'jwt?.verified!==true'),
    r44UsesOutsideTxStaffResolver:has(identity,'resolveStaffAccess({userSub:jwt.sub,shopCode})'),
    r52ReleaseLockHardcoded:/\bconst\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/.test(edge),
    v37ReviewModelNondeployable:has(replay,"environment:'isolated_qa'")&&has(replay,'deployable:false')&&has(replay,'realDbTransaction:false')
  };
  const passed=Object.values(checks).filter(x=>x===true).length;
  return Object.freeze({mode:'SOURCE_REVIEW_ONLY',passed,total:Object.keys(checks).length,
    checks:Object.freeze(checks),release:'NO_GO',migration:'HOLD',productionReady:false,
    blockers:V38_EXPECTED_BLOCKERS,blockerCount:V38_EXPECTED_BLOCKERS.length,
    sourceDriftDetected:passed!==Object.keys(checks).length,
    status:passed===Object.keys(checks).length?'KNOWN_GAPS_CONFIRMED':'SOURCE_DRIFT_REVIEW_REQUIRED'});
}
