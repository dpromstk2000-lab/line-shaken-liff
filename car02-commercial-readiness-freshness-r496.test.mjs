import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {
  CAR02_V496_RELEASE_LOCK,CAR02_V496_ACCEPTED_V495_RUN,CAR02_V496_ACCEPTED_V495_TESTS,
  CAR02_V496_ACCEPTED_V495_SHA256,CAR02_V496_OUTPUT,buildCar02ReadinessFreshBoardR496
} from './car02-commercial-readiness-freshness-r496.mjs';
import {CAR02_V484_REQUIRED_PROOFS,evaluateCar02EvidenceIntakeR484} from './car02-evidence-provenance-gate-r484.mjs';

const read=x=>readFileSync(new URL(x,import.meta.url));
const sha=x=>createHash('sha256').update(x).digest('hex');
const html=buildCar02ReadinessFreshBoardR496();
const evidence={systemCode:'CAR02',branch:'car02-v434-review-only',baselineV483Run:39727016029,
  releaseLock:true,commercialDecision:'NO_GO_HOLD',proofs:[]};

test('R52 hard release lock stays true',()=>assert.equal(CAR02_V496_RELEASE_LOCK,true));
test('accepted V4.95 GitHub run identity is exact',()=>assert.equal(CAR02_V496_ACCEPTED_V495_RUN,39888313357));
test('accepted V4.95 CI total is exact',()=>assert.equal(CAR02_V496_ACCEPTED_V495_TESTS,1549));
test('accepted V4.95 report SHA256 has not changed',()=>assert.equal(sha(read('CAR02_V495_COMMERCIAL_READINESS_OFFLINE_BOARD.html')),CAR02_V496_ACCEPTED_V495_SHA256));
test('generator takes no caller-controlled arguments',()=>assert.equal(buildCar02ReadinessFreshBoardR496.length,0));
test('generator is deterministic',()=>assert.equal(buildCar02ReadinessFreshBoardR496(),html));
test('checked-in HTML equals regenerated HTML',()=>assert.equal(read(CAR02_V496_OUTPUT).toString('utf8'),html));
test('title identifies V4.96 accurately',()=>assert.match(html,/<title>DPRO CAR02 V4\.96/));
test('banner identifies V4.96 review-only',()=>assert.match(html,/DPRO CAR02 · V4\.96 · REVIEW ONLY/));
test('status board reports accepted 1549 of 1549 CI',()=>assert.match(html,/>1,549 \/ 1,549</));
test('stale 1521 count is absent from current board',()=>assert.doesNotMatch(html,/>1,521 \/ 1,521</));
test('V4.95 is named as accepted CI rather than real-service verification',()=>assert.match(html,/V4\.95 GitHub Actions PASS（実サービス試験ではない）/));
test('accepted GitHub run 39888313357 is identified',()=>assert.match(html,/V4\.95 GitHub Actions Run #39888313357/));
test('old V4.94 run does not impersonate the latest accepted one',()=>assert.doesNotMatch(html,/Run #39886974339/));
test('real-provider proof remains zero of seven',()=>assert.match(html,/>0 \/ 7</));
test('seven individual proof rows remain unverified',()=>assert.equal((html.match(/<span class="missing">未確認<\/span>/g)||[]).length,7));
test('seven real-provider taxonomy categories remain unchanged',()=>assert.equal(CAR02_V484_REQUIRED_PROOFS.length,7));
test('commercial approval remains NO_GO and HOLD',()=>assert.match(html,/公開判断：NO_GO \/ HOLD（固定）/));
test('R52 releaseLock explicitly appears in report',()=>assert.match(html,/R52 releaseLock=true/));
test('V4.95 human UI acceptance still awaits real-device checks',()=>assert.match(html,/V4\.95 実端末UI受入[\s\S]*?未完了/));
test('owner approval remains absent',()=>assert.match(html,/オーナー正式許可なし/));
test('CSP prohibits scripts and all network connections',()=>{
  assert.match(html,/script-src 'none'/);assert.match(html,/connect-src 'none'/);
});
test('CSP prohibits forms, frames and external resources',()=>{
  for(const s of ["form-action 'none'","frame-src 'none'","img-src 'none'"])assert.ok(html.includes(s));
});
test('no active script, form, link, image or remote asset is present',()=>{
  assert.doesNotMatch(html,/<script\b|<form\b|<input\b|<iframe\b|<link\b|<img\b|<a\s+href=/i);
  assert.doesNotMatch(html,/@import|url\s*\(/i);
});
test('report is excluded from indexing',()=>assert.match(html,/noindex,nofollow/));
test('the mobile layout keeps an overflow-safe evidence table',()=>{
  assert.match(html,/@media\(max-width:700px\)/);assert.match(html,/overflow-x:auto/);
});
test('production mutations and delivery remain forbidden',()=>{
  for(const s of ['本番Worker','共有Supabase','LINE','GitHub main','メッセージ配信','実予約'])assert.ok(html.includes(s));
});
test('missing human evidence does not turn into commercial approval',()=>{
  const r=evaluateCar02EvidenceIntakeR484(evidence,{asOf:'2026-10-23T02:12:36Z'});
  assert.equal(r.decision,'HOLD');assert.equal(r.commercialProviderProofsVerified,0);
});
