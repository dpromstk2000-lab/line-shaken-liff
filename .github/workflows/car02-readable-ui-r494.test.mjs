import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {
  CAR02_V494_BUILDER_RELEASE_LOCK,CAR02_V494_ACCEPTED_V493_SHA256,
  CAR02_V494_OUTPUT,buildCar02StandaloneHtmlR494
} from './car02-standalone-preview-builder-r494.mjs';

const source=readFileSync(new URL('./CAR02_V493_RESILIENT_STANDALONE_OFFLINE_PREVIEW.html',import.meta.url),'utf8');
const html=readFileSync(new URL('./CAR02_V494_READABLE_STANDALONE_OFFLINE_PREVIEW.html',import.meta.url),'utf8');
const digest=v=>createHash('sha256').update(v).digest('hex');
const scriptOf=v=>[...v.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const styleOf=v=>[...v.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>m[1]);
const newCss=styleOf(html)[0]?.split('/* V4.94:')[1]||'';

test('V4.94 accepted R52 release-lock handoff remains enabled',()=>{
  assert.equal(CAR02_V494_BUILDER_RELEASE_LOCK,true);
  assert.equal(CAR02_V494_OUTPUT,'CAR02_V494_READABLE_STANDALONE_OFFLINE_PREVIEW.html');
});
test('V4.93 accepted standalone HTML remains SHA256 pinned',()=>{
  assert.equal(digest(source),CAR02_V494_ACCEPTED_V493_SHA256);
});
test('new offline HTML deterministically reproduces saved artifact',()=>{
  assert.equal(buildCar02StandaloneHtmlR494(),html);
});
test('second offline build returns byte-identical HTML',()=>{
  assert.equal(buildCar02StandaloneHtmlR494(),buildCar02StandaloneHtmlR494());
});
test('accepted inline executable code is byte-for-byte unchanged',()=>{
  assert.equal(scriptOf(source).length,1);
  assert.deepEqual(scriptOf(html),scriptOf(source));
});
test('exact accepted script hash continues under strict CSP',()=>{
  const hash=createHash('sha256').update(scriptOf(source)[0]).digest('base64');
  assert.ok(html.includes(`script-src 'sha256-${hash}'`));
  assert.ok(html.includes("connect-src 'none'"));
  assert.ok(html.includes("form-action 'none'"));
});
test('single inline CSS block and visual patch are isolated',()=>{
  assert.equal(styleOf(html).length,1);
  assert.match(newCss,/readable touch targets, disabled states and narrow screens/);
  assert.doesNotMatch(newCss,/@import|url\s*\(|<script|<form|<input/);
});
test('desktop default text size is 18 pixels',()=>{
  assert.match(newCss,/:root\{font-size:18px\}/);
});
test('mobile default text size remains comfortably readable',()=>{
  assert.match(newCss,/@media\(max-width:480px\)\{[\s\S]*?:root\{font-size:17px\}/);
});
test('date and time buttons have at least 50 pixel touch height',()=>{
  assert.match(newCss,/\.calendar-day,\.time\{min-height:52px/);
  assert.match(newCss,/\.calendar-day,\.time\{min-height:50px/);
});
test('disabled dates and times are distinguished by visible text color',()=>{
  assert.match(newCss,/\.calendar-day:disabled\{color:#536477/);
  assert.match(newCss,/\.time:disabled\{color:#536477/);
});
test('disabled navigation stays readable rather than translucent',()=>{
  assert.match(newCss,/\.nav:disabled\{opacity:1/);
});
test('keyboard focus remains easy to find',()=>{
  assert.match(newCss,/button:focus-visible\{outline:4px solid #a36605;outline-offset:3px\}/);
});
test('narrow 380 pixel screens show two time columns',()=>{
  assert.match(newCss,/@media\(max-width:380px\)\{[\s\S]*?\.times\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});
test('status and safety warning use 17 pixel text',()=>{
  assert.match(newCss,/\.status,\.warn\{font-size:17px/);
});
test('isolated preview and NO_GO markers are preserved',()=>{
  assert.match(html,/<body data-car02-r493-preview data-car02-r493-standalone>/);
  assert.match(html,/REVIEW ONLY · NO_GO/);
  assert.match(html,/予約・仮確保・通知は成立しません/);
  assert.match(html,/実際の氏名・電話番号・車両情報は入力しないでください/);
});
test('new V4.94 title and footer disclose offline readability improvement',()=>{
  assert.match(html,/<title>DPRO CAR02 V4\.94 \| 読みやすさ改善/);
  assert.match(html,/DPRO CAR02 V4\.94 \| READABLE OFFLINE DEMO/);
});
test('presentation-only page cannot submit a real booking or connect',()=>{
  assert.doesNotMatch(html,/<form\b|<input\b|<script\s+[^>]*src=/i);
  assert.doesNotMatch(scriptOf(html)[0],/\b(?:fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB)\b/);
});
