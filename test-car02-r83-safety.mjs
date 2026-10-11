import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=f=>readFileSync(new URL(f,import.meta.url),'utf8');
const entry=read('car02-edge-entry-r52.ts');
const unified=read('car02-unified-runtime-r50.mjs');
const photo=read('car02-private-photo-r47.mjs');
const route=read('car02-private-photo-upload-http-r82.mjs');
const r83=read('car02-pg-photo-repository-r83.mjs');
const fixture=read('R83_PG17_QA_FIXTURE_ONLY.sql');
const assertSql=read('R83_PG17_QA_ASSERT.sql');

test('R83 requires hardcoded release lock maintained in edge entry',()=>{
 assert.match(entry,/const CAR02_RELEASE_LOCK=true/);
 assert.match(entry,/if\(CAR02_RELEASE_LOCK\)throw Error\('CAR02_NOT_RELEASED'\)/);
});
test('R83 not imported into live/unified/edge/R82 HTTP entrypoints',()=>{
 for(const c of [entry,unified,route])assert.doesNotMatch(c,/car02-pg-photo-repository-r83|createCar02PgPhotoRepositoryR83/);
});
test('R83 R47 uploader still checks private bucket and integrity',()=>{
 assert.match(photo,/BUCKET\s*=\s*'ksh-car02-private-photos'/);
 assert.match(photo,/meta\.public!==false/);
 assert.match(photo,/blobSha\(confirmed\)!==sha256/);
 assert.match(photo,/await repository\.cancel/);
});
test('R83 checkout must not circumvent R80 release review',()=>{
 const result=JSON.parse(read('R79_EVIDENCE_SNAPSHOT.json'));
 assert.equal(result.live_backup_completed,false);
 assert.equal(result.separate_production_restore_verified,false);
 assert.equal(result.car02_tables,0);
 assert.equal(result.edge_stage.CAR02_RELEASE_LOCK,true);
});
test('R83 SQL fixture and asserts enforce database-name isolation',()=>{
 assert.match(fixture,/current_database\(\) !~ '\^car02_r83_qa_/);
 assert.match(assertSql,/current_database\(\) !~ '\^car02_r83_qa_/);
 assert.doesNotMatch(fixture,/DROP TABLE|DROP DATABASE|ALTER TABLE public\.ksh_demo_/i);
});
test('R83 SQL can execute only through disposable PostgreSQL 17 fixture',()=>{
 assert.match(fixture,/CREATE TABLE public\.ksh_car02_photos/);
 assert.match(fixture,/ENABLE ROW LEVEL SECURITY/);
 assert.match(assertSql,/R83_CROSS_TENANT_PHOTO_VISIBLE/);
 assert.match(assertSql,/R83_DUPLICATE_STORAGE_PATH_ALLOWED/);
 assert.match(assertSql,/R83_TEST_MUTATION_NOT_ROLLED_BACK/);
});
test('R83 source enforces 3-photo quota after FOR UPDATE locking',()=>{
 assert.match(r83,/FOR UPDATE OF o,r/);
 assert.match(r83,/upload_state IN \('pending','ready'\)/);
 assert.match(r83,/if\(count\.rows\[0\]\.n>=3\)fail\('PHOTO_LIMIT_REACHED'\)/);
});
test('R83 source never exposes service-role key or signed URL',()=>{
 assert.doesNotMatch(r83,/serviceRoleKey|SUPABASE_SERVICE_ROLE_KEY|signUpload|signedUrl|setTimeout/);
 assert.doesNotMatch(r83,/\bfetch\(/);
});
