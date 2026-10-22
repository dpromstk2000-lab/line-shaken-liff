import test from 'node:test';
import assert from 'node:assert/strict';
import {CAR02_V476_RELEASE_LOCK,createCar02OfflineReviewRevisionFenceR476} from './car02-review-revision-fence-r476.mjs';
import {createCar02OfflineDualReviewR475} from './car02-quarantine-dual-review-r475.mjs';
const S='qa_shop_a',E='01ARZ3NDEKTSV4RRFFQ69G5FAY',D='b'.repeat(64),H='f'.repeat(64),NOW=1800000001000;
const reviewer=id=>({source:'isolated_mock_reviewer_registry',shopCode:S,reviewerId:id,verified:true,independent:true,active:true});
const sign=id=>({source:'disposable_mock_review_ledger',shopCode:S,eventId:E,eventDigest:D,evidenceDigest:H,reviewerId:id,reviewStatus:'quarantine_audit_recorded'});
function setup(o={}){
 let reads=0,dualReads=0;
 const prior=createCar02OfflineDualReviewR475({expectedShopCode:S,authorizeAuditor:async()=>({verified:true,role:'dual_review_auditor',mode:'isolated_qa',shopCode:S}),
  inspectIsolation:async()=>({verified:true,environment:'disposable_pg17_or_offline_mock',testOnly:true}),
  readQuarantine:async()=>({source:'disposable_mock_quarantine',shopCode:S,eventId:E,eventDigest:D,evidenceDigest:H,quarantineReason:'manual_hold',reviewState:'quarantined_review_only'}),
  readReviewers:async()=>o.reviewers??[reviewer('reviewer_a'),reviewer('reviewer_b')],
  readSignoffs:async()=>o.signoffs??[sign('reviewer_a'),sign('reviewer_b')],nowMs:()=>NOW});
 const original={source:'disposable_mock_review_revision',shopCode:S,eventId:E,eventDigest:D,evidenceDigest:H,revision:1,invalidated:false,observedAtMs:1800000000000};
 const build=()=>createCar02OfflineReviewRevisionFenceR476({expectedShopCode:o.expectedShopCode??S,
  authorizeAuditor:async()=>{if(o.fail==='auditor')throw Error('offline');return {verified:true,role:'review_revision_auditor',mode:'isolated_qa',shopCode:S,...o.auditor}},
  inspectIsolation:async()=>{if(o.fail==='isolation')throw Error('offline');return {verified:true,environment:'disposable_pg17_or_offline_mock',testOnly:true,...o.isolation}},
  inspectDualReview:async p=>{dualReads++;if(o.fail==='dual')throw Error('offline');return o.dualResult??prior.inspect(p)},
  readReviewRevision:async()=>{reads++;if(o.fail==='revision')throw Error('offline');return {...original,...(reads===1?o.first:o.second)}} ,nowMs:()=>o.now??NOW});
 return {mod:build(),stats:()=>({reads,dualReads})};
}
const exec=async(o={},p={})=>{const a=setup(o);return {res:await a.mod.inspect({eventId:E,eventDigest:D,evidenceDigest:H,...p}),...a}};
function locked(v){assert.ok(Object.isFrozen(v));assert.equal(v.status,'no_go');assert.equal(v.classification,'offline_quarantine_revision_review_only');for(const x of ['releasePermitted','writeAuthorized','quarantineLifted','jobDispatched','lineDeliveryProven','realWebhookAcknowledged','realBusinessWrites','realProviderVerified'])assert.equal(v[x],false);assert.equal('reviewRevision' in v,false);assert.equal('releaseToken' in v,false);}
test('release lock true',()=>assert.equal(CAR02_V476_RELEASE_LOCK,true));
test('readers mandatory',()=>assert.throws(()=>createCar02OfflineReviewRevisionFenceR476(),/READERS_REQUIRED/));
test('unknown shop rejected',()=>assert.throws(()=>createCar02OfflineReviewRevisionFenceR476({expectedShopCode:'bad shop'}),/READERS_REQUIRED/));
test('stable two independent mock reviewers NO_GO',async()=>{const {res,stats}=await exec();locked(res);assert.equal(res.reason,'stable_two_mock_reviewers_still_no_go');assert.equal(res.reviewersObserved,2);assert.deepEqual(stats(),{reads:2,dualReads:1});});
test('same-shop scope ignores request supplied tenant',async()=>{const {res,mod}=await exec({}, {shopCode:'qa_shop_b'});locked(res);assert.equal(mod.scopedShopCode,S);});
test('invalid event rejected without reads',async()=>{const r=await exec({}, {eventId:'fake'});locked(r.res);assert.equal(r.stats().reads,0);});
test('invalid event digest rejected',async()=>{const r=await exec({}, {eventDigest:'F'.repeat(64)});locked(r.res);assert.equal(r.stats().reads,0);});
test('invalid evidence digest rejected',async()=>{const r=await exec({}, {evidenceDigest:'wrong'});locked(r.res);});
test('unverified auditor rejected before reads',async()=>{const r=await exec({auditor:{verified:false}});locked(r.res);assert.equal(r.stats().reads,0);});
test('invalid auditor scope denied',async()=>{const r=await exec({auditor:{shopCode:'qa_shop_b'}});locked(r.res);});
test('production environment denied',async()=>{const r=await exec({isolation:{environment:'production'}});locked(r.res);});
test('real or missing isolation flag denied',async()=>{const r=await exec({isolation:{testOnly:false}});locked(r.res);});
test('initial invalidated revision denied',async()=>{const r=await exec({first:{invalidated:true}});locked(r.res);assert.equal(r.res.reason,'initial_revision_invalid_or_untrusted');assert.equal(r.stats().dualReads,0);});
test('final invalidated revision denied',async()=>{const r=await exec({second:{invalidated:true}});locked(r.res);assert.equal(r.res.reason,'final_revision_invalid_or_untrusted');});
test('revision rotated during review denied',async()=>{const r=await exec({second:{revision:2}});locked(r.res);assert.equal(r.res.reason,'revision_changed_during_review');});
test('revision timestamp changed during review denied',async()=>{const r=await exec({second:{observedAtMs:1800000000001}});locked(r.res);assert.equal(r.res.reason,'revision_changed_during_review');});
test('negative or zero revision denied',async()=>{for(const revision of [-1,0,1.1,'1',Number.MAX_SAFE_INTEGER]){const r=await exec({first:{revision}});locked(r.res);assert.equal(r.res.reason,'initial_revision_invalid_or_untrusted');}});
test('clock missing denied',async()=>{const r=await exec({now:0});locked(r.res);assert.equal(r.res.reason,'clock_unverified');});
test('future snapshot rejected',async()=>{const r=await exec({first:{observedAtMs:NOW+1}});locked(r.res);});
test('wrong tenant snapshot rejected',async()=>{const r=await exec({first:{shopCode:'qa_shop_b'}});locked(r.res);});
test('wrong event rejected',async()=>{const r=await exec({first:{eventId:'01ARZ3NDEKTSV4RRFFQ69G5FAZ'}});locked(r.res);});
test('wrong event hash rejected',async()=>{const r=await exec({first:{eventDigest:'c'.repeat(64)}});locked(r.res);});
test('wrong evidence hash rejected',async()=>{const r=await exec({first:{evidenceDigest:'c'.repeat(64)}});locked(r.res);});
test('untrusted fake source rejected',async()=>{const r=await exec({first:{source:'production'}});locked(r.res);});
test('extra release field rejected',async()=>{const r=await exec({first:{releasePermitted:true}});locked(r.res);});
test('bad second snapshot denied',async()=>{const r=await exec({second:{source:'production'}});locked(r.res);});
test('missing second reviewer denied',async()=>{const r=await exec({reviewers:[reviewer('reviewer_a')]});locked(r.res);assert.equal(r.res.reason,'dual_review_not_independently_verified');});
test('second reviewer inactive denied',async()=>{const r=await exec({reviewers:[reviewer('reviewer_a'),{...reviewer('reviewer_b'),active:false}]});locked(r.res);});
test('duplicate reviewer ID denied',async()=>{const r=await exec({reviewers:[reviewer('reviewer_a'),reviewer('reviewer_a')]});locked(r.res);});
test('forged second reviewer evidence denied',async()=>{const r=await exec({signoffs:[sign('reviewer_a'),{...sign('reviewer_b'),evidenceDigest:'e'.repeat(64)}]});locked(r.res);});
test('malicious dual result cannot authorize',async()=>{const r=await exec({dualResult:{status:'go',reason:'two_independent_mock_reviews_recorded_still_no_go',reviewersObserved:2,releasePermitted:true}});locked(r.res);});
test('all isolated adapters fail closed',async()=>{for(const fail of ['auditor','isolation','revision','dual']){const r=await exec({fail});locked(r.res);}});
test('no privileged output even with synthetic match',async()=>{const r=await exec();assert.deepEqual(Object.keys(r.res).sort(),['status','reason','reviewersObserved','classification','releasePermitted','writeAuthorized','quarantineLifted','jobDispatched','lineDeliveryProven','realWebhookAcknowledged','realBusinessWrites','realProviderVerified'].sort());});
