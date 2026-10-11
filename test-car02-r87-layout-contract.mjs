// CAR02 R87 isolated UI source and security contract, Node built-in test runner only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=f=>readFileSync(new URL(f,import.meta.url),'utf8');
const html=read('CAR02_R87_STAFF_REVIEW.html');
const app=read('car02-staff-review-app-r87.mjs');
const model=read('car02-staff-review-model-r86.mjs');
const blobsha=x=>{const bytes=Buffer.from(x);return createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')};
const cases=[
 ['R87 HTML Japanese language',()=>assert.match(html,/<html lang="ja">/)],
 ['R87 viewport declared',()=>assert.match(html,/name="viewport" content="width=device-width, initial-scale=1"/)],
 ['R87 noindex remains',()=>assert.match(html,/name="robots" content="noindex,nofollow,noarchive"/)],
 ['R87 CSP default deny',()=>assert.match(html,/default-src 'none'/)],
 ['R87 CSP network deny',()=>assert.match(html,/connect-src 'none'/)],
 ['R87 CSP forms deny',()=>assert.match(html,/form-action 'none'/)],
 ['R87 CSP external object deny',()=>assert.match(html,/object-src 'none'/)],
 ['R87 only one script reference',()=>assert.deepEqual([...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map(x=>x[1]),['./car02-staff-review-app-r87.mjs'])],
 ['R87 no external remote resource',()=>assert.doesNotMatch(html,/(?:src|href)="(?:https?:)?\/\//i)],
 ['R87 declared mobile grid minmax prevents intrinsic bleed',()=>assert.match(html,/\.app\{grid-template-columns:minmax\(0,1fr\)/)],
 ['R87 mobile table gets card layout',()=>assert.match(html,/\.staff-table tbody tr\{display:grid;grid-template-columns:minmax\(0,1fr\) auto/)],
 ['R87 mobile card contains four cells',()=>assert.match(html,/grid-template-areas:"person state" "role action"/)],
 ['R87 table action stays visible without side scrolling',()=>assert.match(html,/\.staff-scroll\{overflow-x:visible\}/)],
 ['R87 tablet and small mobile CSS',()=>{assert.match(html,/@media\(max-width:790px\)/);assert.match(html,/@media\(max-width:360px\)/)}],
 ['R87 mobile menu has all four buttons visible in two rows',()=>assert.match(html,/\.nav\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)],
 ['R87 owner action disabled',()=>assert.match(app,/button\.disabled=m\.self/)],
 ['R87 confirmation only prevented default submit',()=>assert.match(app,/function openPreview\(event\)\{event\.preventDefault\(\)/)],
 ['R87 updates only textContent',()=>{assert.match(app,/\.textContent=/);assert.doesNotMatch(app,/innerHTML\s*=|outerHTML\s*=/)}],
 ['R87 modal payload from strict R86 model',()=>assert.match(app,/buildStaffChangeReview\(/)],
 ['R87 explicit no real side effects',()=>assert.match(html,/APIへの送信、保存、実際の権限変更はしていません/)],
 ['R87 preview history is distinct from audit',()=>assert.match(html,/実際の監査ログや権限変更履歴ではありません/)],
 ['R87 memory only trail',()=>assert.match(app,/const previewTrail=\[\]/)],
 ['R87 memory trail max 10',()=>assert.match(app,/if\(previewTrail\.length>10\)previewTrail\.shift\(\)/)],
 ['R87 trail can be cleared',()=>assert.match(app,/previewTrail\.length=0;renderPreviewTrail\(\)/)],
 ['R87 preview contains reason',()=>assert.match(app,/reasonPreview/)],
 ['R87 history uses safe DOM text builder',()=>assert.match(app,/e\.append\(item\('p','',`変更理由/)],
 ['R87 no direct browser network methods',()=>assert.doesNotMatch(app,/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/)],
 ['R87 no browser storage writes',()=>assert.doesNotMatch(app.replace(/^\s*\/\/.*$/gm,''),/\b(?:localStorage|sessionStorage|indexedDB|document\.cookie)\b/)],
 ['R87 no dynamic script evaluation',()=>assert.doesNotMatch(app,/\b(?:eval|new Function)\s*\(/)],
 ['R86 model stable, not modified',()=>assert.equal(blobsha(model),'a79c97625579e0d892892be2f5b59067da12348f')],
 ['R87 UI script does not import R85 runtime',()=>assert.doesNotMatch(app,/car02-staff-access-http-r85|car02-unified-runtime-r50|car02-edge-entry-r52/)],
 ['R87 HTML file has unique ids',()=>{const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);assert.equal(new Set(ids).size,ids.length)}],
 ['R87 guard code requires R86 review model import',()=>assert.match(app,/from '\.\/car02-staff-review-model-r86\.mjs'/)],
 ['R87 screenshots not embedded in GitHub production artifact',()=>assert.doesNotMatch(html,/R87_VISUAL_|R87_MAIN_|R87_STAFF_MAIN_/)]
];
for(const [name,fn] of cases)test(name,fn);
