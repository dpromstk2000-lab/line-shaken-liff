import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Script,runInNewContext} from 'node:vm';
import {CAR02_V489_RELEASE_LOCK,CAR02_V489_OUTPUT,CAR02_V489_INPUTS,
  buildCar02StandaloneHtmlR489} from './car02-standalone-preview-builder-r489.mjs';

const html=readFileSync(new URL(CAR02_V489_OUTPUT,import.meta.url),'utf8');
const generated=buildCar02StandaloneHtmlR489();
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

test('V4.89 hard release lock is true',()=>assert.equal(CAR02_V489_RELEASE_LOCK,true));
test('V4.89 pins five JS sources and one HTML source',()=>{
  assert.equal(CAR02_V489_INPUTS.length,6);
  for(const item of CAR02_V489_INPUTS){
    assert.equal(item.sha256.length,64);
    const bytes=readFileSync(new URL(item.file,import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256);
  }
});
test('builder is deterministic and checked-in HTML matches exactly',()=>{
  assert.equal(generated,html);
  assert.equal(buildCar02StandaloneHtmlR489(),html);
});
test('generated HTML is standalone and has no import attributes',()=>{
  assert.equal((html.match(/<script\b/g)||[]).length,1);
  assert.ok(script?.includes('const __car02_m4='));
  assert.doesNotMatch(html,/<script\b[^>]*\bsrc\s*=/i);
  assert.doesNotMatch(html,/\btype="module"/);
});
test('embedded script has a matching CSP SHA256 integrity hash',()=>{
  const cspHash=html.match(/script-src 'sha256-([^']+)'/)?.[1];
  assert.ok(cspHash);
  assert.equal(createHash('sha256').update(script).digest('base64'),cspHash);
});
test('standalone CSP blocks network, media, forms and external scripts',()=>{
  for(const directive of ["default-src 'none'","connect-src 'none'",
    "img-src 'none'","frame-src 'none'","object-src 'none'","form-action 'none'",
    "base-uri 'none'","style-src 'unsafe-inline'"])
    assert.ok(html.includes(directive),directive);
  assert.doesNotMatch(html,/script-src 'unsafe-inline'/);
});
test('standalone HTML remains noindex, same readable mobile layout',()=>{
  assert.match(html,/noindex,nofollow/);
  assert.match(html,/@media\(max-width:480px\)/);
  assert.match(html,/<html lang="ja">/);
  assert.match(html,/aria-live="polite"/);
});
test('zero user input, no live booking or payment form',()=>{
  assert.doesNotMatch(html,/<form\b|<input\b|<textarea\b/i);
  assert.match(html,/予約・仮確保・通知は成立しません/);
  assert.match(html,/実際の氏名・電話番号・車両情報は入力しないでください/);
});
test('compiled JS contains no dynamic import, fetch, storage or browser network API',()=>{
  for(const forbidden of [/^\s*import\s/m,/^\s*export\s/m,/\bimport\s*\(/,
    /\bfetch\s*\(/,/\bXMLHttpRequest\b/,/\bWebSocket\b/,/\blocalStorage\b/,
    /\bsessionStorage\b/,/\bsendBeacon\b/])
    assert.doesNotMatch(script,forbidden);
});
test('HTML identifies V4.89 standalone and preserves explicit review-only warning',()=>{
  assert.match(html,/data-car02-r489-standalone/);
  assert.match(html,/V4\.89 オフライン単体カレンダー/);
  assert.match(html,/REVIEW ONLY · NO_GO/);
});
test('generated artifact is moderate in size for a one-file offline preview',()=>{
  assert.ok(Buffer.byteLength(html)<80000);
  assert.ok(Buffer.byteLength(html)>25000);
});
test('embedded script is valid classic JavaScript without external modules',()=>{
  assert.doesNotThrow(()=>new Script(script));
});

function simulatedBrowser(){
  function element(){
    return {children:[],attributes:{},listeners:{},textContent:'',disabled:false,
      className:'',tabIndex:0,
      setAttribute(key,val){this.attributes[key]=val;},
      append(child){this.children.push(child);},
      replaceChildren(...children){this.children=children;},
      addEventListener(key,fn){this.listeners[key]=fn;},
      focus(){this.focused=true;},
      click(){if(!this.disabled)this.listeners.click?.();}};
  }
  const fields={};
  for(const key of ['month-title','days','slots','prev-month','next-month',
    'chosen-day','chosen-time','confirm-preview','notice','slot-description']) fields[key]=element();
  const document={body:{hasAttribute:key=>key==='data-car02-r488-preview'},
    getElementById:key=>fields[key],createElement:()=>element()};
  const ActualDate=Date;
  function StableDate(...args){
    return args.length?new ActualDate(...args):new ActualDate('2026-10-22T01:10:00.000Z');
  }
  StableDate.prototype=ActualDate.prototype;
  StableDate.UTC=ActualDate.UTC;
  StableDate.now=()=>new ActualDate('2026-10-22T01:10:00.000Z').getTime();
  const failures=[];
  const network=()=>{failures.push('network_requested');throw Error('network_disallowed');};
  runInNewContext(script,{document,Date:StableDate,Intl,fetch:network,
    XMLHttpRequest:network,WebSocket:network,console:{log:()=>{}}},{timeout:3000});
  const findDay=day=>fields.days.children.find(el=>el.attributes['aria-label']?.startsWith(day));
  const findTime=time=>fields.slots.children.find(el=>el.textContent===time);
  return {fields,findDay,findTime,failures};
}
test('one-file JavaScript actually mounts a live DOM from file-like context',()=>{
  const {fields,failures}=simulatedBrowser();
  assert.equal(fields['month-title'].textContent,'2026年10月');
  assert.ok(fields.days.children.length>=35);
  assert.equal(fields['confirm-preview'].disabled,true);
  assert.deepEqual(failures,[]);
});
test('standalone demo supports date to time selection without calling providers',()=>{
  const {fields,findDay,findTime,failures}=simulatedBrowser();
  findDay('2026-10-23').click();
  assert.equal(fields['chosen-day'].textContent,'2026-10-23');
  findTime('09:00').click();
  assert.equal(fields['chosen-time'].textContent,'09:00');
  fields['confirm-preview'].click();
  assert.match(fields.notice.textContent,/予約登録・仮確保・通知は行いません/);
  assert.deepEqual(failures,[]);
});
test('standalone synthetic closures still prevent choosing unavailable days',()=>{
  const {findDay}=simulatedBrowser();
  assert.equal(findDay('2026-10-25').disabled,true);
  assert.equal(findDay('2026-10-29').disabled,true);
});
