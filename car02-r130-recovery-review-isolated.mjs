/**
 * DPRO CAR02 R130 - strictly read-only, offline recovery authorization PREVIEW.
 * No automatic lock removal, witness updates, pin publication, DB/Storage or deployment.
 * A dual signed approval is advisory evidence only; release NO_GO / migration HOLD.
 * Requires externally trusted signer keys and an independently provided prior pin.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,createPublicKey,verify} from 'node:crypto';
import {inspectIndependentEscrow,receiptHash} from './car02-r128-witness-escrow-isolated.mjs';
import {checkpointHash} from './car02-r127-independent-trust-isolated.mjs';

export const R130_POLICY=Object.freeze({version:'R130',scope:'SYNTHETIC_OFFLINE_REVIEW_ONLY',release:'NO_GO',migration:'HOLD',productionReady:false,modifiesFiles:false,canClearLock:false,realExternalWitnesses:false,realAuthTested:false});
const W=['witnessA','witnessB'];
const ROLES=['operator','auditor'];
const fail=code=>{throw new Error(`R130_${code}`)};
const requireOk=(value,code)=>{if(!value)fail(code)};
const hash=value=>createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const isHex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const keys=(v,expected)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===expected.slice().sort().join('|');

function readonlyRoot(root){
 requireOk(process.env.CAR02_RELEASE_LOCK==='true'&&process.env.R130_OFFLINE_QA==='yes'&&process.env.R129_OFFLINE_QA==='yes','ISOLATION_REQUIRED');
 requireOk(typeof root==='string'&&path.isAbsolute(root),'ROOT_UNSAFE');
 let actual,tmp;
 try{actual=fs.realpathSync(root);tmp=fs.realpathSync(os.tmpdir())}catch{fail('ROOT_MISSING')}
 requireOk(path.dirname(actual)===tmp&&path.basename(actual).startsWith('car02-r129-'),'ROOT_UNSAFE');
 return actual;
}
function readFile(root,name){
 const p=path.join(root,name);
 let st;
 try{st=fs.lstatSync(p)}catch{fail('MISSING_FILE')}
 requireOk(st.isFile()&&!st.isSymbolicLink()&&st.size>0&&st.size<=1_000_000,'UNSAFE_FILE');
 try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{fail('INVALID_JSON')}
}
function lockState(root){
 const lock=path.join(root,'.r129-lock');
 try{
  const stat=fs.lstatSync(lock);
  requireOk(stat.isDirectory()&&!stat.isSymbolicLink(),'UNSAFE_LOCK');
  return 'PRESENT_MANUAL_HOLD';
 }catch(e){if(e?.code==='ENOENT')return 'ABSENT';throw e}
}
function checkInputs({operationId,registryRecords,newReceipts,nowMs}){
 requireOk(typeof operationId==='string'&&/^r129-[a-z0-9-]{5,64}$/.test(operationId),'OPERATION_ID');
 requireOk(Array.isArray(registryRecords)&&registryRecords.length>=2&&registryRecords.length<=100,'REGISTRY');
 requireOk(keys(newReceipts,W),'NEW_RECEIPTS');
 requireOk(Number.isSafeInteger(nowMs)&&nowMs>=0,'CLOCK');
}
/** Read current disk state without changing intent.json, witness files, lock or pins. */
export function prepareManualRecoveryReview({root,operationId,registryRecords,trustedAuditors,r127Pin,trustedWitnesses,minimumWitnessPin,nowMs,newReceipts}){
 checkInputs({operationId,registryRecords,newReceipts,nowMs});
 const dir=readonlyRoot(root);
 const intent=readFile(dir,'intent.json');
 const policy={release:'NO_GO',migration:'HOLD',productionReady:false,realExternalWitnesses:false,realAuthTested:false,realDBTested:false};
 requireOk(intent&&intent.version==='R129'&&intent.operationId===operationId&&intent.status==='PENDING'&&intent.epoch===registryRecords.length&&Object.entries(policy).every(([k,v])=>intent[k]===v),'PENDING_INTENT_REQUIRED');
 const current=Object.fromEntries(W.map(w=>[w,readFile(dir,`${w}.json`)]));
 const base={},projected={};
 for(const w of W){
  requireOk(Array.isArray(current[w])&&[registryRecords.length-1,registryRecords.length].includes(current[w].length),'UNEXPECTED_EPOCH');
  base[w]=current[w].slice(0,registryRecords.length-1);
  projected[w]=[...base[w],newReceipts[w]];
  requireOk(same(current[w],base[w])||same(current[w],projected[w]),'WITNESS_CONFLICT');
 }
 // Validate the unchanged, externally pinned baseline AND the intended signed new state.
 inspectIndependentEscrow({registryRecords:registryRecords.slice(0,-1),trustedAuditors,r127Pin,receiptChains:base,trustedWitnesses,minimumWitnessPin,nowMs});
 inspectIndependentEscrow({registryRecords,trustedAuditors,r127Pin,receiptChains:projected,trustedWitnesses,minimumWitnessPin,nowMs});
 const fingerprint=hash({version:'R129',operationId,registryRecords,projected});
 requireOk(isHex(intent.fingerprint)&&intent.fingerprint===fingerprint,'INTENT_MISMATCH');
 const nextPin={epoch:registryRecords.length,registryHead:checkpointHash(registryRecords.at(-1)),receiptHashes:Object.fromEntries(W.map(w=>[w,receiptHash(projected[w].at(-1))]))};
 const stages=Object.fromEntries(W.map(w=>[w,current[w].length===registryRecords.length?'ADVANCED':'BASELINE']));
 const locked=lockState(dir);
 const core={version:'R130',operationId,epoch:registryRecords.length,priorPin:minimumWitnessPin,nextPin,stages,lockState:locked,intentFingerprint:intent.fingerprint,
  stateHashes:{intent:hash(intent),witnessA:hash(current.witnessA),witnessB:hash(current.witnessB)},createdAtMs:nowMs,expiresAtMs:nowMs+300_000};
 requireOk(Number.isSafeInteger(core.expiresAtMs),'CLOCK');
 return {...core,digest:hash(core),status:'PENDING_DUAL_REVIEW',manualReplayEligible:locked==='ABSENT',independentlyUpdatedPin:false,...R130_POLICY};
}

/** The signed approval binds the reviewer role to the exact snapshot and time. */
export function recoveryApprovalMessage({proposal,role,issuedAtMs}){
 requireOk(keys({role,issuedAtMs},['role','issuedAtMs'])&&ROLES.includes(role),'ROLE');
 requireOk(proposal?.version==='R130'&&isHex(proposal.digest),'PROPOSAL');
 requireOk(Number.isSafeInteger(issuedAtMs)&&issuedAtMs>=proposal.createdAtMs&&issuedAtMs<=proposal.expiresAtMs,'APPROVAL_TIME');
 return JSON.stringify({domain:'CAR02_R130_OFFLINE_RECOVERY_REVIEW_V1',role,proposalDigest:proposal.digest,issuedAtMs});
}
function trustedKey(registry,role,nowMs){
 requireOk(keys(registry,ROLES),'REVIEWER_REGISTRY');
 const value=registry[role];
 requireOk(keys(value,['publicKey','revokedAtMs'])&&(value.revokedAtMs===null||Number.isSafeInteger(value.revokedAtMs)),'REVIEWER_REGISTRY');
 requireOk(value.revokedAtMs===null||value.revokedAtMs>nowMs,'REVIEWER_REVOKED');
 let key;
 try{key=createPublicKey(value.publicKey)}catch{fail('REVIEWER_KEY')}
 requireOk(key.asymmetricKeyType==='ed25519','REVIEWER_KEY');
 return key;
}
/** Re-read all source files, reject TOCTOU, then verify two distinct signatures. */
export function verifyDualRecoveryReview({proposal,approvals,trustedReviewers,nowMs,...context}){
 requireOk(proposal?.version==='R130'&&proposal?.status==='PENDING_DUAL_REVIEW'&&proposal?.release==='NO_GO'&&proposal?.migration==='HOLD','PROPOSAL');
 requireOk(Number.isSafeInteger(nowMs)&&nowMs>=proposal.createdAtMs&&nowMs<=proposal.expiresAtMs,'REVIEW_EXPIRED');
 const latest=prepareManualRecoveryReview({...context,nowMs:proposal.createdAtMs});
 requireOk(same(latest,proposal),'SNAPSHOT_CHANGED');
 // Recheck evidence lifetimes at the actual approval time, not only proposal time.
 const current=prepareManualRecoveryReview({...context,nowMs});
 requireOk(same(latest.stateHashes,current.stateHashes)&&same(latest.stages,current.stages)&&latest.lockState===current.lockState,'SNAPSHOT_CHANGED');
 requireOk(keys(approvals,ROLES),'APPROVAL_SET');
 const k1=trustedKey(trustedReviewers,'operator',nowMs),k2=trustedKey(trustedReviewers,'auditor',nowMs);
 requireOk(!k1.export({type:'spki',format:'der'}).equals(k2.export({type:'spki',format:'der'})),'SAME_REVIEWER_KEY');
 for(const role of ROLES){
  const a=approvals[role];
  requireOk(keys(a,['role','issuedAtMs','signature'])&&a.role===role&&typeof a.signature==='string'&&/^[A-Za-z0-9_-]{80,100}$/.test(a.signature),'APPROVAL_SHAPE');
  requireOk(a.issuedAtMs<=nowMs,'APPROVAL_IN_FUTURE');
  const message=recoveryApprovalMessage({proposal,role,issuedAtMs:a.issuedAtMs});
  let ok=false;
  try{ok=verify(null,Buffer.from(message),role==='operator'?k1:k2,Buffer.from(a.signature,'base64url'))}catch{}
  requireOk(ok,'INVALID_SIGNATURE');
 }
 return {status:'DUAL_REVIEWED_STILL_HOLD',operationId:proposal.operationId,epoch:proposal.epoch,digest:proposal.digest,
  manualReplayEligible:proposal.lockState==='ABSENT',independentPinPublicationRequired:true,externalStoreVerificationRequired:true,
  lockRemovalAuthorized:false,automaticRecoveryAuthorized:false,...R130_POLICY};
}
