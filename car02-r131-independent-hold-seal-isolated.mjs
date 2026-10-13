/**
 * DPRO CAR02 R131 -- detached offline witness seal on a current R130 HOLD review.
 * READ ONLY: no unlock/replay, no release, no witness writes, no network or DB.
 * The trusted seal key, fresh challenge and previous minimum pin MUST be supplied
 * through an independent trusted channel. CI does NOT establish such a channel.
 * No test can prove live author identity, durable anchoring or a trusted clock.
 */
import {createHash,createPublicKey,verify} from 'node:crypto';
import {prepareManualRecoveryReview,verifyDualRecoveryReview} from './car02-r130-recovery-review-isolated.mjs';
const fail=c=>{throw Error(`R131_${c}`)};
const must=(ok,c)=>{if(!ok)fail(c)};
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const fields=(obj,ks,c)=>must(obj&&typeof obj==='object'&&!Array.isArray(obj)&&Object.keys(obj).length===ks.length&&ks.every(k=>own(obj,k)),c);
const HEX=/^[a-f0-9]{64}$/;
const hash=x=>createHash('sha256').update(JSON.stringify(x),'utf8').digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const KEY_FIELDS=['operator','auditor'];
const POLICY=Object.freeze({version:'R131',scope:'OFFLINE_SIGNED_HOLD_EVIDENCE_ONLY',release:'NO_GO',migration:'HOLD',productionReady:false,automaticRecoveryAuthorized:false,lockRemovalAuthorized:false,externalStorageTested:false,realIdentityTested:false});
export const R131_POLICY=POLICY;
const PAYLOAD_FIELDS=['domain','proposalDigest','reviewDigest','operationId','epoch','stateHashes','baselinePinDigest','challenge','issuedAtMs','expiresAtMs','version','scope','release','migration','productionReady','automaticRecoveryAuthorized','lockRemovalAuthorized','externalStorageTested','realIdentityTested'];
function publicKey(value){
 let k;try{k=createPublicKey(value)}catch{fail('TRUSTED_KEY')}
 must(k.asymmetricKeyType==='ed25519','TRUSTED_KEY');
 return k;
}
const keyBytes=k=>k.export({type:'spki',format:'der'}).toString('base64');
/** Canonical test payload. A real seal must be signed OUTSIDE this verifier. */
export function buildDetachedHoldPayload({proposal,verifiedReview,independentPriorPin,challenge,issuedAtMs,expiresAtMs}){
 must(proposal?.version==='R130'&&HEX.test(proposal.digest)&&proposal.release==='NO_GO'&&proposal.migration==='HOLD'&&proposal.status==='PENDING_DUAL_REVIEW','PROPOSAL');
 must(verifiedReview?.version==='R130'&&verifiedReview.status==='DUAL_REVIEWED_STILL_HOLD'&&verifiedReview.release==='NO_GO'&&verifiedReview.migration==='HOLD'&&verifiedReview.automaticRecoveryAuthorized===false&&verifiedReview.lockRemovalAuthorized===false&&verifiedReview.digest===proposal.digest,'REVIEW');
 must(HEX.test(challenge),'CHALLENGE');
 fields(independentPriorPin,['epoch','registryHead','receiptHashes'],'PRIOR_PIN');
 fields(independentPriorPin.receiptHashes,['witnessA','witnessB'],'PRIOR_PIN');
 must(Number.isSafeInteger(independentPriorPin.epoch)&&independentPriorPin.epoch>=1&&HEX.test(independentPriorPin.registryHead)&&HEX.test(independentPriorPin.receiptHashes.witnessA)&&HEX.test(independentPriorPin.receiptHashes.witnessB),'PRIOR_PIN');
 must(same(independentPriorPin,proposal.priorPin),'PRIOR_PIN_MISMATCH');
 must(Number.isSafeInteger(issuedAtMs)&&Number.isSafeInteger(expiresAtMs)&&issuedAtMs>=proposal.createdAtMs&&expiresAtMs>issuedAtMs&&expiresAtMs<=proposal.expiresAtMs&&expiresAtMs-issuedAtMs<=60_000,'SEAL_WINDOW');
 const data={domain:'CAR02_R131_DETACHED_HOLD_SEAL_V1',proposalDigest:proposal.digest,reviewDigest:hash(verifiedReview),operationId:proposal.operationId,epoch:proposal.epoch,stateHashes:proposal.stateHashes,baselinePinDigest:hash(independentPriorPin),challenge,issuedAtMs,expiresAtMs,...POLICY};
 fields(data,PAYLOAD_FIELDS,'PAYLOAD_SHAPE');
 return data;
}
/** Re-verify R130 signed reviewer quorum and current read-only disk snapshot before trusting witness. */
export function verifyDetachedHoldSeal({proposal,approvals,trustedReviewers,context,seal,trustedSealKey,independentPriorPin,expectedChallenge,nowMs}){
 must(process.env.CAR02_RELEASE_LOCK==='true'&&process.env.R129_OFFLINE_QA==='yes'&&process.env.R130_OFFLINE_QA==='yes'&&process.env.R131_OFFLINE_QA==='yes','ISOLATION_REQUIRED');
 must(Number.isSafeInteger(nowMs)&&nowMs>=0,'CLOCK');
 must(context&&typeof context==='object'&&!Array.isArray(context),'CONTEXT');
 must(fields(trustedReviewers,KEY_FIELDS,'REVIEWER_TRUST')===undefined,'REVIEWER_TRUST');
 must(HEX.test(expectedChallenge),'EXPECTED_CHALLENGE');
 fields(seal,['payload','signature'],'SEAL_SHAPE');
 fields(seal.payload,PAYLOAD_FIELDS,'SEAL_PAYLOAD');
 must(seal.payload.challenge===expectedChallenge,'CHALLENGE_MISMATCH');
 must(same(independentPriorPin,context.minimumWitnessPin),'TRUSTED_PIN_MISMATCH');
 const reviewed=verifyDualRecoveryReview({proposal,approvals,trustedReviewers,...context,nowMs});
 must(reviewed.status==='DUAL_REVIEWED_STILL_HOLD'&&reviewed.release==='NO_GO'&&reviewed.migration==='HOLD','REVIEW_NOT_HOLD');
 const reconstructed=buildDetachedHoldPayload({proposal,verifiedReview:reviewed,independentPriorPin,challenge:expectedChallenge,issuedAtMs:seal.payload.issuedAtMs,expiresAtMs:seal.payload.expiresAtMs});
 must(same(reconstructed,seal.payload),'SEAL_CONTENT_CHANGED');
 must(nowMs>=seal.payload.issuedAtMs&&nowMs<=seal.payload.expiresAtMs,'SEAL_EXPIRED');
 const sealKey=publicKey(trustedSealKey);
 must(!KEY_FIELDS.some(role=>{
   try{return keyBytes(sealKey)===keyBytes(publicKey(trustedReviewers[role].publicKey))}catch{fail('REVIEWER_TRUST')}
 }),'SEALER_NOT_INDEPENDENT');
 // A third signer must not secretly be one of the two escrow witness identities.
 fields(context.trustedWitnesses,['witnessA','witnessB'],'WITNESS_TRUST');
 must(!['witnessA','witnessB'].some(id=>keyBytes(sealKey)===keyBytes(publicKey(context.trustedWitnesses[id]))),'SEALER_NOT_INDEPENDENT');
 must(typeof seal.signature==='string'&&/^[A-Za-z0-9_-]{80,100}$/.test(seal.signature),'SEAL_SIGNATURE_SHAPE');
 let valid=false;
 try{valid=verify(null,Buffer.from(JSON.stringify(seal.payload)),sealKey,Buffer.from(seal.signature,'base64url'))}catch{}
 must(valid,'SEAL_SIGNATURE');
 // A second complete read prevents accepting a seal if the local files changed during review.
 // This is NOT an atomic snapshot and is NOT a production-grade TOCTOU guarantee.
 const latest=prepareManualRecoveryReview({...context,nowMs:proposal.createdAtMs});
 must(same(latest,proposal),'DISK_CHANGED');
 return {status:'INDEPENDENT_SYNTHETIC_HOLD_SEAL_VERIFIED',operationId:proposal.operationId,epoch:proposal.epoch,proposalDigest:proposal.digest,challenge:expectedChallenge,manualFollowupRequired:true,externalPinPublicationRequired:true,...POLICY};
}
