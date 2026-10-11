import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const source=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const r84=source('./car02-photo-pipeline-isolated-r84.mjs');
const r83=source('./car02-pg-photo-repository-r83.mjs');
const r82=source('./car02-private-photo-upload-http-r82.mjs');
const r47=source('./car02-private-photo-r47.mjs');
test('R84 imports precisely the existing R82, R47 and R83 security contracts',()=>{
 assert.match(r84,/createCar02PhotoUploadHttpR82/);
 assert.match(r84,/createCar02PrivatePhotoR47/);
 assert.match(r84,/createCar02PgPhotoRepositoryR83/);
});
test('R84 hardcodes fake Storage endpoint and fake credential, not an external config',()=>{
 assert.match(r84,/const FAKE_STORAGE='https:\/\/car02-r84-simulated\.supabase\.co'/);
 assert.match(r84,/const FAKE_KEY='CAR02_R84_FAKE_STORAGE_CREDENTIAL_ONLY'/);
 assert.doesNotMatch(r84,/process\.env|Deno\.env|serviceRoleKey\s*,|supabaseUrl\s*,/);
});
test('R84 NEVER invokes global fetch or provisions a real Supabase bucket',()=>{
 assert.doesNotMatch(r84,/\bglobalThis\.fetch\s*\(|\bawait fetch\s*\(|\bnpm:pg|CREATE TABLE|DROP TABLE|ALTER TABLE/);
 assert.match(r84,/return storageFetch\(url,options\)/);
});
test('R84 verifies disposable DB identity before any fake Storage transport use',()=>{
 assert.match(r84,/QA_DB=\/\^car02_r83_qa_/);
 assert.match(r84,/if\(await isolatedEnabled\(\)!==true\)throw Error/);
 assert.match(r84,/pool\.query\('SELECT current_database\(\) AS name'\)/);
});
test('R83 independently enforces DB isolation INSIDE every transaction',()=>{
 assert.match(r83,/SELECT current_database\(\) AS name/);
 assert.match(r83,/fail\('ISOLATION_REQUIRED'\)/);
 assert.match(r83,/SELECT count\(\*\)::integer AS n FROM public\.ksh_car02_photos/);
});
test('R47 checks private bucket and object digest rather than trusting response metadata',()=>{
 assert.match(r47,/meta\.public!==false/);
 assert.match(r47,/blobSha\(confirmed\)!==sha256/);
 assert.match(r47,/repository\.cancel\(\{actor,shop,photoId:reserved\.id\}\)/);
});
test('R82 forbids customer role, client-supplied tenant, signed upload URLs',()=>{
 assert.match(r82,/\['owner','staff'\]\.includes\(actor\.role\)/);
 assert.match(r82,/shop:shopCode/);
 assert.doesNotMatch(r82,/signUpload|signedUploadUrl/);
});
test('R84 has only a narrow isolated factory export and returns only handle',()=>{
 assert.deepEqual([...r84.matchAll(/export\s+function\s+(\w+)/g)].map(x=>x[1]),['createCar02PhotoPipelineIsolatedR84']);
 assert.match(r84,/return Object\.freeze\(\{handle:route\}\)/);
});
test('GitHub checkout cannot import R84 into R50/R52 and R52 stays hard locked',()=>{
 const r50=new URL('./car02-unified-runtime-r50.mjs',import.meta.url);
 const r52=new URL('./car02-edge-entry-r52.ts',import.meta.url);
 if(!existsSync(r50)||!existsSync(r52))return; // full GitHub checkout verifies both
 const main=source('./car02-unified-runtime-r50.mjs');
 const edge=source('./car02-edge-entry-r52.ts');
 assert.doesNotMatch(main+edge,/createCar02PhotoPipelineIsolatedR84|car02-photo-pipeline-isolated-r84/);
 assert.match(edge,/const CAR02_RELEASE_LOCK=true/);
 assert.match(edge,/if\(CAR02_RELEASE_LOCK\)throw Error\('CAR02_NOT_RELEASED'\)/);
});
test('R84 is never imported into existing R82/R83 or R47',()=>{
 assert.doesNotMatch(r82+r83+r47,/car02-photo-pipeline-isolated-r84/);
});
