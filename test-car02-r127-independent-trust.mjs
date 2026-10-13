import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {createSyntheticRows,makeManifest,ephemeralTestKeys,signSyntheticManifest} from './car02-r126-signed-chain-isolated.mjs';
import {POLICY,publicKeyId,createCheckpoint,cosignCheckpoint,checkpointHash,inspectRegistry,verifyCurrentSyntheticSnapshot} from './car02-r127-independent-trust-isolated.mjs';

const now=3_000_010,begin=3_000_000,expiry=begin+60_000;
const records=JSON.parse(execFileSync('node',['car02-r124-r123-fixtures.mjs'],{encoding:'utf8'}));
const rows=createSyntheticRows(records);
const signingA=ephemeralTestKeys(), signingB=ephemeralTestKeys();
const auditA=generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const auditB=generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const trustedAuditors={auditorA:auditA.publicKey,auditorB:auditB.publicKey};
const secretAuditors={auditorA:auditA.privateKey,auditorB:auditB.privateKey};
const manifestA=makeManifest(rows,{snapshotId:'r126-independent-audit-snapshot-0001',createdAtMs:begin,expiresAtMs:expiry});
const manifestB=makeManifest(rows,{snapshotId:'r126-independent-audit-snapshot-0002',createdAtMs:begin,expiresAtMs:expiry});
const bundleA=signSyntheticManifest(manifestA,signingA.privateKey);
const bundleB=signSyntheticManifest(manifestB,signingB.privateKey);
const root='0'.repeat(64),keyA=publicKeyId(signingA.publicKey),keyB=publicKeyId(signingB.publicKey);
const make=(list,action,opts={})=>{
 const previousHash=list.length?checkpointHash(list.at(-1)):root;
 const epoch=list.length+1;
 const c=createCheckpoint({epoch,previousHash,createdAtMs:begin+epoch-1,expiresAtMs:expiry,action,manifest:opts.manifest??(action==='ANCHOR'?manifestA:null),signingPublicKey:opts.publicKey??(action==='ANCHOR'?signingA.publicKey:null),revokedKeys:opts.revokedKeys??[]});
 return cosignCheckpoint(c,secretAuditors);
};
const entry1=make([],'ANCHOR');const entry2=make([entry1],'ANCHOR',{manifest:manifestB,publicKey:signingB.publicKey});
const entry3=make([entry1,entry2],'REVOKE',{revokedKeys:[keyA]});
const entries=[entry1,entry2,entry3];
const pin={epoch:2,hash:checkpointHash(entry2)};
const ctx={trustedAuditors,independentPin:pin,nowMs:now};
const copy=x=>structuredClone(x);
const fail=(fn,code)=>assert.throws(fn,new RegExp(`R127_${code}`));
const signed=x=>cosignCheckpoint(x,secretAuditors);
const inspect=(arr=entries,opts=ctx)=>inspectRegistry(arr,opts);
const current=(b=bundleB,r=rows,arr=entries,opts=ctx)=>verifyCurrentSyntheticSnapshot(b,r,arr,opts);

test('R127_01_R123_real_synthetic_review_fixture_count',()=>assert.equal(records.length,3));
test('R127_02_R126_chain_row_count',()=>assert.equal(rows.length,3));
test('R127_03_two_independent_auditors',()=>assert.notEqual(publicKeyId(auditA.publicKey),publicKeyId(auditB.publicKey)));
test('R127_04_new_snapshot_key_rotation_changes_key_id',()=>assert.notEqual(keyA,keyB));
test('R127_05_release_locked',()=>assert.equal(POLICY.release,'NO_GO'));
test('R127_06_migration_held',()=>assert.equal(POLICY.migration,'HOLD'));
test('R127_07_signed_registry_valid',()=>assert.equal(inspect().status,'SIGNED_TEST_REGISTRY_ONLY'));
test('R127_08_revocation_registers_prior_signing_key',()=>assert.ok(inspect().revoked.has(keyA)));
test('R127_09_current_rotated_snapshot_verifies',()=>assert.equal(current().status,'VERIFIED_SYNTHETIC_WITH_INDEPENDENT_TEST_PIN'));
test('R127_10_current_verify_never_releases',()=>assert.equal(current().productionReady,false));
test('R127_11_external_minimum_pin_rollback_rejected',()=>fail(()=>inspect(entries.slice(0,1)),'PIN_ROLLBACK'));
test('R127_12_pinned_epoch_fork_rejected',()=>{
 const a=[entry1,signed({...copy(entry2.checkpoint),createdAtMs:begin+2})];
 fail(()=>inspect(a),'PIN_FORK');
});
test('R127_13_missing_independent_pin_rejected',()=>fail(()=>inspect(entries,{trustedAuditors,nowMs:now}),'INDEPENDENT_PIN'));
test('R127_14_extra_pin_field_rejected',()=>fail(()=>inspect(entries,{...ctx,independentPin:{...pin,bypass:true}}),'INDEPENDENT_PIN'));
test('R127_15_missing_second_auditor_rejected',()=>{
 const a=copy(entries);a[0].auditorSignatures.pop();fail(()=>inspect(a),'SIGNATURE_QUORUM');
});
test('R127_16_duplicate_auditor_rejected',()=>{
 const a=copy(entries);a[0].auditorSignatures[1].auditorId='auditorA';fail(()=>inspect(a),'SIGNATURE_QUORUM');
});
test('R127_17_wrong_auditor_public_key_rejected',()=>{
 const rogue=ephemeralTestKeys();fail(()=>inspect(entries,{...ctx,trustedAuditors:{auditorA:rogue.publicKey,auditorB:auditB.publicKey}}),'AUDITOR_SIGNATURE');
});
test('R127_18_same_trusted_signer_twice_rejected',()=>fail(()=>inspect(entries,{...ctx,trustedAuditors:{auditorA:auditA.publicKey,auditorB:auditA.publicKey}}),'TRUST_INDEPENDENCE'));
test('R127_19_signer_public_key_in_bundle_not_trusted',()=>{
 const a=copy(entries);a[1].embeddedAuditorKey=trustedAuditors;fail(()=>inspect(a),'RECORD_SHAPE');
});
test('R127_20_mutated_signed_checkpoint_rejected',()=>{
 const a=copy(entries);a[1].checkpoint.count=999;fail(()=>inspect(a),'AUDITOR_SIGNATURE');
});
test('R127_21_mutated_auditor_signature_rejected',()=>{
 const a=copy(entries);a[1].auditorSignatures[0].signature=(a[1].auditorSignatures[0].signature[0]==='A'?'B':'A')+a[1].auditorSignatures[0].signature.slice(1);fail(()=>inspect(a),'AUDITOR_SIGNATURE');
});
test('R127_22_swapped_signed_epochs_rejected',()=>fail(()=>inspect([entry2,entry1,entry3]),'EPOCH_SEQUENCE'));
test('R127_23_truncated_older_chain_rejected',()=>fail(()=>inspect([entry1,entry2],{...ctx,independentPin:{epoch:3,hash:checkpointHash(entry3)}}),'PIN_ROLLBACK'));
test('R127_24_forged_previous_hash_rejected',()=>{
 const a=copy(entries);a[2]=signed({...a[2].checkpoint,previousHash:'f'.repeat(64)});fail(()=>inspect(a),'HASH_CHAIN');
});
test('R127_25_policy_release_go_rejected_even_with_both_signatures',()=>{
 const a=copy(entries);a[2]=signed({...a[2].checkpoint,release:'GO'});fail(()=>inspect(a),'POLICY');
});
test('R127_26_policy_db_migration_rejected_even_with_two_signatures',()=>{
 const a=copy(entries);a[2]=signed({...a[2].checkpoint,migration:'PROCEED'});fail(()=>inspect(a),'POLICY');
});
test('R127_27_future_registry_epoch_denied_until_valid',()=>fail(()=>inspect(entries,{...ctx,nowMs:begin+1}),'EXPIRED_CHECKPOINT'));
test('R127_28_expired_registry_rejected',()=>fail(()=>inspect(entries,{...ctx,nowMs:expiry+1}),'EXPIRED_CHECKPOINT'));
test('R127_29_snapshot_signature_mismatch_rejected',()=>{
 const b=copy(bundleB);b.signature=(b.signature[0]==='A'?'B':'A')+b.signature.slice(1);assert.throws(()=>current(b),/R126_SIGNATURE/);
});
test('R127_30_wrong_current_snapshot_denied',()=>fail(()=>current(bundleA),'SNAPSHOT_MISMATCH'));
test('R127_31_truncated_snapshot_rows_denied',()=>assert.throws(()=>current(bundleB,rows.slice(0,2)),/R126_CHAIN_ANCHOR/));
test('R127_32_snapshot_digest_mismatch_denied',()=>{
 const b=copy(bundleB);b.manifest.snapshotDigest='f'.repeat(64);fail(()=>current(b),'ANCHOR_MISMATCH');
});
test('R127_33_signed_current_key_revoked_denied',()=>{
 const a=[...entries,make(entries,'REVOKE',{revokedKeys:[keyB]})];fail(()=>current(bundleB,rows,a),'KEY_REVOKED');
});
test('R127_34_revoked_key_cannot_be_used_for_new_snapshot',()=>{
 const m=makeManifest(rows,{snapshotId:'r126-independent-audit-snapshot-0003',createdAtMs:begin,expiresAtMs:expiry});
 const a=[...entries,make(entries,'ANCHOR',{manifest:m,publicKey:signingA.publicKey})];fail(()=>inspect(a),'KEY_ALREADY_REVOKED');
});
test('R127_35_duplicate_revocation_rejected',()=>{
 const a=[...entries,make(entries,'REVOKE',{revokedKeys:[keyA]})];fail(()=>inspect(a),'DUPLICATE_REVOCATION');
});
test('R127_36_new_snapshot_key_can_be_rotated_and_accepted',()=>{
 const fresh=ephemeralTestKeys();const m=makeManifest(rows,{snapshotId:'r126-independent-audit-snapshot-0004',createdAtMs:begin,expiresAtMs:expiry});
 const bundle=signSyntheticManifest(m,fresh.privateKey);
 const a=[...entries,make(entries,'ANCHOR',{manifest:m,publicKey:fresh.publicKey})];
 assert.equal(current(bundle,rows,a).epoch,4);
});
test('R127_37_tenant_counts_bound_to_manifest',()=>{
 const a=[entry1,signed({...entry2.checkpoint,shops:{shop_a:3,shop_b:0}})];
 fail(()=>current(bundleB,rows,a,{...ctx,independentPin:{epoch:1,hash:checkpointHash(entry1)}}),'ANCHOR_MISMATCH');
});
test('R127_38_unknown_record_fields_rejected',()=>{
 const a=copy(entries);a[0].checkpoint.deploy=true;fail(()=>inspect(a),'CHECKPOINT_SHAPE');
});
test('R127_39_action_REVOKE_cannot_embed_snapshot',()=>{
 const a=copy(entries);a[2]=signed({...a[2].checkpoint,snapshotId:manifestA.snapshotId});fail(()=>inspect(a),'REVOKE_FIELDS');
});
test('R127_40_non_ED25519_key_rejected',()=>fail(()=>publicKeyId('BEGIN PUBLIC KEY NOT REAL'),'PUBLIC_KEY_FORMAT'));
test('R127_41_future_epoch_without_previous_chain_rejected',()=>{
 const a=[entry1,entry3];fail(()=>inspect(a),'EPOCH_SEQUENCE');
});
test('R127_42_synthetically_signed_keys_are_not_production_authorization',()=>{
 const x=current();assert.deepEqual({release:x.release,migration:x.migration,productionReady:x.productionReady},{release:'NO_GO',migration:'HOLD',productionReady:false});
});
