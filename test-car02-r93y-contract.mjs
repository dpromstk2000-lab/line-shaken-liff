import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {R93Y_CONTRACT} from './car02-r93y-qa-storage-http-fixture.mjs';
const code=readFileSync(new URL('./car02-r93y-qa-storage-http-fixture.mjs',import.meta.url),'utf8');
const old=readFileSync(new URL('./car02-r93x-verified-storage-lifecycle-isolated.mjs',import.meta.url),'utf8');
test('R93Y transport is in-process simulated, uses reserved invalid hostname',()=>{
 assert.match(code,/const ORIGIN='https:\/\/car02-storage-fixture\.invalid'/);
 assert.doesNotMatch(code,/\.supabase\.co|workers\.dev|serviceRoleKey|SUPABASE_\w+|process\.env/);
 assert.ok(code.includes("[BRAND]:true"));
});
test('R93Y cannot use ambient/global network fetch',()=>{
 assert.doesNotMatch(code,/\b(?:await|return)\s+fetch\s*\(/m);
 assert.ok(code.includes('fixture.fetch('));
 assert.doesNotMatch(code,/\b(?:https?|net|tls|child_process|worker_threads)\b.*from\s*['"]node:/);
});
test('R93Y fake transport uses never-upsert and only in-process authenticated GET',()=>{
 assert.ok(code.includes("'x-upsert':'false'"));
 assert.ok(code.includes('/object/authenticated/'));
 assert.ok(code.includes('response.status===404'));
 assert.ok(code.includes("response.status!==200"));
 assert.doesNotMatch(code,/method\s*:\s*['"]DELETE['"]/);
});
test('R93Y refuses transport redirects and applies response size bound',()=>{
 assert.ok(code.includes("redirect:'error'"));
 assert.ok(code.includes('if(size>MAX)'));
 assert.ok(code.includes('response.headers.get(\'content-type\')!==mime'));
});
test('R93Y can only be wired into old isolated-memory R93X, not production',()=>{
 assert.ok(old.includes("storage?.kind!=='isolated_memory'"));
 assert.ok(old.includes('storage.testOnly!==true'));
 assert.equal(R93Y_CONTRACT.liveSupabaseConnected,false);
 assert.equal(R93Y_CONTRACT.onlyInvalidOrigin,true);
 assert.equal(R93Y_CONTRACT.directDeleteAllowed,false);
});
test('R93X accepted source still requires separate DB prove and readback',()=>{
 assert.ok(old.includes('readyPort.proveReady(env,photoId)'));
 assert.ok(old.includes('SHA(meta.bytes)===env.sha256'));
 assert.ok(old.includes('readyPort.enqueueUncertain(env,photoId)'));
});
