import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {R93W_CONTRACT} from './car02-r93w-durable-http-reservation-isolated.mjs';
const approved={
 'car02-private-photo-r47.mjs':'e0f3abec6bcf57830d9f3b72fe2eee099b1dff1d',
 'car02-unified-runtime-r50.mjs':'76e4e8cae27599f27e3d887118148718c32ebb80',
 'car02-edge-boundary-r51.mjs':'6614f2ed1933aa787576cb8074cb7d4bc704efa0',
 'car02-edge-entry-r52.ts':'f0e31fb9f9d98524519d01dffd3489893d3d3302',
 'car02-private-photo-upload-http-r82.mjs':'78f8b0f80fcc1f89d15fd25e4593c660cd197ea3',
 'car02-r93u-staging-upload-route-isolated.mjs':'e2ede7669936280256b96504837d421ec6cd5d60',
 'car02-r93v-idempotency-http-bridge-isolated.mjs':'c70e2be2d7d7d10261367b4b2e0baa3246dad53b',
 'car02-r93s-durable-upload-intent-isolated.mjs':'64e907008448264512594573cdcdcd8773c4c29d'
};
const gitSha=b=>createHash('sha1').update(Buffer.from(`blob ${b.length}\0`)).update(b).digest('hex');
test('all eight approved sources and the hard release lock remain unchanged',()=>{
 for(const [file,expected] of Object.entries(approved)){
  const b=readFileSync(file);assert.equal(gitSha(b),expected,'GitHub original drift '+file);
 }
 assert.ok(readFileSync('car02-edge-entry-r52.ts','utf8').includes('const CAR02_RELEASE_LOCK=true'));
});
test('R93W cannot bypass R82/R93V authentication or R93S transactional intent',()=>{
 const code=readFileSync('car02-r93w-durable-http-reservation-isolated.mjs','utf8');
 assert.ok(code.includes('intents.reserve(envelope)'));
 assert.ok(code.includes('R93W_STORAGE_AND_READY_PROOF_NOT_CONNECTED'));
 assert.doesNotMatch(code,/\bfetch\s*\(|\bdeleteObject\s*\(|\bmarkReady\s*\(|\bnew\s+Map\s*\(/);
 assert.equal(R93W_CONTRACT.productionReady,false);
});
test('DB fixtures remain disposable, and real PostgreSQL driver test has hardcoded isolated limits',()=>{
 const fixture=readFileSync('R93R_PG17_DRIVER_FIXTURE_QA_ONLY.sql','utf8');
 const intents=readFileSync('R93S_PG17_DURABLE_INTENT_FIXTURE_QA_ONLY.sql','utf8');
 const real=readFileSync('test-car02-r93w-real-pg17-http.mjs','utf8');
 for(const text of [fixture,intents,real])assert.ok(text.includes('car02_r93q_qa_ci'));
 assert.ok(real.includes("R93W_DISPOSABLE_DRIVER_QA_ONLY"));
 assert.ok(real.includes("PGHOST!=='127.0.0.1'"));
 assert.ok(intents.includes('r93s_intent_immutable'));
});
console.log('R93W_APPROVED_SOURCE_GUARD_PASS');
