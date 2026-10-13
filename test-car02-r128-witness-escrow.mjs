import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createSyntheticRows,makeManifest,ephemeralTestKeys} from './car02-r126-signed-chain-isolated.mjs';
import {createCheckpoint,cosignCheckpoint,checkpointHash,publicKeyId} from './car02-r127-independent-trust-isolated.mjs';
import {POLICY,issueSyntheticWitnessReceipt,inspectIndependentEscrow,receiptHash} from './car02-r128-witness-escrow-isolated.mjs';

const ROOT='0'.repeat(64),start=3_000_000,exp=start+60_000,now=start+9;
const ed=()=>generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const auditorA=ed(),auditorB=ed(),signingA=ephemeralTestKeys(),signingB=ephemeralTestKeys(),witnessA=ed(),witnessB=ed();
const trustedAuditors={auditorA:auditorA.publicKey,auditorB:auditorB.publicKey};
const privateAuditors={auditorA:auditorA.privateKey,auditorB:auditorB.privateKey};
const trustedWitnesses={witnessA:witnessA.publicKey,witnessB:witnessB.publicKey};
const privateWitnesses={witnessA:witnessA.privateKey,witnessB:witnessB.privateKey};
const original=JSON.parse(execFileSync('node',['car02-r124-r123-fixtures.mjs'],{encoding:'utf8'}));
const rows=createSyntheticRows(original);
const manifestA=makeManifest(rows,{snapshotId:'r126-r128-snapshot-evidence-0001',createdAtMs:start,expiresAtMs:exp});
const manifestB=makeManifest(rows,{snapshotId:'r126-r128-snapshot-evidence-0002',createdAtMs:start,expiresAtMs:exp});
function newCheckpoint(arr,action,extra={}){
 const epoch=arr.length+1;
 const cp=createCheckpoint({epoch,previousHash:arr.length?checkpointHash(arr.at(-1)):ROOT,createdAtMs:start+epoch,
  expiresAtMs:exp,action,manifest:action==='ANCHOR'?extra.manifest:null,
  signingPublicKey:action==='ANCHOR'?extra.publicKey:null,revokedKeys:action==='REVOKE'?extra.revokedKeys:[]});
 return cosignCheckpoint(cp,privateAuditors);
}
const a=newCheckpoint([],'ANCHOR',{manifest:manifestA,publicKey:signingA.publicKey});
const b=newCheckpoint([a],'ANCHOR',{manifest:manifestB,publicKey:signingB.publicKey});
const c=newCheckpoint([a,b],'REVOKE',{revokedKeys:[publicKeyId(signingA.publicKey)]});
const registryRecords=[a,b,c];const r127Pin={epoch:2,hash:checkpointHash(b)};
function makeReceiptChains(r=registryRecords){
 const out={witnessA:[],witnessB:[]};
 for(const w of ['witnessA','witnessB']){
  for(let i=0;i<r.length;i++)out[w].push(issueSyntheticWitnessReceipt({witnessId:w,epoch:i+1,
   registryHead:checkpointHash(r[i]),previousReceiptHash:i?receiptHash(out[w][i-1]):ROOT,observedAtMs:start+i+1,expiresAtMs:exp},privateWitnesses[w]));
 }
 return out;
}
const receiptChains=makeReceiptChains();
const minimumWitnessPin={epoch:2,registryHead:checkpointHash(b),receiptHashes:{witnessA:receiptHash(receiptChains.witnessA[1]),witnessB:receiptHash(receiptChains.witnessB[1])}};
const args={registryRecords,trustedAuditors,r127Pin,receiptChains,trustedWitnesses,minimumWitnessPin,nowMs:now};
const clone=x=>structuredClone(x);
const okay=x=>inspectIndependentEscrow(x||args);
const reject=(fn,reason)=>assert.throws(fn,new RegExp(`R128_${reason}`));
const reject127=(fn,reason)=>assert.throws(fn,new RegExp(`R127_${reason}`));

test('R128_01_actual_R123_synthetic_records',()=>assert.equal(original.length,3));
test('R128_02_R126_chain_rows',()=>assert.equal(rows.length,3));
test('R128_03_R127_three_checkpoints',()=>assert.equal(registryRecords.length,3));
test('R128_04_release_closed',()=>assert.equal(POLICY.release,'NO_GO'));
test('R128_05_migration_held',()=>assert.equal(POLICY.migration,'HOLD'));
test('R128_06_both_witnesses_unique_public_keys',()=>assert.notEqual(publicKeyId(witnessA.publicKey),publicKeyId(witnessB.publicKey)));
test('R128_07_valid_two_witness_verification',()=>assert.equal(okay().status,'VERIFIED_SYNTHETIC_ESCROW_ONLY'));
test('R128_08_verified_epoch_three',()=>assert.equal(okay().epoch,3));
test('R128_09_independent_pin_epoch_two',()=>assert.equal(okay().independentlyPinnedEpoch,2));
test('R128_10_returns_no_production_ready',()=>assert.equal(okay().productionReady,false));
test('R128_11_missing_second_witness_chain',()=>reject(()=>okay({...args,receiptChains:{witnessA:receiptChains.witnessA}}),'RECEIPT_CHAINS'));
test('R128_12_both_witness_chains_truncated',()=>reject(()=>okay({...args,receiptChains:{witnessA:receiptChains.witnessA.slice(0,2),witnessB:receiptChains.witnessB.slice(0,2)}}),'WITNESS_ROLLBACK'));
test('R128_13_only_A_chain_truncated',()=>reject(()=>okay({...args,receiptChains:{...receiptChains,witnessA:receiptChains.witnessA.slice(0,2)}}),'WITNESS_ROLLBACK'));
test('R128_14_only_B_chain_truncated',()=>reject(()=>okay({...args,receiptChains:{...receiptChains,witnessB:receiptChains.witnessB.slice(0,1)}}),'WITNESS_ROLLBACK'));
test('R128_15_both_registry_and_chains_stale_beyond_pin',()=>reject(()=>okay({...args,registryRecords:registryRecords.slice(0,2),receiptChains:{witnessA:receiptChains.witnessA.slice(0,2),witnessB:receiptChains.witnessB.slice(0,2)},minimumWitnessPin:{...minimumWitnessPin,epoch:3,registryHead:checkpointHash(c),receiptHashes:{witnessA:receiptHash(receiptChains.witnessA[2]),witnessB:receiptHash(receiptChains.witnessB[2])}}}),'ESCROW_ROLLBACK'));
test('R128_16_pin_different_registry_head',()=>reject(()=>okay({...args,minimumWitnessPin:{...minimumWitnessPin,registryHead:'f'.repeat(64)}}),'MINIMUM_FORK'));
test('R128_17_pin_wrong_A_receipt',()=>reject(()=>okay({...args,minimumWitnessPin:{...minimumWitnessPin,receiptHashes:{...minimumWitnessPin.receiptHashes,witnessA:'f'.repeat(64)}}}),'PIN_FORK'));
test('R128_18_pin_wrong_B_receipt',()=>reject(()=>okay({...args,minimumWitnessPin:{...minimumWitnessPin,receiptHashes:{...minimumWitnessPin.receiptHashes,witnessB:'f'.repeat(64)}}}),'PIN_FORK'));
test('R128_19_missing_pin',()=>reject(()=>okay({...args,minimumWitnessPin:undefined}),'MINIMUM_PIN'));
test('R128_20_rogue_public_key',()=>reject(()=>okay({...args,trustedWitnesses:{...trustedWitnesses,witnessA:ed().publicKey}}),'SIGNATURE'));
test('R128_21_same_key_for_both_witnesses',()=>reject(()=>okay({...args,trustedWitnesses:{witnessA:witnessA.publicKey,witnessB:witnessA.publicKey}}),'NOT_INDEPENDENT'));
test('R128_22_tamper_A_receipt_registry_head',()=>{const d=clone(receiptChains);d.witnessA[2].payload.registryHead='f'.repeat(64);reject(()=>okay({...args,receiptChains:d}),'RECEIPT_LINK')});
test('R128_23_tamper_B_receipt_signature',()=>{const d=clone(receiptChains);const s=d.witnessB[2].signature;d.witnessB[2].signature=(s[0]==='A'?'B':'A')+s.slice(1);reject(()=>okay({...args,receiptChains:d}),'SIGNATURE')});
test('R128_24_swap_witness_receipts',()=>reject(()=>okay({...args,receiptChains:{witnessA:receiptChains.witnessB,witnessB:receiptChains.witnessA}}),'RECEIPT_LINK'));
test('R128_25_skipped_witness_epoch',()=>{const d=clone(receiptChains);d.witnessB[2].payload.epoch=9;reject(()=>okay({...args,receiptChains:d}),'RECEIPT_LINK')});
test('R128_26_modified_previous_receipt_hash',()=>{const d=clone(receiptChains);d.witnessB[2].payload.previousReceiptHash='f'.repeat(64);reject(()=>okay({...args,receiptChains:d}),'RECEIPT_LINK')});
test('R128_27_witness_expired',()=>{
 const d=clone(receiptChains);for(const w of ['witnessA','witnessB']){
  const p=d[w][2].payload;d[w][2]=issueSyntheticWitnessReceipt({...p,expiresAtMs:start+7},privateWitnesses[w]);
 }reject(()=>okay({...args,receiptChains:d}),'WITNESS_EXPIRED');
});
test('R128_28_witness_not_yet_created',()=>{
 const d=clone(receiptChains);for(const w of ['witnessA','witnessB']){
  const p=d[w][2].payload;d[w][2]=issueSyntheticWitnessReceipt({...p,observedAtMs:start+20},privateWitnesses[w]);
 }reject(()=>okay({...args,receiptChains:d}),'WITNESS_EXPIRED');
});
test('R128_29_untrusted_pin_on_r127_fork',()=>reject127(()=>okay({...args,r127Pin:{epoch:2,hash:'f'.repeat(64)}}),'PIN_FORK'));
test('R128_30_invalid_witness_public_key',()=>reject(()=>okay({...args,trustedWitnesses:{...trustedWitnesses,witnessA:'invalid-key'}}),'WITNESS_KEY'));
test('R128_31_receipt_extra_claim_forbidden',()=>{const d=clone(receiptChains);d.witnessA[0].payload.productionGrant=true;reject(()=>okay({...args,receiptChains:d}),'PAYLOAD_SHAPE')});
test('R128_32_embedded_public_key_not_trusted',()=>{const d=clone(receiptChains);d.witnessA[0].publicKey=witnessA.publicKey;reject(()=>okay({...args,receiptChains:d}),'RECEIPT_SHAPE')});
test('R128_33_long_signature_wrong_shape',()=>{const d=clone(receiptChains);d.witnessB[1].signature='bad';reject(()=>okay({...args,receiptChains:d}),'SIGNATURE_SHAPE')});
test('R128_34_wrong_release_policy_denied',()=>{const d=clone(receiptChains);d.witnessB[1].payload.release='GO';reject(()=>okay({...args,receiptChains:d}),'POLICY')});
test('R128_35_pin_for_future_epoch',()=>reject(()=>okay({...args,minimumWitnessPin:{...minimumWitnessPin,epoch:4}}),'ESCROW_ROLLBACK'));
test('R128_36_invalid_pin_shape',()=>reject(()=>okay({...args,minimumWitnessPin:{...minimumWitnessPin,approved:true}}),'MINIMUM_PIN'));
test('R128_37_zero_length_witness_file',()=>reject(()=>okay({...args,receiptChains:{...receiptChains,witnessA:[]}}),'WITNESS_ROLLBACK'));
test('R128_38_disk_readback_both_separate_test_directories',()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'car02-r128-offline-'));
 try{
  const restored={witnessA:[],witnessB:[]};
  for(const id of ['witnessA','witnessB']){
   const dir=path.join(base,id);fs.mkdirSync(dir,{recursive:true});
   const filename=path.join(dir,'witness-receipts.json');fs.writeFileSync(filename,JSON.stringify(receiptChains[id]));
   restored[id]=JSON.parse(fs.readFileSync(filename,'utf8'));
  }
  assert.equal(okay({...args,receiptChains:restored}).epoch,3);
 }finally{fs.rmSync(base,{recursive:true,force:true})}
});
test('R128_39_disk_readback_one_witness_missing_denied',()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'car02-r128-offline-'));
 try{const p=path.join(base,'witnessA.json');fs.writeFileSync(p,JSON.stringify(receiptChains.witnessA));
  reject(()=>okay({...args,receiptChains:{witnessA:JSON.parse(fs.readFileSync(p,'utf8')),witnessB:[]}}),'WITNESS_ROLLBACK');
 }finally{fs.rmSync(base,{recursive:true,force:true})}
});
test('R128_40_restore_without_r127_pin_denied',()=>reject127(()=>okay({...args,r127Pin:null}),'INDEPENDENT_PIN'));
