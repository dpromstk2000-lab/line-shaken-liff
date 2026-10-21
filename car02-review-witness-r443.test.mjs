import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {car02ReviewChainHashR442} from './car02-review-integrity-r442.mjs';
import {CAR02_V443_RELEASE_LOCK,inspectCar02ReviewSnapshotR443,
 signCar02OfflineWitnessR443,verifyCar02OfflineWitnessR443} from './car02-review-witness-r443.mjs';
const shop='qa_shop_a',eventId='00000000-0000-0000-0000-000000004421';
const otherEvent='00000000-0000-0000-0000-000000004429';
const reviewer1='00000000-0000-0000-0000-000000004422',reviewer2='00000000-0000-0000-0000-000000004423';
const keys=generateKeyPairSync('ed25519');
const evil=generateKeyPairSync('ed25519');
const NOW=2_000_000_000_000;
const denied=fn=>assert.throws(fn,x=>x.code==='CAR02_WITNESS_REJECTED');
function snapshotOf(count=2){
 const entries=[];let prev='0'.repeat(64);
 for(let i=0;i<count;i++){
  const row={seq:i+1,reviewerSub:[reviewer1,reviewer2][i],evidenceSha256:["a","b"][i].repeat(64),
   disposition:['investigated','escalated'][i],previousHash:prev};
  row.entryHash=car02ReviewChainHashR442({shop,eventId,seq:row.seq,reviewerSub:row.reviewerSub,
   evidenceSha256:row.evidenceSha256,disposition:row.disposition,previousHash:prev});
  prev=row.entryHash;entries.push(row);
 }
 return {shopCode:shop,eventId,status:'manual_review',entries};
}
const signSnap=(s=snapshotOf(),key=keys.privateKey)=>signCar02OfflineWitnessR443({snapshot:s,privateKey:key,issuedAtMs:NOW});
const verifySnap=(s,att,over={})=>verifyCar02OfflineWitnessR443({snapshot:s,attestation:att,verificationKey:keys.publicKey,
 expectedShop:shop,expectedEventId:eventId,...over});
test('review-only release lock and original runtime lock stay closed',()=>{
 assert.equal(CAR02_V443_RELEASE_LOCK,true);
 const entry=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
 assert.match(entry,/CAR02_RELEASE_LOCK\s*=\s*true\s*;/);
 assert.doesNotMatch(entry,/car02-review-witness-r443/);
});
test('signed full snapshot verifies against a separately pinned public key',()=>{
 const s=snapshotOf(),a=signSnap(s),r=verifySnap(s,a);
 assert.equal(r.status,'witnessed');assert.equal(r.currentCount,2);
 assert.equal(Object.isFrozen(r),true);assert.equal(Object.isFrozen(a.checkpoint),true);
});
test('unchanged EMPTY chain checkpoint permits no phantom entries',()=>{
 const s=snapshotOf(0),a=signSnap(s);assert.equal(verifySnap(s,a).witnessedCount,0);
});
test('authenticated first record can be extended but extension is NOT witnessed',()=>{
 const old=snapshotOf(1),a=signSnap(old),next=snapshotOf(2);
 denied(()=>verifySnap(next,a));
 const r=verifySnap(next,a,{requireExactHead:false});
 assert.equal(r.status,'valid_extension_unwitnessed');assert.equal(r.witnessedCount,1);
});
test('rollback of second record below previously witnessed count is rejected',()=>{
 denied(()=>verifySnap(snapshotOf(1),signSnap(snapshotOf(2))));
});
test('recomputed completely different hash chain cannot impersonate witnessed history',()=>{
 const s=snapshotOf(),a=signSnap(s),revised=snapshotOf();
 revised.entries[0].evidenceSha256='f'.repeat(64);
 revised.entries[0].entryHash=car02ReviewChainHashR442({shop,eventId,seq:1,reviewerSub:reviewer1,
  evidenceSha256:'f'.repeat(64),disposition:'investigated',previousHash:'0'.repeat(64)});
 revised.entries[1].previousHash=revised.entries[0].entryHash;
 revised.entries[1].entryHash=car02ReviewChainHashR442({shop,eventId,seq:2,reviewerSub:reviewer2,
  evidenceSha256:'b'.repeat(64),disposition:'escalated',previousHash:revised.entries[1].previousHash});
 assert.equal(inspectCar02ReviewSnapshotR443(revised).count,2,'rewritten chain is internally consistent');
 denied(()=>verifySnap(revised,a));
});
test('tampering with issued checkpoint fields or signature is denied',()=>{
 const s=snapshotOf(),a=signSnap(s);
 denied(()=>verifySnap(s,{...a,checkpoint:{...a.checkpoint,count:1}}));
 denied(()=>verifySnap(s,{...a,checkpoint:{...a.checkpoint,shopCode:'other_shop'}}));
 denied(()=>verifySnap(s,{...a,signature:a.signature.slice(0,-1)+'!'}));
});
test('a witness signed using a different key is rejected by pinned trust root',()=>{
 denied(()=>verifySnap(snapshotOf(),signSnap(snapshotOf(),evil.privateKey)));
});
test('cross-tenant and cross-event replay are rejected',()=>{
 const s=snapshotOf(),a=signSnap(s);
 denied(()=>verifySnap(s,a,{expectedShop:'qa_shop_b'}));
 denied(()=>verifySnap(s,a,{expectedEventId:otherEvent}));
});
test('checkpoint with timestamp earlier than independent minimum is rejected',()=>{
 const s=snapshotOf(),a=signSnap(s);
 denied(()=>verifySnap(s,a,{minimumIssuedAtMs:NOW+1}));
});
test('missing external verification key or signing key fails closed',()=>{
 const s=snapshotOf(),a=signSnap(s);
 denied(()=>verifyCar02OfflineWitnessR443({snapshot:s,attestation:a,expectedShop:shop,expectedEventId:eventId}));
 denied(()=>signCar02OfflineWitnessR443({snapshot:s,issuedAtMs:NOW}));
});
test('malformed entries, evidence duplicates and mistaken delivery status rejected before sign',()=>{
 for(const change of [s=>s.entries[0].seq=2,s=>s.entries[1].evidenceSha256=s.entries[0].evidenceSha256,
  s=>s.status='delivered',s=>s.entries[1].entryHash='0'.repeat(64)]){
    const s=snapshotOf();change(s);denied(()=>signSnap(s));
  }
});
test('invalid signature serialization and hostile extra attributes are rejected',()=>{
 const s=snapshotOf(),a=signSnap(s);
 denied(()=>verifySnap(s,{checkpoint:a.checkpoint,signature:'!'.repeat(86)}));
 denied(()=>verifySnap(s,{...a,actorRole:'owner'}));
 denied(()=>verifySnap({...s,owner:'attacker'},a));
});
test('even a correctly signed later snapshot does not validate a separate older checkpoint',()=>{
 const s1=snapshotOf(1),s2=snapshotOf(2),a1=signSnap(s1),a2=signSnap(s2);
 assert.notEqual(a1.checkpoint.headHash,a2.checkpoint.headHash);
 assert.equal(verifySnap(s2,a2).status,'witnessed');
 denied(()=>verifySnap(s2,a1));
});
