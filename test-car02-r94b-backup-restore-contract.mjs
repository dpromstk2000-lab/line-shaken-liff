import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const impl=readFileSync('car02-r94b-disposable-backup-restore.mjs','utf8');
const yaml=readFileSync('.github/workflows/car02-r94b-disposable-backup-restore-qa.yml','utf8');
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
 for(const token of ['upload_intents','cleanup_jobs','pg_get_triggerdef','pg_get_functiondef','nspacl','assert.deepEqual(a,b'])assert.ok(impl.includes(token),token);
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
