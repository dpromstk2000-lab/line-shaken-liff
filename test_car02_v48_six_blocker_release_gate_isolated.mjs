import test from 'node:test';
import assert from 'node:assert/strict';
import {V48_MODE,V48_BLOCKER_IDS,V48_SOURCE_KEYS,v48QaAssessSourceGaps,v48QaReleaseDecision,v48QaReaderHasDbVersion} from './car02-v48-six-blocker-release-gate-isolated.mjs';
// These are representative fixtures, NOT a substitute for the source runner on GitHub.
function fixture(){return {
 r46Sql:`-- QA/REVIEW ONLY\nCREATE TABLE public.ksh_car02_staff_access (\nshop_code text NOT NULL,\nuser_sub uuid NOT NULL,\nstaff_role text,\nactive boolean,\nPRIMARY KEY(shop_code,user_sub)\n);`,
 r46Provider:`export function createSupabaseStaffTokenVerifierR46() { return true; }\nSELECT shop_code,user_sub,staff_role,active\nFROM public.ksh_car02_staff_access WHERE shop_code=$1 AND user_sub=$2 LIMIT 2;`,
 r43Adapter:`async transaction(){await c.query('BEGIN');open=true;\nawait c.query('SELECT pg_advisory_xact_lock(1)');\nif(existing){await c.query('COMMIT');open=false;return obj(existing.response_snapshot);}}`,
 r44Identity:`const staff=await resolveStaffAccess({userSub:jwt.sub,shopCode});\nreturn staff;`,
 r52Edge:`const CAR02_RELEASE_LOCK=true; // do not deploy\nif(CAR02_RELEASE_LOCK)throw Error('CAR02_NOT_RELEASED');`,
 v41Sql:`-- NOT AN APPROVED MIGRATION. DO NOT RUN ON PRODUCTION. CREATE FUNCTION mock_review_only() RETURNS void`,
 v47Sql:`-- Everything below is commented out intentionally\n/*\nALTER TABLE public.ksh_car02_notification_outbox ADD COLUMN claim_token uuid;\n*/`,
 r13Sql:`CREATE TABLE public.ksh_car02_notification_outbox (id uuid PRIMARY KEY, delivery_status text NOT NULL);`
};}
const assess=()=>v48QaAssessSourceGaps(fixture());
for(const [n,fn] of [
 ['the model is explicitly not deployable',()=>assert.equal(V48_MODE.deployable,false)],
 ['read-only',()=>assert.equal(V48_MODE.readOnly,true)],
 ['refuses to claim live PostgreSQL proof',()=>assert.equal(V48_MODE.liveDbProof,false)],
 ['refuses to claim real JWT proof',()=>assert.equal(V48_MODE.liveJwtProof,false)],
 ['release remains hold',()=>assert.equal(V48_MODE.release,'NO_GO')],
 ['no authorization authority',()=>assert.equal(V48_MODE.approvalAuthority,false)],
 ['exactly six blockers',()=>assert.equal(V48_BLOCKER_IDS.length,6)],
 ['blocker identifiers unique',()=>assert.equal(new Set(V48_BLOCKER_IDS).size,6)],
 ['exactly eight source inputs',()=>assert.equal(V48_SOURCE_KEYS.length,8)],
 ['baseline only allows NO_GO',()=>assert.equal(assess().release,'NO_GO')],
 ['baseline source consistent',()=>assert.equal(assess().sourceBaselineIntact,true)],
 ['baseline needs no drift review',()=>assert.equal(assess().needsManualSourceReview,false)],
 ['baseline marked not safe',()=>assert.equal(assess().safeToDeploy,false)],
 ['all blockers unresolved',()=>assert.ok(assess().blockers.every(b=>b.unresolved))],
 ['all expected gaps visible',()=>assert.ok(assess().blockers.every(b=>b.expectedGapVisible))],
 ['all source hashes generated',()=>assert.equal(Object.keys(assess().sourceSha256).length,8)],
 ['hash is 64 lowercase hex',()=>assert.ok(Object.values(assess().sourceSha256).every(x=>/^[a-f0-9]{64}$/.test(x)))],
 ['hash is deterministic',()=>assert.deepEqual(assess().sourceSha256,v48QaAssessSourceGaps(fixture()).sourceSha256)],
 ['baseline no-go decision',()=>assert.equal(v48QaReleaseDecision(assess()).authorized,false)],
 ['no-go result requires live independent evidence',()=>assert.equal(v48QaReleaseDecision(assess()).requiresIndependentLiveDbAndSignerEvidence,true)],
 ['failure reasons name all six blockers',()=>assert.equal(v48QaReleaseDecision(assess()).reason,'SIX_UNCLOSED_RELEASE_BLOCKERS')],
 ['assessment read-only',()=>assert.equal(Object.isFrozen(assess()),true)]
])test('V48 baseline: '+n,fn);
for(const k of V48_SOURCE_KEYS){
 test('V48 requires source '+k,()=>{const s=fixture();delete s[k];assert.throws(()=>v48QaAssessSourceGaps(s),/CAR02_V48_MISSING_SOURCE/);});
 test('V48 rejects truncated source '+k,()=>{const s=fixture();s[k]='x';assert.throws(()=>v48QaAssessSourceGaps(s),/CAR02_V48_MISSING_SOURCE/);});
}
for(const s of [null,[],undefined,42,'test',Object.create(null)])test('V48 rejects invalid snapshot '+(s===null?'null':typeof s),()=>assert.throws(()=>v48QaAssessSourceGaps(s),/CAR02_V48_SNAPSHOT_REQUIRED/));
for(const [label,patch,flag] of [
 ['staff membership auth_version column added',s=>s.r46Sql=s.r46Sql.replace('staff_role text,','staff_role text,\nauth_version integer NOT NULL,').replace('active boolean,','active boolean,'),'R46_STAFF_ACCESS_AUTH_VERSION_COLUMN_MISSING'],
 ['staff membership no longer review only',s=>s.r46Sql=s.r46Sql.replace('QA/REVIEW ONLY','PRODUCTION'),'r46ReviewOnly'],
 ['staff table deleted',s=>s.r46Sql=s.r46Sql.replace('ksh_car02_staff_access','other_table'),'sourceTable'],
 ['R43 locking query introduced',s=>s.r43Adapter+=`\nSELECT shop_code FROM public.ksh_car02_staff_access WHERE shop_code=$1 FOR UPDATE;`,'R43_TX_TIME_STAFF_MEMBERSHIP_LOCK_NOT_PROVEN'],
 ['R43 BEGIN removed',s=>s.r43Adapter=s.r43Adapter.replace("await c.query('BEGIN');",'/* no transaction */'),'r43Transaction'],
 ['R43 replay now reauthorizes',s=>s.r43Adapter=s.r43Adapter.replace('return obj(existing.response_snapshot);','return safelyReauthorize(existing.response_snapshot);'),'R43_REPLAY_REAUTHORIZATION_NOT_PROVEN'],
 ['R46 reader begins reading version',s=>s.r46Provider=s.r46Provider.replace('SELECT shop_code,user_sub,staff_role,active','SELECT shop_code,user_sub,staff_role,active,auth_version'),'STAFF_AUTH_VERSION_DB_BINDING_NOT_PROVEN'],
 ['R44 resolver renamed',s=>s.r44Identity=s.r44Identity.replace('resolveStaffAccess({userSub:jwt.sub,shopCode})','otherResolver(jwt)'),'r44SeparateStaffResolver'],
 ['trusted live session binding claim appears',s=>s.r46Provider+=`\nCAR02_LIVE_SIGNER_AND_AUTH_VERSION_BINDING_PROVEN`, 'LIVE_SIGNED_JWT_PROVIDER_NOT_PROVEN'],
 ['R52 release lock disabled',s=>s.r52Edge=s.r52Edge.replace('LOCK=true','LOCK=false'),'R52_PRODUCTION_RELEASE_LOCK_ACTIVE'],
 ['R52 release lock removed',s=>s.r52Edge=s.r52Edge.replace('const CAR02_RELEASE_LOCK=true;','const released=1;'),'R52_PRODUCTION_RELEASE_LOCK_ACTIVE'],
 ['V41 migration draft approved',s=>s.v41Sql=s.v41Sql.replace('NOT AN APPROVED MIGRATION','APPROVED MIGRATION'),'v41DraftOnly'],
 ['V47 lease migration comment removed',s=>s.v47Sql=s.v47Sql.replace('Everything below is commented out intentionally','Executable migration authorized'),'v47CommentOnly'],
 ['R13 outbox table removed',s=>s.r13Sql=s.r13Sql.replace('ksh_car02_notification_outbox','other_outbox'),'r13Outbox']
])test('V48 expected source drift: '+label,()=>{const s=fixture();patch(s);const a=v48QaAssessSourceGaps(s);assert.equal(a.safeToDeploy,false);assert.equal(a.release,'NO_GO');assert.equal(a.sourceBaselineIntact,false);assert.equal(a.needsManualSourceReview,true);assert.ok(a.unexpected.includes(flag));assert.equal(v48QaReleaseDecision(a).reason,'SOURCE_DRIFT_MANUAL_REVIEW');});
for(const opts of [{approved:true},{release:'GO'},{signedBy:'admin'},{allowProduction:true},{proof:'green'},{}])test('V48 refuses approval overrides '+JSON.stringify(opts),()=>{const d=v48QaReleaseDecision(assess(),opts);assert.equal(d.authorized,false);assert.equal(d.release,'NO_GO');assert.equal(d.dryRun,true);});
for(const input of [null,{},false,'GO',{mode:'REVIEW_ONLY',release:'GO',blockerCount:6,blockers:[]}])test('V48 invalid decision cannot promote GO '+String(input),()=>assert.throws(()=>v48QaReleaseDecision(input),/CAR02_V48_ASSESSMENT_REQUIRED/));
for(const [src,expected] of [
 ['SELECT shop_code,user_sub,staff_role,active FROM public.ksh_car02_staff_access',false],
 ['SELECT shop_code,user_sub,staff_role,active,auth_version FROM public.ksh_car02_staff_access',true],
 ['-- SELECT shop_code,user_sub,staff_role,active,auth_version FROM public.ksh_car02_staff_access',false],
 ['/* SELECT shop_code,user_sub,staff_role,active,auth_version FROM public.ksh_car02_staff_access */',false],
 ['SELECT shop_code,user_sub,staff_role,active,auth_version FROM irrelevant.table',false],
 ['claim.auth_version = 1',false],
 [null,false],
 [undefined,false]
])test('V48 membership SELECT strict parsing '+String(src).slice(0,24),()=>assert.equal(v48QaReaderHasDbVersion(src),expected));
