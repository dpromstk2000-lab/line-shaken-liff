import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {makeManifest,createSyntheticRows,ephemeralTestKeys} from './car02-r126-signed-chain-isolated.mjs';
import {createCheckpoint,cosignCheckpoint,checkpointHash} from './car02-r127-independent-trust-isolated.mjs';
import {issueSyntheticWitnessReceipt,receiptHash} from './car02-r128-witness-escrow-isolated.mjs';
import {R129_POLICY,applySignedEscrowEpoch,readVerifiedEscrow} from './car02-r129-escrow-recovery-isolated.mjs';
import {createHash,sign} from 'node:crypto';
import {R130_POLICY,prepareManualRecoveryReview,recoveryApprovalMessage,verifyDualRecoveryReview} from './car02-r130-recovery-review-isolated.mjs';

process.env.R129_OFFLINE_QA='yes';process.env.R130_OFFLINE_QA='yes';process.env.R131_OFFLINE_QA='yes';process.env.CAR02_RELEASE_LOCK='true';
const ROOT='0'.repeat(64),t=3_000_000,now=t+10,expires=t+60_000;
const key=()=>generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const auditA=key(),auditB=key(),witA=key(),witB=key(),snapA=ephemeralTestKeys(),snapB=ephemeralTestKeys();
const privateAuditors={auditorA:auditA.privateKey,auditorB:auditB.privateKey};
const trustedAuditors={auditorA:auditA.publicKey,auditorB:auditB.publicKey};
const trustedWitnesses={witnessA:witA.publicKey,witnessB:witB.publicKey};
const witnessPrivate={witnessA:witA.privateKey,witnessB:witB.privateKey};
const records=JSON.parse(execFileSync('node',['car02-r124-r123-fixtures.mjs'],{encoding:'utf8'}));
const rows=createSyntheticRows(records);
const manifestA=makeManifest(rows,{snapshotId:'r126-r129-synthetic-checkpoint-0001',createdAtMs:t,expiresAtMs:expires});
const manifestB=makeManifest(rows,{snapshotId:'r126-r129-synthetic-checkpoint-0002',createdAtMs:t,expiresAtMs:expires});
function checkpoint(epoch,arr,manifest,pub){return cosignCheckpoint(createCheckpoint({epoch,previousHash:arr.length?checkpointHash(arr.at(-1)):ROOT,createdAtMs:t+epoch,expiresAtMs:expires,action:'ANCHOR',manifest,signingPublicKey:pub}),privateAuditors)}
const reg1=checkpoint(1,[],manifestA,snapA.publicKey);
const reg2=checkpoint(2,[reg1],manifestB,snapB.publicKey);
const registryRecords=[reg1,reg2];
const receipts={};const newReceipts={};
for(const w of ['witnessA','witnessB']){
 const genesis=issueSyntheticWitnessReceipt({witnessId:w,epoch:1,registryHead:checkpointHash(reg1),previousReceiptHash:ROOT,observedAtMs:t+1,expiresAtMs:expires},witnessPrivate[w]);
 const next=issueSyntheticWitnessReceipt({witnessId:w,epoch:2,registryHead:checkpointHash(reg2),previousReceiptHash:receiptHash(genesis),observedAtMs:t+2,expiresAtMs:expires},witnessPrivate[w]);
 receipts[w]=[genesis];newReceipts[w]=next;
}
const r127Pin={epoch:1,hash:checkpointHash(reg1)};
const minimumWitnessPin={epoch:1,registryHead:checkpointHash(reg1),receiptHashes:{witnessA:receiptHash(receipts.witnessA[0]),witnessB:receiptHash(receipts.witnessB[0])}};
const publicContext={registryRecords,trustedAuditors,r127Pin,trustedWitnesses,minimumWitnessPin,nowMs:now};
const fixture=()=>fs.mkdtempSync(path.join(os.tmpdir(),'car02-r129-'));
const create=()=>{const root=fixture();for(const w of ['witnessA','witnessB'])fs.writeFileSync(path.join(root,`${w}.json`),JSON.stringify(receipts[w]));return root};
const data=(root,opts={})=>({root,operationId:'r129-safe-escrow-update-001',...publicContext,newReceipts,...opts});
const run=(fn)=>{const root=create();try{return fn(root)}finally{fs.rmSync(root,{recursive:true,force:true})}};
const fault=(fn,code)=>assert.throws(fn,new RegExp(`R129_${code}`));
const verified=root=>readVerifiedEscrow({root,...publicContext});
const copy=x=>structuredClone(x);

const op=key(),aud=key();
const trustedReviewers={operator:{publicKey:op.publicKey,revokedAtMs:null},auditor:{publicKey:aud.publicKey,revokedAtMs:null}};
const reviewCtx=root=>({root,operationId:'r129-safe-escrow-update-001',...publicContext,newReceipts});
const prepare=root=>prepareManualRecoveryReview(reviewCtx(root));
function approve(p,role,privateKey,issuedAtMs=now+1){return {role,issuedAtMs,signature:sign(null,Buffer.from(recoveryApprovalMessage({proposal:p,role,issuedAtMs})),privateKey).toString('base64url')}}
function approved(p){return {operator:approve(p,'operator',op.privateKey),auditor:approve(p,'auditor',aud.privateKey)}}
function assess(root,options={}){const proposal=prepare(root);return verifyDualRecoveryReview({proposal,approvals:approved(proposal),trustedReviewers,...reviewCtx(root),nowMs:now+1,...options})}
const pending=(which,fn)=>run(root=>{assert.throws(()=>applySignedEscrowEpoch(data(root,{injectFailure:which})),/R129_INJECTED/);return fn(root)});
const mutate=x=>JSON.parse(JSON.stringify(x));
const denied=(fn,code)=>assert.throws(fn,new RegExp(`R130_${code}`));
function snapshot(root){return ['intent.json','witnessA.json','witnessB.json'].map(n=>fs.readFileSync(path.join(root,n),'utf8'))}


import {R131_POLICY,buildDetachedHoldPayload,verifyDetachedHoldSeal} from './car02-r131-independent-hold-seal-isolated.mjs';
const sealer=key(),different=key(),CH='ab'.repeat(32);
const sealTrust=sealer.publicKey;
function setup(root,opts={}){
 const proposal=prepare(root),approvals=approved(proposal),context=reviewCtx(root);
 const reviewed=verifyDualRecoveryReview({proposal,approvals,trustedReviewers,...context,nowMs:now+2});
 const payload=buildDetachedHoldPayload({proposal,verifiedReview:reviewed,independentPriorPin:minimumWitnessPin,challenge:CH,issuedAtMs:now+2,expiresAtMs:now+1000});
 const seal={payload,signature:sign(null,Buffer.from(JSON.stringify(payload)),sealer.privateKey).toString('base64url')};
 return {proposal,approvals,trustedReviewers,context,seal,trustedSealKey:sealTrust,independentPriorPin:minimumWitnessPin,expectedChallenge:CH,nowMs:now+3,...opts};
}
const inspect=root=>verifyDetachedHoldSeal(setup(root));
const deny=(fn,code)=>assert.throws(fn,new RegExp(`R131_${code}`));
const state=root=>['intent.json','witnessA.json','witnessB.json'].map(n=>fs.readFileSync(path.join(root,n),'utf8'));
const doPending=(fn,stage='AFTER_A')=>pending(stage,fn);
const contextWith=(x,opts)=>({...x,context:{...x.context,...opts}});
const replaceSignature=s=>(s[0]==='A'?'B':'A')+s.slice(1);

test('R131_01_policy_is_closed',()=>assert.equal(R131_POLICY.release,'NO_GO'));
test('R131_02_migration_is_hold',()=>assert.equal(R131_POLICY.migration,'HOLD'));
test('R131_03_does_not_clear_lock',()=>assert.equal(R131_POLICY.lockRemovalAuthorized,false));
test('R131_04_not_live',()=>assert.equal(R131_POLICY.productionReady,false));
test('R131_05_proper_seal_accepted',()=>doPending(root=>assert.equal(inspect(root).status,'INDEPENDENT_SYNTHETIC_HOLD_SEAL_VERIFIED')));
test('R131_06_result_keeps_hold',()=>doPending(root=>assert.equal(inspect(root).migration,'HOLD')));
test('R131_07_no_auto_recovery',()=>doPending(root=>assert.equal(inspect(root).automaticRecoveryAuthorized,false)));
test('R131_08_external_pin_still_required',()=>doPending(root=>assert.equal(inspect(root).externalPinPublicationRequired,true)));
test('R131_09_all_read_only',()=>doPending(root=>{let b=state(root);inspect(root);assert.deepEqual(state(root),b)}));
test('R131_10_both_baseline',()=>doPending(root=>assert.equal(inspect(root).epoch,2),'AFTER_INTENT'));
test('R131_11_both_advanced',()=>doPending(root=>assert.equal(inspect(root).epoch,2),'AFTER_B'));
test('R131_12_bad_challenge_rejected',()=>doPending(root=>{let a=setup(root);a.expectedChallenge='cd'.repeat(32);deny(()=>verifyDetachedHoldSeal(a),'CHALLENGE_MISMATCH')}));
test('R131_13_bad_seal_signature',()=>doPending(root=>{let a=setup(root);a.seal.signature=replaceSignature(a.seal.signature);deny(()=>verifyDetachedHoldSeal(a),'SEAL_SIGNATURE')}));
test('R131_14_wrong_sealer_key',()=>doPending(root=>{let a=setup(root);a.trustedSealKey=different.publicKey;deny(()=>verifyDetachedHoldSeal(a),'SEAL_SIGNATURE')}));
test('R131_15_same_as_operator_key',()=>doPending(root=>{let a=setup(root);a.trustedSealKey=op.publicKey;deny(()=>verifyDetachedHoldSeal(a),'SEALER_NOT_INDEPENDENT')}));
test('R131_16_same_as_auditor_key',()=>doPending(root=>{let a=setup(root);a.trustedSealKey=aud.publicKey;deny(()=>verifyDetachedHoldSeal(a),'SEALER_NOT_INDEPENDENT')}));
test('R131_17_expired_seal',()=>doPending(root=>{let a=setup(root);a.nowMs=now+1001;deny(()=>verifyDetachedHoldSeal(a),'SEAL_EXPIRED')}));
test('R131_18_not_yet_issued',()=>doPending(root=>{let a=setup(root);a.nowMs=now+1;deny(()=>verifyDetachedHoldSeal(a),'SEAL_EXPIRED')}));
test('R131_19_extra_payload_field',()=>doPending(root=>{let a=setup(root);a.seal.payload.extra=true;deny(()=>verifyDetachedHoldSeal(a),'SEAL_PAYLOAD')}));
test('R131_20_missing_payload_field',()=>doPending(root=>{let a=setup(root);delete a.seal.payload.stateHashes;deny(()=>verifyDetachedHoldSeal(a),'SEAL_PAYLOAD')}));
test('R131_21_tampered_payload_policy',()=>doPending(root=>{let a=setup(root);a.seal.payload.release='GO';deny(()=>verifyDetachedHoldSeal(a),'SEAL_CONTENT_CHANGED')}));
test('R131_22_tampered_epoch',()=>doPending(root=>{let a=setup(root);a.seal.payload.epoch=3;deny(()=>verifyDetachedHoldSeal(a),'SEAL_CONTENT_CHANGED')}));
test('R131_23_tampered_state_hash',()=>doPending(root=>{let a=setup(root);a.seal.payload.stateHashes={...a.seal.payload.stateHashes,intent:'f'.repeat(64)};deny(()=>verifyDetachedHoldSeal(a),'SEAL_CONTENT_CHANGED')}));
test('R131_24_tampered_review_digest',()=>doPending(root=>{let a=setup(root);a.seal.payload.reviewDigest='f'.repeat(64);deny(()=>verifyDetachedHoldSeal(a),'SEAL_CONTENT_CHANGED')}));
test('R131_25_tampered_prior_pin',()=>doPending(root=>{let a=setup(root);a.independentPriorPin={...a.independentPriorPin,registryHead:'f'.repeat(64)};deny(()=>verifyDetachedHoldSeal(a),'TRUSTED_PIN_MISMATCH')}));
test('R131_26_changed_context_pin',()=>doPending(root=>{let a=setup(root);a=contextWith(a,{minimumWitnessPin:{...minimumWitnessPin,registryHead:'f'.repeat(64)}});deny(()=>verifyDetachedHoldSeal(a),'TRUSTED_PIN_MISMATCH')}));
test('R131_27_missing_minimum_pin',()=>doPending(root=>{let a=setup(root);delete a.independentPriorPin;assert.throws(()=>verifyDetachedHoldSeal(a))}));
test('R131_28_bad_review_signature',()=>doPending(root=>{let a=setup(root);a.approvals.operator.signature=replaceSignature(a.approvals.operator.signature);assert.throws(()=>verifyDetachedHoldSeal(a),/R130_INVALID_SIGNATURE/)}));
test('R131_29_expired_reviewer',()=>doPending(root=>{let a=setup(root);a.trustedReviewers=structuredClone(a.trustedReviewers);a.trustedReviewers.auditor.revokedAtMs=now+2;assert.throws(()=>verifyDetachedHoldSeal(a),/R130_REVIEWER_REVOKED/)}));
test('R131_30_changed_disk_intent',()=>doPending(root=>{let a=setup(root);let f=path.join(root,'intent.json'),v=JSON.parse(fs.readFileSync(f,'utf8'));v.fingerprint='f'.repeat(64);fs.writeFileSync(f,JSON.stringify(v));assert.throws(()=>verifyDetachedHoldSeal(a))}));
test('R131_31_changed_witness',()=>doPending(root=>{let a=setup(root);fs.writeFileSync(path.join(root,'witnessB.json'),'[]');assert.throws(()=>verifyDetachedHoldSeal(a))}));
test('R131_32_no_lock_deletion',()=>doPending(root=>{fs.mkdirSync(path.join(root,'.r129-lock'));let b=fs.existsSync(path.join(root,'.r129-lock'));inspect(root);assert.equal(b,true);assert.equal(fs.existsSync(path.join(root,'.r129-lock')),true)}));
test('R131_33_no_unlock_even_when_lock_absent',()=>doPending(root=>assert.equal(inspect(root).lockRemovalAuthorized,false)));
test('R131_34_remove_offline_flag_rejected',()=>doPending(root=>{let a=setup(root);delete process.env.R131_OFFLINE_QA;try{deny(()=>verifyDetachedHoldSeal(a),'ISOLATION_REQUIRED')}finally{process.env.R131_OFFLINE_QA='yes'}}));
test('R131_35_remove_release_lock_rejected',()=>doPending(root=>{let a=setup(root);delete process.env.CAR02_RELEASE_LOCK;try{deny(()=>verifyDetachedHoldSeal(a),'ISOLATION_REQUIRED')}finally{process.env.CAR02_RELEASE_LOCK='true'}}));
test('R131_36_bad_sealer_public_key',()=>doPending(root=>{let a=setup(root);a.trustedSealKey='bogus';deny(()=>verifyDetachedHoldSeal(a),'TRUSTED_KEY')}));
test('R131_37_bad_seal_signature_shape',()=>doPending(root=>{let a=setup(root);a.seal.signature='bad';deny(()=>verifyDetachedHoldSeal(a),'SEAL_SIGNATURE_SHAPE')}));
test('R131_38_nonhex_challenge',()=>doPending(root=>{let a=setup(root);a.expectedChallenge='not-hex';deny(()=>verifyDetachedHoldSeal(a),'EXPECTED_CHALLENGE')}));
test('R131_39_future_issue_time_rejected',()=>doPending(root=>{let a=setup(root);deny(()=>buildDetachedHoldPayload({proposal:a.proposal,verifiedReview:verifyDualRecoveryReview({proposal:a.proposal,approvals:a.approvals,trustedReviewers,...a.context,nowMs:now+2}),independentPriorPin:minimumWitnessPin,challenge:CH,issuedAtMs:a.proposal.expiresAtMs+1,expiresAtMs:a.proposal.expiresAtMs+2000}),'SEAL_WINDOW')}));
test('R131_40_overlong_seal_window_rejected',()=>doPending(root=>{let a=setup(root);deny(()=>buildDetachedHoldPayload({proposal:a.proposal,verifiedReview:verifyDualRecoveryReview({proposal:a.proposal,approvals:a.approvals,trustedReviewers,...a.context,nowMs:now+2}),independentPriorPin:minimumWitnessPin,challenge:CH,issuedAtMs:now+2,expiresAtMs:now+63_000}),'SEAL_WINDOW')}));

test('R131_41_same_as_witnessA_key',()=>doPending(root=>{let a=setup(root);a.trustedSealKey=witA.publicKey;deny(()=>verifyDetachedHoldSeal(a),'SEALER_NOT_INDEPENDENT')}));
test('R131_42_same_as_witnessB_key',()=>doPending(root=>{let a=setup(root);a.trustedSealKey=witB.publicKey;deny(()=>verifyDetachedHoldSeal(a),'SEALER_NOT_INDEPENDENT')}));
