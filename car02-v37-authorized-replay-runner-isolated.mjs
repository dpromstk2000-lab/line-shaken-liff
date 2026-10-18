/** SHA-pinned V3.7 source review. No network, no DB, no live auth. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const pins={
 'car02-v36-session-version-fence-isolated.mjs':'01b34828a62cb6a3e7c1aad26ff27babe94140d7',
 'car02-pg-adapter.mjs':'dc57effaec3ed9b6ec309420b3506a57ec7a599f',
 'car02-identity-r44.mjs':'91c3ef3475c837828ae7640d9cab75bcc46e3ced',
 'car02-edge-entry-r52.ts':'f0e31fb9f9d98524519d01dffd3489893d3d3302'};
const sha=s=>createHash('sha1').update(`blob ${Buffer.byteLength(s)}\0`,'utf8').update(s,'utf8').digest('hex');
const src=Object.fromEntries(Object.keys(pins).map(k=>[k,readFileSync(new URL(k,import.meta.url),'utf8')]));
for(const [k,expected] of Object.entries(pins))if(sha(src[k])!==expected)throw Error('CAR02_V37_SOURCE_DRIFT');
const v36=src['car02-v36-session-version-fence-isolated.mjs'];
const pg=src['car02-pg-adapter.mjs'];
const r44=src['car02-identity-r44.mjs'];
const r52=src['car02-edge-entry-r52.ts'];
const checks={
 v36IsQaOnly:v36.includes("environment:'isolated_qa'")&&v36.includes('deployable:false'),
 v36ChecksSessionVersion:v36.includes('locked.rows[0].authVersion!==session.authVersion'),
 v36DependsOnSyntheticLock:v36.includes('createV35QaStaffMutationGate'),
 r43TransactionsExist:pg.includes("await c.query('BEGIN')")&&pg.includes("await c.query('COMMIT')"),
 r43StoresReplay:pg.includes('response_snapshot,completed_at')&&pg.includes('return obj(existing.response_snapshot);'),
 r43ReplayLacksConfirmedStaffLock:!pg.includes('FOR UPDATE /* CAR02_STAFF_MEMBERSHIP_LOCK */'),
 r44RequiresTrustedResolver:r44.includes('resolveStaffAccess({userSub:jwt.sub,shopCode})'),
 r52ReleaseLocked:/\bconst\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/.test(r52)
};
if(Object.values(checks).some(v=>v!==true))throw Error('CAR02_V37_SOURCE_AUDIT_FAILED');
console.log('CAR02_V37_REPLAY_FENCE_SOURCE_PASS 8/8 BLOCKERS=5 NO_GO HOLD');
console.log('V37_QA_ONLY: REAL_TX_LOCK_AND_IDEMPOTENCY_REPLAY_AUTHORIZATION_NOT_PROVEN');
