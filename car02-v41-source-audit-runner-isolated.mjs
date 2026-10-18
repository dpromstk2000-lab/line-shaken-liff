/** DPRO CAR02 V4.1 source review ONLY, never SQL execution. */
import {readFileSync} from 'node:fs';
import {V41_MODE,v41ReviewSource} from './car02-v41-staff-auth-version-policy-isolated.mjs';
const read=p=>readFileSync(p,'utf8');
const ddl=read('R46_STAFF_GRANTS_QA_ONLY.sql');
const resolver=read('car02-auth-providers-r46.mjs');
const r43=read('car02-pg-adapter.mjs');
const r44=read('car02-identity-r44.mjs');
const r52=read('car02-edge-entry-r52.ts');
const v40=read('car02-v40-r46-locked-membership-contract-isolated.mjs');
const proposal=read('CAR02_V41_STAFF_AUTH_VERSION_PG17_ISOLATED_REVIEW_ONLY.sql');
const model=read('car02-v41-staff-auth-version-policy-isolated.mjs');
const scan=v41ReviewSource(ddl,resolver);
const checks={
 r46SchemaStillReviewOnly:ddl.includes('QA/REVIEW ONLY'),
 r46CurrentMembershipTable:scan.schemaTable===true,
 r46MissingVersionColumn:scan.schemaVersion===false,
 r46ReaderMissingVersion:scan.readerVersion===false&&scan.requiresMigration===true,
 r46OriginalDeleteGrant:ddl.includes('GRANT SELECT,INSERT,UPDATE,DELETE'),
 v41ReviewOnly:proposal.includes('DO NOT RUN ON PRODUCTION')&&proposal.includes('NOT AN APPROVED MIGRATION'),
 v41PreparedColumnOnly:proposal.includes('ADD COLUMN auth_version integer NOT NULL DEFAULT 1'),
 v41TriggerBumpsVersion:proposal.includes('NEW.auth_version := OLD.auth_version + 1;'),
 v41TriggerRejectsPrincipalKeyMutation:proposal.includes('IDENTITY_IMMUTABLE'),
 v41BlocksDeleteAndRecreate:proposal.includes('BEFORE DELETE')&&proposal.includes('REVOKE DELETE'),
 v41VersionExhaustionDenied:proposal.includes('AUTH_VERSION_EXHAUSTED'),
 v41DoesNotTrustClientClaims:proposal.includes('Do not read it from client JSON.'),
 v41NoDeploymentMode:V41_MODE.deployable===false&&V41_MODE.realDatabase===false&&V41_MODE.release==='NO_GO',
 v41NoDatabaseExecutions:!/(?:pool|client|db)\.query\(/.test(model),
 v40ExistingQueryRequiresVersion:v40.includes('SELECT shop_code,user_sub,staff_role,active,auth_version'),
 r43ReplayStillNotVersionGated:r43.includes('return obj(existing.response_snapshot);'),
 r44IdentityStillSeparate:r44.includes('resolveStaffAccess({userSub:jwt.sub,shopCode})'),
 r52ReleaseLockStillOn:/const\s+CAR02_RELEASE_LOCK\s*=\s*true/.test(r52)
};
for(const [name,ok] of Object.entries(checks))console.log('V41_SOURCE_'+(ok?'PASS ':'FAIL ')+name);
if(Object.values(checks).some(v=>!v))process.exitCode=1;
else console.log(`CAR02_V41_SCHEMA_EVOLUTION_REVIEW_PASS ${Object.keys(checks).length}/${Object.keys(checks).length} BLOCKERS=6 NO_GO HOLD`);
console.log('V41_REVIEW_ONLY: NO_DB_SQL_EXECUTED; NO_SIGNED_SESSION; NO_REAL_LOCK; RELEASE_HOLD');
