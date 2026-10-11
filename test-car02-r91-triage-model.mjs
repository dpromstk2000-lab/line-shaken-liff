import test from 'node:test';
import assert from 'node:assert/strict';
import {makeR91Triage,formatR91Report,R91_LOCKED_GATES,R91_VERSION} from './car02-r91-triage-model.mjs';
import {blankReview,setReviewState,createReviewExport,RECORD_IDS} from './car02-company-pc-record-r90.mjs';
const deny=fn=>assert.throws(fn,/R90_/);
const clean=()=>blankReview();
test('R91 uses the eight R90 permitted identifiers unchanged',()=>assert.equal(RECORD_IDS.length,8));
test('R91 version identifies isolated triage',()=>assert.match(R91_VERSION,/R91-ISOLATED/));
test('R91 empty review still NO_GO and HOLD',()=>{const x=makeR91Triage(clean()); assert.deepEqual(x.totals,{total:8,issue:0,pending:8,ok:0});assert.equal(x.releaseDecision,'NO_GO');assert.equal(x.migrationDecision,'HOLD');assert.equal(x.productionReady,false);assert.equal(x.humanSignoff,false);assert.equal(x.verifiedBackup,false);});
test('R91 consumes valid R90 text export',()=>{const x=makeR91Triage(JSON.stringify(createReviewExport(clean())));assert.equal(x.totals.pending,8)});
test('R91 flags issue before pending before ok',()=>{let x=clean();x=setReviewState(x,'ui_desktop','ok');x=setReviewState(x,'booking_calendar','issue');const y=makeR91Triage(x);assert.equal(y.actionable[0].id,'booking_calendar');assert.equal(y.actionable.at(-1).id,'ui_desktop');assert.deepEqual(y.issueIds,['booking_calendar']);assert.deepEqual(y.pendingIds.length,6)});
test('R91 all ok never changes live release decision',()=>{let x=clean();for(const id of RECORD_IDS)x=setReviewState(x,id,'ok');const y=makeR91Triage(x);assert.equal(y.allChecked,true);assert.equal(y.needsFollowUp,false);assert.equal(y.releaseDecision,'NO_GO');assert.equal(y.productionReady,false)});
test('R91 retains three unapproved production gates',()=>{assert.deepEqual(R91_LOCKED_GATES.map(x=>x.id),['backup','identity','contract']);assert.ok(R91_LOCKED_GATES.every(x=>x.state==='UNVERIFIED'))});
test('R91 safe plain text report includes no sign-off',()=>{const x=makeR91Triage(clean()),r=formatR91Report(x);assert.match(r,/NO_GO/);assert.match(r,/HOLD/);assert.match(r,/自己申告/);assert.match(r,/未承認/);assert.doesNotMatch(r,/Bearer |postgresql:\/\/|SUPABASE_SERVICE_ROLE_KEY/) });
test('R91 report contains all 8 allowed labels only',()=>{const s=formatR91Report(makeR91Triage(clean()));assert.equal(s.split('\n').filter(x=>x.startsWith('・[未確認]')).length,8)});
test('R91 no timestamp or person needed',()=>{const y=makeR91Triage(clean());assert.ok(!('generatedAt' in y));assert.ok(!('actor' in y));assert.ok(!('userSub' in y))});
test('R91 does not modify the source state dictionary',()=>{let a=clean(),copy={...a};makeR91Triage(a);assert.deepEqual(a,copy)});
for(const [n,update] of [
 ['release GO',v=>({...v,releaseDecision:'GO'})],
 ['migration run',v=>({...v,migrationDecision:'RUN'})],
 ['production true',v=>({...v,productionReady:true})],
 ['wrong schema',v=>({...v,schema:'other'})],
 ['wrong source',v=>({...v,source:'OFFICIAL_SIGNOFF'})],
 ['extra token',v=>({...v,token:'secret'})],
 ['missing states',v=>({...v,states:null})],
 ['fake admin status',v=>({...v,states:{...v.states,backup:'ok'}})],
 ['invalid option',v=>({...v,states:{...v.states,ui_desktop:'APPROVED'}})]
])test('R91 denies tampered R90 input: '+n,()=>deny(()=>makeR91Triage(JSON.stringify(update(createReviewExport(clean()))))));
for(const value of ['', '{}','null','[]','{','a'.repeat(16400)])test('R91 rejects malformed/oversized export',()=>deny(()=>makeR91Triage(value)));
for(const state of ['ok','issue','pending'])test('R91 renders correct Japanese status: '+state,()=>{const a=setReviewState(clean(),'ui_search',state);const y=makeR91Triage(a);assert.equal(y.actionable.find(x=>x.id==='ui_search').state,state)});
test('R91 false self-reported completion never unlocks gate',()=>{let a=clean();for(const id of RECORD_IDS)a=setReviewState(a,id,'ok');const y=makeR91Triage(JSON.stringify(createReviewExport(a)));assert.equal(y.verifiedBackup,false);assert.equal(y.humanSignoff,false);assert.equal(y.lockedGates.length,3)});
test('R91 formatted text cannot accept extra forged item',()=>{let a=makeR91Triage(clean());let attack={...a,actionable:[...a.actionable,{id:'EVIL',state:'ok',stateLabel:'承認',group:'偽',label:'リリース'}]};deny(()=>formatR91Report(attack))});
test('R91 empty object fails closed',()=>deny(()=>makeR91Triage({})));
