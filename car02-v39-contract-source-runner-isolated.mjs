/**
 * DPRO CAR02 V3.9 contract source audit; checked-out GitHub repository ONLY.
 * These checks explicitly confirm a REVIEW PROPOSAL and original R43 gap.
 * They do NOT prove DB locks, JWT verification, or live request authorization.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {V39_MODE,v39QaTxAuthorizeAndReplay} from './car02-v39-transaction-authorization-contract-isolated.mjs';
const pins={
 'car02-pg-adapter.mjs':'dc57effaec3ed9b6ec309420b3506a57ec7a599f',
 'car02-identity-r44.mjs':'91c3ef3475c837828ae7640d9cab75bcc46e3ced',
 'car02-edge-entry-r52.ts':'f0e31fb9f9d98524519d01dffd3489893d3d3302',
 'car02-v38-r43-transaction-audit-isolated.mjs':'51c574cc94eff7449929c4f1c2ce197d889d683f'
};
const blobSha=content=>createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`,'utf8').update(content,'utf8').digest('hex');
const source={};
for(const [name,sha] of Object.entries(pins)){
 const content=readFileSync(new URL(name,import.meta.url),'utf8');
 if(blobSha(content)!==sha)throw Error('CAR02_V39_SOURCE_DRIFT_REVIEW_REQUIRED');
 source[name]=content;
}
const pg=source['car02-pg-adapter.mjs'];
const id=source['car02-identity-r44.mjs'];
const edge=source['car02-edge-entry-r52.ts'];
const v38=source['car02-v38-r43-transaction-audit-isolated.mjs'];
const contract=readFileSync(new URL('./car02-v39-transaction-authorization-contract-isolated.mjs',import.meta.url),'utf8');
const tests={
 r43CandidateNotProduction:pg.includes('offline implementation candidate ONLY'),
 r43TransactionBegins:pg.includes("await c.query('BEGIN')"),
 r43ReplayReturnsCachedResponse:pg.includes('return obj(existing.response_snapshot);'),
 r44VerifierInjected:id.includes('verifyStaffJwt({accessToken:token})'),
 r44MembershipResolverExternal:id.includes('resolveStaffAccess({userSub:jwt.sub,shopCode})'),
 r52HardReleaseLocked:/const\s+CAR02_RELEASE_LOCK\s*=\s*true/.test(edge),
 v38ReleaseGapsRecognized:v38.includes('R43_REPLAY_REAUTHORIZATION_NOT_PROVEN'),
 v39LockFirstInReviewProposal:contract.indexOf('lease=await lockMembership(')<contract.indexOf('const saved=await readReplay('),
 v39RequiresIsolatedOptIn:contract.includes("environment!=='isolated_qa'||allowIsolatedQa!==true"),
 v39BlockedFromLiveUse:V39_MODE.deployable===false&&V39_MODE.R43Patched===false&&V39_MODE.realDbTransaction===false&&V39_MODE.release==='NO_GO'
};
if(Object.values(tests).some(ok=>ok!==true)||typeof v39QaTxAuthorizeAndReplay!=='function')throw Error('CAR02_V39_CONTRACT_SOURCE_REVIEW_FAILED');
for(const k of Object.keys(tests))console.log(`V39_REVIEW_SOURCE_PASS ${k}`);
console.log('CAR02_V39_CONTRACT_SOURCE_PASS 10/10 BLOCKERS=5 NO_GO HOLD');
console.log('CAR02_V39_NOT_DEPLOYABLE: REVIEW_PROPOSAL_NOT_R43_PATCH; NO_REAL_AUTH_DB_LOCK');
