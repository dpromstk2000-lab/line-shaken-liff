import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CAR02_V488_RELEASE_LOCK,mountCar02BookingCalendarAccessibleR488}
  from './car02-booking-calendar-accessible-r488.mjs';

const START='2026-10-22T01:10:00.000Z';
const markup=readFileSync(new URL('./CAR02_V488_ACCESSIBLE_BOOKING_CALENDAR_READONLY_PREVIEW.html',import.meta.url),'utf8');
const moduleText=readFileSync(new URL('./car02-booking-calendar-accessible-r488.mjs',import.meta.url),'utf8');

function fakeDom(){
  const focus={current:null};
  function element(){
    return {children:[],disabled:false,attributes:{},listeners:{},textContent:'',
      className:'',tabIndex:0,
      setAttribute(k,v){this.attributes[k]=v;},
      addEventListener(k,fn){this.listeners[k]=fn;},
      append(child){this.children.push(child);},
      replaceChildren(...children){this.children=children;},
      click(){if(!this.disabled)this.listeners.click?.();},
      focus(){focus.current=this;},
      keydown(key){let prevented=false;this.listeners.keydown?.({key,preventDefault(){prevented=true;}});return prevented;}};
  }
  const fields={};
  for(const id of ['month-title','days','slots','prev-month','next-month',
    'chosen-day','chosen-time','confirm-preview','notice','slot-description']) fields[id]=element();
  return {fields,focus,getElementById:id=>fields[id],createElement:()=>element()};
}
function mounted(){
  const dom=fakeDom();let clock=new Date(START);
  const ui=mountCar02BookingCalendarAccessibleR488(dom,()=>new Date(clock));
  const setClock=iso=>{clock=new Date(iso);};
  const findDay=day=>dom.fields.days.children.find(el=>el.attributes['aria-label']?.startsWith(`${day} `));
  const findTime=time=>dom.fields.slots.children.find(el=>el.textContent===time);
  return {dom,ui,setClock,findDay,findTime};
}

test('V4.88 release lock remains true',()=>{
  assert.equal(CAR02_V488_RELEASE_LOCK,true);
});
test('CSP prohibits all browser network connections and submission',()=>{
  assert.match(markup,/connect-src 'none'/);
  assert.match(markup,/form-action 'none'/);
  assert.match(markup,/name="robots" content="noindex,nofollow"/);
});
test('HTML never includes booking inputs or forms',()=>{
  assert.doesNotMatch(markup,/<form\b|<input\b/i);
  assert.match(markup,/id="confirm-preview"[^>]+disabled/);
});
test('HTML uses only same-origin v488 module and isolated marker',()=>{
  assert.match(markup,/data-car02-r488-preview/);
  assert.match(markup,/src="\.\/car02-booking-calendar-accessible-r488\.mjs"/);
  assert.doesNotMatch(markup,/https?:\/\//);
});
test('HTML includes keyboard hints, status announcements and focus styling',()=>{
  assert.match(markup,/矢印キーで日付間を移動/);
  assert.match(markup,/Home／End/);
  assert.match(markup,/aria-live="polite"/);
  assert.match(markup,/role="status"/);
  assert.match(markup,/:focus-visible/);
});
test('all required DOM control IDs exist',()=>{
  for(const id of ['month-title','days','slots','prev-month','next-month',
    'chosen-day','chosen-time','confirm-preview','notice','slot-description'])
    assert.ok(markup.includes(`id="${id}"`),id);
});
test('preview JavaScript has no network, storage or navigation use',()=>{
  for(const re of [/\bfetch\s*\(/,/\bXMLHttpRequest\b/,/\bWebSocket\b/,/\bsendBeacon\b/,
    /\blocalStorage\b/,/\bsessionStorage\b/,/\bindexedDB\b/,/\blocation\.href\s*=/])
    assert.doesNotMatch(moduleText,re);
});
test('isolated fixture and functions do not mention customer fields',()=>{
  for(const re of [/customerId/,/phoneNumber/,/licensePlate/,/service_role/i])
    assert.doesNotMatch(moduleText,re);
});
test('invalid DOM is rejected before rendering',()=>{
  const root=fakeDom();delete root.fields.days;
  assert.throws(()=>mountCar02BookingCalendarAccessibleR488(root),/preview_dom_missing/);
});
test('invalid clock is rejected',()=>{
  assert.throws(()=>mountCar02BookingCalendarAccessibleR488(fakeDom(),()=>new Date('bad')),
    /preview_clock_invalid/);
});
test('initial month is October 2026 and confirmation is disabled',()=>{
  const {dom,ui}=mounted();
  assert.equal(dom.fields['month-title'].textContent,'2026年10月');
  assert.equal(dom.fields['confirm-preview'].disabled,true);
  assert.deepEqual(ui.getSelected(),{day:null,time:null});
  assert.equal(Object.isFrozen(ui.getSelected()),true);
});
test('exactly one available day is tabbable on first render',()=>{
  const {dom,findDay}=mounted();
  const enabled=dom.fields.days.children.filter(el=>el.className==='calendar-day'&&!el.disabled);
  assert.equal(enabled.filter(el=>el.tabIndex===0).length,1);
  assert.equal(findDay('2026-10-22').tabIndex,0);
});
test('past days, Sundays and synthetic closure are disabled',()=>{
  const {findDay}=mounted();
  for(const day of ['2026-10-21','2026-10-25','2026-10-29'])
    assert.equal(findDay(day).disabled,true);
});
test('ArrowRight skips disabled Sunday and moves roving focus',()=>{
  const {dom,findDay}=mounted();
  const friday=findDay('2026-10-23');
  assert.equal(friday.keydown('ArrowRight'),true);
  assert.equal(dom.focus.current,findDay('2026-10-24'));
  assert.equal(findDay('2026-10-24').tabIndex,0);
  assert.equal(findDay('2026-10-23').tabIndex,-1);
  assert.equal(findDay('2026-10-24').keydown('ArrowRight'),true);
  assert.equal(dom.focus.current,findDay('2026-10-26'));
});
test('ArrowUp and ArrowDown move a calendar week while preserving selection',()=>{
  const {dom,ui,findDay}=mounted();
  findDay('2026-10-23').click();
  assert.equal(findDay('2026-10-23').keydown('ArrowDown'),true);
  assert.equal(dom.focus.current,findDay('2026-10-30'));
  assert.equal(findDay('2026-10-30').keydown('ArrowUp'),true);
  assert.equal(dom.focus.current,findDay('2026-10-23'));
  assert.equal(ui.getSelected().day,'2026-10-23');
});
test('Home and End respect actual Monday-first weeks, not first day of month',()=>{
  const {dom,findDay}=mounted();
  findDay('2026-10-23').keydown('Home');
  assert.equal(dom.focus.current,findDay('2026-10-22'));
  findDay('2026-10-23').keydown('End');
  assert.equal(dom.focus.current,findDay('2026-10-24'));
  findDay('2026-10-28').keydown('Home');
  assert.equal(dom.focus.current,findDay('2026-10-26'));
  findDay('2026-10-28').keydown('End');
  assert.equal(dom.focus.current,findDay('2026-10-31'));
});
test('out-of-month arrow cannot navigate or focus a hidden cell',()=>{
  const {dom,findDay}=mounted();
  const first=findDay('2026-10-22');
  assert.equal(first.keydown('ArrowLeft'),true);
  assert.equal(dom.focus.current,null);
  assert.equal(first.tabIndex,0);
});
test('unrecognized key does not prevent default behavior',()=>{
  const {findDay}=mounted();
  assert.equal(findDay('2026-10-22').keydown('Escape'),false);
});
test('day click preserves DOM button identity and active focus',()=>{
  const {dom,ui,findDay}=mounted();
  const day=findDay('2026-10-23');day.focus();day.click();
  assert.equal(findDay('2026-10-23'),day);
  assert.equal(dom.focus.current,day);
  assert.equal(day.attributes['aria-pressed'],'true');
  assert.equal(ui.getSelected().day,'2026-10-23');
});
test('time click preserves DOM element, focus and selection state',()=>{
  const {dom,ui,findDay,findTime}=mounted();
  findDay('2026-10-23').click();
  const time=findTime('09:00');time.focus();time.click();
  assert.equal(findTime('09:00'),time);
  assert.equal(dom.focus.current,time);
  assert.equal(time.attributes['aria-pressed'],'true');
  assert.deepEqual(ui.getSelected(),{day:'2026-10-23',time:'09:00'});
});
test('choosing a second time switches aria-pressed without rebuilding the first',()=>{
  const {findDay,findTime}=mounted();
  findDay('2026-10-23').click();
  const first=findTime('09:00');first.click();findTime('09:30').click();
  assert.equal(findTime('09:00'),first);
  assert.equal(first.attributes['aria-pressed'],'false');
  assert.equal(findTime('09:30').attributes['aria-pressed'],'true');
});
test('disabled synthetic times cannot be selected',()=>{
  const {ui,findDay,findTime}=mounted();
  findDay('2026-10-26').click();
  assert.equal(findTime('10:30').disabled,true);
  findTime('10:30').click();
  assert.equal(ui.getSelected().time,null);
});
test('confirmation explicitly cannot book, hold or notify',()=>{
  const {dom,findDay,findTime}=mounted();
  findDay('2026-10-23').click();findTime('09:00').click();
  assert.equal(dom.fields['confirm-preview'].disabled,false);
  dom.fields['confirm-preview'].click();
  assert.match(dom.fields.notice.textContent,/予約登録・仮確保・通知は行いません/);
});
test('month navigation stays within the 60-day horizon and clears selections',()=>{
  const {dom,ui,findDay,findTime}=mounted();
  findDay('2026-10-23').click();findTime('09:00').click();
  assert.equal(dom.fields['prev-month'].disabled,true);
  dom.fields['next-month'].click();
  assert.equal(dom.fields['month-title'].textContent,'2026年11月');
  assert.deepEqual(ui.getSelected(),{day:null,time:null});
  dom.fields['next-month'].click();
  assert.equal(dom.fields['month-title'].textContent,'2026年12月');
  assert.equal(dom.fields['next-month'].disabled,true);
});
test('time recheck refuses a slot elapsed since render',()=>{
  const {dom,ui,setClock,findDay,findTime}=mounted();
  findDay('2026-10-22').click();
  const oldTime=findTime('10:30');
  assert.equal(oldTime.disabled,false);
  setClock('2026-10-22T02:00:00.000Z'); // JST 11:00
  oldTime.click();
  assert.equal(ui.getSelected().time,null);
  assert.equal(dom.fields['confirm-preview'].disabled,true);
  assert.match(dom.fields.notice.textContent,/有効期限が切れました/);
});
test('confirmation recheck refuses a slot elapsed after selecting',()=>{
  const {dom,ui,setClock,findDay,findTime}=mounted();
  findDay('2026-10-22').click();findTime('10:30').click();
  setClock('2026-10-22T02:00:00.000Z');
  dom.fields['confirm-preview'].click();
  assert.equal(ui.getSelected().time,null);
  assert.equal(dom.fields['confirm-preview'].disabled,true);
  assert.match(dom.fields.notice.textContent,/時間を選び直してください/);
});
