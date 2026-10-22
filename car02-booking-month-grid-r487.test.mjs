import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  CAR02_V487_RELEASE_LOCK,CAR02_V487_BOOKING_HORIZON_DAYS,
  car02JstTodayR487,car02PlusUtcDaysR487,car02CoverageYearR487,
  buildCar02MonthGridR487
} from './car02-booking-month-grid-r487.mjs';
import {
  createCar02SyntheticCalendarR487,mountCar02BookingCalendarPreviewR487
} from './car02-booking-calendar-preview-r487.mjs';
import {buildCar02BookingDayViewR486} from './car02-booking-day-view-r486.mjs';

const NOW=new Date('2026-10-22T01:10:00.000Z');
const input=()=>({year:2026,month:10,now:new Date(NOW),calendar:createCar02SyntheticCalendarR487(NOW)});
const run=edit=>{const p=input();edit?.(p);return buildCar02MonthGridR487(p);};
function locked(r) {
  assert.equal(r.systemCode,'CAR02');assert.equal(r.version,'V4.87');
  assert.equal(r.decision,'HOLD');assert.equal(r.commercialDecision,'NO_GO_HOLD');
  assert.equal(r.releaseLock,true);assert.equal(r.bookingCreationAllowed,false);
  assert.equal(r.providerConnected,false);assert.equal(r.realAvailabilityVerified,false);
  assert.equal(r.verifiedCommercialProviderProofs,0);assert.equal(r.requiredCommercialProviderProofs,7);
  assert.equal(Object.isFrozen(r),true);assert.equal(Object.isFrozen(r.cells),true);
  for(const cell of r.cells) assert.equal(Object.isFrozen(cell),true);
}

test('60-day booking horizon and release lock are pinned',()=>{
  assert.equal(CAR02_V487_RELEASE_LOCK,true);
  assert.equal(CAR02_V487_BOOKING_HORIZON_DAYS,60);
});
test('JST date changes correctly before UTC date rolls over',()=>{
  assert.equal(car02JstTodayR487(new Date('2026-10-21T23:30:00Z')),'2026-10-22');
});
test('Japanese date from midnight in winter',()=>{
  assert.equal(car02JstTodayR487(new Date('2027-01-01T00:00:00Z')),'2027-01-01');
});
test('JST date rejects strings, invalid dates, subclasses and extra fields',()=>{
  assert.equal(car02JstTodayR487('2026-10-22'),null);
  assert.equal(car02JstTodayR487(new Date('invalid')),null);
  assert.equal(car02JstTodayR487(new class extends Date{}(NOW)),null);
  const altered=new Date(NOW);altered.staffApproved=true;
  assert.equal(car02JstTodayR487(altered),null);
});
test('UTC day addition works through leap day',()=>{
  assert.equal(car02PlusUtcDaysR487('2028-02-28',1),'2028-02-29');
  assert.equal(car02PlusUtcDaysR487('2028-02-28',2),'2028-03-01');
});
test('UTC addition rejects malformed dates and oversized range',()=>{
  for(const [day,n] of [['2026-02-30',1],['2026-10-22',-1],['2026-10-22',367],['no',1]])
    assert.equal(car02PlusUtcDaysR487(day,n),null);
});
test('calendar-year coverage clamps 2028 leap day to 2029-02-28',()=>{
  assert.equal(car02CoverageYearR487('2028-02-29'),'2029-02-28');
});
test('coverage calendar year is not the 60-day booking horizon',()=>{
  assert.equal(car02CoverageYearR487('2026-10-22'),'2027-10-22');
  assert.equal(car02PlusUtcDaysR487('2026-10-22',60),'2026-12-21');
});
test('coverage rejects impossible dates',()=>{
  assert.equal(car02CoverageYearR487('2027-02-29'),null);
});
test('synthetic calendar owns no real provider or customer identifiers',()=>{
  const r=createCar02SyntheticCalendarR487(NOW);
  assert.deepEqual(Object.keys(r),['systemCode','environment','coverageThrough','closedDays','occupiedSlots']);
  assert.equal(r.environment,'isolated_qa');
  assert.equal(Object.isFrozen(r),true);assert.equal(Object.isFrozen(r.closedDays),true);
  assert.equal(Object.isFrozen(r.occupiedSlots),true);
});
test('invalid clock never produces a synthetic calendar',()=>{
  assert.equal(createCar02SyntheticCalendarR487(new Date('invalid')),null);
});
test('October 2026 grid begins Monday-first and has 35 cells',()=>{
  const r=run();locked(r);
  assert.equal(r.reason,'synthetic_month_projection_only');
  assert.equal(r.monthTitle,'2026年10月');
  assert.equal(r.cells.length,35);
  assert.equal(r.cells[0].type,'pad');assert.equal(r.cells[1].type,'pad');assert.equal(r.cells[2].type,'pad');
  assert.equal(r.cells[3].day,'2026-10-01');
});
test('current month disables previous month and permits next',()=>{
  const r=run();locked(r);
  assert.equal(r.previousMonthAllowed,false);assert.equal(r.nextMonthAllowed,true);
});
test('maximum booking month disables next month',()=>{
  const r=run(p=>{p.month=12;});locked(r);
  assert.equal(r.nextMonthAllowed,false);
  assert.equal(r.previousMonthAllowed,true);
});
test('months outside 60-day window fail closed',()=>{
  for(const [year,month] of [[2026,9],[2027,1],[2029,2]]) {
    const r=run(p=>{p.year=year;p.month=month;});locked(r);
    assert.equal(r.reason,'month_outside_booking_window');
    assert.equal(r.cells.length,0);
  }
});
test('current past dates are never selectable in grid',()=>{
  const r=run();locked(r);
  for(const c of r.cells.filter(c=>c.type==='day'&&c.day<'2026-10-22'))
    assert.equal(c.selectableInOfflineUi,false);
});
test('Sunday is disabled regardless of other synthetic inventory',()=>{
  const r=run();locked(r);
  assert.equal(r.cells.find(c=>c.day==='2026-10-25').selectableInOfflineUi,false);
});
test('synthetic closure at day plus seven is disabled',()=>{
  const r=run();locked(r);
  assert.equal(r.cells.find(c=>c.day==='2026-10-29').candidateCount,0);
});
test('another weekday after now remains a synthetic day candidate',()=>{
  const r=run();locked(r);
  assert.ok(r.cells.find(c=>c.day==='2026-10-23').candidateCount>0);
});
test('occupied slot does not close the whole day',()=>{
  const r=run();locked(r);
  assert.equal(r.cells.find(c=>c.day==='2026-10-26').candidateCount,17);
});
test('month grid day candidate count exactly matches V4.86 source',()=>{
  const p=input(),r=buildCar02MonthGridR487(p);locked(r);
  for(const c of r.cells.filter(c=>c.type==='day')) {
    const source=buildCar02BookingDayViewR486({day:c.day,calendar:p.calendar,now:p.now});
    assert.equal(c.candidateCount,source.candidateCount);
    assert.equal(c.selectableInOfflineUi,source.candidateCount>0);
  }
});
test('month grid is deterministic and does not mutate fixtures',()=>{
  const p=input(),before=structuredClone(p);
  assert.deepEqual(buildCar02MonthGridR487(p),buildCar02MonthGridR487(p));
  assert.deepEqual(p,before);
});
test('grid has no customer, credentials, or booked slot details',()=>{
  const s=JSON.stringify(run());
  assert.equal(s.includes('2026-10-25T10:30'),false);
  assert.equal(s.includes('customerId'),false);
});
const badCases=[
  ['year not integer',p=>{p.year='2026';},'month_invalid'],
  ['year outside range',p=>{p.year=9999;},'month_invalid'],
  ['month zero',p=>{p.month=0;},'month_invalid'],
  ['month thirteen',p=>{p.month=13;},'month_invalid'],
  ['clock invalid',p=>{p.now=new Date('invalid');},'clock_invalid'],
  ['calendar production refused',p=>{p.calendar={...p.calendar,environment:'production'};},'calendar_shape_or_isolation_invalid'],
  ['calendar incomplete',p=>{p.calendar={...p.calendar,coverageThrough:'2027-10-21'};},'one_year_calendar_coverage_missing'],
  ['calendar wrong tenant',p=>{p.calendar={...p.calendar,systemCode:'PHOTO'};},'calendar_shape_or_isolation_invalid'],
  ['occupancy invalid',p=>{p.calendar={...p.calendar,occupiedSlots:['2026-10-23T10:15']};},'occupied_slot_inventory_invalid'],
  ['closed day invalid',p=>{p.calendar={...p.calendar,closedDays:['2027-02-29']};},'closed_day_inventory_invalid'],
  ['calendar accessor rejected',p=>{p.calendar=Object.defineProperty({...p.calendar},'closedDays',{get(){throw Error('no');}});},'calendar_shape_or_isolation_invalid']
];
for(const [label,edit,reason] of badCases) test(`fail-closed month grid: ${label}`,()=>{
  const r=run(edit);locked(r);assert.equal(r.reason,reason);
  assert.equal(r.cells.length,0);
});

const html=readFileSync(new URL('./CAR02_V487_BOOKING_CALENDAR_READONLY_PREVIEW.html',import.meta.url),'utf8');
const browser=readFileSync(new URL('./car02-booking-calendar-preview-r487.mjs',import.meta.url),'utf8');
test('HTML includes noindex, CSP and hard connect-src none',()=>{
  assert.match(html,/name="robots" content="noindex,nofollow"/);
  assert.match(html,/connect-src 'none'/);
  assert.match(html,/form-action 'none'/);
});
test('HTML module import is a same-origin relative JavaScript file',()=>{
  assert.match(html,/type="module" src="\.\/car02-booking-calendar-preview-r487\.mjs"/);
});
test('HTML has all browser script-required IDs and responsive layout',()=>{
  for(const id of ['month-title','days','slots','prev-month','next-month',
    'chosen-day','chosen-time','confirm-preview','notice','slot-description'])
    assert.ok(html.includes(`id="${id}"`),id);
  assert.match(html,/@media\(max-width:480px\)/);
});
test('HTML does not have production booking inputs or an enabled submit form',()=>{
  assert.doesNotMatch(html,/<form\b/i);
  assert.doesNotMatch(html,/<input\b/i);
  assert.match(html,/id="confirm-preview"[^>]+disabled/);
});
test('browser module never opens network, storage, navigation or provider API',()=>{
  for(const pattern of [/\bfetch\s*\(/,/\bXMLHttpRequest\b/,/\blocalStorage\b/,/\bsessionStorage\b/,/\bnavigator\.sendBeacon\b/,/\bWebSocket\b/,/\blocation\.href\s*=/])
    assert.doesNotMatch(browser,pattern);
});

function fakeDom(){
  function element(){
    return {children:[],disabled:false,attributes:{},listeners:{},textContent:'',
      setAttribute(k,v){this.attributes[k]=v;},
      addEventListener(k,fn){this.listeners[k]=fn;},
      append(child){this.children.push(child);},
      replaceChildren(...children){this.children=children;},
      click(){if(!this.disabled)this.listeners.click?.();}};
  }
  const fields={};
  for(const id of ['month-title','days','slots','prev-month','next-month',
    'chosen-day','chosen-time','confirm-preview','notice','slot-description']) fields[id]=element();
  return {fields,getElementById:id=>fields[id],createElement:()=>element()};
}
test('browser month -> day -> time -> confirm changes ONLY local preview state',()=>{
  const root=fakeDom();
  const ui=mountCar02BookingCalendarPreviewR487(root,()=>new Date(NOW));
  assert.equal(root.fields['month-title'].textContent,'2026年10月');
  assert.equal(root.fields['confirm-preview'].disabled,true);
  const date=root.fields.days.children.find(c=>!c.disabled&&c.attributes['aria-label']?.includes('2026-10-23'));
  assert.ok(date);date.click();
  assert.equal(ui.getSelected().day,'2026-10-23');
  const slot=root.fields.slots.children.find(c=>c.textContent==='09:00');
  assert.ok(slot);slot.click();
  assert.deepEqual(ui.getSelected(),{day:'2026-10-23',time:'09:00'});
  assert.equal(root.fields['confirm-preview'].disabled,false);
  root.fields['confirm-preview'].click();
  assert.match(root.fields.notice.textContent,/実際の予約登録・仮確保・通知は行いません/);
});
test('browser month navigation disables outside 60 days and clears selection',()=>{
  const root=fakeDom();
  const ui=mountCar02BookingCalendarPreviewR487(root,()=>new Date(NOW));
  assert.equal(root.fields['prev-month'].disabled,true);
  root.fields['next-month'].click();
  assert.equal(root.fields['month-title'].textContent,'2026年11月');
  assert.deepEqual(ui.getSelected(),{day:null,time:null});
  root.fields['next-month'].click();
  assert.equal(root.fields['month-title'].textContent,'2026年12月');
  assert.equal(root.fields['next-month'].disabled,true);
});
test('browser refuses to mount if required IDs are absent',()=>{
  const root=fakeDom();delete root.fields.notice;
  assert.throws(()=>mountCar02BookingCalendarPreviewR487(root,()=>new Date(NOW)),/preview_dom_missing/);
});
