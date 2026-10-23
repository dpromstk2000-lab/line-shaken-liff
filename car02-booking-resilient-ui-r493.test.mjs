import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {CAR02_V493_RELEASE_LOCK,mountCar02BookingCalendarResilientR493}
  from './car02-booking-calendar-resilient-r493.mjs';
import {createCar02SyntheticCalendarR487}
  from './car02-booking-calendar-preview-r487.mjs';
import {buildCar02StandaloneHtmlR492} from './car02-standalone-preview-builder-r492.mjs';
import {buildCar02StandaloneHtmlR493,CAR02_V493_ACCEPTED_BASE_SHA256,
  CAR02_V493_RESILIENCE_SHA256,CAR02_V493_BUILDER_RELEASE_LOCK}
  from './car02-standalone-preview-builder-r493.mjs';

const NOW='2026-10-22T01:10:00.000Z';
const sha=v=>createHash('sha256').update(v).digest('hex');
function fakeDom(){
  const focused={current:null};
  function element(){return {disabled:false,children:[],attributes:{},listeners:{},
    textContent:'',className:'',tabIndex:0,
    setAttribute(k,v){this.attributes[k]=v;},addEventListener(k,f){this.listeners[k]=f;},
    append(v){this.children.push(v);},replaceChildren(...v){this.children=v;},
    click(){if(!this.disabled)this.listeners.click?.();},
    focus(){focused.current=this;},
    keydown(key){let p=false;this.listeners.keydown?.({key,preventDefault(){p=true;}});return p;}
  };}
  const fields={};
  for(const k of ['month-title','days','slots','prev-month','next-month','chosen-day',
    'chosen-time','confirm-preview','notice','slot-description'])fields[k]=element();
  return {fields,focused,getElementById:k=>fields[k],createElement:()=>element()};
}
function mounted(clock=()=>new Date(NOW),factory=createCar02SyntheticCalendarR487){
  const root=fakeDom();
  const ui=mountCar02BookingCalendarResilientR493(root,clock,factory);
  const day=d=>root.fields.days.children.find(x=>x.attributes['aria-label']?.startsWith(`${d} `));
  const time=t=>root.fields.slots.children.find(x=>x.textContent===t);
  return {root,ui,day,time};
}

test('V4.93 release lock and builder lock remain true',()=>{
  assert.equal(CAR02_V493_RELEASE_LOCK,true);
  assert.equal(CAR02_V493_BUILDER_RELEASE_LOCK,true);
});
test('normal synthetic UI still displays selectable October day',()=>{
  const {root,ui,day}=mounted();
  assert.equal(root.fields['month-title'].textContent,'2026年10月');
  assert.equal(day('2026-10-23').disabled,false);
  assert.deepEqual(ui.getSelected(),{day:null,time:null});
});
test('normal date/time/confirmation never creates a booking',()=>{
  const {root,ui,day,time}=mounted();
  day('2026-10-23').click();time('09:00').click();
  assert.deepEqual(ui.getSelected(),{day:'2026-10-23',time:'09:00'});
  root.fields['confirm-preview'].click();
  assert.match(root.fields.notice.textContent,/予約登録・仮確保・通知は行いません/);
  assert.equal(ui.bookingCreationAllowed,false);
  assert.equal(ui.commercialDecision,'NO_GO_HOLD');
});
test('normal keyboard roving focus is retained',()=>{
  const {root,day}=mounted();
  day('2026-10-23').keydown('ArrowRight');
  assert.equal(root.focused.current,day('2026-10-24'));
});
test('throwing initial clock fails closed without crashing',()=>{
  const {root,ui}=mounted(()=>{throw Error('clock');});
  assert.equal(root.fields['confirm-preview'].disabled,true);
  assert.equal(root.fields.days.children.length,0);
  assert.match(root.fields.notice.textContent,/安全停止|表示を停止/);
  assert.deepEqual(ui.getSelected(),{day:null,time:null});
});
test('invalid initial Date object fails closed',()=>{
  const {root}=mounted(()=>new Date('bad'));
  assert.equal(root.fields['prev-month'].disabled,true);
  assert.equal(root.fields['next-month'].disabled,true);
  assert.equal(root.fields['confirm-preview'].disabled,true);
});
test('Date subclasses and decorated dates are rejected, not laundered',()=>{
  class SubDate extends Date{}
  for(const clock of [()=>new SubDate(NOW),()=>Object.assign(new Date(NOW),{userId:'private'})]){
    const {root,ui}=mounted(clock);
    assert.equal(root.fields['confirm-preview'].disabled,true);
    assert.deepEqual(ui.getSelected(),{day:null,time:null});
  }
});
test('malicious Date proxy traps fail closed',()=>{
  const hostile=new Proxy(new Date(NOW),{getPrototypeOf(){throw Error('proxy');}});
  const {root}=mounted(()=>hostile);
  assert.equal(root.fields['confirm-preview'].disabled,true);
});
test('invalid clock function type fails closed without throwing',()=>{
  const {root,ui}=mounted('bad');
  assert.equal(root.fields['confirm-preview'].disabled,true);
  assert.equal(ui.releaseLock,true);
});
test('initial throwing calendar fixture never displays candidate dates',()=>{
  const {root,ui}=mounted(()=>new Date(NOW),()=>{throw Error('fixture');});
  const available=root.fields.days.children.filter(x=>x.className==='calendar-day'&&!x.disabled);
  assert.equal(available.length,0);
  assert.deepEqual(ui.getSelected(),{day:null,time:null});
});
test('malformed calendar fixture does not display any candidate days',()=>{
  const {root}=mounted(()=>new Date(NOW),()=>({systemCode:'CAR02',environment:'production'}));
  assert.equal(root.fields.days.children.filter(x=>x.className==='calendar-day'&&!x.disabled).length,0);
});
test('invalid calendar factory type fails closed',()=>{
  const {root,ui}=mounted(()=>new Date(NOW),null);
  assert.equal(root.fields['confirm-preview'].disabled,true);
  assert.deepEqual(ui.getSelected(),{day:null,time:null});
});
test('clock failure after selection suppresses confirmation',()=>{
  let invalid=false;
  const clock=()=>invalid?new Date('bad'):new Date(NOW);
  const {root,ui,day,time}=mounted(clock);
  day('2026-10-23').click();time('09:00').click();
  invalid=true;root.fields['confirm-preview'].click();
  assert.equal(ui.getSelected().time,null);
  assert.equal(root.fields['confirm-preview'].disabled,true);
  assert.match(root.fields.notice.textContent,/失効/);
});
test('fixture failure after day selection denies time click',()=>{
  let fail=false;
  const factory=now=>fail?(()=>{throw Error('fixture');})():createCar02SyntheticCalendarR487(now);
  const {root,ui,day,time}=mounted(()=>new Date(NOW),factory);
  day('2026-10-23').click();
  fail=true;time('09:00').click();
  assert.equal(ui.getSelected().time,null);
  assert.equal(root.fields['confirm-preview'].disabled,true);
});
test('missing root is converted into an immutable locked facade',()=>{
  const ui=mountCar02BookingCalendarResilientR493(null);
  assert.equal(Object.isFrozen(ui),true);
  assert.deepEqual(ui.getSelected(),{day:null,time:null});
  assert.equal(ui.bookingCreationAllowed,false);
});
test('partially missing DOM fields lock all remaining controls',()=>{
  const dom=fakeDom();delete dom.fields.slots;
  const ui=mountCar02BookingCalendarResilientR493(dom);
  assert.equal(dom.fields['confirm-preview'].disabled,true);
  assert.equal(dom.fields['prev-month'].disabled,true);
  assert.equal(dom.fields['next-month'].disabled,true);
  assert.deepEqual(ui.getSelected(),{day:null,time:null});
});
test('accepted V4.92 standalone HTML remains byte-identical',()=>{
  const old=buildCar02StandaloneHtmlR492();
  assert.equal(sha(old),CAR02_V493_ACCEPTED_BASE_SHA256);
  assert.equal(old,readFileSync(new URL('./CAR02_V492_FIREWALLED_STANDALONE_OFFLINE_PREVIEW.html',import.meta.url),'utf8'));
});
test('new resilience module matches pinned SHA256',()=>{
  assert.equal(sha(readFileSync(new URL('./car02-booking-calendar-resilient-r493.mjs',import.meta.url))),
    CAR02_V493_RESILIENCE_SHA256);
});
test('new self-contained HTML has exact CSP script hash',()=>{
  const html=buildCar02StandaloneHtmlR493();
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length,1);
  assert.ok(html.includes(`script-src 'sha256-${createHash('sha256').update(scripts[0][1]).digest('base64')}'`));
  for(const rule of ["default-src 'none'","connect-src 'none'","form-action 'none'"])
    assert.ok(html.includes(rule));
  assert.match(html,/<body data-car02-r493-preview/);
  assert.doesNotMatch(html,/<body[^>]*data-car02-r492-preview/);
});
test('new standalone artifact never includes network, storage, forms or live API',()=>{
  const html=buildCar02StandaloneHtmlR493();
  for(const re of [/<form\b/i,/<input\b/i,/<script[^>]+src=/i,/\bfetch\s*\(/,
    /\bWebSocket\b/,/\blocalStorage\b/,/\bsessionStorage\b/,/\bindexedDB\b/])
    assert.doesNotMatch(html,re);
});
test('standalone VM DOM automatically mounts V4.93, not V4.92',()=>{
  const html=buildCar02StandaloneHtmlR493();
  const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const dom=fakeDom();dom.body={hasAttribute:k=>k==='data-car02-r493-preview'};
  const FixedDate=new Proxy(Date,{construct(T,args){return new T(...(args.length?args:[NOW]));}});
  assert.doesNotThrow(()=>vm.runInNewContext(script,{document:dom,Date:FixedDate}));
  assert.equal(dom.fields['month-title'].textContent,'2026年10月');
  assert.equal(dom.fields['confirm-preview'].disabled,true);
});
