/**
 * DPRO CAR02 V3.5 — transaction-time staff revalidation contract, ISOLATED QA ONLY.
 * The injected callback is a synthetic lock/read; this file does not connect to a DB,
 * establish real PostgreSQL locks, verify signatures, or patch R43/R44/R52.
 * Cannot be deployed, used to authorize production or relied upon as a SQL lock.
 */
import {createHash} from 'node:crypto';

export const V35_MODE=Object.freeze({environment:'isolated_qa',databaseConnected:false,
  realTransactionLockVerified:false,realSignedJwtVerifierBound:false,
  realMembershipPersistenceBound:false,productionReady:false,deployable:false,
  release:'NO_GO',migration:'HOLD'});
const deny=()=>{throw Object.assign(new Error('CAR02_V35_QA_DENIED'),{code:'CAR02_V35_QA_DENIED'});};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const clean=x=>typeof x==='string'&&x.length>0&&x.length<=256&&x.trim()===x&&!/\s/.test(x);
const sec=x=>Number.isSafeInteger(x)&&x>0;
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const ops=new Set(['create','report','present','complete']);
/**
 * Exercises an application-level transaction boundary by reading a fresh staff row
 * immediately before invoking synthetic work. DO NOT treat the lockHeld flag as
 * cryptographic or database evidence: only a real same-transaction FOR UPDATE lock
 * could provide the required production guarantee, which is NOT implemented here.
 */
export function createV35QaStaffMutationGate({environment,allowIsolatedQa=false,
  lockMembershipRow,nowSeconds=()=>Math.floor(Date.now()/1000)}={}){
  if(environment!=='isolated_qa'||allowIsolatedQa!==true||
    typeof lockMembershipRow!=='function'||typeof nowSeconds!=='function')deny();
  return async function simulateMutation({actor,shopCode,operation,work}={}){
    if(!plain(actor)||actor.verified!==true||!clean(shopCode)||
       actor.shopCode!==shopCode||!['staff','owner'].includes(actor.role)||
       !clean(actor.subject)||!actor.subject.startsWith('staff:')||
       !clean(actor.subject.slice(6))||!ops.has(operation)||typeof work!=='function')deny();
    const userSub=actor.subject.slice(6);
    let result,now;
    try{
      now=nowSeconds();
      result=await lockMembershipRow(Object.freeze({userSub,shopCode,operation}));
    }catch{deny();}
    if(!sec(now)||!plain(result)||result.lockHeld!==true||
       !Array.isArray(result.rows)||result.rows.length!==1||!plain(result.rows[0]))deny();
    const r=result.rows[0];
    if(!uuid(r.membershipId)||r.userSub!==userSub||r.shopCode!==shopCode||
       r.active!==true||r.suspended!==false||r.revokedAt!==null||
       r.role!==actor.role||!Number.isSafeInteger(r.authVersion)||r.authVersion<1||
       !sec(r.validFrom)||!sec(r.validUntil)||r.validUntil<=r.validFrom||
       now<r.validFrom||now>=r.validUntil)deny();
    // Only a synthetic work callback, after recheck. No network/database writes.
    return work(Object.freeze({shopCode,subject:actor.subject,role:actor.role,operation}));
  };
}

const hashes=Object.freeze({
 'car02-identity-r44.mjs':'91c3ef3475c837828ae7640d9cab75bcc46e3ced',
 'car02-runtime-r45.mjs':'f53cc297c2e968845cccd54a258bf0d2006f7007',
 'car02-edge-entry-r52.ts':'f0e31fb9f9d98524519d01dffd3489893d3d3302',
 'car02-pg-adapter.mjs':'dc57effaec3ed9b6ec309420b3506a57ec7a599f',
 'car02-v34-staff-membership-isolated.mjs':'d02345cc3db2a75f4c7712afe05f8413a1d5b0be'
});
const blob=s=>createHash('sha1').update(`blob ${Buffer.byteLength(s)}\0`,'utf8').update(s,'utf8').digest('hex');
/** Locked baseline source audit; unimplemented production capability remains a BLOCKER. */
export function auditV35MutationBoundary(sources){
 if(!plain(sources)||Object.keys(sources).sort().join('|')!==Object.keys(hashes).sort().join('|'))deny();
 for(const [path,sha] of Object.entries(hashes))if(typeof sources[path]!=='string'||blob(sources[path])!==sha)deny();
 const r44=sources['car02-identity-r44.mjs'];
 const r45=sources['car02-runtime-r45.mjs'];
 const r52=sources['car02-edge-entry-r52.ts'];
 const pg=sources['car02-pg-adapter.mjs'];
 const v34=sources['car02-v34-staff-membership-isolated.mjs'];
 const checks=Object.freeze({
   r44StaffReadIsInjected:r44.includes('resolveStaffAccess({userSub:jwt.sub,shopCode})'),
   r44RejectsWrongShop:r44.includes('staff.shopCode!==shopCode'),
   r44RejectsWrongSub:r44.includes('staff.userSub!==jwt.sub'),
   v34ReadThroughMembership:v34.includes('records=await readMembership('),
   r43UsesSqlTransaction:pg.includes("await c.query('BEGIN')")&&pg.includes("await c.query('COMMIT')"),
   r43DoesNotSupplyConfirmedStaffMembershipRowLock:!pg.includes('FOR UPDATE /* CAR02_STAFF_MEMBERSHIP_LOCK */'),
   r45QaOnly:r45.includes('QA ONLY'),
   r52ReleaseHardLocked:/\bconst\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/.test(r52)
 });
 if(Object.values(checks).some(x=>x!==true))deny();
 return Object.freeze({checks,passed:8,total:8,sourceReviewOnly:true,
   missingRealTransactionGuarantee:true,productionReady:false,release:'NO_GO',migration:'HOLD',
   blockers:Object.freeze(['REAL_SIGNED_JWT_VERIFIER_NOT_BOUND','REAL_STAFF_MEMBERSHIP_DB_NOT_BOUND',
     'REAL_SAME_TRANSACTION_STAFF_LOCK_NOT_PROVEN','JWT_AUTH_VERSION_RECHECK_NOT_PROVEN',
     'PRODUCTION_DATABASE_AND_TENANT_ISOLATION_UNVERIFIED'])});
}
