import test from 'node:test';
import assert from 'node:assert/strict';
import {CAR02_V477_RELEASE_LOCK,CAR02_V477_REVIEW_BRANCH,CAR02_V477_BASELINE_COMMIT,
 CAR02_V477_BASELINE_CI_RUN,CAR02_V477_PROOF_KEYS,createCar02OfflineCommercialGapAssessorR477}
 from './car02-commercial-gap-audit-r477.mjs';
const SHOP='qa_shop_a';
const ci=()=>({source:'isolated_mock_ci_metadata',reviewBranch:CAR02_V477_REVIEW_BRANCH,
 headSha:CAR02_V477_BASELINE_COMMIT,runId:CAR02_V477_BASELINE_CI_RUN,
 conclusion:'success',nodeTests:849,nodeFailed:0,releaseLock:true});
const claims=()=>CAR02_V477_PROOF_KEYS.map(key=>({key,state:'unverified',evidenceClass:'none'}));
function setup(o={}){
 const calls={ci:0,gaps:0};
 const service=createCar02OfflineCommercialGapAssessorR477({expectedShopCode:o.shop??SHOP,
  authorizeAuditor:async()=>{if(o.throw==='auditor')throw Error('offline');return {verified:true,role:'commercial_gap_auditor',mode:'isolated_qa',shopCode:SHOP,...o.auditor}},
  inspectIsolation:async()=>{if(o.throw==='isolation')throw Error('offline');return {verified:true,testOnly:true,environment:'offline_mock_only',...o.isolation}},
  readBaselineCI:async()=>{calls.ci++;if(o.throw==='ci')throw Error('offline');return o.ci===undefined?ci():o.ci},
  readProofClaims:async()=>{calls.gaps++;if(o.throw==='gaps')throw Error('offline');return o.claims===undefined?claims():o.claims}});
 return {service,calls};
}
const exec=async(o={})=>{const a=setup(o);return{result:await a.service.inspect({request:{shopCode:'qa_shop_b',releasePermitted:true}}),...a}};
function locked(r){
 assert.ok(Object.isFrozen(r));assert.equal(r.status,'no_go');
 assert.equal(r.classification,'offline_ci_is_not_commercial_evidence');
 for(const k of ['releasePermitted','businessWritesAuthorized','lineDispatchAuthorized','quarantineLifted','realProviderEvidenceVerified','realHumanApprovalVerified'])assert.equal(r[k],false);
 assert.equal(r.verifiedProofCount,0);assert.ok(Object.isFrozen(r.unverifiedProofs));
 assert.deepEqual(r.unverifiedProofs,CAR02_V477_PROOF_KEYS);
 assert.equal('serviceRole' in r,false);assert.equal('goToken' in r,false);
}
test('V477 release lock is true',()=>assert.equal(CAR02_V477_RELEASE_LOCK,true));
test('exactly seven independent commercial proofs',()=>assert.equal(CAR02_V477_PROOF_KEYS.length,7));
test('proof keys are immutable',()=>assert.ok(Object.isFrozen(CAR02_V477_PROOF_KEYS)));
test('all adapters mandatory',()=>assert.throws(()=>createCar02OfflineCommercialGapAssessorR477(),/ADAPTERS_REQUIRED/));
test('invalid fixed shop rejected',()=>assert.throws(()=>createCar02OfflineCommercialGapAssessorR477({expectedShopCode:'bad shop'}),/ADAPTERS_REQUIRED/));
test('successful mock baseline still NO_GO',async()=>{const v=await exec();locked(v.result);assert.equal(v.result.reason,'seven_real_commercial_proofs_still_unverified');assert.equal(v.result.baselineObserved,true);assert.deepEqual(v.calls,{ci:1,gaps:1});});
test('request-controlled shop cannot override scope',async()=>{const x=setup();assert.equal(x.service.scopedShopCode,SHOP);const r=await x.service.inspect({request:{shopCode:'evil'}});locked(r);});
test('mock proof claims cannot unlock release',async()=>{const v=await exec({claims:claims().map(x=>({...x,state:'mock_claim_only',evidenceClass:'offline_fixture'}))});locked(v.result);assert.equal(v.result.verifiedProofCount,0);});
test('missing all proof claims still NO_GO',async()=>{const v=await exec({claims:claims().map(x=>({...x,state:'missing'}))});locked(v.result);});
test('unverified auditor denied before reading CI',async()=>{const v=await exec({auditor:{verified:false}});locked(v.result);assert.equal(v.calls.ci,0);});
test('wrong auditor role denied',async()=>{const v=await exec({auditor:{role:'admin'}});locked(v.result);});
test('wrong tenant auditor denied',async()=>{const v=await exec({auditor:{shopCode:'qa_shop_b'}});locked(v.result);});
test('real mode auditor denied',async()=>{const v=await exec({auditor:{mode:'production'}});locked(v.result);});
test('real provider isolation forbidden',async()=>{const v=await exec({isolation:{environment:'production'}});locked(v.result);});
test('non test-only isolation forbidden',async()=>{const v=await exec({isolation:{testOnly:false}});locked(v.result);});
test('CI run from stale SHA denied',async()=>{const v=await exec({ci:{...ci(),headSha:'a'.repeat(40)}});locked(v.result);assert.equal(v.result.reason,'baseline_ci_stale_or_untrusted');assert.equal(v.calls.gaps,0);});
test('CI from different branch denied',async()=>{const v=await exec({ci:{...ci(),reviewBranch:'main'}});locked(v.result);});
test('unsuccessful CI denied',async()=>{const v=await exec({ci:{...ci(),conclusion:'failure'}});locked(v.result);});
test('uncompleted CI denied',async()=>{const v=await exec({ci:{...ci(),conclusion:'in_progress'}});locked(v.result);});
test('lower count CI denied',async()=>{const v=await exec({ci:{...ci(),nodeTests:848}});locked(v.result);});
test('CI with one failure denied',async()=>{const v=await exec({ci:{...ci(),nodeFailed:1}});locked(v.result);});
test('wrong CI run ID denied',async()=>{const v=await exec({ci:{...ci(),runId:CAR02_V477_BASELINE_CI_RUN-1}});locked(v.result);});
test('release unlocked baseline denied',async()=>{const v=await exec({ci:{...ci(),releaseLock:false}});locked(v.result);});
test('faked real CI source denied',async()=>{const v=await exec({ci:{...ci(),source:'production_verified'}});locked(v.result);});
test('CI extra field rejected',async()=>{const v=await exec({ci:{...ci(),approve:true}});locked(v.result);});
test('missing proof key denied',async()=>{const v=await exec({claims:claims().slice(1)});locked(v.result);assert.equal(v.result.reason,'proof_inventory_untrusted');});
test('duplicate proof key denied',async()=>{const c=claims();c[1]={...c[1],key:c[0].key};const v=await exec({claims:c});locked(v.result);});
test('unrecognized proof key denied',async()=>{const c=claims();c[0]={...c[0],key:'can_release'};const v=await exec({claims:c});locked(v.result);});
test('untrusted actual verification claim denied',async()=>{const c=claims();c[0]={...c[0],state:'verified'};const v=await exec({claims:c});locked(v.result);assert.equal(v.result.reason,'proof_inventory_untrusted');});
test('live evidence class denied',async()=>{const c=claims();c[0]={...c[0],evidenceClass:'production_token'};const v=await exec({claims:c});locked(v.result);});
test('proof claim with authorization field denied',async()=>{const c=claims();c[0]={...c[0],releasePermitted:true};const v=await exec({claims:c});locked(v.result);});
test('null proof array denied',async()=>{const v=await exec({claims:null});locked(v.result);});
test('all read adapters fail closed',async()=>{for(const name of ['auditor','isolation','ci','gaps']){const v=await exec({throw:name});locked(v.result);}});
