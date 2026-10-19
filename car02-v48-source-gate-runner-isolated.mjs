/** CAR02 V4.8 — GitHub checkout read-only gap evidence; NO writes, DB calls, secrets. */
import {readFileSync} from 'node:fs';
import {V48_MODE,v48QaAssessSourceGaps,v48QaReleaseDecision,V48_BLOCKER_IDS} from './car02-v48-six-blocker-release-gate-isolated.mjs';
const paths=Object.freeze({
 r46Sql:'R46_STAFF_GRANTS_QA_ONLY.sql',
 r46Provider:'car02-auth-providers-r46.mjs',
 r43Adapter:'car02-pg-adapter.mjs',
 r44Identity:'car02-identity-r44.mjs',
 r52Edge:'car02-edge-entry-r52.ts',
 v41Sql:'CAR02_V41_STAFF_AUTH_VERSION_PG17_ISOLATED_REVIEW_ONLY.sql',
 v47Sql:'CAR02_V47_DURABLE_OUTBOX_LEASE_PG17_REVIEW_ONLY.sql',
 r13Sql:'R13_MIGRATION_QA_ONLY.sql'
});
const snapshot=Object.fromEntries(Object.entries(paths).map(([k,p])=>[k,readFileSync(p,'utf8')]));
const a=v48QaAssessSourceGaps(snapshot),d=v48QaReleaseDecision(a);
const checks={
 modeExplicitlyIsolated:V48_MODE.environment==='isolated_qa'&&V48_MODE.deployable===false&&V48_MODE.readOnly,
 noProofClaim:V48_MODE.liveDbProof===false&&V48_MODE.liveJwtProof===false&&V48_MODE.dbSqlExecuted===false,
 noApprovalAuthority:V48_MODE.approvalAuthority===false&&V48_MODE.release==='NO_GO',
 sourceBaselineIntact:a.sourceBaselineIntact===true,
 allSixExpectedGapsVisible:a.blockers.length===6&&a.blockers.every(b=>b.expectedGapVisible&&b.unresolved),
 failsClosedOnSourceDrift:a.needsManualSourceReview===false&&a.unexpected.length===0,
 noReleaseDecision:d.authorized===false&&d.release==='NO_GO'&&d.blockers===6,
 sixUniqueBlockers:new Set(V48_BLOCKER_IDS).size===6,
 fingerprintsForEightInputs:Object.keys(a.sourceSha256).length===8&&Object.values(a.sourceSha256).every(v=>/^[a-f0-9]{64}$/.test(v)),
 noNetworkOrPgInModel:!/(?:\bfetch\s*\(|(?:pool|client|db)\.query\s*\(|\bimport\s*\(\s*['"]npm:pg)/.test(readFileSync('car02-v48-six-blocker-release-gate-isolated.mjs','utf8')),
 r52GateStaticNotEnv:!/(?:Deno\.env|getenv)\s*\([^)]*RELEASE_LOCK/.test(snapshot.r52Edge),
 r13OutboxStillLegacy:!snapshot.r13Sql.includes('claim_token uuid'),
 r46SqlStillReviewOnly:snapshot.r46Sql.includes('QA/REVIEW ONLY'),
 v47SqlNotExecuted:a.anchors.v47CommentOnly===true,
 r43ReplayStillUnfenced:a.blockers[2].expectedGapVisible,
 noProductionWrites:!/(?:\bALTER\s+TABLE|\bCREATE\s+TRIGGER|\bDROP\s+TABLE)/i.test(readFileSync('car02-v48-six-blocker-release-gate-isolated.mjs','utf8')),
 modelNotCalledFromWorker:!snapshot.r52Edge.includes('car02-v48-six-blocker-release-gate-isolated'),
 knownGitHubCIIsNotLivePg:!d.authorized&&d.requiresIndependentLiveDbAndSignerEvidence,
 sourceDriftIsFailure:a.unexpected.length===0,
 fiveAuthAndOneReleaseBlocker:a.blockers.slice(0,5).every(b=>b.unresolved)&&a.blockers.at(-1).id==='R52_PRODUCTION_RELEASE_LOCK_ACTIVE'
};
let passed=0;for(const [name,good]of Object.entries(checks)){if(good)passed++;console.log('V48_SOURCE_'+(good?'PASS ':'FAIL ')+name);}
for(const b of a.blockers)console.log(`V48_HOLD ${b.id} source_gap=${b.expectedGapVisible?'present':'CHANGED'}`);
console.log('V48_RELEASE_DECISION NO_GO BLOCKERS=6 NEVER_AUTO_GO');
if(passed!==Object.keys(checks).length)process.exitCode=1;
else console.log(`CAR02_V48_SIX_BLOCKER_GATE_PASS ${passed}/${Object.keys(checks).length} BLOCKERS=6 NO_GO HOLD`);
console.log('V48_QA_ONLY: STATIC_SOURCE_CHECKS; NO_LIVE_DB; NO_REAL_JWT; NO_SQL_EXECUTION; NO_RELEASE');
