import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {R93V_CONTRACT} from './car02-r93v-idempotency-http-bridge-isolated.mjs';
const baseline={
 'car02-private-photo-upload-http-r82.mjs':'78f8b0f80fcc1f89d15fd25e4593c660cd197ea3',
 'car02-r93u-staging-upload-route-isolated.mjs':'e2ede7669936280256b96504837d421ec6cd5d60',
 'car02-r93s-durable-upload-intent-isolated.mjs':'64e907008448264512594573cdcdcd8773c4c29d'
};
const shaGit=bytes=>createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
test('R82 R93U and R93S original source Git blob hashes unchanged',()=>{
 for(const [name,digest] of Object.entries(baseline)){
  const bytes=readFileSync(name);assert.equal(shaGit(bytes),digest,name);
 }
});
test('R93V never imports R47 or R50/R51/R52 and cannot activate release',()=>{
 const src=readFileSync('car02-r93v-idempotency-http-bridge-isolated.mjs','utf8');
 assert.match(src,/createCar02PhotoUploadHttpR82/);
 assert.doesNotMatch(src,/(?:import\s*\(|from\s*['"])(?:[^'"\n]*r47|[^'"\n]*r50|[^'"\n]*r51|[^'"\n]*r52)/i);
 assert.doesNotMatch(src,/\b(?:fetch\s*\(|deleteObject\s*\(|supabase\s+db\s+push|wrangler\s+deploy)\b/i);
 assert.equal(R93V_CONTRACT.notProductionComposition,true);
});
test('R93S cannot run outside exact disposable DB',()=>{
 const src=readFileSync('car02-r93s-durable-upload-intent-isolated.mjs','utf8');
 assert.match(src,/const QA_DB='car02_r93q_qa_ci'/);
 assert.match(src,/environment!=='isolated_qa'/);
 assert.match(src,/to_regclass\('public\.ksh_car02_photos'\) IS NULL/);
});
test('R82 source still forbids unverified actor, does not directly accept intent key',()=>{
 const src=readFileSync('car02-private-photo-upload-http-r82.mjs','utf8');
 assert.match(src,/actor\?\.verified!==true/);
 assert.match(src,/const MAX_BYTES=5\*1024\*1024/);
 assert.doesNotMatch(src,/\bidempotency-key\b/i);
});
test('R93U route cap unchanged while R93V adds preflight header',()=>{
 const route=readFileSync('car02-r93u-staging-upload-route-isolated.mjs','utf8');
 const bridge=readFileSync('car02-r93v-idempotency-http-bridge-isolated.mjs','utf8');
 assert.match(route,/const UPLOAD_MAX=5\*1024\*1024/);
 assert.match(route,/const BUSINESS_MAX=32768/);
 assert.match(bridge,/Access-Control-Allow-Headers.*Authorization, Content-Type, Idempotency-Key/);
});
console.log('R93V_SOURCE_INTEGRITY_NO_PRODUCTION_WIRING_PASS');
