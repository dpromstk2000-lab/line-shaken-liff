/** DPRO CAR02 V3.4 — staff membership & revocation CONTRACT, ISOLATED QA ONLY.
 * Injected readMembership is a synthetic callback. This does not connect to a
 * real database, verify JWT signatures, modify R44 or authorize production.
 */
import {createHash} from 'node:crypto';
export const V34_MODE=Object.freeze({environment:'isolated_qa',dbConnection:false,
  realStaffResolverBound:false,realSignedJwtVerifierBound:false,productionReady:false,
  deployable:false,release:'NO_GO',migration:'HOLD'});
const reject=()=>{const e=new Error('CAR02_V34_STAFF_ACCESS_DENIED');e.code=e.message;throw e;};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const nonblank=x=>typeof x==='string'&&x.length>0&&x.length<=256&&x.trim()===x&&!/\s/.test(x);
const intSec=x=>Number.isSafeInteger(x)&&x>0;
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
/**
 * Fail-closed read-through contract: ONE record, exact scope, active and not
 * revoked, suspended, or outside validity window. No cache or fallback.
 * The caller must independently supply cryptographically verified JWT identity.
 */
export function createV34QaStaffMembershipResolver({environment,allowIsolatedQa=false,
  readMembership,nowSeconds=()=>Math.floor(Date.now()/1000)}={}){
  if(environment!=='isolated_qa'||allowIsolatedQa!==true||
     typeof readMembership!=='function'||typeof nowSeconds!=='function')reject();
  return async function resolveStaffAccess({userSub,shopCode}={}){
    if(!nonblank(userSub)||!nonblank(shopCode))reject();
    let records,now;
    try {
      now=nowSeconds();
      records=await readMembership(Object.freeze({userSub,shopCode}));
    } catch {reject();}
    if(!intSec(now)||!Array.isArray(records)||records.length!==1||!plain(records[0]))reject();
    const r=records[0];
    if(!uuid(r.membershipId)||r.userSub!==userSub||r.shopCode!==shopCode||
       r.active!==true||r.suspended!==false||r.revokedAt!==null||
       !['owner','staff'].includes(r.role)||!Number.isSafeInteger(r.authVersion)||r.authVersion<1||
       !intSec(r.validFrom)||!intSec(r.validUntil)||r.validUntil<=r.validFrom||
       now<r.validFrom||now>=r.validUntil)reject();
    // R44-shaped response only; no membership IDs, internal versions or storage details.
    return Object.freeze({active:true,userSub:r.userSub,shopCode:r.shopCode,role:r.role});
  };
}
const EXPECTED=Object.freeze({
 'car02-identity-r44.mjs':'91c3ef3475c837828ae7640d9cab75bcc46e3ced',
 'car02-runtime-r45.mjs':'f53cc297c2e968845cccd54a258bf0d2006f7007',
 'car02-edge-entry-r52.ts':'f0e31fb9f9d98524519d01dffd3489893d3d3302',
 'car02-v33-staff-jwt-claims-isolated.mjs':'2ec36af22ee9a455fe70d0303e2e0d84a3e1e9ae'
});
const blobHash=s=>createHash('sha1').update(`blob ${Buffer.byteLength(s)}\0`).update(s).digest('hex');
/** SHA-locked code inspection, NOT proof of any live membership DB resolver. */
export function auditV34MembershipSource(sources){
  if(!plain(sources)||Object.keys(sources).sort().join('|')!==Object.keys(EXPECTED).sort().join('|'))reject();
  for(const [key,sha] of Object.entries(EXPECTED))if(typeof sources[key]!=='string'||blobHash(sources[key])!==sha)reject();
  const r44=sources['car02-identity-r44.mjs'],r45=sources['car02-runtime-r45.mjs'];
  const r52=sources['car02-edge-entry-r52.ts'],v33=sources['car02-v33-staff-jwt-claims-isolated.mjs'];
  const checks=Object.freeze({
    r44RequiresServerMembership:r44.includes('resolveStaffAccess({userSub:jwt.sub,shopCode})'),
    r44RequiresActiveFlag:r44.includes('!isLive(staff)'),
    r44RequiresShopMatch:r44.includes('staff.shopCode!==shopCode'),
    r44RequiresSubjectMatch:r44.includes('staff.userSub!==jwt.sub'),
    r44RestrictsRoles:r44.includes("!['owner','staff'].includes(staff.role)"),
    v33NotRealVerifier:v33.includes('liveVerifierBound:false'),
    r52HardLocked:/\bconst\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/.test(r52)&&r45.includes('QA ONLY')
  });
  if(Object.values(checks).some(x=>x!==true))reject();
  return Object.freeze({checks,passed:7,total:7,sourceReviewOnly:true,
    realStaffResolverBound:false,productionReady:false,release:'NO_GO',migration:'HOLD',
    unresolved:Object.freeze(['LIVE_SIGNED_JWT_VERIFIER_UNBOUND','LIVE_MEMBERSHIP_DB_UNBOUND',
      'REVOCATION_PERSISTENCE_UNPROVEN','TENANT_REAL_DB_ISOLATION_UNPROVEN'])});
}
