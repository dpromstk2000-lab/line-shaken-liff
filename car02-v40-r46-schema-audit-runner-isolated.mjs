/** V4.0 read-only source inspection; fails closed if sources change unexpectedly. */
import {readFileSync} from 'node:fs';
import {v40ReviewR46Schema,V40_LOCK_SQL,V40_MODE,V40_TABLE} from './car02-v40-r46-locked-membership-contract-isolated.mjs';
const source=p=>readFileSync(new URL(`./${p}`,import.meta.url),'utf8');
const readRepo=p=>readFileSync(p,'utf8');
const ddl=readRepo('R46_STAFF_GRANTS_QA_ONLY.sql');
const providers=readRepo('car02-auth-providers-r46.mjs');
const r43=readRepo('car02-pg-adapter.mjs');
const r44=readRepo('car02-identity-r44.mjs');
const r52=readRepo('car02-edge-entry-r52.ts');
const v39=readRepo('car02-v39-transaction-authorization-contract-isolated.mjs');
const v40=source('car02-v40-r46-locked-membership-contract-isolated.mjs');
const schema=v40ReviewR46Schema(ddl);
const checks={
 r46ReviewOnly:schema.sourceIsReviewOnly===true,
 r46KnownMembershipTable:schema.tableFound===true&&schema.expectedColumnsPresent===true,
 r46MissingAuthVersion:schema.versionAvailable===false&&schema.requiresMigration===true,
 r46PrimaryKey:/PRIMARY KEY \(shop_code,user_sub\)/.test(ddl),
 r46LockedDownToServiceRole:ddl.includes('ENABLE ROW LEVEL SECURITY')&&ddl.includes('TO service_role'),
 r46ExistingReaderUsesSameTable:providers.includes(`FROM ${V40_TABLE} WHERE shop_code=$1 AND user_sub=$2 LIMIT 2`),
 r46ReaderHasNoVersionBinding:!providers.includes('SELECT shop_code,user_sub,staff_role,active,auth_version'),
 r43ReplayReturnsCachedSnapshot:r43.includes('return obj(existing.response_snapshot);'),
 r43TxStartsBeforeReplay:r43.includes("await c.query('BEGIN')")&&r43.includes('response_snapshot,completed_at'),
 r44SeparateStaffMembershipResolver:r44.includes('resolveStaffAccess({userSub:jwt.sub,shopCode})'),
 r52ReleaseHardLocked:/const\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/.test(r52),
 v39RequiresAuthVersion:v39.includes('claims.authVersion')&&v39.includes('lease.authVersion'),
 v40SqlRequestsPgRowLock:V40_LOCK_SQL.includes('FOR UPDATE')&&V40_LOCK_SQL.includes('auth_version'),
 v40NeverDeployable:V40_MODE.deployable===false&&V40_MODE.realDatabase===false&&V40_MODE.release==='NO_GO',
 v40NoHardcodedProductSecrets:!/SERVICE_ROLE_KEY\s*=|SUPABASE_SERVICE_ROLE_KEY\s*=|LINE_CHANNEL_SECRET\s*=/.test(v40)
};
for(const [name,ok] of Object.entries(checks))console.log('V40_R46_SOURCE_'+(ok?'PASS ':'FAIL ')+name);
if(Object.values(checks).some(x=>!x))process.exitCode=1;
else console.log(`CAR02_V40_R46_SCHEMA_GAP_PASS ${Object.keys(checks).length}/${Object.keys(checks).length} BLOCKERS=6 NO_GO HOLD`);
console.log('V40_RELEASE_BLOCKER R46_STAFF_ACCESS_AUTH_VERSION_COLUMN_MISSING');
console.log('V40_RELEASE_BLOCKER R43_TX_TIME_STAFF_MEMBERSHIP_LOCK_NOT_PROVEN');
console.log('V40_RELEASE_BLOCKER R43_REPLAY_REAUTHORIZATION_NOT_PROVEN');
console.log('V40_RELEASE_BLOCKER STAFF_AUTH_VERSION_DB_BINDING_NOT_PROVEN');
console.log('V40_RELEASE_BLOCKER LIVE_SIGNED_JWT_PROVIDER_NOT_PROVEN');
console.log('V40_RELEASE_BLOCKER R52_PRODUCTION_RELEASE_LOCK_ACTIVE');
console.log('V40_QA_ONLY: PROPOSED COLUMN NOT IN R46; NO_SQL_EXECUTION NO_REAL_DB NO_DEPLOY');
