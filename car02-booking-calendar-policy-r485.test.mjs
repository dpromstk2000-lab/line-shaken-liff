import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAR02_V485_RELEASE_LOCK,CAR02_V485_MAX_BOOKING_DAYS,
  CAR02_V485_SLOT_MINUTES,CAR02_V485_REQUIRED_HOLIDAY_YEARS,
  evaluateCar02BookingCalendarR485
} from './car02-booking-calendar-policy-r485.mjs';

const NOW=new Date('2026-10-22T01:10:00.000Z'); // 10:10 JST
const base=()=>({
  now:new Date(NOW),
  selection:{day:'2026-11-05',time:'10:30'},
  calendar:{systemCode:'CAR02',environment:'isolated_qa',coverageThrough:'2027-10-22',
    closedDays:['2026-11-03','2027-01-01'],
    occupiedSlots:['2026-11-04T10:30','2026-12-10T13:00']}
});
const run=change=>{const input=base();change?.(input);return evaluateCar02BookingCalendarR485(input)};
function assertLocked(result,reason,candidate=false){
  assert.equal(result.systemCode,'CAR02');
  assert.equal(result.version,'V4.85');
  assert.equal(result.decision,'HOLD');
  assert.equal(result.commercialDecision,'NO_GO_HOLD');
  assert.equal(result.releaseLock,true);
  assert.equal(result.reason,reason);
  assert.equal(result.candidateAvailableInOfflineUi,candidate);
  for(const key of ['bookingCreationAllowed','realCalendarOwnershipVerified',
    'liveHolidayProviderChecked','staffIdentityVerified','databaseMutationAllowed',
    'lineDispatchAllowed']) assert.equal(result[key],false,key);
  assert.equal(result.commercialProviderProofsVerified,0);
  assert.equal(result.requiredCommercialProviderProofs,7);
}

test('booking 60 days, half-hour 00/30, one-year calendar and lock remain pinned',()=>{
  assert.equal(CAR02_V485_MAX_BOOKING_DAYS,60);
  assert.equal(CAR02_V485_SLOT_MINUTES,30);
  assert.equal(CAR02_V485_REQUIRED_HOLIDAY_YEARS,1);
  assert.equal(CAR02_V485_RELEASE_LOCK,true);
});
test('valid synthetic candidate is NOT a bookable authenticated reservation',()=>{
  const r=run();assertLocked(r,'candidate_available_offline_only',true);
});
test('synthetic calendar data is not echoed to logs or results',()=>{
  const r=run();assertLocked(r,'candidate_available_offline_only',true);
  assert.equal(JSON.stringify(r).includes('2026-11-03'),false);
  assert.equal(JSON.stringify(r).includes('2026-11-04T10:30'),false);
});
test('all result objects are immutable',()=>{
  assert.equal(Object.isFrozen(run()),true);
});
test('request and closure data are not mutated',()=>{
  const req=base();const frozen=structuredClone(req);
  evaluateCar02BookingCalendarR485(req);
  assert.deepEqual(req,frozen);
});

const cases=[
  ['missing clock',p=>{delete p.now;},'clock_invalid'],
  ['invalid clock',p=>{p.now=new Date('invalid');},'clock_invalid'],
  ['string clock is not trusted',p=>{p.now=NOW.toISOString();},'clock_invalid'],
  ['no selection',p=>{delete p.selection;},'selection_shape_invalid'],
  ['selection extra authority',p=>{p.selection.ownerApproval=true;},'selection_shape_invalid'],
  ['selection missing time',p=>{delete p.selection.time;},'selection_shape_invalid'],
  ['selection getter prohibited',p=>{Object.defineProperty(p.selection,'day',{get(){throw Error('unexpected read')}});},'selection_shape_invalid'],
  ['missing calendar',p=>{delete p.calendar;},'calendar_shape_or_isolation_invalid'],
  ['calendar not isolated',p=>{p.calendar.environment='production';},'calendar_shape_or_isolation_invalid'],
  ['wrong system code',p=>{p.calendar.systemCode='PHOTO';},'calendar_shape_or_isolation_invalid'],
  ['unexpected provider identifier',p=>{p.calendar.supabaseProject='secret';},'calendar_shape_or_isolation_invalid'],
  ['calendar getter prohibited',p=>{Object.defineProperty(p.calendar,'coverageThrough',{get(){throw Error('unexpected read')}});},'calendar_shape_or_isolation_invalid'],
  ['closed days wrong type',p=>{p.calendar.closedDays={};},'calendar_shape_or_isolation_invalid'],
  ['occupied slots wrong type',p=>{p.calendar.occupiedSlots=null;},'calendar_shape_or_isolation_invalid'],
  ['coverage less than one year',p=>{p.calendar.coverageThrough='2027-10-21';},'one_year_calendar_coverage_missing'],
  ['coverage missing',p=>{p.calendar.coverageThrough='';},'one_year_calendar_coverage_missing'],
  ['coverage impossible date',p=>{p.calendar.coverageThrough='2027-02-29';},'one_year_calendar_coverage_missing'],
  ['invalid closure month',p=>{p.calendar.closedDays[0]='2026-13-03';},'closed_day_inventory_invalid'],
  ['duplicated closure day',p=>{p.calendar.closedDays.push('2026-11-03');},'closed_day_inventory_invalid'],
  ['closure before today',p=>{p.calendar.closedDays.push('2026-10-21');},'closed_day_inventory_invalid'],
  ['closure beyond coverage',p=>{p.calendar.closedDays.push('2027-10-23');},'closed_day_inventory_invalid'],
  ['closure contains PII object',p=>{p.calendar.closedDays[0]={date:'2026-11-03',customer:'name'};},'closed_day_inventory_invalid'],
  ['invalid occupied minute',p=>{p.calendar.occupiedSlots[0]='2026-11-04T10:15';},'occupied_slot_inventory_invalid'],
  ['duplicate occupied slot',p=>{p.calendar.occupiedSlots.push('2026-11-04T10:30');},'occupied_slot_inventory_invalid'],
  ['occupied slot before current day',p=>{p.calendar.occupiedSlots.push('2026-10-21T10:00');},'occupied_slot_inventory_invalid'],
  ['occupied slot after closure coverage',p=>{p.calendar.occupiedSlots.push('2027-10-23T10:00');},'occupied_slot_inventory_invalid'],
  ['occupied slot outside business hours',p=>{p.calendar.occupiedSlots.push('2026-11-10T18:00');},'occupied_slot_inventory_invalid'],
  ['occupied slot invalid leap date',p=>{p.calendar.occupiedSlots.push('2027-02-29T10:00');},'occupied_slot_inventory_invalid'],
  ['occupied slot with identity fields',p=>{p.calendar.occupiedSlots.push({day:'2026-11-10',customerId:'foo'});},'occupied_slot_inventory_invalid'],
  ['selected day impossible',p=>{p.selection.day='2026-02-30';},'selected_day_invalid'],
  ['selected day non-string',p=>{p.selection.day=20300101;},'selected_day_invalid'],
  ['selected minute 10:15',p=>{p.selection.time='10:15';},'selected_time_not_half_hour'],
  ['selected minute 10:45',p=>{p.selection.time='10:45';},'selected_time_not_half_hour'],
  ['selected 24:00',p=>{p.selection.time='24:00';},'selected_time_not_half_hour'],
  ['selected time is non-string',p=>{p.selection.time=1030;},'selected_time_not_half_hour'],
  ['08:30 before opening',p=>{p.selection.time='08:30';},'outside_business_hours'],
  ['18:00 after closing',p=>{p.selection.time='18:00';},'outside_business_hours'],
  ['selected yesterday',p=>{p.selection.day='2026-10-21';},'booking_date_outside_open_window'],
  ['selected today at passed 10:00',p=>{p.selection.day='2026-10-22';p.selection.time='10:00';},'booking_date_outside_open_window'],
  ['selected 61 days ahead',p=>{p.selection.day=new Date(Date.UTC(2026,9,22)+61*86400000).toISOString().slice(0,10);},'booking_date_outside_open_window'],
  ['selected Sunday',p=>{p.selection.day='2026-10-25';},'sunday_closed'],
  ['declared closure blocks otherwise valid day',p=>{p.selection.day='2026-11-03';},'owner_declared_closed_day'],
  ['occupied synthetic slot blocks candidate',p=>{p.selection.day='2026-11-04';p.selection.time='10:30';},'synthetic_slot_occupied']
];
for(const [name,change,reason] of cases){
  test(`fail-closed booking calendar: ${name}`,()=>assertLocked(run(change),reason));
}
test('today 10:30 JST is allowed as synthetic candidate when now is 10:10 JST',()=>{
  const r=run(p=>{p.selection.day='2026-10-22';p.selection.time='10:30';});
  assertLocked(r,'candidate_available_offline_only',true);
});
test('business hours 09:00 and 17:30 are inclusive on future open days',()=>{
  for(const time of ['09:00','17:30']){
    const r=run(p=>{p.selection.time=time;});
    assertLocked(r,'candidate_available_offline_only',true);
  }
});
test('exactly 60 days away is within the existing QA booking window',()=>{
  const day=new Date(Date.UTC(2026,9,22)+60*86400000).toISOString().slice(0,10);
  const r=run(p=>{p.selection.day=day;});
  assertLocked(r,'candidate_available_offline_only',true);
});
test('leap-day calendar covers one calendar year through next February 28',()=>{
  const r=run(p=>{
    p.now=new Date('2028-02-29T01:10:00.000Z');
    p.calendar.coverageThrough='2029-02-28';
    p.calendar.closedDays=[];p.calendar.occupiedSlots=[];
    p.selection.day='2028-03-01';p.selection.time='10:30';
  });
  assertLocked(r,'candidate_available_offline_only',true);
});
test('Japanese business date is used even when UTC date is one day behind',()=>{
  const r=run(p=>{
    p.now=new Date('2026-10-21T23:40:00.000Z'); // 08:40 JST on Oct 22
    p.selection.day='2026-10-22';p.selection.time='09:00';
  });
  assertLocked(r,'candidate_available_offline_only',true);
});
