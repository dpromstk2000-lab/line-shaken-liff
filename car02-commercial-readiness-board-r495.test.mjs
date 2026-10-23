import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {
  CAR02_V495_RELEASE_LOCK,CAR02_V495_BASE_RUN,CAR02_V495_OUTPUT,
  CAR02_V495_EXPECTED_BASE_HTML_SHA256,CAR02_V495_EXPECTED_R484_GATE_SHA256,
  buildCar02ReadinessBoardR495
} from './car02-commercial-readiness-board-r495.mjs';
import {CAR02_V484_REQUIRED_PROOFS,evaluateCar02EvidenceIntakeR484} from './car02-evidence-provenance-gate-r484.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex');
const html=buildCar02ReadinessBoardR495();
const local=x=>readFileSync(new URL(x,import.meta.url));
const sample={systemCode:'CAR02',branch:'car02-v434-review-only',baselineV483Run:39727016029,
  releaseLock:true,commercialDecision:'NO_GO_HOLD',proofs:[]};

test('V4.95 preserves hard release lock',()=>assert.equal(CAR02_V495_RELEASE_LOCK,true));
test('V4.94 official successful CI run is pinned',()=>assert.equal(CAR02_V495_BASE_RUN,39886974339));
test('V4.94 accepted demo exact SHA256 is pinned',()=>assert.equal(hash(local('CAR02_V494_READABLE_STANDALONE_OFFLINE_PREVIEW.html')),CAR02_V495_EXPECTED_BASE_HTML_SHA256));
test('V4.84 proof taxonomy gate exact SHA256 is pinned',()=>assert.equal(hash(local('car02-evidence-provenance-gate-r484.mjs')),CAR02_V495_EXPECTED_R484_GATE_SHA256));
test('seven provider evidence categories retain accepted order',()=>assert.deepEqual(CAR02_V484_REQUIRED_PROOFS.map(x=>x.key),[
  'auth_session_revocation','staff_worker_store_acl','transaction_commit_acl_fence','line_webhook_delivery_retry',
  'independent_offsite_worm','independent_signature_key_rotation','owner_isolated_staging_acceptance']));
test('seven provider families are shown without provider details or account identifiers',()=>{
  assert.equal(CAR02_V484_REQUIRED_PROOFS.length,7);
  for(const x of CAR02_V484_REQUIRED_PROOFS)assert.ok(html.includes(`>${x.providerFamily}<`));
});
test('all seven proof rows remain unverified',()=>assert.equal((html.match(/<span class="missing">未確認<\/span>/g)||[]).length,7));
test('all evidence entries have human-readable specific criteria',()=>assert.equal((html.match(/<tr><th scope="row">\d\. /g)||[]).length,7));
test('0 of 7 externally verified proof is explicit',()=>assert.match(html,/>0 \/ 7</));
test('offline tests show exact accepted 1521 result',()=>assert.match(html,/>1,521 \/ 1,521</));
test('offline QA is not represented as real-provider acceptance',()=>assert.match(html,/実サービス試験ではない/));
test('V4.94 real device manual UI acceptance is pending',()=>assert.match(html,/V4.94 実端末UI受入[\s\S]*?未完了/));
test('commercial verdict remains NO_GO HOLD',()=>assert.match(html,/公開判断：NO_GO \/ HOLD（固定）/));
test('R52 releaseLock remains explicit',()=>assert.match(html,/R52 releaseLock=true/));
test('owner approval remains separate',()=>assert.match(html,/オーナー正式許可なし/));
test('report generator accepts no caller-controlled manifest or release override',()=>assert.equal(buildCar02ReadinessBoardR495.length,0));
test('report content is deterministic',()=>assert.equal(buildCar02ReadinessBoardR495(),html));
test('tracked output exactly equals generated content',()=>assert.equal(local(CAR02_V495_OUTPUT).toString('utf8'),html));
test('offline CSP prohibits scripts and connections',()=>{
  assert.match(html,/script-src 'none'/);assert.match(html,/connect-src 'none'/);
});
test('offline CSP prohibits forms and embedded frames',()=>{
  assert.match(html,/form-action 'none'/);assert.match(html,/frame-src 'none'/);
});
test('no executable script, active form or external resource exists',()=>{
  assert.doesNotMatch(html,/<script\b|<form\b|<input\b|<iframe\b|<link\b|<img\b/i);
  assert.doesNotMatch(html,/@import|url\s*\(|<a\s+href=/i);
});
test('preview is never indexable',()=>assert.match(html,/noindex,nofollow/));
test('real-person evidence is not falsely presented as gathered',()=>assert.match(html,/未収集・未検証/));
test('all business connectors, mutations and dispatch remain explicitly disallowed',()=>{
  for(const x of ['本番Worker','共有Supabase','LINE','GitHub main','メッセージ配信','実予約'])assert.ok(html.includes(x));
});
test('mobile presentation and scrollable evidence table are defined',()=>{
  assert.match(html,/@media\(max-width:700px\)/);assert.match(html,/overflow-x:auto/);
});
test('semantic table has headers and explanatory caption',()=>{
  assert.match(html,/<caption>商用提供者証拠：0\/7、全項目未確認<\/caption>/);
  assert.match(html,/scope="row"/);assert.match(html,/scope="col"/);
});
test('underlying empty manifest is still HOLD and independently verified count is zero',()=>{
  const r=evaluateCar02EvidenceIntakeR484(sample,{asOf:'2026-10-23T01:58:00Z'});
  assert.equal(r.decision,'HOLD');assert.equal(r.commercialProviderProofsVerified,0);
  assert.equal(r.independentVerificationPerformed,false);
});
test('forged owner authority is rejected, not displayed as approval',()=>{
  const r=evaluateCar02EvidenceIntakeR484({...sample,ownerApproved:true},{asOf:'2026-10-23T01:58:00Z'});
  assert.equal(r.decision,'HOLD');assert.equal(r.reason,'manifest_shape_invalid');
});
