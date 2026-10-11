// Real R85 parser + R86 generated JSON. All identifiers are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCar02StaffAccessHttpR85} from './car02-staff-access-http-r85.mjs';
import {demoMembers,buildStaffChangeReview,DEMO_SHOP,DEMO_ACTOR_SUB} from './car02-staff-review-model-r86.mjs';
const targetSub='33333333-3333-4333-8333-333333333333';
const origin='https://example.com';
const reason='配置転換による担当権限の変更確認';
const actor=Object.freeze({verified:true,role:'owner',shopCode:DEMO_SHOP,subject:'staff:'+DEMO_ACTOR_SUB});
const prepared=(extras={})=>buildStaffChangeReview({members:demoMembers(),targetSub,nextRole:'owner',nextActive:true,reason,...extras});
function harness({released=true,identity=actor}={}){
 const calls={gate:0,auth:0,change:0,last:null};
 const route=createCar02StaffAccessHttpR85({shopCode:DEMO_SHOP,allowedOrigins:[origin],
 releaseEnabled:async()=>{calls.gate++;return released},authenticate:async()=>{calls.auth++;return identity},
 changeExistingStaffPermission:async arg=>{calls.change++;calls.last=arg;return {changed:true,shopCode:DEMO_SHOP,targetUserSub:arg.targetUserSub,role:arg.nextRole,active:arg.nextActive}}});
 return {route,calls};
}
function request(review,headers={}){return new Request('https://api.example.com'+review.path,{method:review.method,
 headers:{origin,authorization:'Bearer '+'d'.repeat(40),'content-type':'application/json',...headers},body:JSON.stringify(review.body)});}
test('R86 contract: generated body accepted by existing isolated R85 verifier',async()=>{
 const h=harness(),p=prepared(),r=await h.route(request(p));
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true,changed:true,role:'owner',active:true});
 assert.equal(h.calls.gate,1);assert.equal(h.calls.auth,1);assert.equal(h.calls.change,1);
 assert.equal(h.calls.last.actor,actor);assert.equal(h.calls.last.targetUserSub,targetSub);
 assert.deepEqual(Object.keys(h.calls.last).sort(),['actor','expectedActive','expectedRole','nextActive','nextRole','reason','targetUserSub'].sort());
});
test('R86 contract: preview does not include owner/shop/authorization in body',()=>{
 const p=prepared();assert.deepEqual(Object.keys(p.body).sort(),['expectedRole','expectedActive','nextRole','nextActive','reason'].sort());
 assert.ok(!Object.keys(p.body).includes('shopCode'));assert.ok(!Object.keys(p.body).includes('actor'));
});
test('R86 contract: R85 fails closed with gate off; never calls identity or writer',async()=>{
 const h=harness({released:false});const r=await h.route(request(prepared()));assert.equal(r.status,503);
 assert.equal((await r.json()).code,'CAR02_NOT_RELEASED');assert.equal(h.calls.auth,0);assert.equal(h.calls.change,0);
});
test('R86 contract: R85 fails closed for server actor with staff role',async()=>{
 const h=harness({identity:{...actor,role:'staff'}});const r=await h.route(request(prepared()));assert.equal(r.status,403);assert.equal(h.calls.change,0);
});
test('R86 contract: R85 rejects forged client shop key',async()=>{
 const h=harness();const p=prepared();const data={...p.body,shopCode:'victim'};
 const r=await h.route(new Request('https://api.example.com'+p.path,{method:'POST',headers:{origin,authorization:'Bearer '+'x'.repeat(20),'content-type':'application/json'},body:JSON.stringify(data)}));
 assert.equal(r.status,400);assert.equal(h.calls.change,0);
});
test('R86 contract: disallowed origin blocked before auth',async()=>{
 const h=harness();const r=await h.route(request(prepared(),{origin:'https://attacker.example'}));assert.equal(r.status,403);assert.equal(h.calls.auth,0);assert.equal(h.calls.change,0);
});
test('R86 contract: correct preflight method & headers accepted only when released',async()=>{
 const p=prepared();const h=harness();const r=await h.route(new Request('https://api.example.com'+p.path,{method:'OPTIONS',headers:{origin,'access-control-request-method':'POST','access-control-request-headers':'authorization,content-type'}}));assert.equal(r.status,204);assert.equal(h.calls.auth,0);assert.equal(h.calls.change,0);
});
