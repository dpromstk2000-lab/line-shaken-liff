// Offline DOM event harness: verifies the actual browser module handlers without network.
import test from 'node:test';
import assert from 'node:assert/strict';
class NodeStub {
 constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this._value='';this.checked=false;this.textContent='';this.style={};this.attributes={};this.className='';this.disabled=false;
  this.classList={add:()=>{},remove:()=>{}};}
 get value(){return this._value}
 set value(v){this._value=String(v)}
 addEventListener(type,fn){this.listeners[type]=fn;}
 setAttribute(name,value){this.attributes[name]=value;}
 append(...children){this.children.push(...children);}
 remove(){}
 click(){this.clicked=true;}
 dispatch(type,more={}){if(!this.listeners[type])return;return this.listeners[type]({...more,target:this,preventDefault(){}});}
}
function build(){
 const ids=['entry','checklist','services','pending','status','notice','customerType','facilityCode','domainPlan','bookingMinutes','export','reset','importFile'];
 const elements=Object.fromEntries(ids.map(id=>[id,new NodeStub(id)]));
 const document={getElementById(id){assert.ok(elements[id],id);return elements[id]},
  createElement(tag){return new NodeStub(tag)},body:new NodeStub('body')};
 return {elements,document};
}
test('R98 browser real handlers: entry, validation, download, reset, safe import',async()=>{
 const {elements:e,document}=build();
 const oldDocument=globalThis.document,oldWindow=globalThis.window,oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;
 let blob;
 try{
  globalThis.document=document;
  globalThis.window={addEventListener(){}};
  URL.createObjectURL=x=>{blob=x;return 'blob:r98-isolated'};
  URL.revokeObjectURL=()=>{};
  await import('./car02-r98-intake-browser.mjs?dom-test=1');
  assert.match(e.status.textContent,/13 項目/);
  const boxes=e.checklist.children.map(l=>l.children[0]);
  assert.equal(boxes.length,9);
  e.customerType.value='new';e.customerType.dispatch('input');
  e.facilityCode.value='car02_demo_001';e.facilityCode.dispatch('input');
  e.domainPlan.value='new_domain';e.domainPlan.dispatch('input');
  e.bookingMinutes.value='30';e.bookingMinutes.dispatch('input');
  for(const checkbox of boxes){checkbox.checked=true;checkbox.dispatch('change');}
  assert.match(e.status.textContent,/確認完了/);
  assert.equal(e.export.disabled,false);
  e.facilityCode.value='../bad';e.facilityCode.dispatch('input');
  assert.equal(e.status.textContent,'入力エラー');assert.equal(e.export.disabled,true);
  e.facilityCode.value='car02_demo_001';e.facilityCode.dispatch('input');
  e.entry.dispatch('submit');assert.ok(blob);
  const text=await blob.text();const saved=JSON.parse(text);
  assert.equal(saved.facilityCode,'car02_demo_001');assert.equal(saved.approvals.owner_identity,true);
  e.reset.dispatch('click');assert.match(e.status.textContent,/13 項目/);
  e.importFile.files=[{size:text.length,text:async()=>text}];
  await e.importFile.dispatch('change');assert.match(e.status.textContent,/確認完了/);
  const old=e.facilityCode.value;
  e.importFile.files=[{size:200,text:async()=>'{bad'}];await e.importFile.dispatch('change');
  assert.equal(e.facilityCode.value,old);assert.match(e.notice.textContent,/読込エラー/);
 }finally{
  globalThis.document=oldDocument;globalThis.window=oldWindow;
  URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;
 }
});
