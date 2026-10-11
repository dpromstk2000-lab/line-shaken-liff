// R88 irreversible safety constraints + original R87 hashes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=f=>readFileSync(new URL(f,import.meta.url),'utf8');
const html=read('CAR02_R88_STAFF_REVIEW.html');
const app=read('car02-staff-review-app-r88.mjs');
const model=read('car02-staff-review-model-r86.mjs');
const sha=x=>createHash('sha1').update('blob '+Buffer.byteLength(x)+'\0').update(x).digest('hex');
const cases=[
['R86 model untouched',()=>assert.equal(sha(model),'a79c97625579e0d892892be2f5b59067da12348f')],
['R87 original HTML not overwritten',()=>assert.equal(sha(read('CAR02_R87_STAFF_REVIEW.html')),'f98a539575522163375178ebe6c042c87cfc15c3')],
['R87 original JS not overwritten',()=>assert.equal(sha(read('car02-staff-review-app-r87.mjs')),'ba11178d8c2dc70e1cd1dac79142855a71778262')],
['R88 no HTTP calls',()=>assert.doesNotMatch(app,/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/)],
['R88 no remote runtime imports',()=>assert.match(app,/from '\.\/car02-staff-review-model-r86\.mjs'/)],
['R88 no HTML injection',()=>assert.doesNotMatch(app,/\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b/)],
['R88 no browser persistence',()=>assert.doesNotMatch(app.replace(/^\s*\/\/.*$/gm,''),/\b(?:localStorage|sessionStorage|indexedDB|document\.cookie)\b/)],
['R88 no dynamic eval',()=>assert.doesNotMatch(app,/\b(?:eval|Function)\s*\(/)],
['R88 preview capped at 10',()=>assert.match(app,/previewTrail\.length>10\)previewTrail\.shift/)],
['R88 preview never claims audit or saving',()=>assert.match(html,/実際の監査ログや権限変更履歴ではありません/)],
['R88 misleading send avoided',()=>assert.match(html,/変更内容を確認する（送信なし）/)],
['R88 no backend routes',()=>assert.doesNotMatch(app,/from '\.\/car02-(?:edge|unified|staff-access|pg-)/)],
['R88 no deploy links',()=>assert.doesNotMatch(html,/(?:fetch\s*\(|worker\.dev|supabase\.co)/)],
['R88 robots noindex',()=>assert.match(html,/name="robots" content="noindex,nofollow,noarchive"/)],
['R88 CSP script self only',()=>assert.match(html,/script-src 'self'/)],
['R88 CSP form none',()=>assert.match(html,/form-action 'none'/)],
['R88 no client-side payload manipulation',()=>assert.match(app,/buildStaffChangeReview\(/)],
['R88 demo active only',()=>assert.match(html,/本番接続なし \/ 反映なし/)],
];
for(const [name,fn] of cases)test('R88 SAFETY '+name,fn);
const edgeURL=new URL('car02-edge-entry-r52.ts',import.meta.url);
test('R88 source release lock stays hard-coded in GitHub main',
  {skip:!existsSync(edgeURL)},()=>{
    const edge=read('car02-edge-entry-r52.ts');
    assert.match(edge,/const CAR02_RELEASE_LOCK=true/);
    assert.match(edge,/if\(CAR02_RELEASE_LOCK\)throw Error\('CAR02_NOT_RELEASED'\)/);
  });
const boundaryURL=new URL('car02-unified-runtime-r50.mjs',import.meta.url);
test('R88 has no production staff handler on canonical R50',
 {skip:!existsSync(boundaryURL)},()=>{
   assert.doesNotMatch(read('car02-unified-runtime-r50.mjs'),/car02-staff-review-app-r88|CAR02_R88_STAFF_REVIEW/);
 });
