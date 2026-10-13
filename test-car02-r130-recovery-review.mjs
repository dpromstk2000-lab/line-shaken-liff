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

process.env.R129_OFFLINE_QA='yes';process.env.R130_OFFLINE_QA='yes';process.env.CAR02_RELEASE_LOCK='true';
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

test('R130_01_release_is_NO_GO',()=>assert.equal(R130_POLICY.release,'NO_GO'));
test('R130_02_migration_is_HOLD',()=>assert.equal(R130_POLICY.migration,'HOLD'));
test('R130_03_no_mutation_policy',()=>assert.equal(R130_POLICY.modifiesFiles,false));
test('R130_04_no_lock_clear_policy',()=>assert.equal(R130_POLICY.canClearLock,false));
test('R130_05_after_intent_is_pending',()=>pending('AFTER_INTENT',root=>assert.equal(prepare(root).status,'PENDING_DUAL_REVIEW')));
test('R130_06_after_A_shows_partial',()=>pending('AFTER_A',root=>assert.deepEqual(prepare(root).stages,{witnessA:'ADVANCED',witnessB:'BASELINE'})));
test('R130_07_after_B_shows_both',()=>pending('AFTER_B',root=>assert.deepEqual(prepare(root).stages,{witnessA:'ADVANCED',witnessB:'ADVANCED'})));
test('R130_08_after_intent_stages_base',()=>pending('AFTER_INTENT',root=>assert.deepEqual(prepare(root).stages,{witnessA:'BASELINE',witnessB:'BASELINE'})));
test('R130_09_operator_auditor_review_is_advisory_only',()=>pending('AFTER_A',root=>assert.equal(assess(root).status,'DUAL_REVIEWED_STILL_HOLD')));
test('R130_10_approved_does_not_release',()=>pending('AFTER_A',root=>assert.equal(assess(root).release,'NO_GO')));
test('R130_11_review_does_not_clear_hold',()=>pending('AFTER_A',root=>assert.equal(assess(root).migration,'HOLD')));
test('R130_12_only_a_read_does_not_change_files',()=>pending('AFTER_A',root=>{const before=snapshot(root);prepare(root);assess(root);assert.deepEqual(snapshot(root),before)}));
test('R130_13_repeated_review_deterministic',()=>pending('AFTER_A',root=>assert.equal(prepare(root).digest,prepare(root).digest)));
test('R130_14_missing_operator_denied',()=>pending('AFTER_A',root=>{const p=prepare(root);denied(()=>verifyDualRecoveryReview({proposal:p,approvals:{auditor:approved(p).auditor},trustedReviewers,...reviewCtx(root),nowMs:now+1}),'APPROVAL_SET')}));
test('R130_15_swapped_roles_denied',()=>pending('AFTER_A',root=>{const p=prepare(root),a=approved(p);a.operator.role='auditor';denied(()=>verifyDualRecoveryReview({proposal:p,approvals:a,trustedReviewers,...reviewCtx(root),nowMs:now+1}),'APPROVAL_SHAPE')}));
test('R130_16_duplicate_public_key_denied',()=>pending('AFTER_A',root=>{const p=prepare(root),t=mutate(trustedReviewers);t.auditor.publicKey=t.operator.publicKey;denied(()=>verifyDualRecoveryReview({proposal:p,approvals:approved(p),trustedReviewers:t,...reviewCtx(root),nowMs:now+1}),'SAME_REVIEWER_KEY')}));
test('R130_17_revoked_operator_denied',()=>pending('AFTER_A',root=>{const p=prepare(root),t=mutate(trustedReviewers);t.operator.revokedAtMs=now;denied(()=>verifyDualRecoveryReview({proposal:p,approvals:approved(p),trustedReviewers:t,...reviewCtx(root),nowMs:now+1}),'REVIEWER_REVOKED')}));
test('R130_18_revoked_auditor_denied',()=>pending('AFTER_A',root=>{const p=prepare(root),t=mutate(trustedReviewers);t.auditor.revokedAtMs=now;denied(()=>verifyDualRecoveryReview({proposal:p,approvals:approved(p),trustedReviewers:t,...reviewCtx(root),nowMs:now+1}),'REVIEWER_REVOKED')}));
test('R130_19_bad_signature_denied',()=>pending('AFTER_A',root=>{const p=prepare(root),a=approved(p);a.operator.signature=(a.operator.signature[0]==='A'?'B':'A')+a.operator.signature.slice(1);denied(()=>verifyDualRecoveryReview({proposal:p,approvals:a,trustedReviewers,...reviewCtx(root),nowMs:now+1}),'INVALID_SIGNATURE')}));
test('R130_20_signature_from_other_key_denied',()=>pending('AFTER_A',root=>{const p=prepare(root),a=approved(p);a.operator=approve(p,'operator',key().privateKey);denied(()=>verifyDualRecoveryReview({proposal:p,approvals:a,trustedReviewers,...reviewCtx(root),nowMs:now+1}),'INVALID_SIGNATURE')}));
test('R130_21_proposal_digest_tamper_denied',()=>pending('AFTER_A',root=>{const p=prepare(root),a=approved(p);p.digest='f'.repeat(64);denied(()=>verifyDualRecoveryReview({proposal:p,approvals:a,trustedReviewers,...reviewCtx(root),nowMs:now+1}),'SNAPSHOT_CHANGED')}));
test('R130_22_disk_intent_changes_after_proposal_denied',()=>pending('AFTER_A',root=>{const p=prepare(root),a=approved(p),file=path.join(root,'intent.json');const v=JSON.parse(fs.readFileSync(file));v.fingerprint='f'.repeat(64);fs.writeFileSync(file,JSON.stringify(v));assert.throws(()=>verifyDualRecoveryReview({proposal:p,approvals:a,trustedReviewers,...reviewCtx(root),nowMs:now+1}))}));
test('R130_23_witness_changes_after_proposal_denied',()=>pending('AFTER_A',root=>{const p=prepare(root),a=approved(p);fs.writeFileSync(path.join(root,'witnessA.json'),'[]');assert.throws(()=>verifyDualRecoveryReview({proposal:p,approvals:a,trustedReviewers,...reviewCtx(root),nowMs:now+1}))}));
test('R130_24_bad_r127_pin_denied',()=>pending('AFTER_A',root=>assert.throws(()=>prepareManualRecoveryReview({...reviewCtx(root),r127Pin:{epoch:1,hash:'f'.repeat(64)}}))));
test('R130_25_bad_minimum_witness_pin_denied',()=>pending('AFTER_A',root=>assert.throws(()=>prepareManualRecoveryReview({...reviewCtx(root),minimumWitnessPin:{...minimumWitnessPin,registryHead:'f'.repeat(64)}}))));
test('R130_26_bad_new_receipt_denied',()=>pending('AFTER_A',root=>{const n=mutate(newReceipts);n.witnessB.signature=(n.witnessB.signature[0]==='A'?'B':'A')+n.witnessB.signature.slice(1);assert.throws(()=>prepareManualRecoveryReview({...reviewCtx(root),newReceipts:n}))}));
test('R130_27_operation_id_mismatch_denied',()=>pending('AFTER_A',root=>denied(()=>prepareManualRecoveryReview({...reviewCtx(root),operationId:'r129-other-safe-job'}),'PENDING_INTENT_REQUIRED')));
test('R130_28_untrusted_temp_root_denied',()=>pending('AFTER_A',root=>denied(()=>prepareManualRecoveryReview({...reviewCtx(root),root:os.tmpdir()}),'ROOT_UNSAFE')));
test('R130_29_offline_flag_required',()=>pending('AFTER_A',root=>{delete process.env.R130_OFFLINE_QA;try{denied(()=>prepare(root),'ISOLATION_REQUIRED')}finally{process.env.R130_OFFLINE_QA='yes'}}));
test('R130_30_stale_lock_stays_on_hold',()=>pending('AFTER_A',root=>{fs.mkdirSync(path.join(root,'.r129-lock'));const p=prepare(root);assert.equal(p.lockState,'PRESENT_MANUAL_HOLD');assert.equal(assess(root).manualReplayEligible,false);assert.equal(fs.existsSync(path.join(root,'.r129-lock')),true)}));
test('R130_31_symlink_lock_rejected',()=>pending('AFTER_A',root=>{fs.symlinkSync(os.tmpdir(),path.join(root,'.r129-lock'));denied(()=>prepare(root),'UNSAFE_LOCK')}));
test('R130_32_symlink_witness_rejected',()=>pending('AFTER_A',root=>{const f=path.join(root,'witnessB.json');fs.unlinkSync(f);fs.symlinkSync(path.join(root,'witnessA.json'),f);denied(()=>prepare(root),'UNSAFE_FILE')}));
test('R130_33_a_completed_intent_cannot_be_reviewed',()=>run(root=>{applySignedEscrowEpoch(data(root));denied(()=>prepare(root),'PENDING_INTENT_REQUIRED')}));
test('R130_34_no_intent_cannot_be_reviewed',()=>run(root=>denied(()=>prepare(root),'MISSING_FILE')));
test('R130_35_missing_witness_cannot_be_reviewed',()=>pending('AFTER_A',root=>{fs.unlinkSync(path.join(root,'witnessB.json'));denied(()=>prepare(root),'MISSING_FILE')}));
test('R130_36_expires_after_five_minutes',()=>pending('AFTER_A',root=>{const p=prepare(root);denied(()=>verifyDualRecoveryReview({proposal:p,approvals:approved(p),trustedReviewers,...reviewCtx(root),nowMs:now+300_001}),'REVIEW_EXPIRED')}));
test('R130_37_changed_signed_approval_time_denied',()=>pending('AFTER_A',root=>{const p=prepare(root),a=approved(p);a.operator.issuedAtMs=now+2;denied(()=>verifyDualRecoveryReview({proposal:p,approvals:a,trustedReviewers,...reviewCtx(root),nowMs:now+2}),'INVALID_SIGNATURE')}));
test('R130_38_future_approval_time_denied',()=>pending('AFTER_A',root=>{const p=prepare(root),a=approved(p);denied(()=>verifyDualRecoveryReview({proposal:p,approvals:a,trustedReviewers,...reviewCtx(root),nowMs:now}),'APPROVAL_IN_FUTURE')}));
test('R130_39_previous_PIN_epoch_must_be_trusted',()=>pending('AFTER_A',root=>{const p=prepare(root);assert.equal(p.priorPin.epoch,1);assert.equal(p.independentlyUpdatedPin,false)}));
test('R130_40_new_PIN_only_a_candidate',()=>pending('AFTER_A',root=>{const p=prepare(root);assert.equal(p.nextPin.epoch,2);assert.equal(assess(root).independentPinPublicationRequired,true)}));
test('R130_41_lock_absent_does_not_authorize_automatic_recovery',()=>pending('AFTER_A',root=>{const a=assess(root);assert.equal(a.automaticRecoveryAuthorized,false);assert.equal(a.lockRemovalAuthorized,false)}));
test('R130_42_never_contacts_external_storage',()=>pending('AFTER_A',root=>{const a=assess(root);assert.equal(a.realExternalWitnesses,false);assert.equal(a.externalStoreVerificationRequired,true)}));
