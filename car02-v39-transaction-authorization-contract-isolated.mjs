/**
 * DPRO CAR02 V3.9 — isolated QA design contract for R43 authorization and replay.
 * THIS IS NOT A PATCH TO R43, NOT A DB LOCK, NOT REAL JWT VERIFICATION, NOT DEPLOYABLE.
 * The callback named lockMembership MUST BE transaction-bound and take a conflicting
 * PostgreSQL row lock with all staff revocation/version updates in a future impl.
 * The runner intentionally only simulates that contract. The live implementation
 * remains NO_GO until independently reviewed and tested in disposable PostgreSQL.
 */
import { createHash } from 'node:crypto';

export const V39_MODE = Object.freeze({environment:'isolated_qa',deployable:false,
  liveAuthentication:false,realDbTransaction:false,realRowLock:false,
  R43Patched:false,release:'NO_GO',migration:'HOLD'});
const DENY='CAR02_V39_QA_DENIED';
const deny=()=>{const e=new Error(DENY);e.code=DENY;throw e;};
const plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const safe=s=>typeof s==='string'&&s.length>=1&&s.length<=256&&s.trim()===s&&!/\s/.test(s);
const sha=s=>createHash('sha256').update(s).digest('hex');
const OPS=new Set(['create','report','present','complete']);
const roleSet=new Set(['owner','staff']);
const validVersion=v=>Number.isSafeInteger(v)&&v>0;
const validTime=v=>Number.isSafeInteger(v)&&v>0;
const finiteNow=v=>Number.isSafeInteger(v)&&v>0;

/** Scope of an operation; use exactly the same intent hash for first write/retry.
 * Operation data is reduced to a *server calculated* digest by the caller.
 */
export function v39QaScopeDigest({shopCode,subject,role,operation,key,intentDigest}) {
  if(![shopCode,subject,intentDigest].every(safe)||!roleSet.has(role)||!OPS.has(operation)||
    typeof key!=='string'||key.length<12||key.length>150||!/^[-_A-Za-z0-9]+$/.test(key)||
    !/^[a-f0-9]{64}$/.test(intentDigest))deny();
  return sha(JSON.stringify([shopCode,subject,role,operation,key,intentDigest]));
}

/**
 * Stage-only reference contract. Caller already began a transaction; callback
 * lockMembership must lock the staff row within THAT SAME transaction and all
 * revocation writers must acquire a conflicting lock on the same row.
 * No callback can bypass this barrier for a completed idempotency replay.
 */
export async function v39QaTxAuthorizeAndReplay({
  environment,allowIsolatedQa=false,tx,actor,claims,shopCode,operation,
  idempotencyKey,intentDigest,expectedIssuer,expectedAudience,
  nowSeconds=()=>Math.floor(Date.now()/1000),lockMembership,readReplay,mutate
}={}) {
  if(environment!=='isolated_qa'||allowIsolatedQa!==true||!tx||tx.state!=='open'||
    !safe(tx.id)||!plain(actor)||actor.verified!==true||!safe(shopCode)||
    actor.shopCode!==shopCode||!roleSet.has(actor.role)||!safe(actor.subject)||
    !actor.subject.startsWith('staff:')||!safe(actor.subject.slice(6))||
    !OPS.has(operation)||!plain(claims)||claims.cryptographicallyVerified!==true||
    !safe(expectedIssuer)||!safe(expectedAudience)||claims.iss!==expectedIssuer||
    claims.aud!==expectedAudience||!safe(claims.sub)||actor.subject!==`staff:${claims.sub}`||
    !validVersion(claims.authVersion)||!validTime(claims.exp)||
    !finiteNow(nowSeconds())||claims.exp<=nowSeconds()||
    (claims.nbf!==undefined&&(!validTime(claims.nbf)||claims.nbf>nowSeconds()))||
    typeof lockMembership!=='function'||typeof readReplay!=='function'||
    typeof mutate!=='function')deny();
  const scopeDigest=v39QaScopeDigest({shopCode,subject:actor.subject,role:actor.role,
    operation,key:idempotencyKey,intentDigest});
  let lease;
  try {
    // MUST occur after BEGIN and before reading cached responses, locks held until COMMIT.
    lease=await lockMembership(Object.freeze({txId:tx.id,userSub:claims.sub,shopCode}));
    if(!plain(lease)||lease.lockKind!=='FOR_UPDATE'||lease.txId!==tx.id||
      lease.shopCode!==shopCode||lease.userSub!==claims.sub||lease.active!==true||
      !roleSet.has(lease.role)||lease.role!==actor.role||
      !validVersion(lease.authVersion)||lease.authVersion!==claims.authVersion)deny();
    // Lease evidence is advisory in this simulated model, NOT proof of a DB lock.
    if(tx.state!=='open')deny();
    const saved=await readReplay(Object.freeze({txId:tx.id,scopeDigest,shopCode}));
    if(tx.state!=='open')deny();
    if(saved!==null) {
      if(!plain(saved)||saved.scopeDigest!==scopeDigest||saved.shopCode!==shopCode||
        saved.actorSubject!==actor.subject||saved.actorRole!==actor.role||
        saved.intentDigest!==intentDigest||saved.completed!==true||
        !validVersion(saved.authVersion)||saved.authVersion!==claims.authVersion||
        !Object.prototype.hasOwnProperty.call(saved,'snapshot'))deny();
      return structuredClone(saved.snapshot);
    }
    const result=await mutate(Object.freeze({txId:tx.id,shopCode,subject:actor.subject,
      role:actor.role,scopeDigest,authVersion:claims.authVersion}));
    if(tx.state!=='open')deny();
    return structuredClone(result);
  } catch {deny();}
}
