import test from 'node:test';
import assert from 'node:assert/strict';
import {CAR02_V491_BASE_RUN_ID,CAR02_V491_RELEASE_LOCK,
  evaluateCar02BookingInputFirewallR491 as evaluate} from './car02-booking-input-firewall-r491.mjs';

const base=()=>({
  selection:{day:'2026-10-23',time:'10:30'},
  calendar:{systemCode:'CAR02',environment:'isolated_qa',coverageThrough:'2027-10-22',
    closedDays:['2026-11-03'],occupiedSlots:['2026-11-04T10:30']},
  now:new Date('2026-10-22T01:10:00.000Z')
});
const run=mutate=>{const req=base();mutate?.(req);return evaluate(req);};
const assertLocked=(r,reason,candidate=false)=>{
  assert.equal(r.systemCode,'CAR02');assert.equal(r.version,'V4.91');
  assert.equal(r.reason,reason);assert.equal(r.decision,'HOLD');
  assert.equal(r.commercialDecision,'NO_GO_HOLD');assert.equal(r.releaseLock,true);
  assert.equal(r.candidateAvailableInOfflineUi,candidate);
  assert.equal(r.bookingCreationAllowed,false);assert.equal(r.databaseMutationAllowed,false);
  assert.equal(r.lineDispatchAllowed,false);assert.equal(r.realCalendarOwnershipVerified,false);
  assert.equal(r.liveHolidayProviderChecked,false);assert.equal(r.staffIdentityVerified,false);
  assert.equal(r.commercialProviderProofsVerified,0);
  assert.equal(r.requiredCommercialProviderProofs,7);assert.ok(Object.isFrozen(r));
};

test('V4.91 hard release lock remains true, bound to formally accepted V4.90',()=>{
  assert.equal(CAR02_V491_RELEASE_LOCK,true);
  assert.equal(CAR02_V491_BASE_RUN_ID,39748618887);
});
test('valid isolated fixture can only be a non-booking offline candidate',()=>{
  assertLocked(run(),'candidate_available_offline_only',true);
});
test('wrapper is deterministic for identical user input',()=>{
  assert.deepEqual(run(),run());
});
test('input is never mutated',()=>{
  const req=base(),snapshot=structuredClone(req);
  evaluate(req);assert.deepEqual(req,snapshot);
});
test('response never serializes customer or credential-like inputs',()=>{
  const r=run(p=>{p.selection.customerName='private-person';});
  assertLocked(r,'selection_shape_invalid');
  assert.ok(!JSON.stringify(r).includes('private-person'));
});
test('null-prototype records are accepted when they contain exact fields',()=>{
  const r=run(p=>{
    p.selection=Object.assign(Object.create(null),p.selection);
    p.calendar=Object.assign(Object.create(null),p.calendar);
  });
  assertLocked(r,'candidate_available_offline_only',true);
});

const invalid=[
  ['missing root',()=>null,'payload_shape_invalid'],
  ['root as array',()=>[],'payload_shape_invalid'],
  ['extra root authority',p=>{p.accessToken='fake';},'payload_shape_invalid'],
  ['root symbol property',p=>{p[Symbol('authorization')]=true;},'payload_shape_invalid'],
  ['root accessor',p=>{Object.defineProperty(p,'selection',{get(){throw Error('forbidden')}});},'payload_shape_invalid'],
  ['root class instance',p=>{Object.setPrototypeOf(p,new(class X {})());},'payload_shape_invalid'],
  ['missing selection',p=>{delete p.selection;},'payload_shape_invalid'],
  ['selection as array',p=>{p.selection=[];},'selection_shape_invalid'],
  ['selection inherited day',p=>{p.selection=Object.create({day:'2026-10-23'});p.selection.time='10:30';},'selection_shape_invalid'],
  ['selection has staff approval flag',p=>{p.selection.staffApproved=true;},'selection_shape_invalid'],
  ['selection has symbol credential',p=>{p.selection[Symbol('token')]='fake';},'selection_shape_invalid'],
  ['selection accessor',p=>{Object.defineProperty(p.selection,'day',{get(){throw Error('no read')}});},'selection_shape_invalid'],
  ['calendar null',p=>{p.calendar=null;},'calendar_shape_invalid'],
  ['calendar override environment',p=>{p.calendar.environment='production';},'calendar_shape_or_isolation_invalid'],
  ['calendar wrong system',p=>{p.calendar.systemCode='PHOTO';},'calendar_shape_or_isolation_invalid'],
  ['calendar new owner ID',p=>{p.calendar.ownerId='secret';},'calendar_shape_invalid'],
  ['calendar has symbol',p=>{p.calendar[Symbol('identity')]='x';},'calendar_shape_invalid'],
  ['calendar getter',p=>{Object.defineProperty(p.calendar,'coverageThrough',{get(){throw Error('no read')}});},'calendar_shape_invalid'],
  ['closedDays as null',p=>{p.calendar.closedDays=null;},'calendar_inventory_shape_invalid'],
  ['closedDays as object',p=>{p.calendar.closedDays={0:'2026-11-03',length:1};},'calendar_inventory_shape_invalid'],
  ['closedDays extra property',p=>{p.calendar.closedDays.owner='fake';},'calendar_inventory_shape_invalid'],
  ['closedDays with hole',p=>{p.calendar.closedDays=new Array(1);},'calendar_inventory_shape_invalid'],
  ['closedDays symbol',p=>{p.calendar.closedDays[Symbol('token')]='x';},'calendar_inventory_shape_invalid'],
  ['closedDays element getter',p=>{Object.defineProperty(p.calendar.closedDays,'0',{get(){throw Error('no read')}});},'calendar_inventory_shape_invalid'],
  ['closedDays element object',p=>{p.calendar.closedDays[0]={day:'2026-11-03',customer:'x'};},'calendar_inventory_shape_invalid'],
  ['occupiedSlots extra property',p=>{p.calendar.occupiedSlots.customerId='secret';},'calendar_inventory_shape_invalid'],
  ['occupiedSlots as array-like object',p=>{p.calendar.occupiedSlots={length:0};},'calendar_inventory_shape_invalid'],
  ['occupiedSlots with hole',p=>{p.calendar.occupiedSlots=new Array(1);},'calendar_inventory_shape_invalid'],
  ['occupiedSlots element getter',p=>{Object.defineProperty(p.calendar.occupiedSlots,'0',{get(){throw Error('no read')}});},'calendar_inventory_shape_invalid'],
  ['clock as string',p=>{p.now='2026-10-22T01:10:00Z';},'clock_invalid'],
  ['clock as invalid Date',p=>{p.now=new Date('invalid');},'clock_invalid'],
  ['clock subclass',p=>{p.now=new(class Clock extends Date {})('2026-10-22T01:10:00Z');},'clock_invalid'],
  ['clock has additional data',p=>{p.now.customerId='private';},'clock_invalid'],
  ['clock is null',p=>{p.now=null;},'clock_invalid'],
  ['selected 10:15',p=>{p.selection.time='10:15';},'selected_time_not_half_hour'],
  ['selected 10:45',p=>{p.selection.time='10:45';},'selected_time_not_half_hour'],
  ['selected 24:00',p=>{p.selection.time='24:00';},'selected_time_not_half_hour'],
  ['selected negative minute',p=>{p.selection.time='10:-30';},'selected_time_not_half_hour'],
  ['selected invalid leap day',p=>{p.selection.day='2027-02-29';},'selected_day_invalid'],
  ['selected yesterday JST',p=>{p.selection.day='2026-10-21';},'booking_date_outside_open_window'],
  ['selected 61st day',p=>{p.selection.day='2026-12-22';},'booking_date_outside_open_window'],
  ['selected Sunday',p=>{p.selection.day='2026-10-25';},'sunday_closed'],
  ['selected synthetic closure',p=>{p.selection.day='2026-11-03';},'owner_declared_closed_day'],
  ['selected occupied synthetic time',p=>{p.selection.day='2026-11-04';p.selection.time='10:30';},'synthetic_slot_occupied'],
  ['insufficient holiday horizon',p=>{p.calendar.coverageThrough='2027-10-21';},'one_year_calendar_coverage_missing'],
  ['duplicate closed day',p=>{p.calendar.closedDays.push('2026-11-03');},'closed_day_inventory_invalid'],
  ['duplicated occupied slot',p=>{p.calendar.occupiedSlots.push('2026-11-04T10:30');},'occupied_slot_inventory_invalid'],
  ['closed day PII injection',p=>{p.calendar.closedDays[0]='2026-11-03|customer=private';},'closed_day_inventory_invalid'],
  ['occupied slot non-half-hour',p=>{p.calendar.occupiedSlots[0]='2026-11-04T10:15';},'occupied_slot_inventory_invalid'],
];
for(const [title,change,reason] of invalid){
  test(`V4.91 strict fail-closed: ${title}`,()=>{
    const r=change.length===0?evaluate(change()):run(change);
    assertLocked(r,reason);
  });
}
test('at 00:01 JST the calendar day is the next Japanese day',()=>{
  const r=run(p=>{p.now=new Date('2026-10-22T15:01:00Z');p.selection.day='2026-10-23';p.selection.time='09:00';p.calendar.coverageThrough='2027-10-23';});
  assertLocked(r,'candidate_available_offline_only',true);
});
test('a prior same-day slot at 23:59 JST cannot become a candidate',()=>{
  const r=run(p=>{p.now=new Date('2026-10-22T14:59:00Z');p.selection.day='2026-10-22';p.selection.time='17:30';});
  assertLocked(r,'booking_date_outside_open_window');
});
test('future opening boundary 09:00 and closing boundary 17:30 are synthetic only',()=>{
  for(const time of ['09:00','17:30'])assertLocked(run(p=>{p.selection.time=time;}),'candidate_available_offline_only',true);
});
test('even hostile deep-proxy inputs do not throw or grant authorization',()=>{
  const p=base();p.calendar.closedDays=new Proxy(['2026-11-03'],{ownKeys(){throw Error('untrusted proxy')}});
  assertLocked(evaluate(p),'malformed_input_failed_closed');
});
