/** DPRO CAR02 V4.3 read-only source audit. Run only in GitHub QA or local fixtures.
 * Does not open network connections, sign production tokens or execute SQL.
 */
import {readFileSync} from 'node:fs';
import {V42_MODE} from './car02-v42-signed-session-binding-isolated.mjs';
import {V43_MODE} from './car02-v43-signed-transaction-replay-isolated.mjs';
const read=p=>readFileSync(p,'utf8');
const ddl=read('R46_STAFF_GRANTS_QA_ONLY.sql');
const provider=read('car02-auth-providers-r46.mjs');
const pg=read('car02-pg-adapter.mjs');
const identity=read('car02-identity-r44.mjs');
const edge=read('car02-edge-entry-r52.ts');
const v41sql=read('CAR02_V41_STAFF_AUTH_VERSION_PG17_ISOLATED_REVIEW_ONLY.sql');
const v42=read('car02-v42-signed-session-binding-isolated.mjs');
const model=read('car02-v43-signed-transaction-replay-isolated.mjs');
const tests=read('test_car02_v43_signed_transaction_replay_isolated.mjs');
const checks={
 r46SchemaReviewOnly:ddl.includes('QA/REVIEW ONLY'),
 r46VersionStillAbsent:ddl.includes('CREATE TABLE public.ksh_car02_staff_access')&&!/\bauth_version\s+integer\b/.test(ddl),
 r46RlsEnabled:ddl.includes('ENABLE ROW LEVEL SECURITY'),
 r46ServicePrivilegeOnly:ddl.includes('TO service_role'),
 v41MigrationReviewOnly:v41sql.includes('NOT EXECUTED OR LOCK-TESTED'),
 v41ProposesVersion:v41sql.includes('ADD COLUMN auth_version integer NOT NULL DEFAULT 1'),
 v41RotatesAndBlocksDeletes:v41sql.includes('NEW.auth_version := OLD.auth_version + 1')&&v41sql.includes('REVOKE DELETE'),
 providerFetchesCurrentAuthUser:provider.includes("fetchImpl(issuer+'/user'"),
 providerVersionReaderUnbound:provider.includes('SELECT shop_code,user_sub,staff_role,active')&&!provider.includes('SELECT shop_code,user_sub,staff_role,active,auth_version'),
 r43StillReturnsUnreauthorizedReplay:pg.includes('return obj(existing.response_snapshot);'),
 r44ExistingStaffResolverSeparate:identity.includes('resolveStaffAccess({userSub:jwt.sub,shopCode})'),
 r52ReleaseLocked:/const\s+CAR02_RELEASE_LOCK\s*=\s*true/.test(edge),
 v42SyntheticOnly:V42_MODE.deployable===false&&V42_MODE.liveJwtProvider===false&&V42_MODE.realDb===false,
 v42UsesEd25519:v42.includes('edSign(null,')&&v42.includes('edVerify(null,'),
 v42UsesTrustedWeakset:v42.includes('new WeakSet()')&&v42.includes('trusted.add(verified)'),
 v43NotDeployable:V43_MODE.deployable===false&&V43_MODE.realDatabase===false&&V43_MODE.release==='NO_GO',
 v43NoRealRowLockClaim:V43_MODE.realRowLockProven===false&&V43_MODE.transactionCommitProof===false,
 v43BindsSignedV42Model:model.includes("import {V42_MODE} from './car02-v42-signed-session-binding-isolated.mjs'")&&model.includes('lab.mode!==V42_MODE'),
 v43VerifiesBeforeMembership: model.indexOf('const verified=lab.verify(token);')<model.indexOf('const lock=await lockMembership('),
 v43AuthorizesBeforeReplay:model.indexOf('const decision=lab.authorize(')<model.indexOf('const saved=await readReplay('),
 v43ChecksMembershipLockClaims:model.includes("lock.lockKind!=='FOR_UPDATE'")&&model.includes('lock.txId!==txId'),
 v43RejectsStaleReplayAuthVersion:model.includes('saved.authVersion!==decision.authVersion'),
 v43RejectsMismatchedIntent:model.includes('saved.intentDigest!==intentDigest'),
 v43TransactionOpenAfterAsync:model.includes('assertOpen(tx,txId);')&&model.includes('tx.state!==\'open\''),
 v43NoNetworkOrDbOperations:!/(?:pool|client|db)\.query\(/.test(model)&&!/(?:fetch\(|https?:\/\/)/.test(model),
 v43TestsRevocationAndReuse:tests.includes('single token is rejected after subsequent membership version bump')&&tests.includes('replay cannot bypass locked row active flag'),
 v43NoEmbeddedPrivateKeys:!/(BEGIN PRIVATE KEY|SUPABASE_SERVICE_ROLE_KEY|CHANNEL_SECRET)/.test(model)
};
for(const [name,ok] of Object.entries(checks))console.log('V43_SOURCE_'+(ok?'PASS ':'FAIL ')+name);
if(Object.values(checks).some(x=>!x))process.exitCode=1;
else console.log(`CAR02_V43_SIGNED_REPLAY_BRIDGE_PASS ${Object.keys(checks).length}/${Object.keys(checks).length} BLOCKERS=6 NO_GO HOLD`);
console.log('V43_QA_ONLY: SYNTHETIC_SIGNED_SESSION; NO_REAL_PG_LOCK; NO_LIVE_AUTH; NO_SQL; NO_RELEASE');
