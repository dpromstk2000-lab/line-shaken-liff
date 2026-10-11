// Offline/source-level fail-closed checks. Does NOT execute live services.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const dir=new URL('.',import.meta.url);
const read=n=>readFileSync(new URL(n,dir),'utf8');
const html=read('CAR02_R86_STAFF_REVIEW.html');
const app=read('car02-staff-review-app-r86.mjs');
const model=read('car02-staff-review-model-r86.mjs');
const hasR52=existsSync(new URL('car02-edge-entry-r52.ts',dir));
const r52=hasR52?read('car02-edge-entry-r52.ts'):'';
const hasR50=existsSync(new URL('car02-unified-runtime-r50.mjs',dir));
const r50=hasR50?read('car02-unified-runtime-r50.mjs'):'';
const r85=read('car02-staff-access-http-r85.mjs');
const r80=JSON.parse(read('R79_EVIDENCE_SNAPSHOT.json'));
test('R86 CSP prevents outbound connections and HTML form actions',()=>{
 assert.match(html,/Content-Security-Policy/);assert.match(html,/connect-src &#39;none&#39;|connect-src 'none'/);
 assert.match(html,/form-action 'none'/);
});
test('R86 HTML actively prohibits search indexing',()=>assert.match(html,/noindex,nofollow,noarchive/));
test('R86 demo messaging clearly states no production effect',()=>{
 for(const s of ['DEMO','更新不可','本番接続なし','送信なし','実際の更新は行いません'])assert.ok(html.includes(s),s);
});
test('R86 frontend contains no outbound request API calls',()=>{
 for(const s of [html,app,model])assert.doesNotMatch(s,/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(|\bnavigator\.sendBeacon\b/);
});
test('R86 frontend contains no persistent storage writes',()=>{
 for(const s of [app,model])assert.doesNotMatch(s,/\b(?:localStorage|sessionStorage|indexedDB|document\.cookie|postMessage)\b/);
});
test('R86 frontend binds user-originated data with textContent',()=>{
 assert.match(app,/\.textContent/);assert.doesNotMatch(app,/innerHTML\s*=|insertAdjacentHTML|eval\(|new Function\(/);
});
test('R86 only exports preview model, no server signing/storage client',()=>{
 assert.match(model,/previewOnly:true,networkRequests:0,mutations:0/);
 assert.doesNotMatch(model,/SERVICE_ROLE|Authorization|databaseURL|postgresql:\/\//i);
});
test('R86 no client-side auth or live API secrets',()=>{
 for(const s of [html,app,model])assert.doesNotMatch(s,/eyJ[a-zA-Z0-9_-]{40,}|sk_[A-Za-z0-9]{15,}|supabaseKey|serviceRoleKey|client_secret/i);
});
test('R52 production release lock unchanged',{skip:!hasR52},()=>{
 assert.match(r52,/const CAR02_RELEASE_LOCK=true/);
 assert.match(r52,/if\(CAR02_RELEASE_LOCK\)throw Error\('CAR02_NOT_RELEASED'\)/);
});
test('R50 stays separate from R86, R85, and R82',{skip:!hasR50},()=>{
 assert.doesNotMatch(r50,/car02-staff-review-|car02-staff-access-http-r85|car02-private-photo-upload-http-r82/);
});
test('R85 remains server-side and does not trust client role',()=>{
 assert.match(r85,/ownerActor\(actor,shopCode\)/);
 assert.match(r85,/changeExistingStaffPermission\(/);
});
test('R79 records release NO_GO and migration HOLD',()=>{
 assert.equal(r80.release_decision,'NO_GO');assert.equal(r80.migration_decision,'HOLD_BACKUP_AND_RESTORE');
 assert.equal(r80.edge_stage.CAR02_RELEASE_LOCK,true);
});
test('R86 UI dependency list has only local ESM scripts',()=>{
 assert.match(html,/src="\.\/car02-staff-review-app-r86\.mjs"/);
 assert.doesNotMatch(html,/src="https?:|href="https?:|@import\s+url/);
});

const blobSha1=(s)=>{const bytes=Buffer.from(s,'utf8');return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')};
test('R86 existing R85 audited source has exact GitHub blob SHA',()=>assert.equal(blobSha1(r85),'1bd21520f3d17039af0415e34a7da13a92b3dcfd'));
test('R86 existing R52 locked entrypoint has exact GitHub blob SHA',{skip:!hasR52},()=>assert.equal(blobSha1(r52),'f0e31fb9f9d98524519d01dffd3489893d3d3302'));
test('R86 existing R50 runtime has exact GitHub blob SHA',{skip:!hasR50},()=>assert.equal(blobSha1(r50),'76e4e8cae27599f27e3d887118148718c32ebb80'));
