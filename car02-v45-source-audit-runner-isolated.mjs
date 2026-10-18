/** DPRO CAR02 V4.5 read-only source audit of rollback contract. Never runs SQL. */
import {readFileSync} from 'node:fs';
import {V45_MODE} from './car02-v45-rollback-unit-of-work-isolated.mjs';
const read=p=>readFileSync(p,'utf8');
const v45=read('car02-v45-rollback-unit-of-work-isolated.mjs');
const tests=read('test_car02_v45_rollback_unit_of_work_isolated.mjs');
const v44=read('car02-v44-async-expiry-fence-isolated.mjs');
const v43=read('car02-v43-signed-transaction-replay-isolated.mjs');
const v42=read('car02-v42-signed-session-binding-isolated.mjs');
const pg=read('car02-pg-adapter.mjs');
const r46=read('R46_STAFF_GRANTS_QA_ONLY.sql');
const r44=read('car02-identity-r44.mjs');
const gate=read('car02-edge-entry-r52.ts');
const checks={
 v45IsReviewOnly:V45_MODE.environment==='isolated_qa'&&V45_MODE.deployable===false&&V45_MODE.release==='NO_GO',
 v45ClaimsNoRealRollback:V45_MODE.realRollbackProven===false&&V45_MODE.realDatabase===false,
 v45NoExternalSideEffectsProof:V45_MODE.externalSideEffectsReversible===false,
 v45KeepsStagedRecords: v45.includes('const staged=new Map(committed)'),
 v45RollbackDiscardsStaged:v45.includes('staged.clear();')&&v45.includes("record.steps.push('ROLLBACK')"),
 v45OnlyPublishesAtCommit:v45.includes('committed.clear();for(const [k,v] of staged)committed.set'),
 v45RechecksAuthBeforeCommit:v45.includes('lab.authorize({verifiedIdentity:lab.verify(token),lockedMembership:copy(membership),shopCode})'),
 v45UsesV44Fence:v45.includes('v44QaExpiryFencedReplay({environment,allowIsolatedQa,lab,token,tx'),
 v45RollbackFaultIsNotSuccess:v45.includes('CAR02_V45_ROLLBACK_UNCONFIRMED'),
 v45NoExternalDbOrNetworkCalls:!/(?:pool|client|db)\.query\s*\(|\bfetch\s*\(/.test(v45),
 testExpiryInEachStage:tests.includes("['afterBegin','afterLock','afterRead','afterStage','beforeCommit']"),
 testNeverPublishesStagedWrite:tests.includes("never commits a staged mutation"),
 testRollbackFailure:tests.includes('rollback failure stays unmistakably unconfirmed'),
 testReplayWithoutExtraWrite:tests.includes('returns committed replay without new write'),
 v44HasPostAwaitExpiryFence:v44.includes('fresh();const value=await args.mutate(ctx);fresh()')&&v44.includes('fresh(); // Also fence'),
 v44ExplicitlyNoRealRollback:v44.includes('rollbackProven:false'),
 v43HasUncommittedMutationCallback:v43.includes('const value=await mutate('),
 v42VerifiesSignedSession:v42.includes("edVerify(null")&&v42.includes('const trusted=new WeakSet()'),
 originalR43ReplayWithoutTxAuthVersion:pg.includes('return obj(existing.response_snapshot);'),
 originalR46VersionColumnStillMissing:r46.includes('CREATE TABLE public.ksh_car02_staff_access')&&!/\bauth_version\s+(?:int|integer)\b/.test(r46),
 originalR44StaffResolverSeparate:r44.includes('resolveStaffAccess({userSub:jwt.sub,shopCode})'),
 originalReleaseLockActive:/const\s+CAR02_RELEASE_LOCK\s*=\s*true/.test(gate)
};
for(const [name,pass] of Object.entries(checks))console.log('V45_SOURCE_'+(pass?'PASS ':'FAIL ')+name);
const passed=Object.values(checks).filter(Boolean).length,total=Object.keys(checks).length;
if(passed!==total)process.exitCode=1;
else console.log(`CAR02_V45_ROLLBACK_UOW_REVIEW_PASS ${passed}/${total} BLOCKERS=6 NO_GO HOLD`);
console.log('V45_QA_ONLY: IN_MEMORY_ROLLBACK_MODEL; NO_POSTGRESQL_ROLLBACK_PROOF; NO_DB; NO_EXTERNAL_SIDE_EFFECT_GUARANTEE; NO_RELEASE');
