// This QA is intended for GitHub repository root where the reviewed R47/R50/R52
// originals are available. It never contacts a database, Auth, Storage, or LINE.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=(name)=>readFileSync(new URL('./'+name,import.meta.url),'utf8');
const entry=source('car02-edge-entry-r52.ts');
const boundary=source('car02-edge-boundary-r51.mjs');
const runtime=source('car02-unified-runtime-r50.mjs');
const uploader=source('car02-private-photo-r47.mjs');
const r81=source('car02-initial-owner-r81.mjs');
const r82=source('car02-private-photo-upload-http-r82.mjs');

test('R82 remains disconnected from R50/R52 production entrypoints',()=>{
 for(const s of [entry,runtime,boundary])assert.ok(!/car02-private-photo-upload-http-r82|createCar02PhotoUploadHttpR82/.test(s));
});
test('R82 cannot activate locked Edge despite new adapter',()=>{
 assert.match(entry,/const\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/);
 assert.match(entry,/if\(CAR02_RELEASE_LOCK\)throw Error\('CAR02_NOT_RELEASED'\)/);
 assert.match(entry,/isServerReleased:\(\)=>!CAR02_RELEASE_LOCK/);
 assert.match(boundary,/if\(!released\)return json\(503,'CAR02_NOT_RELEASED'\)/);
});
test('R82 does not reference browser secrets, remote credentials, or SQL',()=>{
 assert.ok(!/SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|postgresql:\/\/|signedUrl|\.query\(|new\s+Pool\(/i.test(r82));
});
test('R47 retained private storage, scoped repository and release controls',()=>{
 assert.match(uploader,/const BUCKET = 'ksh-car02-private-photos'/);
 assert.match(uploader,/meta\?\.id!==BUCKET\|\|meta\.public!==false/);
 assert.match(uploader,/if\(!released\) fail\('NOT_RELEASED'\)/);
 assert.match(uploader,/repository\.reserve\(/);
 assert.match(uploader,/repository\.markReady\(/);
 assert.match(uploader,/repository\.cancel\(/);
 assert.match(uploader,/blobSha\(confirmed\)!==sha256/);
 assert.match(uploader,/MAX_BYTES = 5 \* 1024 \* 1024/);
});
test('R81 isolated initial owner still cannot be reached via new photo adapter',()=>{
 assert.ok(!/car02-initial-owner-r81|createCar02InitialOwnerIsolatedR81/.test(r82+runtime+entry));
 assert.match(r81,/QA_DATABASE\s*=\s*\/\^car02_r81_qa_/);
});
test('No release approval can be inferred from new R82 audit',()=>{
 assert.ok(!/productionReady\s*:\s*true|goLiveApproved\s*:\s*true|migrationVerified\s*:\s*true/.test(r82));
});
