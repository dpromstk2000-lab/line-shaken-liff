/**
 * CAR02 V4.79 — Offline evidence chain audit (NOT real compliance evidence).
 * All fixtures are synthetic, unverified and non-authorizing. The SHA-256 chain
 * detects fixture edits but does not authenticate people/providers or prove source custody.
 * No real Supabase, LINE, production data, network calls, DB, writes or GO.
 */
import {createHash} from 'node:crypto';
import {CAR02_V478_PROOF_KEYS} from './car02-staging-boundary-preflight-r478.mjs';
export const CAR02_V479_RELEASE_LOCK=true;
export const CAR02_V479_BRANCH='car02-v434-review-only';
export const CAR02_V479_BASELINE='487e194b1c610f14dffce5ee84f665d67eb70838';
export const CAR02_V479_PROOFS=Object.freeze([...CAR02_V478_PROOF_KEYS]);
export const CAR02_V479_MAX_AGE_MS=86400000;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const SEED='0'.repeat(64);
const fields=(x,ks)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype&&
 Object.keys(x).sort().join('|')===ks.slice().sort().join('|');
const OUT=(reason,receiptsChecked=0)=>Object.freeze({status:'no_go',reason,
 classification:'synthetic_evidence_chain_only_not_provider_or_owner_proof',
 releasePermitted:false,businessWritesAuthorized:false,lineDispatchAuthorized:false,
 realStagingVerified:false,realOwnerApproved:false,realProviderProofsVerified:0,
 realProofsMissing:Object.freeze([...CAR02_V479_PROOFS]),receiptsChecked,
 nextAction:'request_separate_owner_approved_isolated_staging_and_real_evidence'});
export function createCar02OfflineReceiptDigestR479({shopCode,baseline,proofKey,index,recordedAtMs,previousDigest}={}){
 if(!SHOP.test(shopCode??'')||baseline!==CAR02_V479_BASELINE||
  !CAR02_V479_PROOFS.includes(proofKey)||!Number.isSafeInteger(index)||index<0||index>=7||
  !Number.isSafeInteger(recordedAtMs)||recordedAtMs<1||!DIGEST.test(previousDigest??''))
   throw Error('CAR02_V479_SYNTHETIC_DIGEST_INPUT_INVALID');
 return createHash('sha256').update(JSON.stringify(['CAR02_V479_OFFLINE_FIXTURE',shopCode,baseline,proofKey,index,recordedAtMs,previousDigest]),'utf8').digest('hex');
}
function checkChain(x,shop,now){
 if(!fields(x,['source','shopCode','reviewBranch','baselineSha','capturedAtMs','receipts'])||
  x.source!=='offline_fixture_receipt_chain'||x.shopCode!==shop||x.reviewBranch!==CAR02_V479_BRANCH||
  x.baselineSha!==CAR02_V479_BASELINE||!Number.isSafeInteger(x.capturedAtMs)||
  x.capturedAtMs>now||now-x.capturedAtMs>CAR02_V479_MAX_AGE_MS||
  !Array.isArray(x.receipts)||x.receipts.length!==7)return 'fixture_envelope_untrusted';
 let previous=SEED,lastTime=0;const seen=new Set();
 for(let index=0;index<x.receipts.length;index++){
  let r=x.receipts[index];
  if(!fields(r,['key','index','recordedAtMs','previousDigest','digest','state','evidenceClass'])||
   r.key!==CAR02_V479_PROOFS[index]||seen.has(r.key)||r.index!==index||
   r.state!=='unverified'||r.evidenceClass!=='offline_fixture'||
   !Number.isSafeInteger(r.recordedAtMs)||r.recordedAtMs<lastTime||
   r.recordedAtMs>x.capturedAtMs||x.capturedAtMs-r.recordedAtMs>CAR02_V479_MAX_AGE_MS||
   r.previousDigest!==previous||!DIGEST.test(r.digest??''))return 'fixture_receipt_untrusted';
  const actual=createCar02OfflineReceiptDigestR479({shopCode:shop,baseline:CAR02_V479_BASELINE,
    proofKey:r.key,index,recordedAtMs:r.recordedAtMs,previousDigest:previous});
  if(actual!==r.digest)return 'fixture_receipt_digest_mismatch';
  seen.add(r.key);lastTime=r.recordedAtMs;previous=r.digest;
 }
 return null;
}
/** Read-only adapter contract. Never grant a token/capability, even on full fixture match. */
export function createCar02OfflineStagingEvidenceChainAuditorR479({expectedShopCode,authorizeAuditor,inspectIsolation,readReceiptChain,nowMs}={}){
 if(!SHOP.test(expectedShopCode??'')||![authorizeAuditor,inspectIsolation,readReceiptChain,nowMs].every(v=>typeof v==='function'))
  throw Error('CAR02_V479_OFFLINE_ADAPTERS_REQUIRED');
 return Object.freeze({inspect:async({request}={})=>{
  let identity,isolation,now,record;
  try{now=nowMs();if(!Number.isSafeInteger(now)||now<1) return OUT('invalid_clock');
   [identity,isolation]=await Promise.all([authorizeAuditor({request}),inspectIsolation()]);}
  catch{return OUT('auditor_or_isolation_unavailable');}
  if(!fields(identity,['verified','role','mode','shopCode'])||identity.verified!==true||
   identity.role!=='staging_evidence_auditor'||identity.mode!=='isolated_qa'||identity.shopCode!==expectedShopCode||
   !fields(isolation,['verified','environment','testOnly','providerCallsEnabled'])||isolation.verified!==true||
   isolation.environment!=='offline_mock_only'||isolation.testOnly!==true||isolation.providerCallsEnabled!==false)
     return OUT('auditor_or_isolation_untrusted');
  try{record=await readReceiptChain({shopCode:expectedShopCode,baselineSha:CAR02_V479_BASELINE});}
  catch{return OUT('receipt_chain_unavailable');}
  try{let bad=checkChain(record,expectedShopCode,now);if(bad)return OUT(bad);
   return OUT('seven_offline_receipts_consistent_but_zero_real_proofs',record.receipts.length);}
  catch{return OUT('receipt_chain_untrusted');}
 }});
}
