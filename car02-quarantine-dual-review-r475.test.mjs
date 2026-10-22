import test from 'node:test';
import assert from 'node:assert/strict';
import {CAR02_V475_RELEASE_LOCK,createCar02OfflineDualReviewR475} from './car02-quarantine-dual-review-r475.mjs';
const S='qa_shop_a',E='01ARZ3NDEKTSV4RRFFQ69G5FAY',D='b'.repeat(64),H='f'.repeat(64);
function factory(o={}){
 const calls={q:0,r:0,s:0};const reviewer=(id)=>({source:'isolated_mock_reviewer_registry',shopCode:S,reviewerId:id,verified:true,active:true,independent:true});
 const sign=(id)=>({source:'disposable_mock_review_ledger',shopCode:S,eventId:E,eventDigest:D,evidenceDigest:H,reviewerId:id,reviewStatus:'quarantine_audit_recorded'});
 const p={reviewers:[reviewer('reviewer_a'),reviewer('reviewer_b')],signoffs:[sign('reviewer_a'),sign('reviewer_b')],...o};
 const mod=createCar02OfflineDualReviewR475({expectedShopCode:p.expectedShop??S,
  nowMs:()=>p.now??1800000001000,
  authorizeAuditor:async()=>{if(p.throw==='auditor')throw Error('offline');return{verified:true,mode:'isolated_qa',role:'dual_review_auditor',shopCode:S,...p.auditor}},
  inspectIsolation:async()=>{if(p.throw==='isolation')throw Error('offline');return{verified:true,environment:'disposable_pg17_or_offline_mock',testOnly:true,...p.isolation}},
  readQuarantine:async()=>{calls.q++;if(p.throw==='quarantine')throw Error('offline');return{source:'disposable_mock_quarantine',shopCode:S,eventId:E,eventDigest:D,quarantineReason:'manual_hold',reviewState:'quarantined_review_only',evidenceDigest:H,...p.quarantine}},
  readReviewers:async()=>{calls.r++;if(p.throw==='reviewers')throw Error('offline');return p.reviewers},
  readSignoffs:async()=>{calls.s++;if(p.throw==='signoffs')throw Error('offline');return p.signoffs}});
 return {mod,calls,p};
}
const run=async(o={},i={})=>{let x=factory(o);return{...x,res:await x.mod.inspect({eventId:E,eventDigest:D,evidenceDigest:H,...i})}};
function locked(res){assert.equal(res.status,'no_go');assert.equal(res.classification,'quarantine_review_only');assert.ok(Object.isFrozen(res));
 for(const f of ['releasePermitted','writeAuthorized','jobDispatched','realWebhookAcknowledged','lineDeliveryProven','realProviderVerified','quarantineLifted','realBusinessWrites'])assert.equal(res[f],false);
 assert.equal('reviewerIds' in res,false);assert.equal('recoveryToken' in res,false);}
test('hard release lock',()=>assert.equal(CAR02_V475_RELEASE_LOCK,true));
test('mandatory external isolated readers',()=>assert.throws(()=>createCar02OfflineDualReviewR475(),/READERS_REQUIRED/));
test('happy review still NO_GO with 2',async()=>{let x=await run();locked(x.res);assert.equal(x.res.reviewersObserved,2);assert.deepEqual(x.calls,{q:1,r:1,s:1});});
test('nothing can unlock quarantine',async()=>{let x=await run();locked(x.res);assert.equal(x.res.reason,'two_independent_mock_reviews_recorded_still_no_go');});
test('bad constructor shop refused',()=>assert.throws(()=>factory({expectedShop:'qa shop'}),/READERS_REQUIRED/));
test('scope fixed by constructor',async()=>{let x=await run({}, {shopCode:'qa_shop_b'});locked(x.res);assert.equal(x.mod.scopedShopCode,S);});
test('invalid event refused before reads',async()=>{let x=await run({}, {eventId:'not-an-event'});locked(x.res);assert.equal(x.calls.q,0);});
test('invalid digest refused before reads',async()=>{let x=await run({}, {eventDigest:'A'.repeat(64)});locked(x.res);assert.equal(x.calls.q,0);});
test('invalid evidence refused before reads',async()=>{let x=await run({}, {evidenceDigest:'hello'});locked(x.res);assert.equal(x.calls.q,0);});
test('missing reviewer refuses',async()=>{let x=await run({reviewers:[]});locked(x.res);assert.equal(x.res.reason,'two_independent_reviews_missing');});
test('missing second signoff refuses',async()=>{let x=await run({signoffs:[]});locked(x.res);});
test('two signoffs from same person refused',async()=>{let f=factory(),x=await run({signoffs:[f.p.signoffs[0],f.p.signoffs[0]]});locked(x.res);assert.equal(x.res.reason,'review_attestation_mismatch');});
test('one person acting as two reviewers refused',async()=>{let f=factory(),x=await run({reviewers:[f.p.reviewers[0],f.p.reviewers[0]]});locked(x.res);assert.equal(x.res.reason,'independent_reviewer_unverified');});
test('unknown signed reviewer denied',async()=>{let f=factory();let x=await run({signoffs:[f.p.signoffs[0],{...f.p.signoffs[1],reviewerId:'reviewer_x'}]});locked(x.res);});
test('second reviewer inactive',async()=>{let f=factory();let x=await run({reviewers:[f.p.reviewers[0],{...f.p.reviewers[1],active:false}]});locked(x.res);});
test('second reviewer not independently verified',async()=>{let f=factory();let x=await run({reviewers:[f.p.reviewers[0],{...f.p.reviewers[1],independent:false}]});locked(x.res);});
test('second reviewer wrong shop denied',async()=>{let f=factory();let x=await run({reviewers:[f.p.reviewers[0],{...f.p.reviewers[1],shopCode:'qa_shop_b'}]});locked(x.res);});
test('second reviewer extra metadata denied',async()=>{let f=factory();let x=await run({reviewers:[f.p.reviewers[0],{...f.p.reviewers[1],businessApproved:true}]});locked(x.res);});
test('second signoff shop forged refused',async()=>{let f=factory();let x=await run({signoffs:[f.p.signoffs[0],{...f.p.signoffs[1],shopCode:'qa_shop_b'}]});locked(x.res);});
test('second signoff digest forged refused',async()=>{let f=factory();let x=await run({signoffs:[f.p.signoffs[0],{...f.p.signoffs[1],eventDigest:'c'.repeat(64)}]});locked(x.res);});
test('second signoff evidence forged refused',async()=>{let f=factory();let x=await run({signoffs:[f.p.signoffs[0],{...f.p.signoffs[1],evidenceDigest:'c'.repeat(64)}]});locked(x.res);});
test('second signoff status forged refused',async()=>{let f=factory();let x=await run({signoffs:[f.p.signoffs[0],{...f.p.signoffs[1],reviewStatus:'release_granted'}]});locked(x.res);});
test('second signoff extra release field refused',async()=>{let f=factory();let x=await run({signoffs:[f.p.signoffs[0],{...f.p.signoffs[1],releaseApproved:true}]});locked(x.res);});
test('quarantine not recorded refused',async()=>{let x=await run({quarantine:{reviewState:'pending'}});locked(x.res);assert.equal(x.calls.r,0);});
test('quarantine mismatched evidence refused',async()=>{let x=await run({quarantine:{evidenceDigest:'c'.repeat(64)}});locked(x.res);});
test('quarantine mismatched tenant refused',async()=>{let x=await run({quarantine:{shopCode:'qa_shop_b'}});locked(x.res);});
test('quarantine record leaked field refused',async()=>{let x=await run({quarantine:{customerPhone:'123456'}});locked(x.res);});
test('invalid time refused',async()=>{let x=await run({now:0});locked(x.res);});
test('unverified auditor refused before reads',async()=>{let x=await run({auditor:{verified:false}});locked(x.res);assert.equal(x.calls.q,0);});
test('wrong auditor shop refused before reads',async()=>{let x=await run({auditor:{shopCode:'qa_shop_b'}});locked(x.res);assert.equal(x.calls.q,0);});
test('real production environment refused',async()=>{let x=await run({isolation:{environment:'production'}});locked(x.res);assert.equal(x.calls.q,0);});
test('failed auditor isolation readers fail closed',async()=>{for(let name of ['auditor','isolation','quarantine','reviewers','signoffs']){let x=await run({throw:name});locked(x.res);}});
test('invalid reviewer identifier denied',async()=>{let f=factory();let x=await run({reviewers:[f.p.reviewers[0],{...f.p.reviewers[1],reviewerId:'reviewer_b;drop'}]});locked(x.res);});
