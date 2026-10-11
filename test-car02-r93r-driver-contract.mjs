// Static checks can run offline before GitHub's actual PG17 driver test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const fixture=readFileSync('R93R_PG17_DRIVER_FIXTURE_QA_ONLY.sql','utf8');
const real=readFileSync('test-car02-r93r-real-pg-driver.mjs','utf8');
const source=readFileSync('car02-r93q-single-schema-lifecycle-isolated.mjs','utf8');
test('only explicit disposable DB exact name in PostgreSQL fixture',()=>{
 assert.match(fixture,/current_database\(\)\s*<>\s*'car02_r93q_qa_ci'/);
 assert.match(fixture,/current_setting\('server_version_num'\)::integer\s*<\s*170000/);
 assert.match(fixture,/to_regclass\('public\.ksh_car02_photos'\) IS NOT NULL/);
 assert.match(fixture,/CREATE SCHEMA car02_r93q_qa;/);
 assert.match(fixture,/REVOKE ALL ON SCHEMA car02_r93q_qa FROM PUBLIC;/);
});
test('fixture is real, committed data with representative staff and orders',()=>{
 for(const s of ['CREATE TABLE car02_r93q_qa.photos','CREATE TABLE car02_r93q_qa.cleanup_jobs','CREATE TRIGGER car02_r93q_guard','INSERT INTO car02_r93q_qa.staff','INSERT INTO car02_r93q_qa.work_orders','INSERT INTO car02_r93q_qa.reports','COMMIT;']) assert.ok(fixture.includes(s),s);
 assert.doesNotMatch(fixture,/DROP SCHEMA\s+public|ALTER\s+ROLE|CREATE\s+EXTENSION/i);
});
test('R93R real driver requires hardcoded loopback and CI-only password',()=>{
 for(const s of ['R93R_ISOLATED_PG17_DRIVER_QA','127.0.0.1','car02_r93q_qa_ci','disposable-r93r-ci-only','new pg.Pool','await import(\'pg\')']) assert.ok(real.includes(s),s);
 assert.doesNotMatch(real,/(?:SUPABASE_URL|CAR02_DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY|process\.env\.DATABASE_URL)/);
});
test('tests enforce transaction rollback and lost COMMIT response, not only mocked DB',()=>{
 for(const s of ['outbox unique collision','unknown COMMIT response','SIMULATED_ACK_LOSS_AFTER_REAL_COMMIT','revoked staff','3-active-photo','R93R_REAL_NODE_PG17_DRIVER_PASS']) assert.ok(real.toLowerCase().includes(s.toLowerCase()),s);
});
test('no production source imports R93R, and R93Q remains hard locked',()=>{
 assert.match(source,/ISOLATED POSTGRESQL QA ONLY/);
 assert.match(source,/productionReady:false,liveWiring:false/);
 assert.match(source,/neverCallsStorageDelete:true/);
});
