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

process.env.R129_OFFLINE_QA='yes';process.env.CAR02_RELEASE_LOCK='true';
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

test('R129_01_release_stays_NO_GO',()=>assert.equal(R129_POLICY.release,'NO_GO'));
test('R129_02_DB_migration_stays_HOLD',()=>assert.equal(R129_POLICY.migration,'HOLD'));
test('R129_03_R123_synthetic_fixture_is_used',()=>assert.equal(records.length,3));
test('R129_04_R126_synthetic_rows_are_used',()=>assert.equal(rows.length,3));
test('R129_05_genesis_is_verifiable_with_epoch_one',()=>run(root=>assert.equal(readVerifiedEscrow({root,...publicContext,registryRecords:[reg1]}).epoch,1)));
test('R129_06_complete_update_fully_verified',()=>run(root=>assert.equal(applySignedEscrowEpoch(data(root)).status,'APPLIED')));
test('R129_07_read_after_commit_epoch_two',()=>run(root=>{applySignedEscrowEpoch(data(root));assert.equal(verified(root).epoch,2)}));
test('R129_08_after_commit_NO_GO',()=>run(root=>{applySignedEscrowEpoch(data(root));assert.equal(verified(root).release,'NO_GO')}));
test('R129_09_after_commit_not_independently_pinned',()=>run(root=>{const v=applySignedEscrowEpoch(data(root));assert.equal(v.independentlyPinned,false)}));
test('R129_10_replay_same_operation_only_once',()=>run(root=>{applySignedEscrowEpoch(data(root));assert.equal(applySignedEscrowEpoch(data(root)).status,'REPLAY');assert.equal(JSON.parse(fs.readFileSync(path.join(root,'witnessA.json'))).length,2)}));
test('R129_11_after_intent_failure_holds',()=>run(root=>{fault(()=>applySignedEscrowEpoch(data(root,{injectFailure:'AFTER_INTENT'})),'INJECTED_AFTER_INTENT');fault(()=>verified(root),'PENDING_MANUAL_HOLD')}));
test('R129_12_retry_after_intent_failure',()=>run(root=>{fault(()=>applySignedEscrowEpoch(data(root,{injectFailure:'AFTER_INTENT'})),'INJECTED_AFTER_INTENT');assert.equal(applySignedEscrowEpoch(data(root)).status,'APPLIED')}));
test('R129_13_after_witnessA_failure_holds',()=>run(root=>{fault(()=>applySignedEscrowEpoch(data(root,{injectFailure:'AFTER_A'})),'INJECTED_AFTER_A');fault(()=>verified(root),'PENDING_MANUAL_HOLD')}));
test('R129_14_witnessA_only_advanced_on_failure',()=>run(root=>{fault(()=>applySignedEscrowEpoch(data(root,{injectFailure:'AFTER_A'})),'INJECTED_AFTER_A');assert.equal(JSON.parse(fs.readFileSync(path.join(root,'witnessA.json'))).length,2);assert.equal(JSON.parse(fs.readFileSync(path.join(root,'witnessB.json'))).length,1)}));
test('R129_15_same_operation_repairs_partial',()=>run(root=>{fault(()=>applySignedEscrowEpoch(data(root,{injectFailure:'AFTER_A'})),'INJECTED_AFTER_A');assert.equal(applySignedEscrowEpoch(data(root)).status,'APPLIED');assert.equal(verified(root).epoch,2)}));
test('R129_16_after_both_written_intent_stays_pending',()=>run(root=>{fault(()=>applySignedEscrowEpoch(data(root,{injectFailure:'AFTER_B'})),'INJECTED_AFTER_B');fault(()=>verified(root),'PENDING_MANUAL_HOLD')}));
test('R129_17_retry_after_both_writes_completes',()=>run(root=>{fault(()=>applySignedEscrowEpoch(data(root,{injectFailure:'AFTER_B'})),'INJECTED_AFTER_B');assert.equal(applySignedEscrowEpoch(data(root)).status,'APPLIED');assert.equal(verified(root).epoch,2)}));
test('R129_18_different_operation_id_rejected_on_pending',()=>run(root=>{fault(()=>applySignedEscrowEpoch(data(root,{injectFailure:'AFTER_A'})),'INJECTED_AFTER_A');fault(()=>applySignedEscrowEpoch(data(root,{operationId:'r129-different-operation'})),'OPERATION_CONFLICT')}));
test('R129_19_altered_signed_receipt_rejected',()=>run(root=>{const n=copy(newReceipts);n.witnessB.signature='A'+n.witnessB.signature.slice(1);assert.throws(()=>applySignedEscrowEpoch(data(root,{newReceipts:n})))}));
test('R129_20_missing_witness_denied',()=>run(root=>{fs.unlinkSync(path.join(root,'witnessB.json'));assert.throws(()=>verified(root))}));
test('R129_21_rogue_public_key_denied',()=>run(root=>{assert.throws(()=>applySignedEscrowEpoch(data(root,{trustedWitnesses:{...trustedWitnesses,witnessA:key().publicKey}})),/R128_SIGNATURE/);}));
test('R129_22_forked_checkpoint_pin_denied',()=>run(root=>{assert.throws(()=>applySignedEscrowEpoch(data(root,{r127Pin:{...r127Pin,hash:'f'.repeat(64)}})))}));
test('R129_23_tamper_after_commit_denied',()=>run(root=>{applySignedEscrowEpoch(data(root));const f=path.join(root,'witnessA.json');const d=JSON.parse(fs.readFileSync(f));d[1].payload.epoch=7;fs.writeFileSync(f,JSON.stringify(d));assert.throws(()=>verified(root))}));
test('R129_24_different_request_after_success_denied',()=>run(root=>{applySignedEscrowEpoch(data(root));fault(()=>applySignedEscrowEpoch(data(root,{operationId:'r129-new-id-not-allowed'})),'OPERATION_CONFLICT')}));
test('R129_25_old_state_is_rejected_by_new_external_pin',()=>run(root=>{
 const v=applySignedEscrowEpoch(data(root));for(const w of ['witnessA','witnessB'])fs.writeFileSync(path.join(root,`${w}.json`),JSON.stringify(receipts[w]));
 assert.throws(()=>readVerifiedEscrow({root,...publicContext,minimumWitnessPin:v.candidatePin}));
}));
test('R129_26_preexisting_lock_fail_closed',()=>run(root=>{fs.mkdirSync(path.join(root,'.r129-lock'));fault(()=>applySignedEscrowEpoch(data(root)),'LOCKED')}));
test('R129_27_offline_flag_required',()=>run(root=>{const p=process.env.R129_OFFLINE_QA;delete process.env.R129_OFFLINE_QA;try{fault(()=>applySignedEscrowEpoch(data(root)),'ISOLATION_REQUIRED')}finally{process.env.R129_OFFLINE_QA=p}}));
test('R129_28_root_must_be_temporary',()=>run(root=>{fault(()=>applySignedEscrowEpoch(data(root,{root:'/mnt/data'})),'TEMP_ROOT')}));
test('R129_29_done_ledger_file_missing_denied',()=>run(root=>{applySignedEscrowEpoch(data(root));fs.unlinkSync(path.join(root,'witnessA.json'));assert.throws(()=>verified(root))}));
test('R129_30_attempt_with_different_witness_after_partial_rejected',()=>run(root=>{fault(()=>applySignedEscrowEpoch(data(root,{injectFailure:'AFTER_A'})),'INJECTED_AFTER_A');const d=copy(newReceipts);d.witnessB.signature=d.witnessB.signature.replace(/^./,d.witnessB.signature[0]==='Z'?'A':'Z');assert.throws(()=>applySignedEscrowEpoch(data(root,{newReceipts:d})))}));
test('R129_31_durable_write_survives_separate_process',()=>run(root=>{applySignedEscrowEpoch(data(root));const args=JSON.stringify({root,...publicContext});const code=`import {readVerifiedEscrow} from './car02-r129-escrow-recovery-isolated.mjs';const x=JSON.parse(process.argv[1]);console.log(readVerifiedEscrow(x).epoch);`;assert.equal(execFileSync('node',['--input-type=module','-e',code,args],{encoding:'utf8'}).trim(),'2')}));
test('R129_32_partial_state_visible_as_hold_even_from_other_process',()=>run(root=>{fault(()=>applySignedEscrowEpoch(data(root,{injectFailure:'AFTER_A'})),'INJECTED_AFTER_A');const args=JSON.stringify({root,...publicContext});const code=`import {readVerifiedEscrow} from './car02-r129-escrow-recovery-isolated.mjs';try{readVerifiedEscrow(JSON.parse(process.argv[1]));process.exit(9)}catch(e){console.log(e.message)}`;assert.match(execFileSync('node',['--input-type=module','-e',code,args],{encoding:'utf8'}),/R129_PENDING_MANUAL_HOLD/)}));
test('R129_33_six_independent_processes_one_applies_at_most',async()=>{
 const root=create();
 try{
  const payload=path.join(root,'fixture.json');fs.writeFileSync(payload,JSON.stringify(data(root)),{mode:0o600});
  const js=`import fs from 'node:fs';import {applySignedEscrowEpoch} from './car02-r129-escrow-recovery-isolated.mjs';try{const r=applySignedEscrowEpoch(JSON.parse(fs.readFileSync(process.argv[1])));console.log(r.status)}catch(e){console.log(e.message)}`;
  const calls=Array.from({length:6},()=>new Promise((resolve,reject)=>{
   const p=spawn('node',['--input-type=module','-e',js,payload],{env:process.env});let log='';p.stdout.on('data',x=>log+=x.toString());p.stderr.on('data',x=>log+=x.toString());p.on('error',reject);p.on('close',()=>resolve(log.trim()));
  }));
  const results=await Promise.all(calls);
  assert.equal(results.filter(x=>x==='APPLIED').length,1);
  assert.ok(results.every(x=>['APPLIED','REPLAY','R129_LOCKED'].includes(x)),results.join(','));
  assert.equal(verified(root).epoch,2);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
