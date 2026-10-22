import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CAR02_V478_PROOF_KEYS} from './car02-staging-boundary-preflight-r478.mjs';
import {CAR02_V479_RELEASE_LOCK,CAR02_V479_BRANCH,CAR02_V479_BASELINE,
 CAR02_V479_PROOFS,CAR02_V479_MAX_AGE_MS,createCar02OfflineReceiptDigestR479,
 createCar02OfflineStagingEvidenceChainAuditorR479} from './car02-staging-evidence-chain-r479.mjs';
const shop='qa_shop_a',now=1800000000000,base=now-11000;
function chain(){let previousDigest='0'.repeat(64);const receipts=CAR02_V479_PROOFS.map((key,index)=>{
 const recordedAtMs=base+index*1000;
 const digest=createCar02OfflineReceiptDigestR479({shopCode:shop,baseline:CAR02_V479_BASELINE,
  proofKey:key,index,recordedAtMs,previousDigest});
 const receipt={key,index,recordedAtMs,previousDigest,digest,state:'unverified',evidenceClass:'offline_fixture'};
 previousDigest=digest;return receipt;});
 return {source:'offline_fixture_receipt_chain',shopCode:shop,reviewBranch:CAR02_V479_BRANCH,
  baselineSha:CAR02_V479_BASELINE,capturedAtMs:now-1000,receipts};
}
function fixture(o={}){const calls={reads:0,auth:0,isolation:0};const cfg={
 expectedShopCode:o.fixedShop??shop,
 nowMs:()=>o.now===undefined?now:o.now,
 authorizeAuditor:async()=>{calls.auth++;if(o.throw==='auth')throw Error('offline');return{
 verified:true,role:'staging_evidence_auditor',mode:'isolated_qa',shopCode:shop,...o.identity};},
 inspectIsolation:async()=>{calls.isolation++;if(o.throw==='isolation')throw Error('offline');return{
 verified:true,environment:'offline_mock_only',testOnly:true,providerCallsEnabled:false,...o.isolation};},
 readReceiptChain:async({shopCode,baselineSha})=>{calls.reads++;assert.equal(shopCode,shop);
  assert.equal(baselineSha,CAR02_V479_BASELINE);if(o.throw==='chain')throw Error('offline');return o.chain??chain();}
};return {service:createCar02OfflineStagingEvidenceChainAuditorR479(cfg),calls};}
async function inspect(o={},request={shopCode:'other_shop',authorizeRelease:true}){const x=fixture(o);return {...x,result:await x.service.inspect({request})};}
function locked(r){assert.ok(Object.isFrozen(r));assert.equal(r.status,'no_go');
 for(const key of ['releasePermitted','businessWritesAuthorized','lineDispatchAuthorized','realStagingVerified','realOwnerApproved'])assert.equal(r[key],false);
 assert.equal(r.realProviderProofsVerified,0);assert.deepEqual(r.realProofsMissing,CAR02_V478_PROOF_KEYS);
 assert.ok(!('token' in r));assert.ok(!('session' in r));assert.ok(!('evidence' in r));}
test('always locked',()=>assert.equal(CAR02_V479_RELEASE_LOCK,true));
test('proof keys match V478',()=>assert.deepEqual(CAR02_V479_PROOFS,CAR02_V478_PROOF_KEYS));
test('keys frozen',()=>assert.ok(Object.isFrozen(CAR02_V479_PROOFS)));
test('review branch frozen literal',()=>assert.equal(CAR02_V479_BRANCH,'car02-v434-review-only'));
test('TTL is one day',()=>assert.equal(CAR02_V479_MAX_AGE_MS,86400000));
test('baseline belongs to last successful V478',()=>assert.equal(CAR02_V479_BASELINE,'487e194b1c610f14dffce5ee84f665d67eb70838'));
test('adapters required',()=>assert.throws(()=>createCar02OfflineStagingEvidenceChainAuditorR479(),/ADAPTERS_REQUIRED/));
test('invalid shop rejected',()=>assert.throws(()=>createCar02OfflineStagingEvidenceChainAuditorR479({expectedShopCode:'Bad Shop'}),/ADAPTERS_REQUIRED/));
test('valid synthetic seven-receipt chain stays NO_GO',async()=>{const x=await inspect();locked(x.result);assert.equal(x.result.receiptsChecked,7);assert.equal(x.result.reason,'seven_offline_receipts_consistent_but_zero_real_proofs');});
test('request supplied tenant and release flag ignored',async()=>{let x=await inspect();locked(x.result);assert.equal(x.calls.reads,1)});
test('digest deterministic',()=>{const a=chain();assert.equal(a.receipts.length,7);assert.equal(a.receipts[0].previousDigest,'0'.repeat(64));assert.match(a.receipts[6].digest,/^[a-f0-9]{64}$/);});
test('digest invalid shop rejected',()=>assert.throws(()=>createCar02OfflineReceiptDigestR479({shopCode:'bad shop'}),/INVALID/));
test('digest wrong baseline rejected',()=>assert.throws(()=>createCar02OfflineReceiptDigestR479({shopCode:shop,baseline:'fake'}),/INVALID/));
test('digest non-listed proof rejected',()=>assert.throws(()=>createCar02OfflineReceiptDigestR479({shopCode:shop,baseline:CAR02_V479_BASELINE,proofKey:'fake'}),/INVALID/));
test('digest invalid predecessor rejected',()=>assert.throws(()=>createCar02OfflineReceiptDigestR479({shopCode:shop,baseline:CAR02_V479_BASELINE,proofKey:CAR02_V479_PROOFS[0],index:0,recordedAtMs:now,previousDigest:'x'}),/INVALID/));
function changed(f){let x=chain();f(x);return x;}
const cases=[
 ['wrong tenant',x=>x.shopCode='qa_shop_b'],
 ['wrong branch',x=>x.reviewBranch='main'],
 ['wrong commit',x=>x.baselineSha='1'.repeat(40)],
 ['wrong source',x=>x.source='real_service'],
 ['real verified flag injection',x=>x.releasePermitted=true],
 ['secrets injected',x=>x.providerToken='test'],
 ['owner approval injected',x=>x.ownerApproval=true],
 ['empty receipts',x=>x.receipts=[]],
 ['missing receipt',x=>x.receipts.pop()],
 ['extra receipt',x=>x.receipts.push(x.receipts[0])],
 ['wrong order',x=>[x.receipts[0],x.receipts[1]]=[x.receipts[1],x.receipts[0]]],
 ['tampered digest',x=>x.receipts[2].digest='f'.repeat(64)],
 ['tampered predecessor',x=>x.receipts[2].previousDigest='a'.repeat(64)],
 ['claim verified rather than unverified',x=>x.receipts[0].state='verified'],
 ['claim real signed evidence',x=>x.receipts[0].evidenceClass='real_attestation'],
 ['receipt extra field',x=>x.receipts[1].verifiedBy='owner'],
 ['receipt index changed',x=>x.receipts[2].index=6],
 ['timestamp moves backward',x=>x.receipts[2].recordedAtMs=x.receipts[1].recordedAtMs-1],
 ['timestamp after snapshot',x=>x.receipts[6].recordedAtMs=x.capturedAtMs+1],
 ['captured future',x=>x.capturedAtMs=now+1],
 ['captured too old',x=>x.capturedAtMs=now-CAR02_V479_MAX_AGE_MS-1],
 ['record too old',x=>x.receipts[0].recordedAtMs=x.capturedAtMs-CAR02_V479_MAX_AGE_MS-1],
 ['malformed snapshot',x=>x.capturedAtMs='1800000000000'],
 ['missing shop code',x=>delete x.shopCode],
 ['digest uppercase',x=>x.receipts[0].digest=x.receipts[0].digest.toUpperCase()],
 ['receipt null',x=>x.receipts[0]=null],
 ['receipt string',x=>x.receipts[0]='wrong'],
 ['envelope array',x=>x.receipts='wrong'],
 ['replayed fixture with new baseline',x=>x.baselineSha=CAR02_V479_BASELINE.slice(0,-1)+'0']
];
for(const [name,f] of cases)test('fail closed: '+name,async()=>{let x=await inspect({chain:changed(f)});locked(x.result);assert.notEqual(x.result.reason,'seven_offline_receipts_consistent_but_zero_real_proofs');});
for(const [name,o] of [
 ['wrong auditor tenant',{identity:{shopCode:'qa_shop_b'}}],
 ['wrong auditor role',{identity:{role:'admin'}}],
 ['unsigned reviewer',{identity:{verified:false}}],
 ['production env',{isolation:{environment:'production'}}],
 ['provider networking enabled',{isolation:{providerCallsEnabled:true}}],
 ['not test-only',{isolation:{testOnly:false}}],
 ['auditor adapter throws',{throw:'auth'}],
 ['isolation adapter throws',{throw:'isolation'}],
 ['read adapter throws',{throw:'chain'}],
 ['clock invalid',{now:'now'}],
 ['clock missing',{now:0}]
 ])test('boundary denial: '+name,async()=>{let x=await inspect(o);locked(x.result);assert.equal(x.result.receiptsChecked,0);});
test('shop mismatch prevents receipt reads',async()=>{let x=await inspect({identity:{shopCode:'qa_shop_b'}});assert.equal(x.calls.reads,0);locked(x.result);});
test('no report reflects an injected token',async()=>{let x=await inspect({chain:changed(x=>x.receipts[0].token='TOP_SECRET')});locked(x.result);assert.ok(!JSON.stringify(x.result).includes('TOP_SECRET'));});
test('contract never claims real provider or owner',()=>{const c=JSON.parse(readFileSync('car02-v479-staging-evidence-chain-contract.json','utf8'));
 for(const k of ['releasePermitted','realStagingVerified','realOwnerApproved','realProviderVerified','realBusinessWrites','usesProductionCredentials','usesCustomerData'])assert.equal(c[k],false);
 assert.equal(c.requiredRealProofs,7);assert.equal(c.realProofsVerified,0);
 assert.equal(c.baselineNodeTests,916);assert.equal(c.baselineV478CI,39713246494);});
test('Japanese guidance reiterates NO_GO and human approval',()=>{const t=readFileSync('CAR02_V479_REAL_STAGING_NEXT_STEPS.md','utf8');assert.match(t,/NO_GO\/HOLD/);assert.match(t,/オーナー/);});
