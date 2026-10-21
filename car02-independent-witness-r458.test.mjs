import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createCar02OfflineReviewEvidenceSealR457} from './car02-review-evidence-seal-r457.mjs';
import {CAR02_V458_RELEASE_LOCK,signCar02OfflineCheckpointR458,
 createCar02OfflineWitnessVerifierR458} from './car02-independent-witness-r458.mjs';
const shop='qa_shop_a',event='00000000-0000-0000-0000-000000004533',
 digest='a'.repeat(64),zero='0'.repeat(64),now=2_000_000_000_000;
const denied=p=>assert.rejects(p,e=>e.code==='CAR02_WITNESS_UNVERIFIED'&&e.status===403);
async function fixture(over={}){
 const e=generateKeyPairSync('ed25519'),w=generateKeyPairSync('ed25519');
 const signer=createCar02OfflineReviewEvidenceSealR457({
  privateKey:e.privateKey,keyId:'offline_publisher',keyEpoch:3,nowMs:()=>now,
  authorizeAuditor:async()=>({verified:true,mode:'isolated_qa',role:'auditor',shopCode:shop}),
  readSnapshot:async()=>({rows:[{event_id:event,integrity_state:'consistent_closed',
    review_stage:'closed_without_delivery_assertion',audit_steps:2,evidence_sha256:digest}]})
 });
 const envelope=await signer.seal({eventId:event,sequence:7,previousDigest:'b'.repeat(64)});
 const checkpoint=signCar02OfflineCheckpointR458({envelope,privateKey:w.privateKey,
   witnessKeyId:'offline_witness',witnessKeyEpoch:2,witnessSequence:19,
   previousWitnessDigest:'c'.repeat(64),witnessedAtMs:now+1});
 let value={checkpoint,cursor:{sequence:19,digest:checkpoint.checkpointDigest,previousDigest:'c'.repeat(64)}},readCount=0;
 const read=async()=>{readCount++;if(over.failRead)throw Error('untrusted witness backend');return value};
 const options={trustedRead:read,pinnedEvidencePublicKey:e.publicKey,pinnedWitnessPublicKey:w.publicKey,
  expectedEvidenceKeyId:'offline_publisher',minEvidenceKeyEpoch:3,
  expectedWitnessKeyId:'offline_witness',minWitnessKeyEpoch:2,nowMs:()=>now+2,maxAgeMs:300000};
 const verifier=createCar02OfflineWitnessVerifierR458({...options,...over.options});
 return {e,w,envelope,checkpoint,options,verifier,get readCount(){return readCount},
  set value(v){value=v},get value(){return value}};
}
const check=f=>f.verifier.verifyEvidence({shopCode:shop,eventId:event,envelope:f.envelope});
test('review-only release lock and required independent pinned trust',()=>{
 assert.equal(CAR02_V458_RELEASE_LOCK,true);
 assert.throws(()=>createCar02OfflineWitnessVerifierR458(),/INDEPENDENT_TRUST_REQUIRED/);
});
test('valid TWO Ed25519 signers and pinned CURRENT independent anchor',async()=>{
 const f=await fixture(),r=await check(f);
 assert.deepEqual(r,{status:'witnessed_review_only',checkpointDigest:f.checkpoint.checkpointDigest,witnessSequence:19});
 assert.equal(f.readCount,1);assert.ok(Object.isFrozen(r));
});
test('publisher signed V457 evidence alone cannot satisfy independent witness',async()=>{
 const f=await fixture();f.value={checkpoint:null,cursor:{}};await denied(check(f));
});
test('an old valid checkpoint after the independent cursor advances is rejected',async()=>{
 const f=await fixture();f.value={checkpoint:f.checkpoint,cursor:{...f.value.cursor,sequence:20}};await denied(check(f));
});
test('external latest digest mismatch rejects an authentic but stale signed checkpoint',async()=>{
 const f=await fixture();f.value={checkpoint:f.checkpoint,cursor:{...f.value.cursor,digest:'d'.repeat(64)}};await denied(check(f));
});
test('independently pinned previous digest blocks local cursor forgery',async()=>{
 const f=await fixture();f.value={checkpoint:f.checkpoint,cursor:{...f.value.cursor,previousDigest:'1'.repeat(64)}};await denied(check(f));
});
test('witness signature tampering is denied despite publisher signature remaining valid',async()=>{
 const f=await fixture();f.value={...f.value,checkpoint:{...f.checkpoint,signature:'A'.repeat(86)}};await denied(check(f));
});
test('witness payload editing cannot reuse former Ed25519 signature',async()=>{
 const f=await fixture();f.value={...f.value,checkpoint:{...f.checkpoint,payload:{...f.checkpoint.payload,witnessSequence:21}}};await denied(check(f));
});
test('witness signing key substitution is denied by a pinned witness key',async()=>{
 const f=await fixture(),foreign=generateKeyPairSync('ed25519');
 const changed=signCar02OfflineCheckpointR458({envelope:f.envelope,privateKey:foreign.privateKey,
  witnessKeyId:'offline_witness',witnessKeyEpoch:2,witnessSequence:19,
  previousWitnessDigest:'c'.repeat(64),witnessedAtMs:now+1});
 f.value={checkpoint:changed,cursor:{...f.value.cursor,digest:changed.checkpointDigest}};await denied(check(f));
});
test('publisher signature tamper cannot pass even with genuine witness pointing to prior envelope',async()=>{
 const f=await fixture();await denied(f.verifier.verifyEvidence({shopCode:shop,eventId:event,
  envelope:{...f.envelope,signature:'A'.repeat(86)}}));
});
test('publisher digest altered cannot be accepted with pinned witness',async()=>{
 const f=await fixture();await denied(f.verifier.verifyEvidence({shopCode:shop,eventId:event,
  envelope:{...f.envelope,envelopeDigest:'f'.repeat(64)}}));
});
test('different tenant is rejected without any fallback grant',async()=>{
 const f=await fixture();await denied(f.verifier.verifyEvidence({shopCode:'qa_shop_b',eventId:event,envelope:f.envelope}));
});
test('different event ID is rejected without fallback grant',async()=>{
 const f=await fixture();await denied(f.verifier.verifyEvidence({shopCode:shop,eventId:'00000000-0000-0000-0000-000000004599',envelope:f.envelope}));
});
test('witness key ID is pinned and cannot be rewritten by publisher',async()=>{
 const f=await fixture({options:{expectedWitnessKeyId:'another_witness'}});await denied(check(f));
});
test('witness key epoch minimum prevents retired witness rollback',async()=>{
 const f=await fixture({options:{minWitnessKeyEpoch:3}});await denied(check(f));
});
test('publisher key ID minimum and epoch independently enforced',async()=>{
 for(const opt of [{expectedEvidenceKeyId:'old_publisher'},{minEvidenceKeyEpoch:4}]){
   const f=await fixture({options:opt});await denied(check(f));
 }
});
test('both publisher and witness timestamps must be fresh',async()=>{
 const f=await fixture({options:{nowMs:()=>now+300002}});await denied(check(f));
});
test('trusted witness read failures fail closed and leak no database exception',async()=>{
 const f=await fixture({failRead:true});await denied(check(f));
});
test('malformed untrusted witness cursor or extra fields cannot be accepted',async()=>{
 for(const cursor of [{sequence:19,digest:'a'.repeat(64)},
   {sequence:19,digest:'a'.repeat(64),previousDigest:'b'.repeat(64),admin:true},
   {sequence:'19',digest:'a'.repeat(64),previousDigest:zero}]){
  const f=await fixture();f.value={checkpoint:f.checkpoint,cursor};await denied(check(f));
 }
});
test('synthetic witness signer rejects missing secret and invalid cursor digest',async()=>{
 const f=await fixture();assert.throws(()=>signCar02OfflineCheckpointR458({envelope:f.envelope}),/OFFLINE_WITNESS_INPUT_REQUIRED/);
 assert.throws(()=>signCar02OfflineCheckpointR458({envelope:f.envelope,privateKey:f.w.privateKey,
 witnessKeyId:'offline_witness',witnessKeyEpoch:2,witnessSequence:1,
 previousWitnessDigest:'bad',witnessedAtMs:now}),/OFFLINE_WITNESS_INPUT_REQUIRED/);
});
test('V457 signature remains signed, R52 remains locked and no V458 production wiring',()=>{
 const entry=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
 const v457=readFileSync(new URL('./car02-review-evidence-seal-r457.mjs',import.meta.url),'utf8');
 assert.match(entry,/const\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/);
 assert.match(v457,/CAR02_V457_RELEASE_LOCK\s*=\s*true/);
 assert.doesNotMatch(entry,/independent-witness-r458|v458_private/);
});
