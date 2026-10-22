import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  CAR02_V490_RELEASE_LOCK,CAR02_V490_BASELINE_HTML_SHA256,
  CAR02_V490_CLOCK_FIXTURES,scanCar02BookingBoundariesR490
} from './car02-booking-boundary-sweep-r490.mjs';
import {createCar02SyntheticCalendarR487} from './car02-booking-calendar-preview-r487.mjs';
import {buildCar02BookingDayViewR486} from './car02-booking-day-view-r486.mjs';
import {car02JstTodayR487,car02PlusUtcDaysR487} from './car02-booking-month-grid-r487.mjs';

const html=readFileSync(new URL('./CAR02_V489_STANDALONE_OFFLINE_BOOKING_PREVIEW.html',import.meta.url),'utf8');
const css=html.match(/<style>([\s\S]*?)<\/style>/)?.[1]??'';
const records=JSON.parse(readFileSync(new URL('./car02-v490-offline-boundary-contract.json',import.meta.url),'utf8'));
const result=scanCar02BookingBoundariesR490();

test('V4.90 hard release lock is true',()=>assert.equal(CAR02_V490_RELEASE_LOCK,true));
test('V4.90 baseline V4.89 HTML SHA is exact',()=>{
  assert.equal(createHash('sha256').update(html).digest('hex'),CAR02_V490_BASELINE_HTML_SHA256);
});
test('contract binds to the same immutable base',()=>{
  assert.equal(records.baseHtmlSha256,CAR02_V490_BASELINE_HTML_SHA256);
  assert.equal(records.baseVersion,'V4.89');
  assert.equal(records.version,'V4.90');
});
test('eight clocks bracket JST midnight, year-end and leap day',()=>{
  assert.equal(CAR02_V490_CLOCK_FIXTURES.length,8);
  assert.equal(car02JstTodayR487(new Date('2026-12-31T14:59:00Z')),'2026-12-31');
  assert.equal(car02JstTodayR487(new Date('2026-12-31T15:01:00Z')),'2027-01-01');
  assert.equal(car02JstTodayR487(new Date('2028-02-28T15:01:00Z')),'2028-02-29');
});
test('all clock fixtures are immutable UTC instants',()=>{
  assert.ok(Object.isFrozen(CAR02_V490_CLOCK_FIXTURES));
  for(const iso of CAR02_V490_CLOCK_FIXTURES)
    assert.equal(new Date(iso).toISOString(),iso);
});
test('all 496 consecutive day views were scanned',()=>{
  assert.equal(result.checkedClocks,8);assert.equal(result.checkedDays,496);
});
test('all 8928 half-hour independent policy decisions were scanned',()=>{
  assert.equal(result.checkedSlots,8*62*18);
});
test('all 25 overlapping month grids were scanned',()=>assert.equal(result.checkedMonths,25));
test('boundary scan has zero discrepancies',()=>{
  assert.equal(result.boundaryVerified,true);assert.deepEqual(result.findings,[]);
});
test('repeat sweep stays deterministic',()=>assert.deepEqual(scanCar02BookingBoundariesR490(),result));
test('boundary scan output cannot be mutated',()=>{
  assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.findings));
});
test('60-day slot remains synthetic; 61-day slot must be disallowed',()=>{
  for(const iso of CAR02_V490_CLOCK_FIXTURES){
    const now=new Date(iso),today=car02JstTodayR487(now),calendar=createCar02SyntheticCalendarR487(now);
    const day=car02PlusUtcDaysR487(today,61);
    assert.equal(buildCar02BookingDayViewR486({day,calendar,now}).candidateCount,0);
  }
});
test('owner-like synthetic day+7 closure never gains candidates',()=>{
  for(const iso of CAR02_V490_CLOCK_FIXTURES){
    const now=new Date(iso),today=car02JstTodayR487(now),calendar=createCar02SyntheticCalendarR487(now);
    const day=car02PlusUtcDaysR487(today,7);
    assert.equal(buildCar02BookingDayViewR486({day,calendar,now}).candidateCount,0);
  }
});
test('no browser or provider network permitted in standalone CSP',()=>{
  for(const key of ["default-src 'none'","connect-src 'none'","img-src 'none'",
    "frame-src 'none'","form-action 'none'"])assert.ok(html.includes(key),key);
});
test('no real booking inputs, upload controls or form',()=>{
  assert.doesNotMatch(html,/<form\b|<input\b|<textarea\b|<select\b/i);
});
test('wide two-column layout stacks at <=850 px',()=>{
  assert.match(css,/\.layout\{display:grid;grid-template-columns:minmax\(0,1\.26fr\) minmax\(0,\.9fr\)/);
  assert.match(css,/@media\(max-width:850px\)\{\.layout\{grid-template-columns:1fr\}/);
});
test('<=480 px layout retains all seven calendar columns',()=>{
  assert.match(css,/\.week,\.days\{display:grid;grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);
  assert.match(css,/@media\(max-width:480px\)/);
  assert.match(css,/\.week,\.days\{gap:4px\}/);
});
test('<=480 px time candidate layout uses three equal columns',()=>{
  assert.match(css,/\.times\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\);gap:7px\}/);
});
test('minimum mobile button hit area remains readable',()=>{
  assert.match(css,/button\{font:inherit;min-height:48px/);
  assert.match(css,/\.calendar-day\{font-size:16px;min-height:47px\}/);
});
test('compact summary never requires a fixed pixel width',()=>{
  assert.match(css,/\.rows\{grid-template-columns:80px minmax\(0,1fr\)\}/);
  assert.match(css,/\.card\{padding:15px\}/);
});
test('keyboard focus and aria-live annotations still exist',()=>{
  assert.match(css,/button:focus-visible\{outline:3px solid/);
  assert.match(html,/aria-live="polite"/);
  assert.match(html,/キーボード：Tabで日付へ移動/);
});
test('the standalone artifact is never a real booking completion',()=>{
  assert.match(html,/予約・仮確保・通知は成立しません/);
  assert.match(html,/未予約（画面確認のみ）/);
});
test('human desktop and narrow browser checks are not mobile hardware claims',()=>{
  assert.equal(records.humanUiReview.desktopBasicFlow,'PASS');
  assert.equal(records.humanUiReview.narrowDesktopWindow,'PASS');
  assert.equal(records.humanUiReview.realPhoneHardwareTested,false);
});
test('reported human checks are observations, not provider verification',()=>{
  assert.equal(records.humanUiReview.verificationClass,'visual_review_only');
  assert.equal(records.verifiedCommercialProviderProofs,0);
  assert.equal(records.commercialDecision,'NO_GO_HOLD');
});
test('bounded scan never changes the commercial release verdict',()=>{
  assert.equal(result.decision,'HOLD');assert.equal(result.commercialDecision,'NO_GO_HOLD');
  assert.equal(result.releaseLock,true);assert.equal(result.bookingCreationAllowed,false);
  assert.equal(result.providerProofsVerified,0);assert.equal(result.requiredProviderProofs,7);
});
