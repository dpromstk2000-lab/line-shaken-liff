import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const bridge=readFileSync(new URL('./car02-r93i-r47-safe-bridge-isolated.mjs',import.meta.url),'utf8');
const h=readFileSync(new URL('./car02-r93h-upload-compensation-isolated.mjs',import.meta.url),'utf8');
for(const key of ['createR93HIsolatedUploadCompensation','R93I_ISOLATION_REQUIRED','R93I_NOT_RELEASED',
  'releaseEnabled','tombstoneAndEnqueue','sha256','actor,shop,orderId,reportId,mimeType,bytes',
  'R93I_CONTRACT','productionReady:false','releaseDecision:\'NO_GO\'','migrationDecision:\'HOLD\''])
 test('R93I R47 compatibility contract '+key,()=>assert.ok(bridge.includes(key)));
for(const key of ['tombstoneAndEnqueue','UPLOAD_UNCERTAIN','postObject','inspectObject','neverImmediateDelete:true'])
 test('R93H uncertainty cleanup contract '+key,()=>assert.ok(h.includes(key)));
test('R93I remains offline: no fetch, Supabase keys, or direct Storage DELETE',()=>{
 assert.doesNotMatch(bridge,/(?:\bfetch\s*\(|XMLHttpRequest|process\.env|serviceRoleKey|wrangler|db\s*push)/);
 assert.doesNotMatch(bridge,/\b(?:deleteObject|\.remove|\.delete)\s*\(/);
});
test('R93I wrapper imports only R93H safety contract',()=>{
 assert.match(bridge,/from '\.\/car02-r93h-upload-compensation-isolated\.mjs'/);
 assert.doesNotMatch(bridge,/from '\.\/car02-private-photo-r47\.mjs'/);
});
test('R93I does not accept caller-supplied photo ID or storage path in upload signature',()=>{
 assert.match(bridge,/async upload\(\{actor,shop,orderId,reportId,mimeType,bytes\}/);
 assert.doesNotMatch(bridge,/upload\(\{actor,shop,.*\b(?:photoId|storagePath|bucket)\b/);
});
