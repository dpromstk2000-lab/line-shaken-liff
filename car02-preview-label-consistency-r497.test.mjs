import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  CAR02_V497_RELEASE_LOCK,CAR02_V497_OUTPUT,CAR02_V497_ACCEPTED_V494_SHA256,
  buildCar02PreviewLabelR497
} from './car02-preview-label-consistency-r497.mjs';

const accepted=readFileSync(new URL('./CAR02_V494_READABLE_STANDALONE_OFFLINE_PREVIEW.html',import.meta.url),'utf8');
const output=readFileSync(new URL('./CAR02_V497_LABEL_CONSISTENT_STANDALONE_OFFLINE_PREVIEW.html',import.meta.url),'utf8');
const contract=JSON.parse(readFileSync(new URL('./car02-v497-preview-label-contract.json',import.meta.url),'utf8'));
const hash=(text,encoding='hex')=>createHash('sha256').update(text).digest(encoding);
const scripts=text=>[...text.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const styles=text=>[...text.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>m[1]);
const announcementOld="announce('V4.92 安全な隔離プレビューです。すべて架空の候補です。');";
const announcementNew="announce('V4.97 安全な隔離プレビューです。すべて架空の候補です。');";

test('release-lock is true',()=>assert.equal(CAR02_V497_RELEASE_LOCK,true));
test('output filename is single-purpose and offline',()=>assert.equal(CAR02_V497_OUTPUT,'CAR02_V497_LABEL_CONSISTENT_STANDALONE_OFFLINE_PREVIEW.html'));
test('accepted V4.94 hash is pinned',()=>assert.equal(hash(accepted),CAR02_V497_ACCEPTED_V494_SHA256));
test('builder exactly reproduces checked-in V4.97 HTML',()=>assert.equal(buildCar02PreviewLabelR497(),output));
test('builder is deterministic across multiple executions',()=>assert.equal(buildCar02PreviewLabelR497(),buildCar02PreviewLabelR497()));
test('exactly one accepted inline script and one new inline script',()=>{assert.equal(scripts(accepted).length,1);assert.equal(scripts(output).length,1);});
test('only the initial display announcement changes inside executable script',()=>{
  assert.equal(scripts(output)[0],scripts(accepted)[0].replace(announcementOld,announcementNew));
});
test('old initial display text occurs once in accepted script',()=>assert.equal(scripts(accepted)[0].split(announcementOld).length-1,1));
test('new initial display text occurs once in new script',()=>assert.equal(scripts(output)[0].split(announcementNew).length-1,1));
test('old initial display text is absent from resulting preview',()=>assert.ok(!output.includes(announcementOld)));
test('CSP script hash matches exact updated script bytes',()=>{
  assert.ok(output.includes(`script-src 'sha256-${hash(scripts(output)[0],'base64')}'`));
});
test('previous CSP script hash was replaced, not retained',()=>{
  assert.ok(!output.includes(`script-src 'sha256-${hash(scripts(accepted)[0],'base64')}'`));
});
test('default resource policy remains none',()=>assert.ok(output.includes("default-src 'none'")));
test('network connections remain forbidden',()=>assert.ok(output.includes("connect-src 'none'")));
test('form actions remain forbidden',()=>assert.ok(output.includes("form-action 'none'")));
test('frames images objects and base URI remain forbidden',()=>{
  for(const v of ["frame-src 'none'","img-src 'none'","object-src 'none'","base-uri 'none'"])
    assert.ok(output.includes(v),v);
});
test('accepted readable CSS remains byte-for-byte unchanged',()=>assert.deepEqual(styles(output),styles(accepted)));
test('V4.97 visible browser title is consistent',()=>assert.match(output,/<title>DPRO CAR02 V4\.97 \| 表示ラベル統一/));
test('V4.97 visible header is consistent',()=>assert.match(output,/<small>V4\.97 表示ラベル統一・オフラインUI確認用<\/small>/));
test('V4.97 visible footer is consistent',()=>assert.match(output,/DPRO CAR02 V4\.97 \| LABEL-CONSISTENT OFFLINE DEMO/));
test('historic V4.92 internal decision version is not rewritten',()=>{
  assert.ok(output.includes("systemCode:'CAR02',version:'V4.92',decision:'HOLD'"));
});
test('R52 NO_GO / REVIEW ONLY warnings remain visible',()=>{
  for(const v of ['REVIEW ONLY · NO_GO','予約・仮確保・通知は成立しません','実際の氏名・電話番号・車両情報は入力しないでください'])
    assert.ok(output.includes(v),v);
});
test('no booking form, remote script or storage/network invocation appears',()=>{
  assert.doesNotMatch(output,/<form\b|<input\b|<script\s+[^>]*src=/i);
  assert.doesNotMatch(scripts(output)[0],/\b(?:fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB)\b/);
});
test('synthetic selection and simulated confirm messages are intact',()=>{
  assert.ok(output.includes('架空デモの画面表示のみ確認しました。予約登録・仮確保・通知は行いません。'));
  assert.ok(output.includes('入力防御検査により候補が失効しました。時間を選び直してください。'));
});
test('calendar initialization and safe synthetic projection continue unchanged',()=>{
  assert.ok(output.includes('mountCar02BookingCalendarFirewalledR492'));
  assert.ok(output.includes('createCar02SyntheticCalendarR487'));
});
test('contract is on isolated review-only branch',()=>{
  assert.equal(contract.systemCode,'CAR02');assert.equal(contract.version,'V4.97');
  assert.equal(contract.branch,'car02-v434-review-only');
});
test('contract binds the accepted 1577/1577 V4.96 baseline and V4.94 HTML',()=>{
  assert.equal(contract.acceptedBaseRunId,39890429319);
  assert.equal(contract.acceptedBaseNodeTests,1577);
  assert.equal(contract.acceptedV494HtmlSha256,CAR02_V497_ACCEPTED_V494_SHA256);
});
test('contract pins the new HTML hash',()=>assert.equal(hash(output),contract.outputSha256));
test('contract forbids production, booking, database, LINE and payments',()=>{
  assert.equal(contract.releaseLock,true);assert.equal(contract.commercialDecision,'NO_GO_HOLD');
  for(const field of ['bookingCreationAllowed','productionDeployAllowed','databaseMutationAllowed',
    'lineDispatchAllowed','providerConnectionAllowed','billingChangeAllowed','githubMainMutationAllowed'])
    assert.equal(contract[field],false,field);
});
test('contract preserves provider proof and device acceptance boundaries',()=>{
  assert.equal(contract.independentlyVerifiedRealProviderProofs,0);
  assert.equal(contract.requiredRealProviderProofs,7);
  assert.equal(contract.pcCalendarBasicHumanQa,'PASS_2026-10-23');
  assert.equal(contract.smartphoneRealDeviceAcceptanceVerified,false);
  assert.equal(contract.realBookingE2EVerified,false);
});
