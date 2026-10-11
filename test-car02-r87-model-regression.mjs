// R87 regression of the unmodified R86 preview data contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import {demoMembers,reviewStats,visibleMembers,buildStaffChangeReview,DEMO_ACTOR_SUB} from './car02-staff-review-model-r86.mjs';
const ID='33333333-3333-4333-8333-333333333333';
const input={members:demoMembers(),actorSub:DEMO_ACTOR_SUB,targetSub:ID,nextRole:'staff',nextActive:false,reason:'担当変更に伴って権限を停止するため'};
const cases=[
 ['five immutable synthetic members',()=>{const m=demoMembers();assert.equal(m.length,5);assert.notEqual(m,demoMembers())}],
 ['stats remain demo values',()=>assert.deepEqual(reviewStats(demoMembers()),{total:5,active:4,owners:2,inactive:1})],
 ['R85 response five keys, no spoofed role in preview',()=>{const r=buildStaffChangeReview(input);assert.deepEqual(Object.keys(r.body).sort(),['expectedActive','expectedRole','nextActive','nextRole','reason'].sort())}],
 ['R87 review still never sends',()=>{const r=buildStaffChangeReview(input);assert.equal(r.previewOnly,true);assert.equal(r.networkRequests,0);assert.equal(r.mutations,0)}],
 ['R87 expected current staff values',()=>{const r=buildStaffChangeReview(input);assert.equal(r.body.expectedRole,'staff');assert.equal(r.body.expectedActive,true)}],
 ['R87 correct review route',()=>assert.equal(buildStaffChangeReview(input).path,`/api/car02/staff/${ID}/access`)],
 ['R87 NFKC staff search',()=>assert.equal(visibleMembers(demoMembers(),{query:'田中'}).length,1)],
 ['R87 inactive-only filter',()=>assert.equal(visibleMembers(demoMembers(),{filter:'inactive'}).length,1)],
 ['R87 no change blocked',()=>assert.throws(()=>buildStaffChangeReview({...input,nextActive:true}),{code:'REVIEW_UNCHANGED'})],
 ['R87 actor self-change blocked',()=>assert.throws(()=>buildStaffChangeReview({...input,targetSub:DEMO_ACTOR_SUB}),{code:'REVIEW_SELF_CHANGE_DENIED'})],
 ['R87 wrong shop blocked',()=>assert.throws(()=>buildStaffChangeReview({...input,shopCode:'wrong_shop'}),{code:'REVIEW_SCOPE_INVALID'})],
 ['R87 client cannot inject role',()=>assert.throws(()=>buildStaffChangeReview({...input,nextRole:'superadmin'}),{code:'REVIEW_INPUT_INVALID'})],
 ['R87 reason too short blocked',()=>assert.throws(()=>buildStaffChangeReview({...input,reason:'no'}),{code:'REVIEW_REASON_REQUIRED'})],
 ['R87 newline in reason blocked',()=>assert.throws(()=>buildStaffChangeReview({...input,reason:'理由を入れました\n他の行です'}),{code:'REVIEW_REASON_REQUIRED'})],
 ['R87 trim whitespace blocked',()=>assert.throws(()=>buildStaffChangeReview({...input,reason:' 先頭の空白は禁止となっています'}),{code:'REVIEW_REASON_REQUIRED'})],
 ['R87 exact max reason length accepted',()=>assert.equal(buildStaffChangeReview({...input,reason:'あ'.repeat(512)}).body.reason.length,512)],
 ['R87 reason overflow blocked',()=>assert.throws(()=>buildStaffChangeReview({...input,reason:'あ'.repeat(513)}),{code:'REVIEW_REASON_REQUIRED'})],
 ['R87 role must be owner or staff',()=>assert.throws(()=>buildStaffChangeReview({...input,nextRole:'customer'}),{code:'REVIEW_INPUT_INVALID'})]
];
for(const [name,fn] of cases)test(name,fn);
