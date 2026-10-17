/** DPRO CAR02 V3.3: synthetic STAFF JWT claim contract. QA-ONLY.
 * THIS IS NOT A SIGNATURE VERIFIER. The injected trusted verifySignedJwt
 * MUST cryptographically validate key, algorithm and signature independently.
 * No Supabase/LINE/Worker/DB calls, production enablement or existing R44 edits.
 */
import {createHash} from 'node:crypto';
export const V33_MODE=Object.freeze({environment:'isolated_qa',signatureVerificationImplemented:false,
  liveVerifierBound:false,liveStaffResolverBound:false,productionReady:false,
  deployable:false,release:'NO_GO',migration:'HOLD'});
const deny=()=>{throw Object.assign(new Error('CAR02_V33_STAFF_CLAIMS_REJECTED'),{code:'CAR02_V33_STAFF_CLAIMS_REJECTED'});};
const isPlain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const isSec=x=>Number.isSafeInteger(x)&&x>0;
const nonblank=x=>typeof x==='string'&&x.trim()===x&&x.length>0&&x.length<=256;
const tokenOk=x=>typeof x==='string'&&x.length>=8&&x.length<=8192&&!/\s/.test(x);
const trustedIssuer=x=>{
 if(typeof x!=='string'||x.length>256||!/^https:\/\//.test(x))return false;
 try {const u=new URL(x);return u.protocol==='https:'&&u.username===''&&u.password===''&&u.search===''&&u.hash===''&&u.hostname!==''&&u.origin!== 'null'&&x===u.href.replace(/\/$/,'');}
 catch{return false;}
};
/**
 * Caller supplies TEST-ONLY signed-JWT callback. This wrapper checks claims
 * AFTER that trusted callback; it cannot independently prove a signature.
 */
export function createV33QaStaffClaimsGuard({environment,allowIsolatedQa=false,
  verifySignedJwt,trustedIssuer:issuer,trustedAudience:audience,
  expectedAlgorithm:algorithm,nowSeconds=()=>Math.floor(Date.now()/1000),
  maxTtlSeconds=3600}={}){
 if(environment!=='isolated_qa'||allowIsolatedQa!==true||typeof verifySignedJwt!=='function'||
   !trustedIssuer(issuer)||!nonblank(audience)||!/^(?:RS256|ES256)$/.test(algorithm||'')||
   typeof nowSeconds!=='function'||!Number.isSafeInteger(maxTtlSeconds)||
   maxTtlSeconds<60||maxTtlSeconds>86400)deny();
 return async function verifyStaffJwt({accessToken}={}){
   if(!tokenOk(accessToken))deny();
   let claims;
   try{claims=await verifySignedJwt({accessToken});}catch{deny();}
   let now;try{now=nowSeconds();}catch{deny();}
   if(!isSec(now)||!isPlain(claims)||claims.verified!==true||claims.alg!==algorithm||
      claims.iss!==issuer||claims.aud!==audience||!nonblank(claims.sub)||
      !isSec(claims.iat)||!isSec(claims.nbf)||!isSec(claims.exp)||
      claims.iat>now||claims.nbf>now||claims.exp<=now||claims.exp<=claims.iat||
      claims.exp-claims.iat>maxTtlSeconds)deny();
   // Minimal R44-shaped output. No token, issuer, algorithm, callback metadata or claims leak.
   return Object.freeze({verified:true,sub:claims.sub,exp:claims.exp});
 };
}
const BLOB_HASHES=Object.freeze({
 'car02-identity-r44.mjs':'91c3ef3475c837828ae7640d9cab75bcc46e3ced',
 'car02-runtime-r45.mjs':'f53cc297c2e968845cccd54a258bf0d2006f7007',
 'car02-edge-entry-r52.ts':'f0e31fb9f9d98524519d01dffd3489893d3d3302'
});
export const V33_APPROVED_BLOBS=BLOB_HASHES;
const gitBlobSha=s=>createHash('sha1').update(`blob ${Buffer.byteLength(s)}\0`,'utf8').update(s,'utf8').digest('hex');
/** Strict source inspection, NOT production operational evidence. */
export function auditV33R44ClaimDelegation(sources){
 if(!isPlain(sources)||Object.keys(sources).sort().join('|')!==Object.keys(BLOB_HASHES).sort().join('|'))deny();
 for(const [p,expected] of Object.entries(BLOB_HASHES))if(typeof sources[p]!=='string'||gitBlobSha(sources[p])!==expected)deny();
 const r44=sources['car02-identity-r44.mjs'],r45=sources['car02-runtime-r45.mjs'],r52=sources['car02-edge-entry-r52.ts'];
 const checks=Object.freeze({
  r44UsesInjectedSignatureVerifier:r44.includes('verifyStaffJwt({accessToken:token})'),
  r44RequiresVerifierEvidence:r44.includes('jwt?.verified!==true'),
  r44RequiresServerStaffMembership:r44.includes('resolveStaffAccess({userSub:jwt.sub,shopCode})'),
  r45NotLiveVerifier:r45.includes('QA ONLY')&&r45.includes('Not a Cloudflare Worker bundle'),
  r52ReleaseLocked:/\bconst\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/.test(r52)
 });
 if(Object.values(checks).some(v=>v!==true))deny();
 return Object.freeze({checks:Object.freeze({...checks}),passed:5,total:5,
  notProven:Object.freeze(['SIGNED_STAFF_JWT_TRUSTED_PROVIDER_NOT_BOUND',
     'STAFF_JWT_ISSUER_AUDIENCE_ALGORITHM_NOT_CONFIRMED_LIVE',
     'REAL_STAFF_MEMBERSHIP_DB_NOT_VERIFIED','R52_RELEASE_LOCK_CLOSED']),
  sourceReviewOnly:true,liveVerifierBound:false,productionReady:false,
  release:'NO_GO',migration:'HOLD'});
}
