/** DPRO CAR02 V4.2 -- READ-ONLY source review; no database, deploy, external API or key access. */
import {readFileSync} from 'node:fs';
import {V42_MODE} from './car02-v42-signed-session-binding-isolated.mjs';
const read=p=>readFileSync(p,'utf8');
const ddl=read('R46_STAFF_GRANTS_QA_ONLY.sql');
const provider=read('car02-auth-providers-r46.mjs');
const pg=read('car02-pg-adapter.mjs');
const identity=read('car02-identity-r44.mjs');
const edge=read('car02-edge-entry-r52.ts');
const v41sql=read('CAR02_V41_STAFF_AUTH_VERSION_PG17_ISOLATED_REVIEW_ONLY.sql');
const model=read('car02-v42-signed-session-binding-isolated.mjs');
const tests=read('test_car02_v42_signed_session_binding_isolated.mjs');
const checks={
 originalMembershipSchemaIsReviewOnly:ddl.includes('QA/REVIEW ONLY'),
 originalMembershipHasNoVersion:/CREATE TABLE public\.ksh_car02_staff_access/.test(ddl)&&!/\bauth_version\s+integer\b/.test(ddl),
 originalMembershipRlsOn:ddl.includes('ENABLE ROW LEVEL SECURITY'),
 originalMembershipServiceRole:ddl.includes('TO service_role'),
 v41SchemaProposalIsNotExecuted:v41sql.includes('NOT EXECUTED OR LOCK-TESTED'),
 v41AddsVersionColumn:v41sql.includes('ADD COLUMN auth_version integer NOT NULL DEFAULT 1'),
 v41RequiresUpdateBump:v41sql.includes('NEW.auth_version := OLD.auth_version + 1'),
 v41ForbidsDelete:v41sql.includes('BEFORE DELETE')&&v41sql.includes('REVOKE DELETE'),
 existingProviderChecksSupabaseUser:provider.includes("fetchImpl(issuer+'/user'")&&provider.includes('JWT payload alone is NEVER sufficient'),
 existingProviderDoesNotReadVersion:provider.includes('SELECT shop_code,user_sub,staff_role,active')&&!provider.includes('SELECT shop_code,user_sub,staff_role,active,auth_version'),
 existingR43ReturnsSnapshotWithoutNewReauthorization:pg.includes('return obj(existing.response_snapshot);'),
 existingR44AuthorizationSeparate:identity.includes('resolveStaffAccess({userSub:jwt.sub,shopCode})'),
 releaseGateStillHardLocked:/const\s+CAR02_RELEASE_LOCK\s*=\s*true/.test(edge),
 qaExplicitlyNonDeployable:V42_MODE.deployable===false&&V42_MODE.realDb===false&&V42_MODE.release==='NO_GO',
 qaExplicitlyNoLiveProvider:V42_MODE.liveJwtProvider===false&&V42_MODE.realRowLock===false,
 modelUsesEd25519: model.includes("edSign(null,")&&model.includes('edVerify(null,'),
 modelPinsAlgorithmAndIssuer: model.includes("head.alg!=='EdDSA'")&&model.includes('claims.iss!==issuer')&&model.includes('claims.aud!==audience'),
 modelUsesPrivateVerifiedBrand:model.includes('new WeakSet()')&&model.includes('trusted.add(verified)'),
 modelRequiresVersionAndRevocation:model.includes('lockedMembership.active!==true')&&model.includes('lockedMembership.auth_version!==verifiedIdentity.authVersion'),
 testsIncludePostVerificationExpiry:tests.includes('expires after verify but before authorization'),
 modelDoesNotAccessDbOrNetwork:!/(?:pool|client|db)\.query\(/.test(model)&&!/(?:fetch\(|https?:\/\/)/.test(model),
 modelContainsNoEmbeddedKeys:!/(BEGIN PRIVATE KEY|BEGIN PUBLIC KEY|SUPABASE_SERVICE_ROLE_KEY|CHANNEL_SECRET)/.test(model)
};
for(const [k,v] of Object.entries(checks)) console.log(`V42_SOURCE_${v?'PASS':'FAIL'} ${k}`);
if(Object.values(checks).some(v=>!v))process.exitCode=1;
else console.log(`CAR02_V42_SIGNED_SESSION_REVIEW_PASS ${Object.keys(checks).length}/${Object.keys(checks).length} BLOCKERS=6 NO_GO HOLD`);
console.log('V42_QA_ONLY: SYNTHETIC_ED25519_KEYS; NO_LIVE_JWT; NO_DB; NO_SQL; NO_RELEASE');
