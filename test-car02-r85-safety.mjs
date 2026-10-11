import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
// This test runs on GitHub main with all canonical existing sources.
// Fail if a production/review boundary has drifted. Do not substitute mock sources.
const dir=new URL('.',import.meta.url);
const read=path=>readFileSync(new URL(path,dir),'utf8');
const sha=content=>createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex');
const r85=read('car02-staff-access-http-r85.mjs');
const r70=read('car02-staff-permissions-r70.mjs');
const r50=read('car02-unified-runtime-r50.mjs');
const r52=read('car02-edge-entry-r52.ts');
const r51=read('car02-edge-boundary-r51.mjs');
const r81=read('car02-initial-owner-r81.mjs');
const r84=read('car02-photo-pipeline-isolated-r84.mjs');
const r80=JSON.parse(read('R79_EVIDENCE_SNAPSHOT.json'));

test('R85 never imported by live/review HTTP entrypoints, photo pipeline, or owner bootstrap',()=>{
 for(const [name,contents] of Object.entries({r50,r52,r51,r81,r84})){
   assert.doesNotMatch(contents,/(?:car02-staff-access-http-r85|createCar02StaffAccessHttpR85)/,
     `${name} unexpectedly imports isolated R85`);
 }
});
test('R52 is still hard-locked before PostgreSQL initialization',()=>{
 assert.match(r52,/const\s+CAR02_RELEASE_LOCK\s*=\s*true/);
 assert.match(r52,/if\s*\(CAR02_RELEASE_LOCK\)throw Error\('CAR02_NOT_RELEASED'\)/);
 assert.match(r52,/isServerReleased:\(\)=>!CAR02_RELEASE_LOCK/);
});
test('R51 does not expose R85 staff route',()=>{
 assert.doesNotMatch(r51,/\/staff\/|staff-access|r85/i);
 assert.match(r51,/if\(!released\)return json\(503,'CAR02_NOT_RELEASED'\)/);
});
test('R50 does not expose R85 permissions and retains server-verified authenticator',()=>{
 assert.doesNotMatch(r50,/(?:car02-staff-access-http-r85|createCar02StaffAccessHttpR85)/);
 assert.match(r50,/createCar02Authenticator/);
 assert.match(r50,/createCar02ReleaseGate/);
});
test('R70 canonical module was not modified by R85',()=>{
 assert.equal(sha(r70),'f551977e831269bc3e31900b4cb71d0f8d1fa3fc');
 assert.match(r70,/FOR UPDATE/);
 assert.match(r70,/ksh_car02_staff_access_audit/);
 assert.match(r70,/CAR02_OWNER_LAST_ACTIVE_REQUIRED/);
});
test('R50 and R52 known source baseline has not silently drifted',()=>{
 assert.equal(sha(r50),'76e4e8cae27599f27e3d887118148718c32ebb80');
 assert.equal(sha(r52),'f0e31fb9f9d98524519d01dffd3489893d3d3302');
});
test('R81 initial owner registration remains isolated',()=>{
 assert.match(r81,/const QA_DATABASE\s*=\s*\/\^car02_r81_qa_/);
 assert.doesNotMatch(r81,/from ['"].*staff-access-http-r85/);
});
test('R84 private photo pipeline remains isolated and not linked to staff privilege API',()=>{
 assert.doesNotMatch(r84,/car02-staff-access-http-r85|createCar02StaffAccessHttpR85/);
});
test('R79 snapshot is not release authorization',()=>{
 assert.equal(r80.release_decision,'NO_GO');
 assert.equal(r80.migration_decision,'HOLD_BACKUP_AND_RESTORE');
 assert.equal(r80.live_backup_completed,false);
 assert.equal(r80.separate_production_restore_verified,false);
 assert.equal(r80.car02_tables,0);
 assert.equal(r80.edge_stage.CAR02_RELEASE_LOCK,true);
});
test('R85 requires server-configured security boundary and protects all errors',()=>{
 assert.match(r85,/typeof authenticate!=='function'/);
 assert.match(r85,/typeof changeExistingStaffPermission!=='function'/);
 assert.match(r85,/typeof releaseEnabled!=='function'/);
 assert.match(r85,/Object\.hasOwn\(STATUS_CODES,key\)/);
 assert.match(r85,/const MAX_BODY=2048/);
 assert.match(r85,/const PATH=\/\^\\\/api\\\/car02\\\/staff/);
});
test('R85 contains no privileged keys, deployment code, SQL statements or external network calls',()=>{
 assert.doesNotMatch(r85,/(?:service_role|DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY|Deno\.env|process\.env|fetch\(|CREATE TABLE|ALTER TABLE|DROP TABLE|migrationVerified\s*=\s*true)/i);
});
