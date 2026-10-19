/** DPRO CAR02 V4.8 — source-only release evidence gate, QA ONLY.
 * Static source evidence does not prove a live DB transaction, JWT signer, or deployment safety.
 * This module cannot authorize a release; unexpected source drift is a CI FAILURE, not a GO.
 */
import { createHash } from 'node:crypto';
export const V48_MODE=Object.freeze({environment:'isolated_qa',deployable:false,readOnly:true,
 productionReady:false,liveDbProof:false,liveJwtProof:false,dbSqlExecuted:false,release:'NO_GO',
 approvalAuthority:false});
export const V48_BLOCKER_IDS=Object.freeze([
 'R46_STAFF_ACCESS_AUTH_VERSION_COLUMN_MISSING',
 'R43_TX_TIME_STAFF_MEMBERSHIP_LOCK_NOT_PROVEN',
 'R43_REPLAY_REAUTHORIZATION_NOT_PROVEN',
 'STAFF_AUTH_VERSION_DB_BINDING_NOT_PROVEN',
 'LIVE_SIGNED_JWT_PROVIDER_NOT_PROVEN',
 'R52_PRODUCTION_RELEASE_LOCK_ACTIVE'
]);
export const V48_SOURCE_KEYS=Object.freeze(['r46Sql','r46Provider','r43Adapter','r44Identity','r52Edge','v41Sql','v47Sql','r13Sql']);
const SHA=s=>createHash('sha256').update(s,'utf8').digest('hex');
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const F=Object.freeze;
/** Never trusts user-provided 'approved' flags, signatures or CI PASS as production proof.
 * A changed implementation fails the expected-gap audit and requires a fresh review.
 */
export function v48QaAssessSourceGaps(snapshot){
 if(!plain(snapshot))throw Error('CAR02_V48_SNAPSHOT_REQUIRED');
 const invalid=V48_SOURCE_KEYS.filter(k=>!own(snapshot,k)||typeof snapshot[k]!=='string'||snapshot[k].length<30);
 if(invalid.length)throw Error('CAR02_V48_MISSING_SOURCE_'+invalid.join(','));
 const {r46Sql,r46Provider,r43Adapter,r44Identity,r52Edge,v41Sql,v47Sql,r13Sql}=snapshot;
 const tbl=/CREATE\s+TABLE\s+public\.ksh_car02_staff_access\s*\(([\s\S]*?)\);/i.exec(r46Sql)?.[1];
 const authColumn=tbl? /^\s*auth_version\s+(?:integer|int4|int|bigint)\b/im.test(tbl):null;
 const releaseLock=/\bconst\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/.test(r52Edge);
 const reader=v48QaReaderHasDbVersion(r46Provider);
 const membershipTx=/FROM\s+public\.ksh_car02_staff_access[\s\S]{0,190}?FOR\s+UPDATE/i.test(r43Adapter);
 const replayWithoutFence=/await\s+c\.query\(['"]COMMIT['"]\)\s*;\s*open=false\s*;\s*return\s+obj\(existing\.response_snapshot\)/.test(r43Adapter);
 const anchor={
  sourceTable:tbl!==undefined, r46ReviewOnly:/QA\s*\/\s*REVIEW\s+ONLY/i.test(r46Sql),
  r43Transaction:/await\s+c\.query\(['"]BEGIN['"]\)/.test(r43Adapter),
  r44SeparateStaffResolver:/resolveStaffAccess\(\{userSub:jwt\.sub,shopCode\}\)/.test(r44Identity),
  v41DraftOnly:/NOT\s+AN\s+APPROVED\s+MIGRATION/i.test(v41Sql),
  v47CommentOnly:/Everything below is commented out intentionally/.test(v47Sql)&&/\/\*[\s\S]*?ALTER TABLE[\s\S]*?\*\//.test(v47Sql),
  r13Outbox:/CREATE\s+TABLE\s+public\.ksh_car02_notification_outbox/i.test(r13Sql),
  releaseLock
 };
 const expectedGaps={
  R46_STAFF_ACCESS_AUTH_VERSION_COLUMN_MISSING:authColumn===false,
  R43_TX_TIME_STAFF_MEMBERSHIP_LOCK_NOT_PROVEN:!membershipTx,
  R43_REPLAY_REAUTHORIZATION_NOT_PROVEN:replayWithoutFence,
  STAFF_AUTH_VERSION_DB_BINDING_NOT_PROVEN:!reader,
  LIVE_SIGNED_JWT_PROVIDER_NOT_PROVEN:
    r46Provider.includes('createSupabaseStaffTokenVerifierR46')&&
    !r46Provider.includes('CAR02_LIVE_SIGNER_AND_AUTH_VERSION_BINDING_PROVEN'),
  R52_PRODUCTION_RELEASE_LOCK_ACTIVE:releaseLock
 };
 const unexpected=Object.entries({...anchor,...expectedGaps}).filter(([,value])=>!value).map(([key])=>key);
 const hashes=Object.fromEntries(V48_SOURCE_KEYS.map(k=>[k,SHA(snapshot[k])]));
 return F({mode:'REVIEW_ONLY',release:'NO_GO',safeToDeploy:false,
  sourceBaselineIntact:unexpected.length===0,needsManualSourceReview:unexpected.length>0,
  blockingEvidenceMissing:true,blockerCount:6,
  blockers:F(V48_BLOCKER_IDS.map(id=>F({id,unresolved:true,expectedGapVisible:expectedGaps[id]===true}))),
  anchors:F({...anchor}),unexpected:F(unexpected),sourceSha256:F(hashes)});
}
/** Checks actual query not unrelated mentions of auth_version in comments. */
export function v48QaReaderHasDbVersion(source){
 if(typeof source!=='string')return false;
 const q=/SELECT\s+shop_code\s*,\s*user_sub\s*,\s*staff_role\s*,\s*active\s*,\s*auth_version\b[\s\S]{0,140}?FROM\s+public\.ksh_car02_staff_access/i;
 return q.test(source.replace(/--[^\n]*/g,'').replace(/\/\*[\s\S]*?\*\//g,''));
}
/** CI PASS certifies only known-gap detection, never a release approval. */
export function v48QaReleaseDecision(assessment, options={}){
 if(!assessment||assessment.mode!=='REVIEW_ONLY'||assessment.release!=='NO_GO'||
    assessment.blockerCount!==6||!Array.isArray(assessment.blockers))
  throw Error('CAR02_V48_ASSESSMENT_REQUIRED');
 if(!plain(options))throw Error('CAR02_V48_OPTIONS_INVALID');
 return F({authorized:false,release:'NO_GO',blockers:6,
  reason:assessment.needsManualSourceReview?'SOURCE_DRIFT_MANUAL_REVIEW':'SIX_UNCLOSED_RELEASE_BLOCKERS',
  dryRun:true,requiresIndependentLiveDbAndSignerEvidence:true});
}
