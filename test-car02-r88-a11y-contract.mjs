// R88 isolated accessibility regression; Node built-in test runner, no external dependencies.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=x=>readFileSync(new URL(x,import.meta.url),'utf8');
const html=read('CAR02_R88_STAFF_REVIEW.html');
const app=read('car02-staff-review-app-r88.mjs');
const tests=[
['Japanese document language',()=>assert.match(html,/<html lang="ja">/)],
['mobile viewport',()=>assert.match(html,/name="viewport" content="width=device-width, initial-scale=1"/)],
['separate R88 file / version',()=>assert.match(html,/CAR02 R88/)],
['skip navigation visible on focus',()=>{assert.match(html,/<a class="skip-link" href="#mainContent">/);assert.match(html,/\.skip-link:focus\{top:12px\}/)}],
['main content landmark target',()=>assert.match(html,/<main class="canvas" id="mainContent" tabindex="-1">/)],
['search retains explicit aria label',()=>assert.match(html,/id="staffSearch"[^>]*aria-label="名前や担当で検索"/)],
['filter controls grouped semantically',()=>assert.match(html,/role="group" aria-label="スタッフの絞り込み"/)],
['filter buttons initial selection exposed',()=>{assert.match(html,/aria-pressed="true" class="selected" data-filter="all"/);assert.equal([...html.matchAll(/aria-pressed="false" data-filter=/g)].length,3)}],
['filter aria-pressed follows state',()=>assert.match(app,/x\.setAttribute\('aria-pressed',String\(on\)\)/)],
['result count announced',()=>assert.match(html,/id="staffCount" role="status" aria-live="polite" aria-atomic="true"/)],
['change editor can take keyboard focus',()=>assert.match(html,/id="editorPanel" tabindex="-1"/)],
['mobile selection focus is visible',()=>assert.match(app,/if\(innerWidth<1190\)focusEditor\(\)/)],
['respect reduced motion preference',()=>{assert.match(app,/prefers-reduced-motion: reduce/);assert.match(html,/prefers-reduced-motion:reduce/)}],
['selection buttons include member name',()=>assert.match(app,/button\.setAttribute\('aria-label',m\.self\?/)],
['selection button pressed state exposed',()=>assert.match(app,/button\.setAttribute\('aria-pressed',String\(selected\?\.id===m\.id\)\)/)],
['reason fields have descriptive controls',()=>assert.match(html,/aria-describedby="reasonHint feedback" aria-invalid="false"/)],
['server-level reason guard reused',()=>assert.match(app,/buildStaffChangeReview\(/)],
['invalid reason gets focus',()=>assert.match(app,/if\(invalid\)\$\('reasonInput'\)\.focus\(\)/)],
['invalid reason aria announcement',()=>assert.match(app,/\$\('reasonInput'\)\.setAttribute\('aria-invalid',invalid\?'true':'false'\)/)],
['reason invalid visual state',()=>assert.match(html,/textarea\[aria-invalid="true"\]/)],
['no history delete until history exists',()=>{assert.match(html,/id="clearPreviewHistory" type="button" disabled/);assert.match(app,/disabled=previewTrail\.length===0/)}],
['history can still be cleared',()=>assert.match(app,/previewTrail\.length=0;renderPreviewTrail\(\)/)],
['keyboard shortcut only outside editors',()=>assert.match(app,/\['INPUT','TEXTAREA','SELECT'\]\.includes\(tag\)/)],
['keyboard shortcut blocked when modal open',()=>assert.match(app,/\$\('reviewDialog'\)\.open\)return/)],
['keyboard shortcut sends no requests',()=>assert.match(app,/event\.preventDefault\(\);changePage\('staff'\);\$\('staffSearch'\)\.focus\(\)/)],
['page change has live announcement',()=>{assert.match(html,/id="pageAnnouncement"[^>]*aria-live="polite"/);assert.match(app,/pageAnnouncement'\)\.textContent/)}],
['touch targets 44px on mobile',()=>assert.match(html,/\.smallbtn\{min-width:88px;min-height:44px/)],
['all mobile menu choices visible',()=>assert.match(html,/\.nav\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)],
['R87 responsive card view retained',()=>assert.match(html,/\.staff-table tbody tr\{display:grid;grid-template-columns:minmax\(0,1fr\) auto/)],
['readability improved',()=>assert.match(html,/\.field \.hint,\.panel-foot,\.selection p,\.selection small,\.preview-note,\.footer-note,\.stat \.foot\{font-size:12px\}/)],
['no duplicate HTML identifiers',()=>{const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);assert.equal(ids.length,new Set(ids).size)}],
['exactly one local script reference',()=>assert.deepEqual([...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map(x=>x[1]),['./car02-staff-review-app-r88.mjs'])],
['no third-party resources in markup',()=>assert.doesNotMatch(html,/(?:src|href)="(?:https?:)?\/\//i)],
['CSP still explicitly denies network',()=>assert.match(html,/connect-src 'none'/)],
['R88 can be navigated without other HTML pages',()=>assert.deepEqual([...html.matchAll(/data-page="([a-z]+)"/g)].map(x=>x[1]),['dashboard','staff','history','help'])],
];
for(const [name,fn] of tests)test('R88 A11Y '+name,fn);
