import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gitBlobShaR460,inspectCar02SourceProvenanceR460,CAR02_V460_RELEASE_LOCK,
 CAR02_V460_PINNED_R52_GIT_BLOB_SHA,CAR02_V460_PINNED_MAIN_SHA,CAR02_V460_REVIEW_BRANCH}
 from './car02-source-provenance-r460.mjs';
import {CAR02_V459_MANDATORY_CONTROLS} from './car02-release-readiness-r459.mjs';
const r52=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
const mf=JSON.parse(readFileSync(new URL('./car02-v460-real-integration-gaps.json',import.meta.url),'utf8'));
const fresh=()=>JSON.parse(JSON.stringify(mf));
const verify=(over={})=>inspectCar02SourceProvenanceR460({r52Text:r52,branch:CAR02_V460_REVIEW_BRANCH,
 mainSha:CAR02_V460_PINNED_MAIN_SHA,manifest:fresh(),...over});
const fails=x=>assert.deepEqual([x.status,x.releasePermitted,x.sourceParityVerified],['no_go',false,false]);
test('V460 production protection remains hard locked',()=>assert.equal(CAR02_V460_RELEASE_LOCK,true));
test('pinned Git BLOB SHA-1 matches actual 2221-byte GitHub R52, not stub',()=>{
 assert.equal(Buffer.byteLength(r52),2221);
 assert.equal(gitBlobShaR460(r52),CAR02_V460_PINNED_R52_GIT_BLOB_SHA);
 assert.notEqual(gitBlobShaR460('const CAR02_RELEASE_LOCK = true;\n'),CAR02_V460_PINNED_R52_GIT_BLOB_SHA);
});
test('actual GitHub R52 and complete seven blocked integrations return NO_GO with source parity',()=>{
 const r=verify();assert.equal(r.status,'no_go');assert.equal(r.releasePermitted,false);
 assert.equal(r.sourceParityVerified,true);assert.equal(r.remainingControls.length,7);
 assert.equal(Object.isFrozen(r),true);assert.equal(Object.isFrozen(r.remainingControls),true);
});
test('R52 text does not need to come from unstated file or environment',()=>{
 assert.match(r52,/const\s+CAR02_RELEASE_LOCK=true;/);
 assert.ok(r52.indexOf('if(CAR02_RELEASE_LOCK)throw')<r52.indexOf("import('npm:pg@"));
});
test('old stub cannot claim source parity even with the right lock flag',()=>fails(verify({r52Text:'const CAR02_RELEASE_LOCK = true;\n'})));
test('modified source with the lock switched off is rejected',()=>fails(verify({r52Text:r52.replace('CAR02_RELEASE_LOCK=true','CAR02_RELEASE_LOCK=false')})));
test('modified source with a dynamic unlock route is rejected by source pin',()=>fails(verify({r52Text:r52+'\nconst override=true;'})));
test('tampering a releaseState false flag is rejected by source pin',()=>fails(verify({r52Text:r52.replace('goLiveApproved:false','goLiveApproved:true')})));
test('wrong review branch rejected',()=>fails(verify({branch:'main'})));
test('wrong main SHA rejected',()=>fails(verify({mainSha:'f'.repeat(40)})));
test('manifest missing entirely rejected',()=>fails(verify({manifest:undefined})));
test('empty controls rejected',()=>{const m=fresh();m.controls=[];fails(verify({manifest:m}))});
test('one required control absent rejected',()=>{const m=fresh();m.controls.pop();fails(verify({manifest:m}))});
test('duplicate control cannot pass audit',()=>{const m=fresh();m.controls[2]=m.controls[1];fails(verify({manifest:m}))});
test('unknown control cannot bypass fixed seven keys',()=>{const m=fresh();m.controls[0].code='unverified_extra';fails(verify({manifest:m}))});
test('forged commercial GO cannot be accepted',()=>{const m=fresh();m.releaseDecision='GO';fails(verify({manifest:m}))});
test('mislabeling fake evidence as verified cannot be accepted',()=>{const m=fresh();m.controls[1].evidenceState='verified';fails(verify({manifest:m}))});
test('an unsupported proof URI alone is not evidence',()=>{const m=fresh();m.controls[0].acceptedProof='url';fails(verify({manifest:m}))});
test('wrong source pin stored inside manifest cannot be accepted',()=>{const m=fresh();m.pinnedR52GitBlobSha='0'.repeat(40);fails(verify({manifest:m}))});
test('non-plain or polluted manifest cannot be accepted',()=>{
 fails(verify({manifest:Object.assign(Object.create(null),mf)}));
});
test('input failure never produces a GO or external-delivery claim',()=>{
 for(const value of [null,0,{},[],Symbol('x')]){
   const r=verify({r52Text:value});assert.equal(r.releasePermitted,false);
 }
 assert.equal(typeof verify().sendLine,'undefined');
});
test('original live entry remains disconnected from V459/V460 and release locked',()=>{
 assert.doesNotMatch(r52,/release-readiness-r459|source-provenance-r460/);
 assert.match(r52,/if\s*\(CAR02_RELEASE_LOCK\)throw Error\('CAR02_NOT_RELEASED'\)/);
 assert.equal(CAR02_V459_MANDATORY_CONTROLS.length,7);
});
