/** DPRO CAR02 V4.4 read-only source contract audit, no database or network. */
import {readFileSync} from 'node:fs';
import {V44_MODE} from './car02-v44-async-expiry-fence-isolated.mjs';
const read=n=>readFileSync(n,'utf8');
const v42=read('car02-v42-signed-session-binding-isolated.mjs');
const v43=read('car02-v43-signed-transaction-replay-isolated.mjs');
const v44=read('car02-v44-async-expiry-fence-isolated.mjs');
const tests=read('test_car02_v44_async_expiry_fence_isolated.mjs');
const r46sql=read('R46_STAFF_GRANTS_QA_ONLY.sql');
const r46=read('car02-auth-providers-r46.mjs');
const r43=read('car02-pg-adapter.mjs');
const r44=read('car02-identity-r44.mjs');
const r52=read('car02-edge-entry-r52.ts');
const v41sql=read('CAR02_V41_STAFF_AUTH_VERSION_PG17_ISOLATED_REVIEW_ONLY.sql');
const checks={
 v43ReviewOnly:/REVIEW ONLY/.test(v43)&&v43.includes('realRowLockProven:false'),
 v43VerifiesBeforeMembership:v43.indexOf('const verified=lab.verify(token)')<v43.indexOf('await lockMembership('),
 v43AuthorizesBeforeReplay:v43.indexOf('const decision=lab.authorize(')<v43.indexOf('await readReplay('),
 v43AsyncReplayAwaitExists:v43.includes('await readReplay('),
 v43AsyncMutateAwaitExists:v43.includes('await mutate('),
 v43MissingExpiryFenceAfterReplay:!v43.includes('lab.authorize({verifiedIdentity:verified,lockedMembership:lock.row,shopCode});\n    const saved')&&
   v43.includes('const saved=await readReplay(')&&v43.includes('assertOpen(tx,txId);\n    if(saved!==null)'),
 v42Ed25519Offline:v42.includes("asymmetricKeyType!=='ed25519'"),
 v42AuthorizerChecksExpiry:v42.includes('nowSeconds()>=verifiedIdentity.expiry'),
 v42TrustBrandWeakSet:v42.includes('const trusted=new WeakSet()'),
 v42NoProductionSigner:v42.includes('liveJwtProvider:false'),
 v44OnlyIsolated:V44_MODE.deployable===false&&V44_MODE.realDatabase===false&&V44_MODE.release==='NO_GO',
 v44NoRealRollbackClaim:V44_MODE.rollbackProven===false&&v44.includes('does NOT lock PostgreSQL or roll back'),
 v44CallsExistingV43:v44.includes('await v43QaSignedTxReplay('),
 v44BeforeAndAfterReplayFence:v44.includes('readReplay:async ctx=>{fresh();const value=await args.readReplay(ctx);fresh();return value;}'),
 v44BeforeAndAfterMutationFence:v44.includes('mutate:async ctx=>{fresh();const value=await args.mutate(ctx);fresh();return value;}'),
 v44FinalResponseFence:v44.includes('fresh(); // Also fence the final response boundary.'),
 v44TrustedSessionAuthorization:v44.includes('lab.authorize({verifiedIdentity:verified,lockedMembership:locked,shopCode:args.shopCode})'),
 v44NoProductionSqlOrNetwork:!/(?:fetch\(|pool\.query\(|client\.query\(|https?:\/\/)/.test(v44),
 testProvesExistingV43Gap:tests.includes('V4.3 baseline gap is reproducible'),
 testRejectsV44ExpiryReplay:tests.includes('V4.4 rejects expiration during replay await'),
 testRejectsV44ExpiryMutation:tests.includes('V4.4 rejects expiration inside mutation'),
 r46SchemaNoAuthVersion:r46sql.includes('CREATE TABLE public.ksh_car02_staff_access')&&!/\bauth_version\s+integer\b/.test(r46sql),
 r46ServerMembershipReader:r46.includes('SELECT shop_code,user_sub,staff_role,active'),
 r43ReturnsCachedWithoutFreshCheck:r43.includes('return obj(existing.response_snapshot);'),
 r44ExternalResolver:r44.includes('resolveStaffAccess({userSub:jwt.sub,shopCode})'),
 v41SchemaReviewOnly:v41sql.includes('NOT EXECUTED OR LOCK-TESTED'),
 r52ReleaseHardLocked:/const\s+CAR02_RELEASE_LOCK\s*=\s*true/.test(r52)
};
for(const [name,ok] of Object.entries(checks))console.log('V44_SOURCE_'+(ok?'PASS ':'FAIL ')+name);
const pass=Object.values(checks).filter(Boolean).length,n=Object.keys(checks).length;
if(pass!==n)process.exitCode=1;
else console.log(`CAR02_V44_ASYNC_EXPIRY_REVIEW_PASS ${n}/${n} BLOCKERS=6 NO_GO HOLD`);
console.log('V44_QA_ONLY: EXISTING_V43_ASYNC_EXPIRY_GAP; SYNTHETIC_ONLY; NO_PG_LOCK; NO_ROLLBACK_PROOF; NO_RELEASE');
