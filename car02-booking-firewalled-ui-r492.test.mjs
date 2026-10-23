import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {CAR02_V492_RELEASE_LOCK,buildCar02FirewalledDayR492}
  from './car02-booking-firewalled-day-r492.mjs';
import {CAR02_V492_UI_RELEASE_LOCK,mountCar02BookingCalendarFirewalledR492}
  from './car02-booking-calendar-firewalled-r492.mjs';
import {createCar02SyntheticCalendarR487}
  from './car02-booking-calendar-preview-r487.mjs';
import {buildCar02StandaloneHtmlR489} from './car02-standalone-preview-builder-r489.mjs';
import {buildCar02StandaloneHtmlR492,CAR02_V492_ACCEPTED_BASE_SHA256,
  CAR02_V492_BUILDER_RELEASE_LOCK,CAR02_V492_NEW_SOURCES}
  from './car02-standalone-preview-builder-r492.mjs';

const START='2026-10-22T01:10:00.000Z';
const sha=value=>createHash('sha256').update(value).digest('hex');
const fixture=()=>{
  const now=new Date(START);
  return {day:'2026-10-23',calendar:createCar02SyntheticCalendarR487(now),now};
};
function fakeDom(){
  const focus={current:null};
  function element(){
    return {children:[],disabled:false,attributes:{},listeners:{},textContent:'',
      className:'',tabIndex:0,setAttribute(k,v){this.attributes[k]=v;},
      addEventListener(k,fn){this.listeners[k]=fn;},
      append(child){this.children.push(child);},
      replaceChildren(...items){this.children=items;},
      click(){if(!this.disabled)this.listeners.click?.();},
      focus(){focus.current=this;},
      keydown(key){let prevented=false;
        this.listeners.keydown?.({key,preventDefault(){prevented=true;}});return prevented;}
    };
  }
  const fields={};
  for(const id of ['month-title','days','slots','prev-month','next-month',
    'chosen-day','chosen-time','confirm-preview','notice','slot-description'])fields[id]=element();
  return {fields,focus,getElementById:id=>fields[id],createElement:()=>element()};
}
function mounted(calendarFactory=createCar02SyntheticCalendarR487){
  const dom=fakeDom();let now=START;
  const ui=mountCar02BookingCalendarFirewalledR492(dom,()=>new Date(now),calendarFactory);
  const findDay=day=>dom.fields.days.children.find(x=>x.attributes['aria-label']?.startsWith(`${day} `));
  const findTime=time=>dom.fields.slots.children.find(x=>x.textContent===time);
  return {dom,ui,findDay,findTime,setClock:value=>{now=value;}};
}

test('V4.92 adapter, UI and bundler preserve release locks',()=>{
  assert.equal(CAR02_V492_RELEASE_LOCK,true);
  assert.equal(CAR02_V492_UI_RELEASE_LOCK,true);
  assert.equal(CAR02_V492_BUILDER_RELEASE_LOCK,true);
});
test('synthetic day retains 18 guarded, half-hour candidate slots',()=>{
  const result=buildCar02FirewalledDayR492(fixture());
  assert.equal(result.reason,'synthetic_firewalled_day_projection_only');
  assert.equal(result.candidateCount,18);
  assert.deepEqual(result.candidateTimes.slice(0,3),['09:00','09:30','10:00']);
  assert.equal(result.candidateTimes.at(-1),'17:30');
});
test('every green candidate must be present in guard-verified source list',()=>{
  const result=buildCar02FirewalledDayR492(fixture());
  for(const slot of result.slots){
    assert.equal(slot.selectableInOfflineUi,result.candidateTimes.includes(slot.time));
    assert.equal(Object.isFrozen(slot),true);
  }
});
test('adapter results are immutable and strictly non-authorizing',()=>{
  const result=buildCar02FirewalledDayR492(fixture());
  for(const field of ['bookingCreationAllowed','databaseMutationAllowed','lineDispatchAllowed'])
    assert.equal(result[field],false);
  assert.equal(result.releaseLock,true);
  assert.equal(result.commercialDecision,'NO_GO_HOLD');
  assert.equal(result.commercialProviderProofsVerified,0);
  assert.equal(result.requiredCommercialProviderProofs,7);
  assert.equal(Object.isFrozen(result),true);
  assert.equal(Object.isFrozen(result.slots),true);
  assert.equal(Object.isFrozen(result.candidateTimes),true);
});
test('occupied synthetic 10:30 candidate remains disabled',()=>{
  const input=fixture();input.day='2026-10-26';
  const result=buildCar02FirewalledDayR492(input);
  assert.equal(result.reason,'synthetic_firewalled_day_projection_only');
  assert.equal(result.slots.find(x=>x.time==='10:30').selectableInOfflineUi,false);
  assert.ok(!result.candidateTimes.includes('10:30'));
});
test('closed Sunday, out-of-window and invalid calendar fail closed',()=>{
  for(const day of ['2026-10-25','2027-01-15']){
    const input=fixture();input.day=day;
    const result=buildCar02FirewalledDayR492(input);
    assert.equal(result.bookingCreationAllowed,false);
    assert.equal(result.candidateCount,0);
  }
  const input=fixture();input.calendar=null;
  assert.equal(buildCar02FirewalledDayR492(input).candidateCount,0);
});
test('unexpected own calendar field rejects all otherwise plausible slots',()=>{
  const input=fixture();input.calendar={...input.calendar,allowBookings:true};
  assert.equal(buildCar02FirewalledDayR492(input).candidateCount,0);
});
test('sparse calendar arrays reject all otherwise plausible slots',()=>{
  const input=fixture();input.calendar={...input.calendar,closedDays:new Array(2)};
  assert.equal(buildCar02FirewalledDayR492(input).candidateCount,0);
});
test('hostile accessor and proxy fail closed without executing an effect',()=>{
  const input=fixture();
  input.calendar={...input.calendar};
  Object.defineProperty(input.calendar,'coverageThrough',{get(){throw Error('hostile');}});
  assert.equal(buildCar02FirewalledDayR492(input).candidateCount,0);
  const proxy=new Proxy(fixture().calendar,{getPrototypeOf(){throw Error('proxy');}});
  assert.equal(buildCar02FirewalledDayR492({...fixture(),calendar:proxy}).candidateCount,0);
});
test('stale clock disables elapsed candidates',()=>{
  const input=fixture();input.day='2026-10-22';input.now=new Date('2026-10-22T02:00:00.000Z');
  const result=buildCar02FirewalledDayR492(input);
  assert.equal(result.candidateTimes.includes('10:30'),false);
});
test('bad date objects cannot authorize candidate display',()=>{
  for(const clock of [new Date('invalid'),Object.assign(new Date(START),{flag:true})]){
    const input=fixture();input.now=clock;
    assert.equal(buildCar02FirewalledDayR492(input).candidateCount,0);
  }
});
test('invalid root or clock rejected before mounting',()=>{
  assert.throws(()=>mountCar02BookingCalendarFirewalledR492(null),/preview_dom_missing/);
  assert.throws(()=>mountCar02BookingCalendarFirewalledR492(fakeDom(),()=>new Date('invalid')),
    /preview_clock_invalid/);
});
test('initial UI is read-only and shows October 2026',()=>{
  const {dom,ui}=mounted();
  assert.equal(dom.fields['month-title'].textContent,'2026年10月');
  assert.equal(dom.fields['confirm-preview'].disabled,true);
  assert.deepEqual(ui.getSelected(),{day:null,time:null});
});
test('disabled dates include yesterday, Sunday and declared closure',()=>{
  const {findDay}=mounted();
  for(const day of ['2026-10-21','2026-10-25','2026-10-29'])
    assert.equal(findDay(day).disabled,true,day);
});
test('key navigation respects roving tabindex and preserved DOM focus',()=>{
  const {dom,findDay}=mounted();
  const friday=findDay('2026-10-23');friday.focus();
  assert.equal(friday.keydown('ArrowRight'),true);
  assert.equal(dom.focus.current,findDay('2026-10-24'));
  assert.equal(findDay('2026-10-24').keydown('ArrowRight'),true);
  assert.equal(dom.focus.current,findDay('2026-10-26'));
});
test('time clicks preserve original focused buttons and selection state',()=>{
  const {dom,ui,findDay,findTime}=mounted();
  const day=findDay('2026-10-23');day.click();
  const slot=findTime('09:00');slot.focus();slot.click();
  assert.equal(findTime('09:00'),slot);
  assert.equal(dom.focus.current,slot);
  assert.deepEqual(ui.getSelected(),{day:'2026-10-23',time:'09:00'});
  assert.match(dom.fields.notice.textContent,/予約は成立していません/);
});
test('disabled occupied time cannot be selected',()=>{
  const {ui,findDay,findTime}=mounted();
  findDay('2026-10-26').click();
  assert.equal(findTime('10:30').disabled,true);
  findTime('10:30').click();
  assert.equal(ui.getSelected().time,null);
});
test('final click rechecks firewall and never books or notifies',()=>{
  const {dom,findDay,findTime}=mounted();
  findDay('2026-10-23').click();findTime('09:00').click();
  dom.fields['confirm-preview'].click();
  assert.match(dom.fields.notice.textContent,/予約登録・仮確保・通知は行いません/);
});
test('elapsed time slot is rejected on click and clears selection',()=>{
  const {dom,ui,findDay,findTime,setClock}=mounted();
  findDay('2026-10-22').click();const slot=findTime('10:30');
  assert.equal(slot.disabled,false);
  setClock('2026-10-22T02:00:00.000Z');slot.click();
  assert.equal(ui.getSelected().time,null);
  assert.equal(dom.fields['confirm-preview'].disabled,true);
  assert.match(dom.fields.notice.textContent,/失効/);
});
test('elapsed time is rejected at confirmation after selection',()=>{
  const {dom,ui,findDay,findTime,setClock}=mounted();
  findDay('2026-10-22').click();findTime('10:30').click();
  setClock('2026-10-22T02:00:00.000Z');dom.fields['confirm-preview'].click();
  assert.equal(ui.getSelected().time,null);
  assert.match(dom.fields.notice.textContent,/失効/);
});
test('malformed fixture causes unavailable calendar, no selectable dates',()=>{
  const bad=now=>({...createCar02SyntheticCalendarR487(now),illegal:true});
  const {dom,ui}=mounted(bad);
  assert.equal(dom.fields['confirm-preview'].disabled,true);
  assert.equal(dom.fields.days.children.filter(x=>x.className==='calendar-day'&&!x.disabled).length,0);
  assert.equal(ui.getSelected().day,null);
});
test('month navigation stays within window and resets selection',()=>{
  const {dom,ui,findDay,findTime}=mounted();
  findDay('2026-10-23').click();findTime('09:00').click();
  assert.equal(dom.fields['prev-month'].disabled,true);
  dom.fields['next-month'].click();
  assert.equal(dom.fields['month-title'].textContent,'2026年11月');
  assert.deepEqual(ui.getSelected(),{day:null,time:null});
});
test('V4.89 accepted HTML is byte-identical and pinned in V4.92 builder',()=>{
  const old=buildCar02StandaloneHtmlR489();
  assert.equal(sha(old),CAR02_V492_ACCEPTED_BASE_SHA256);
  assert.equal(old,readFileSync(new URL('./CAR02_V489_STANDALONE_OFFLINE_BOOKING_PREVIEW.html',import.meta.url),'utf8'));
});
test('all V4.91/V4.92 embedded modules match pinned SHA256',()=>{
  for(const spec of CAR02_V492_NEW_SOURCES){
    const content=readFileSync(new URL(spec.file,import.meta.url),'utf8');
    assert.equal(sha(content),spec.sha256,spec.file);
  }
});
test('V4.92 standalone CSP allows only exact SHA256 inline script',()=>{
  const html=buildCar02StandaloneHtmlR492();
  const match=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(match.length,1);
  const csp=`script-src 'sha256-${createHash('sha256').update(match[0][1]).digest('base64')}'`;
  assert.ok(html.includes(csp));
  for(const part of ["default-src 'none'","connect-src 'none'","form-action 'none'",
    "base-uri 'none'","img-src 'none'",'data-car02-r492-preview'])assert.ok(html.includes(part),part);
});
test('V4.92 HTML contains zero external fetch, form, storage or script sources',()=>{
  const html=buildCar02StandaloneHtmlR492();
  for(const re of [/<form\b/i,/<input\b/i,/<script[^>]+src=/i,/<link[^>]+href=/i,
    /\bfetch\s*\(/,/\bWebSocket\b/,/\blocalStorage\b/,/\bsessionStorage\b/])
    assert.doesNotMatch(html,re);
  assert.doesNotMatch(html,/<body[^>]*data-car02-r488-preview/);
});
test('standalone embedded JS parses and mounts automatically in a DOM sandbox',()=>{
  const html=buildCar02StandaloneHtmlR492();
  const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const document=fakeDom();document.body={hasAttribute:k=>k==='data-car02-r492-preview'};
  const FixedDate=new Proxy(Date,{
    construct(Target,args){return new Target(...(args.length?args:[START]));}
  });
  assert.doesNotThrow(()=>vm.runInNewContext(script,{document,Date:FixedDate}));
  assert.equal(document.fields['month-title'].textContent,'2026年10月');
  assert.equal(document.fields['confirm-preview'].disabled,true);
});
