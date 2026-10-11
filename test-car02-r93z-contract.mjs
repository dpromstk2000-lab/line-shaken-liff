// Local static preflight. No database connection, HTTP request or credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {R93Y_CONTRACT} from './car02-r93y-qa-storage-http-fixture.mjs';
import {R93X_CONTRACT} from './car02-r93x-verified-storage-lifecycle-isolated.mjs';
import {R93S_CONTRACT} from './car02-r93s-durable-upload-intent-isolated.mjs';
const src=readFileSync(new URL('./test-car02-r93z-http-fixture-real-pg17.mjs',import.meta.url),'utf8');
const gate='const CAR02_RELEASE_LOCK=true';
test('R93Z source requires fixed disposable PG17 and local hostname',()=>{
 for(const required of ["process.env.R93Z_DISPOSABLE_PG17_QA!=='yes'","process.env.PGHOST!=='127.0.0.1'",
  "process.env.PGDATABASE!==DB","process.env.PGPASSWORD!=='disposable-r93s-ci-only'",
  "database:DB", "releaseEnabled:gate"]){assert.ok(src.includes(required),required)}
});
test('R93Z QA route never imports or uses live Supabase / Cloudflare transport',()=>{
 assert.doesNotMatch(src,/(?:https?:\/\/(?!r93z-fixture-client\.invalid)|\.supabase\.co|workers\.dev)/i);
 assert.doesNotMatch(src,/(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_URL|wrangler\s+deploy|fetch\(['"]https?:\/\/)/i);
});
test('R93Z requires real DB driver and HTTP fixture in same test chain',()=>{
 for(const s of ['await import(\'pg\')','createR93YInProcessStorageFixture(config)',
  'createR93YIsolatedStorageProtocol','createR93SDurableUploadIntentQA',
  'createR93XIsolatedPgReadyPort','createR93XIsolatedVerifiedStorageLifecycle',
  'createCar02R93VIsolatedIdempotencyBridge'])assert.ok(src.includes(s),s);
});
test('R93Z keeps all production readiness flags false',()=>{
 for(const c of [R93Y_CONTRACT,R93X_CONTRACT,R93S_CONTRACT]){
  assert.equal(c.productionReady,false);assert.equal(c.releaseDecision,'NO_GO');assert.equal(c.migrationDecision,'HOLD');
 }
});
test('R93Z does not interpret simulated HTTP 404 as real Storage absence proof',()=>{
 assert.equal(R93Y_CONTRACT.storageImplementationStillSimulation,true);
 assert.equal(R93Y_CONTRACT.liveSupabaseConnected,false);
 assert.ok(src.includes('R93Z_REAL_PG17_HTTP_STORAGE_PROTOCOL_E2E_PASS'));
});
test('R93Z release lock invariant from approved source if present',()=>{
 const srcPath=new URL('./car02-edge-entry-r52.ts',import.meta.url);
 try{assert.ok(readFileSync(srcPath,'utf8').includes(gate));}catch(e){if(e?.code!=='ENOENT')throw e;}
});
