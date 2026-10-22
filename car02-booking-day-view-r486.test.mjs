import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAR02_V486_RELEASE_LOCK, CAR02_V486_SLOT_COUNT,
  CAR02_V486_FIRST_SLOT, CAR02_V486_LAST_SLOT,
  buildCar02BookingDayViewR486
} from './car02-booking-day-view-r486.mjs';
import {evaluateCar02BookingCalendarR485} from './car02-booking-calendar-policy-r485.mjs';

const now = new Date('2026-10-22T01:10:00.000Z'); // 10:10 JST
const base = () => ({
  day: '2026-11-05', now: new Date(now),
  calendar: {
    systemCode: 'CAR02', environment: 'isolated_qa', coverageThrough: '2027-10-22',
    closedDays: ['2026-11-03', '2027-01-01'],
    occupiedSlots: ['2026-11-05T10:30', '2026-11-05T11:00', '2026-11-04T16:00']
  }
});
const evaluate = edit => {const input=base();edit?.(input);return buildCar02BookingDayViewR486(input);};
const dayMs = 86400000;
const dayAt = n => new Date(Date.UTC(2026,9,22)+n*dayMs).toISOString().slice(0,10);

function checkLock(result) {
  assert.equal(result.systemCode, 'CAR02');
  assert.equal(result.version, 'V4.86');
  assert.equal(result.environment, 'isolated_qa');
  assert.equal(result.decision, 'HOLD');
  assert.equal(result.commercialDecision, 'NO_GO_HOLD');
  assert.equal(result.releaseLock, true);
  for(const k of ['bookingCreationAllowed','authenticatedCapacityVerified',
    'nationalHolidayProviderChecked','ownerCalendarApprovalVerified',
    'databaseMutationAllowed','lineDispatchAllowed']) assert.equal(result[k],false,k);
  assert.equal(result.commercialProviderProofsVerified,0);
  assert.equal(result.requiredCommercialProviderProofs,7);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.slots));
  assert.ok(Object.isFrozen(result.candidateTimes));
  for(const slot of result.slots) assert.ok(Object.isFrozen(slot));
}

test('projection pins 18 half-hour slots and hard release lock',()=>{
  assert.equal(CAR02_V486_RELEASE_LOCK,true);
  assert.equal(CAR02_V486_SLOT_COUNT,18);
  assert.equal(CAR02_V486_FIRST_SLOT,'09:00');
  assert.equal(CAR02_V486_LAST_SLOT,'17:30');
});
test('future open date has 18 UI rows, with only synthetic occupied times disabled',()=>{
  const r=evaluate(); checkLock(r);
  assert.equal(r.reason,'synthetic_day_projection_only');
  assert.equal(r.day,'2026-11-05');
  assert.equal(r.slots.length,18);
  assert.equal(r.candidateCount,16);
  assert.equal(r.displayCandidateSlots,true);
  assert.deepEqual(r.slots.filter(s=>s.state==='occupied').map(s=>s.time),['10:30','11:00']);
  assert.deepEqual(r.candidateTimes.slice(0,3),['09:00','09:30','10:00']);
  assert.equal(r.slots.at(-1).time,'17:30');
  assert.equal(r.bookingCreationAllowed,false);
});
test('each displayed row is exactly equal to the V4.85 source decision',()=>{
  const input=base(), r=buildCar02BookingDayViewR486(input);
  for(const row of r.slots) {
    const source=evaluateCar02BookingCalendarR485({
      selection:{day:input.day,time:row.time},calendar:input.calendar,now:input.now
    });
    assert.equal(row.selectableInOfflineUi,source.candidateAvailableInOfflineUi);
    assert.equal(row.state==='occupied',source.reason==='synthetic_slot_occupied');
  }
  checkLock(r);
});
test('same-day 10:10 JST makes 09:00, 09:30, 10:00 elapsed; 10:30 available',()=>{
  const r=evaluate(p=>{p.day='2026-10-22';}); checkLock(r);
  assert.deepEqual(r.slots.slice(0,3).map(s=>s.state),Array(3).fill('elapsed_or_out_of_window'));
  assert.equal(r.slots[3].time,'10:30');
  assert.equal(r.slots[3].selectableInOfflineUi,true);
  assert.equal(r.candidateCount,15);
});
test('UTC previous day is still same Japanese booking date',()=>{
  const r=evaluate(p=>{p.now=new Date('2026-10-21T23:40:00.000Z');p.day='2026-10-22';});
  checkLock(r);assert.equal(r.slots[0].time,'09:00');
  assert.equal(r.slots[0].selectableInOfflineUi,true);
});
test('Sunday returns no available rows even if fixture otherwise empty',()=>{
  const r=evaluate(p=>{p.day='2026-10-25';});
  checkLock(r);assert.equal(r.reason,'sunday_closed');assert.equal(r.slots.length,0);
});
test('owner-declared closed day returns no rows and never implies provider approval',()=>{
  const r=evaluate(p=>{p.day='2026-11-03';});
  checkLock(r);assert.equal(r.reason,'owner_declared_closed_day');
  assert.equal(r.slots.length,0);
  assert.equal(r.ownerCalendarApprovalVerified,false);
});
test('occupied slots affect only their own day',()=>{
  const r=evaluate(p=>{p.day='2026-11-04';});
  checkLock(r); assert.deepEqual(r.slots.filter(s=>s.state==='occupied').map(s=>s.time),['16:00']);
});
test('empty occupancy yields 18 synthetic candidates on a future weekday',()=>{
  const r=evaluate(p=>{p.calendar.occupiedSlots=[];});
  checkLock(r);assert.equal(r.candidateCount,18);
});
test('every possible time occupied still renders 18 disabled rows and zero candidates',()=>{
  const r=evaluate(p=>{
    p.calendar.occupiedSlots=Array.from({length:18},(_,i)=>
      `2026-11-05T${String(9+Math.floor(i/2)).padStart(2,'0')}:${i%2?'30':'00'}`);
  });
  checkLock(r);assert.equal(r.candidateCount,0);
  assert.equal(r.slots.length,18);
  assert.equal(r.slots.every(s=>s.state==='occupied'),true);
  assert.equal(r.displayCandidateSlots,false);
});
test('60-day boundary uses unchanged booking window',()=>{
  const r=evaluate(p=>{p.day=dayAt(60);});
  checkLock(r);assert.equal(r.candidateCount,18);
});
test('61-day boundary displays no false candidates',()=>{
  const r=evaluate(p=>{p.day=dayAt(61);});
  checkLock(r);assert.equal(r.candidateCount,0);
  assert.equal(r.slots.length,0);
  assert.equal(r.reason,'no_future_slots_in_booking_window');
});
test('yesterday and elapsed full day display no false candidates',()=>{
  for(const change of [p=>{p.day='2026-10-21';},p=>{
    p.now=new Date('2026-10-22T09:00:00.000Z');p.day='2026-10-22';
  }]) {
    const r=evaluate(change); checkLock(r);
    assert.equal(r.candidateCount,0);assert.equal(r.slots.length,0);
  }
});
test('repeated calls produce deterministic immutable results',()=>{
  assert.deepEqual(evaluate(),evaluate());
});
test('projection never mutates user input, including its arrays',()=>{
  const input=base(), previous=structuredClone(input);
  const r=buildCar02BookingDayViewR486(input);checkLock(r);
  assert.deepEqual(input,previous);
});
test('no supplied occupied slots or closed-day metadata are echoed in the view model',()=>{
  const text=JSON.stringify(evaluate());
  assert.equal(text.includes('2026-11-03'),false);
  assert.equal(text.includes('2027-01-01'),false);
  assert.equal(text.includes('2026-11-04T16:00'),false);
});
test('no general booking authority is exposed on candidate rows',()=>{
  const r=evaluate();
  for(const slot of r.slots) {
    assert.deepEqual(Object.keys(slot),['time','state','selectableInOfflineUi']);
    assert.equal(Object.hasOwn(slot,'bookingCreationAllowed'),false);
  }
});
test('large valid capacity fixture produces bounded UI rows',()=>{
  const r=evaluate(p=>{
    p.calendar.occupiedSlots=Array.from({length:10000},(_,i)=>{
      const day=dayAt(Math.floor(i/18)+1);
      const slot=i%18;
      return `${day}T${String(9+Math.floor(slot/2)).padStart(2,'0')}:${slot%2?'30':'00'}`;
    }).filter(x=>x.slice(0,10)<='2027-10-22');
  });
  checkLock(r);
  assert.ok(r.slots.length<=18);
});

const failures=[
  ['missing input',()=>undefined,'input_shape_invalid'],
  ['null input',()=>null,'input_shape_invalid'],
  ['array input',()=>[],'input_shape_invalid'],
  ['inherited input',()=>Object.create({day:'2026-11-05'}),'input_shape_invalid'],
  ['extra authorization field',p=>{p.bookingAllowed=true;},'input_shape_invalid'],
  ['no day',p=>{delete p.day;},'input_shape_invalid'],
  ['day getter',p=>{Object.defineProperty(p,'day',{get(){throw Error('not accessed');}});},'input_shape_invalid'],
  ['non-string day',p=>{p.day=1234;},'day_shape_invalid'],
  ['malformed day',p=>{p.day='2026-11-05T00:00:00Z';},'day_shape_invalid'],
  ['impossible day',p=>{p.day='2026-02-30';},'selected_day_invalid'],
  ['invalid date',p=>{p.now=new Date('invalid');},'clock_invalid'],
  ['string clock',p=>{p.now=now.toISOString();},'clock_invalid'],
  ['subclass clock',p=>{p.now=new class extends Date{}(now);},'clock_invalid'],
  ['clock additional field',p=>{p.now.authoritative=true;},'clock_invalid'],
  ['calendar wrong system',p=>{p.calendar.systemCode='GREEN';},'calendar_shape_or_isolation_invalid'],
  ['production calendar refused',p=>{p.calendar.environment='production';},'calendar_shape_or_isolation_invalid'],
  ['unauthorized owner flag',p=>{p.calendar.ownerApproved=true;},'calendar_shape_or_isolation_invalid'],
  ['calendar missing',p=>{p.calendar=undefined;},'calendar_shape_or_isolation_invalid'],
  ['calendar bad coverage',p=>{p.calendar.coverageThrough='2027-10-21';},'one_year_calendar_coverage_missing'],
  ['calendar duplicate occupied',p=>{p.calendar.occupiedSlots.push('2026-11-05T10:30');},'occupied_slot_inventory_invalid'],
  ['calendar bad half-hour',p=>{p.calendar.occupiedSlots[0]='2026-11-05T10:15';},'occupied_slot_inventory_invalid'],
  ['calendar bad closure',p=>{p.calendar.closedDays.push('2026-13-04');},'closed_day_inventory_invalid'],
  ['calendar accessor',p=>{Object.defineProperty(p.calendar,'occupiedSlots',{get(){throw Error('not accessed');}});},'calendar_shape_or_isolation_invalid'],
  ['hostile top-level proxy',()=>new Proxy(base(),{getPrototypeOf(){throw Error('no');}}),'untrusted_input_rejected'],
  ['hostile calendar proxy',p=>{p.calendar=new Proxy(p.calendar,{getPrototypeOf(){throw Error('no');}});},'untrusted_input_rejected']
];
for(const [name, setup, reason] of failures) {
  test(`fail-closed UI projection: ${name}`,()=>{
    const input=base();
    const maybe=setup(input);
    const r=buildCar02BookingDayViewR486(maybe===undefined && name==='missing input' ? undefined :
      (['null input','array input','inherited input','hostile top-level proxy'].includes(name) ? maybe : input));
    checkLock(r);
    assert.equal(r.reason,reason);
    assert.equal(r.candidateCount,0);
    assert.equal(r.displayCandidateSlots,false);
    assert.equal(r.slots.length,0);
    assert.equal(r.day,null);
  });
}

test('all bookable half-hours retain baseline parity across the next 60 days',()=>{
  const input=base();input.calendar.closedDays=[];input.calendar.occupiedSlots=[];
  for(let i=0;i<=60;i++) {
    input.day=dayAt(i);
    const r=buildCar02BookingDayViewR486(input);checkLock(r);
    for(const slot of r.slots){
      const source=evaluateCar02BookingCalendarR485({
        selection:{day:input.day,time:slot.time},calendar:input.calendar,now:input.now
      });
      assert.equal(slot.selectableInOfflineUi,source.candidateAvailableInOfflineUi);
    }
  }
});
