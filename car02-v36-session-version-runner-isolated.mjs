/** DPRO CAR02 V3.6: SHA-pinned source-only gap audit. No DB or requests. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const pinned=Object.freeze({
 'car02-v33-staff-jwt-claims-isolated.mjs':'2ec36af22ee9a455fe70d0303e2e0d84a3e1e9ae',
 'car02-v34-staff-membership-isolated.mjs':'d02345cc3db2a75f4c7712afe05f8413a1d5b0be',
 'car02-v35-tx-time-membership-isolated.mjs':'a649aeb4a56d2319093b10ade5172a113935c74a'});
const get=n=>readFileSync(new URL(n,import.meta.url),'utf8');
const sha=s=>createHash('sha1').update(`blob ${Buffer.byteLength(s)}\0`).update(s).digest('hex');
const src=Object.fromEntries(Object.keys(pinned).map(n=>[n,get(n)]));
for(const [n,expected] of Object.entries(pinned))if(sha(src[n])!==expected)throw Error('CAR02_V36_BASELINE_DRIFT');
const a=src['car02-v33-staff-jwt-claims-isolated.mjs'];
const b=src['car02-v34-staff-membership-isolated.mjs'];
const c=src['car02-v35-tx-time-membership-isolated.mjs'];
const checks={
  v33TrustedVerifierIsInjected:a.includes("typeof verifySignedJwt!=='function'"),
  v33DropsSessionVersion:a.includes('return Object.freeze({verified:true,sub:claims.sub,exp:claims.exp});'),
  v34RequiresNumericMembershipVersion:b.includes('!Number.isSafeInteger(r.authVersion)||r.authVersion<1'),
  v35RequiresNumericMembershipVersion:c.includes('!Number.isSafeInteger(r.authVersion)||r.authVersion<1'),
  v35NotYetTokenVersionFenced:!c.includes('session.authVersion')&&!c.includes('jwt.authVersion'),
  v35UsesSyntheticLockFlag:c.includes('result.lockHeld!==true'),
  v34DoesNotUseLiveDb:b.includes('realStaffResolverBound:false'),
  v35DoesNotUseLiveDb:c.includes('databaseConnected:false')
};
if(Object.values(checks).some(v=>v!==true))throw Error('CAR02_V36_SOURCE_AUDIT_FAILED');
console.log('CAR02_V36_SESSION_VERSION_SOURCE_PASS 8/8 BLOCKERS=5 NO_GO HOLD');
console.log('CAR02_V36_AUTH_VERSION_NOT_BOUND_IN_R44_OR_REAL_DB: REVIEW_ONLY');
