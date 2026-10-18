/** DPRO CAR02 V4.3: synthetic signed-session -> membership -> idempotent replay bridge.
 * REVIEW ONLY. A callback saying FOR_UPDATE is NOT proof of an actual PostgreSQL lock.
 * No release, no live authentication, no SQL, no production DB and no Worker import.
 */
import {createHash} from 'node:crypto';
import {V42_MODE} from './car02-v42-signed-session-binding-isolated.mjs';
export const V43_MODE=Object.freeze({environment:'isolated_qa',deployable:false,
  usesSyntheticSignedSessions:true,realDatabase:false,realRowLockProven:false,
  transactionCommitProof:false,release:'NO_GO'});
const DENY='CAR02_V43_QA_DENIED';
const deny=()=>{const e=new Error(DENY);e.code=DENY;throw e;};
const plain=o=>!!o&&typeof o==='object'&&!Array.isArray(o)&&Object.getPrototypeOf(o)===Object.prototype;
const safe=s=>typeof s==='string'&&s.length>=1&&s.length<=128&&s===s.trim()&&/^[A-Za-z0-9_.:-]+$/.test(s);
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const has=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const validDigest=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const OPS=new Set(['create','report','present','complete']);
function assertOpen(tx,txId){if(!tx||tx.state!=='open'||tx.id!==txId)deny();}
/** Executed only with explicitly injected QA callbacks: nothing writes to any database.
 * The actual backend must later separately prove PostgreSQL row lock serialization,
 * transaction rollback, durable idempotency, and principal-version issuance.
 */
export async function v43QaSignedTxReplay({environment,allowIsolatedQa,lab,token,tx,
  shopCode,operation,idempotencyKey,intentDigest,lockMembership,readReplay,mutate}={}) {
  if(environment!=='isolated_qa'||allowIsolatedQa!==true||!lab||lab.mode!==V42_MODE||
    typeof lab.verify!=='function'||typeof lab.authorize!=='function'||!plain(tx)||
    !safe(tx.id)||tx.state!=='open'||!safe(shopCode)||!OPS.has(operation)||
    !safe(idempotencyKey)||idempotencyKey.length<12||!validDigest(intentDigest)||
    typeof lockMembership!=='function'||typeof readReplay!=='function'||
    typeof mutate!=='function')deny();
  const txId=tx.id;
  try {
    // Verify SIGNATURE and time first. Signing keys are synthetic/ephemeral in tests.
    const verified=lab.verify(token);
    if(!verified||verified.shopCode!==shopCode)deny();
    assertOpen(tx,txId);
    // The callback must obtain an actual conflicting row lock IN THIS transaction
    // in any future deployable implementation; here it is purely a synthetic claim.
    const lock=await lockMembership(Object.freeze({txId,shopCode,userSub:verified.subject}));
    assertOpen(tx,txId);
    if(!plain(lock)||lock.txId!==txId||lock.lockKind!=='FOR_UPDATE'||!plain(lock.row))deny();
    const decision=lab.authorize({verifiedIdentity:verified,lockedMembership:lock.row,shopCode});
    assertOpen(tx,txId);
    const scopeDigest=sha([shopCode,decision.subject,decision.role,operation,idempotencyKey,intentDigest]);
    const saved=await readReplay(Object.freeze({txId,shopCode,scopeDigest}));
    assertOpen(tx,txId);
    if(saved!==null){
      if(!plain(saved)||saved.completed!==true||saved.shopCode!==shopCode||
        saved.subject!==decision.subject||saved.role!==decision.role||
        saved.authVersion!==decision.authVersion||saved.scopeDigest!==scopeDigest||
        saved.intentDigest!==intentDigest||!has(saved,'snapshot'))deny();
      return Object.freeze({mode:'replay',result:structuredClone(saved.snapshot),scopeDigest,reviewOnly:true});
    }
    const value=await mutate(Object.freeze({txId,shopCode,subject:decision.subject,
      role:decision.role,authVersion:decision.authVersion,scopeDigest,intentDigest}));
    assertOpen(tx,txId);
    return Object.freeze({mode:'new',result:structuredClone(value),scopeDigest,reviewOnly:true});
  } catch {deny();}
}
