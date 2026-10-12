import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {R94B_SCHEMA_ACL_SQL,normalizeR94BSchemaAcl} from './car02-r94b-schema-acl.mjs';
const impl=readFileSync('car02-r94b-disposable-backup-restore.mjs','utf8');
const yaml=readFileSync('.github/workflows/car02-r94b-disposable-backup-restore-qa.yml','utf8');
const aclImpl=readFileSync('car02-r94b-schema-acl.mjs','utf8');
test('R94B hard requires explicit disposable environment',()=>assert.match(impl,/R94B_DISPOSABLE_BACKUP_QA/));
test('R94B only two allowed database identifiers',()=>{
 assert.match(impl,/\[SOURCE,RESTORE\]\.includes\(db\)/);
 assert.match(impl,/car02_r93q_qa_ci/);assert.match(impl,/car02_r94b_restore_ci/);
});
test('R94B Postgres 17 and no live tables fail closed',()=>{
 assert.match(impl,/pg>=170000/);assert.match(impl,/no_live,true/);
});
test('R94B seed exercises production-shaped staging path',()=>{
 assert.match(impl,/createCar02R94AFullStagingPipeline/);
 assert.match(impl,/functions\/v1\/dpro-car02-stage\/api\/car02\/uploads/);
});
test('R94B backup contains READY and tombstone',()=>{
 assert.match(impl,/upload_state==='ready'/);assert.match(impl,/upload_state==='deleted'/);
 assert.match(impl,/cleanup_jobs\.length,1/);
});
test('R94B compares tables, triggers, functions and ACL',()=>{
 for(const token of ['upload_intents','cleanup_jobs','pg_get_triggerdef','pg_get_functiondef','snapshotAcl','assert.deepEqual(a,b'])assert.ok(impl.includes(token),token);
 assert.match(aclImpl,/aclexplode\(COALESCE\(n\.nspacl,acldefault\('n',n\.nspowner\)\)\)/);
});
test('R94B verifies hard delete is still blocked',()=>assert.match(impl,/hard delete ready/));
test('R94B verifies READY cannot downgrade',()=>assert.match(impl,/downgrade READY/));
test('R94B verifies immutable durable intent',()=>assert.match(impl,/mutate durable upload intent/));
test('R94B checks repeat keys prevented',()=>assert.match(impl,/duplicate durable upload intent/));
test('R94B read-only rollback probes never commit',()=>{
 assert.match(impl,/ROLLBACK TO SAVEPOINT r94b_probe/);assert.match(impl,/await client\.query\('ROLLBACK'\)/);
 assert.doesNotMatch(impl,/client\.query\('COMMIT'\)/);
});
test('R94B dump and restore happen on same disposable PostgreSQL 17 service',()=>{
 assert.match(yaml,/pg_dump -U postgres/);assert.match(yaml,/pg_restore -U postgres/);
 assert.match(yaml,/image: postgres:17/);
});
test('R94B cleanup runs on any exit, removes both databases and dump',()=>{
 assert.match(yaml,/if: always\(\)/);
 assert.match(yaml,/DROP DATABASE IF EXISTS car02_r94b_restore_ci/);
 assert.match(yaml,/DROP DATABASE IF EXISTS car02_r93q_qa_ci/);
 assert.match(yaml,/rm -f \/tmp\/car02-r94b-disposable.dump/);
});
test('R94B never declares worker or production configuration',()=>{
 assert.doesNotMatch(yaml,/\$\{\{\s*secrets\./);
 assert.doesNotMatch(impl,/SUPABASE_SERVICE_ROLE_KEY|CAR02_DATABASE_URL|wrangler/i);
});

// Deterministic offline semantic checks: these run BEFORE disposable PostgreSQL 17.
const ownerRow=(privilege_type,extras={})=>({schema_name:'car02_r93q_qa',schema_owner:'postgres',
 grantee:'postgres',grantor:'postgres',privilege_type,is_grantable:false,...extras});
const implicitDefault=[ownerRow('CREATE'),ownerRow('USAGE')];
const normalized=()=>normalizeR94BSchemaAcl(implicitDefault);
test('R94B ACL: nspacl NULL becomes semantic default through aclexplode',()=>{
 assert.match(R94B_SCHEMA_ACL_SQL,/aclexplode\(COALESCE\(n\.nspacl,acldefault\('n',n\.nspowner\)\)\)/);
 assert.doesNotMatch(R94B_SCHEMA_ACL_SQL,/nspacl::text/);
 assert.deepEqual(normalizeR94BSchemaAcl([...implicitDefault].reverse()),normalized());
});
test('R94B ACL: public USAGE elevation is detected',()=>{
 const elevated=normalizeR94BSchemaAcl([...implicitDefault,ownerRow('USAGE',{grantee:'PUBLIC'})]);
 assert.notDeepEqual(elevated,normalized());
});
test('R94B ACL: public CREATE elevation is detected',()=>{
 const elevated=normalizeR94BSchemaAcl([...implicitDefault,ownerRow('CREATE',{grantee:'PUBLIC'})]);
 assert.notDeepEqual(elevated,normalized());
});
test('R94B ACL: owner USAGE revocation with one remaining CREATE row fails closed with precise cause',()=>{
 assert.throws(()=>normalizeR94BSchemaAcl([ownerRow('CREATE')]),/R94B_OWNER_USAGE_MISSING/);
});
test('R94B ACL: owner CREATE revocation with one remaining USAGE row is detected',()=>{
 assert.throws(()=>normalizeR94BSchemaAcl([ownerRow('USAGE')]),/R94B_OWNER_CREATE_MISSING/);
});
test('R94B ACL: zero rows still fail closed and are never interpreted as valid defaults',()=>{
 assert.throws(()=>normalizeR94BSchemaAcl([]),/R94B_ACL_EMPTY_OR_MISSING/);
 assert.throws(()=>normalizeR94BSchemaAcl(null),/R94B_ACL_EMPTY_OR_MISSING/);
});
test('R94B ACL: the real probe handler recognizes the precise owner revocation error',()=>{
 assert.match(impl,/R94B_OWNER_/);
 assert.match(impl,/REVOKE USAGE ON SCHEMA car02_r93q_qa FROM postgres/);
 assert.match(impl,/await client\.query\('ROLLBACK'\)/);
});
test('R94B ACL: owner CREATE revocation fails closed',()=>{
 assert.throws(()=>normalizeR94BSchemaAcl([ownerRow('USAGE'),ownerRow('USAGE',{grantee:'PUBLIC'})]),/R94B_OWNER_CREATE_MISSING/);
});
test('R94B ACL: grant option and grantor changes are detected',()=>{
 assert.notDeepEqual(normalizeR94BSchemaAcl([ownerRow('CREATE',{is_grantable:true}),ownerRow('USAGE')]),normalized());
 assert.notDeepEqual(normalizeR94BSchemaAcl([ownerRow('CREATE',{grantor:'other_role'}),ownerRow('USAGE')]),normalized());
});
test('R94B ACL: schema owner and grantee role change are detected',()=>{
 assert.notDeepEqual(normalizeR94BSchemaAcl(implicitDefault.map(r=>({...r,schema_owner:'other_owner',grantee:'other_owner'}))),normalized());
 assert.notDeepEqual(normalizeR94BSchemaAcl([...implicitDefault,ownerRow('USAGE',{grantee:'other_role'})]),normalized());
});
test('R94B ACL: unknown OIDs and invalid grant types fail closed',()=>{
 assert.throws(()=>normalizeR94BSchemaAcl([ownerRow('CREATE',{grantor:'MISSING_GRANTOR_OID:5'}),ownerRow('USAGE')]),/R94B_UNRESOLVED_ACL_grantor/);
 assert.throws(()=>normalizeR94BSchemaAcl([ownerRow('CREATE',{privilege_type:'DROP'}),ownerRow('USAGE')]),/R94B_UNEXPECTED_SCHEMA_PRIVILEGE/);
});
test('R94B ACL: real disposable rollback-only negative probes required',()=>{
 for(const token of ['GRANT USAGE ON SCHEMA car02_r93q_qa TO PUBLIC',
  'REVOKE USAGE ON SCHEMA car02_r93q_qa FROM postgres','R94B_ACL_NEGATIVE_2_2_PASS',
  "await client.query('ROLLBACK')",'R94B_ACL_PROBE_LEFT_MUTATIONS']) assert.ok(impl.includes(token),token);
});
