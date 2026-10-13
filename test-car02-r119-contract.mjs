import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assertDisposableEnv,classifyResults,safeEvidence} from './car02-r119-pg17-booking-qa.mjs';
const env=()=>({R119_DISPOSABLE_QA:'yes',CAR02_RELEASE_LOCK:'true',PGHOST:'127.0.0.1',PGPORT:'5432',PGDATABASE:'car02_r119_qa_ci'});
test('disposable environment and explicit release lock',()=>assert.equal(assertDisposableEnv(env()),true));
test('reject arbitrary production database',()=>assert.throws(()=>assertDisposableEnv({...env(),PGDATABASE:'production'})));
test('reject outside host',()=>assert.throws(()=>assertDisposableEnv({...env(),PGHOST:'db.supabase.co'})));
test('reject Supabase environment',()=>assert.throws(()=>assertDisposableEnv({...env(),SUPABASE_URL:'https://example.invalid'})));
test('reject disabled release lock',()=>assert.throws(()=>assertDisposableEnv({...env(),CAR02_RELEASE_LOCK:'false'})));
test('six contenders cannot all succeed',()=>assert.throws(()=>classifyResults(Array(6).fill('CREATED'))));
test('one winner five losers accepted',()=>assert.equal(classifyResults(['CREATED',...Array(5).fill('SLOT_TAKEN')]),true));
test('only redacted evidence metadata accepted',()=>{const e={releaseDecision:'NO_GO',migrationDecision:'HOLD',productionReady:false,realSupabaseTested:false,realProductionBackup:false,mode:'disposable_postgresql17_only',pg:170000,checks:1,rowCount:2,db:'car02_r119_qa_ci'}; assert.equal(safeEvidence(e),true);assert.throws(()=>safeEvidence({...e,customerName:'REAL'}));});
test('SQL cannot target non-disposable database',()=>{const s=fs.readFileSync('R119_PG17_BOOKING_RLS_QA_ONLY.sql','utf8');assert.match(s,/current_database\(\) <> 'car02_r119_qa_ci'/);assert.match(s,/R119_DISPOSABLE_PG17_ONLY/);assert.match(s,/ROW LEVEL SECURITY/);assert.match(s,/UNIQUE\(shop_code,booking_day,begins_at\)/);assert.match(s,/UNIQUE\(shop_code,request_key\)/);assert.match(s,/SECURITY INVOKER/);assert.doesNotMatch(s,/DROP\s+TABLE|ALTER\s+SYSTEM|http[s]?:\/\//i);});
test('disposable role privileges cannot mutate confirmed bookings',()=>{
 const s=fs.readFileSync('R119_PG17_BOOKING_RLS_QA_ONLY.sql','utf8');
 assert.match(s,/GRANT SELECT,INSERT ON car02_r119_qa\.bookings TO car02_r119_a_ci,car02_r119_b_ci/);
 assert.doesNotMatch(s,/GRANT [^\n]*(UPDATE|DELETE|TRUNCATE) ON car02_r119_qa\.bookings/i);
 assert.match(s,/NOINHERIT PASSWORD 'r119-disposable-tenant-only'/);
});
test('CI YAML has controlled read-only permission and cleanup',()=>{
 const s=fs.readFileSync('.github/workflows/car02-r119-pg17-booking-restore-isolated-qa.yml','utf8');
 assert.match(s,/permissions:\s*\n\s+contents: read/);
 assert.match(s,/postgres:17/);
 assert.match(s,/Always remove the disposable DBs roles and synthetic dump/);
 assert.match(s,/DROP DATABASE IF EXISTS car02_r119_restore_ci WITH \(FORCE\)/);
 assert.match(s,/DROP DATABASE IF EXISTS car02_r119_qa_ci WITH \(FORCE\)/);
 assert.match(s,/if: always\(\)/);
 assert.doesNotMatch(s,/wrangler\s+deploy|supabase\s+db\s+push|migrations\s+apply|workflow_run:/i);
});
test('R119 source refuses direct production settings and offline evidence does not authorize GO',()=>{
 const s=fs.readFileSync('car02-r119-pg17-booking-qa.mjs','utf8');
 assert.match(s,/PGHOST,'127\.0\.0\.1'/);
 assert.match(s,/SUPABASE_SERVICE_ROLE_KEY/);
 assert.match(s,/releaseDecision:'NO_GO'/);
 assert.match(s,/realProductionBackup:false/);
});
