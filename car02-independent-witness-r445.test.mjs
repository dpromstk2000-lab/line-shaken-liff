import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {car02ReviewChainHashR442} from './car02-review-integrity-r442.mjs';
import {signCar02OfflineWitnessR443} from './car02-review-witness-r443.mjs';
import {CAR02_V445_RELEASE_LOCK,createCar02IndependentWitnessR445} from './car02-independent-witness-r445.mjs';
const shop='qa_shop_a',evt='00000000-0000-0000-0000-000000004421',users=[
 '00000000-0000-0000-0000-000000004422','00000000-0000-0000-0000-000000004423'];
const k1=generateKeyPairSync('ed25519'),k2=generateKeyPairSync('ed25519'),evil=generateKeyPairSync('ed25519');
const now=2000000000000;
const roots={KEY1:{publicKey:k1.publicKey,epoch:1},KEY2:{publicKey:k2.publicKey,epoch:2}};
const denial=fn=>assert.rejects(fn,e=>e?.code==='CAR02_INDEPENDENT_WITNESS_REJECTED');
function snap(count=1,s=shop,e=evt,changed=false){
 let previousHash='0'.repeat(64);const entries=[];
 for(let i=0;i<count;i++){
  const entry={seq:i+1,reviewerSub:users[i],evidenceSha256:(changed&&i===0?'f':i===0?'a':'b').repeat(64),
    disposition:i===0?'investigated':'escalated',previousHash};
  entry.entryHash=car02ReviewChainHashR442({shop:s,eventId:e,seq:entry.seq,reviewerSub:entry.reviewerSub,
    evidenceSha256:entry.evidenceSha256,disposition:entry.disposition,previousHash});
  previousHash=entry.entryHash;entries.push(entry);
 }
 return {shopCode:s,eventId:e,status:'manual_review',entries};
}
const sign=(s,key=k1.privateKey,at=now)=>signCar02OfflineWitnessR443({snapshot:s,privateKey:key,issuedAtMs:at});
const append=(guard,s=snap(),keyId='KEY1',key=k1.privateKey,at=now)=>
 guard.append({snapshot:s,attestation:sign(s,key,at),keyId});
function fixture({lostAck=false,commitBeforeLoss=false,failRead=false,writeReject=false,
                  staleRead=false,skipPersist=false,wrongRevision=false}={}){
 const history=new Map(),calls=[];
 const identity=({shopCode,eventId})=>`${shopCode}|${eventId}`;
 const archive={
  async readCurrent(scope){calls.push('READ');if(failRead)throw Error('archive is offline');
   const v=history.get(identity(scope));
   if(staleRead)return {revision:0,record:null};
   return v?structuredClone(v):{revision:0,record:null};
  },
  async compareAndAppend({shopCode,eventId,expectedRevision,envelope}){
   calls.push('CAS');
   const id=identity({shopCode,eventId}),prior=history.get(id),version=prior?.revision??0;
   if(writeReject)return {accepted:false};
   if(version!==expectedRevision)return {accepted:false};
   if(!skipPersist&&(!lostAck||commitBeforeLoss))history.set(id,{revision:version+(wrongRevision?2:1),record:structuredClone(envelope)});
   if(lostAck)throw Error('lost acknowledgement, outcome unknown');
   return {accepted:true};
  }
 };
 const make=()=>createCar02IndependentWitnessR445({archive,trustRoots:roots});
 return {guard:make(),make,archive,history,calls};
}
test('review-only hard release lock remains true and original R52 disconnected',()=>{
 assert.equal(CAR02_V445_RELEASE_LOCK,true);
 const edge=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
 assert.match(edge,/const\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/);
 assert.doesNotMatch(edge,/car02-independent-witness-r445/);
});
test('missing archive or pinned trust key fails closed without local DB fallback',()=>{
 assert.throws(()=>createCar02IndependentWitnessR445(),/CAR02_V445_ARCHIVE_REQUIRED/);
 assert.throws(()=>createCar02IndependentWitnessR445({archive:{readCurrent(){},compareAndAppend(){}}}),/CAR02_V445_PINNED_TRUST_REQUIRED/);
 assert.throws(()=>createCar02IndependentWitnessR445({archive:{readCurrent(){},compareAndAppend(){}},trustRoots:{X:{publicKey:k1.publicKey,epoch:1},Y:{publicKey:k2.publicKey,epoch:1}}}),/CAR02_V445_PINNED_TRUST_REQUIRED/);
});
test('absent independently retained checkpoint never validates current DB history',async()=>{
 await denial(fixture().guard.verifyCurrent(snap()));
});
test('valid signed checkpoint can be appended and reread without invoking database fallback',async()=>{
 const h=fixture();const r=await append(h.guard);assert.equal(r.status,'witnessed');
 assert.equal(r.count,1);assert.equal(r.revision,1);
 assert.equal((await h.guard.verifyCurrent(snap())).status,'witnessed');
 assert.deepEqual(h.calls,['READ','CAS','READ','READ']);
});
test('independent archive can be reread by a newly created guard after restart',async()=>{
 const h=fixture();await append(h.guard);
 assert.equal((await h.make().verifyCurrent(snap())).count,1);
});
test('new higher-epoch signed second review advances external checkpoint',async()=>{
 const h=fixture();await append(h.guard);
 const r=await append(h.guard,snap(2),'KEY2',k2.privateKey,now+1000);
 assert.equal(r.status,'witnessed');assert.equal(r.count,2);
 assert.equal((await h.make().verifyCurrent(snap(2))).keyId,'KEY2');
});
test('recomputed database hash chain is rejected against previously stored checkpoint',async()=>{
 const h=fixture();await append(h.guard);
 await denial(h.guard.verifyCurrent(snap(1,shop,evt,true)));
});
test('truncated snapshot and new unwitnessed extension fail closed',async()=>{
 const h=fixture();await append(h.guard);
 await denial(h.guard.verifyCurrent(snap(2)));
 await append(h.guard,snap(2),'KEY2',k2.privateKey,now+1000);
 await denial(h.guard.verifyCurrent(snap(1)));
});
test('same signed witness replay and time rollback are denied',async()=>{
 const h=fixture();await append(h.guard);
 await denial(append(h.guard));
 await denial(append(h.guard,snap(2),'KEY2',k2.privateKey,now-1000));
});
test('old pinned key cannot be reused after higher key epoch',async()=>{
 const h=fixture();await append(h.guard,snap(1),'KEY2',k2.privateKey);
 await denial(append(h.guard,snap(2),'KEY1',k1.privateKey,now+1000));
});
test('unknown key and wrong signing private key rejected before any archive reads',async()=>{
 const h=fixture();await denial(append(h.guard,snap(), 'unknown', k1.privateKey));
 await denial(append(h.guard,snap(),'KEY1',evil.privateKey));
 assert.equal(h.calls.length,0);
});
test('other tenant/event scopes cannot impersonate a witnessed case',async()=>{
 const h=fixture();await append(h.guard);
 await denial(h.guard.verifyCurrent(snap(1,'qa_shop_b',evt)));
 await denial(h.guard.verifyCurrent(snap(1,shop,'00000000-0000-0000-0000-000000004429')));
});
test('external archive unavailable fails closed and cannot falsely witness',async()=>{
 const h=fixture({failRead:true});await denial(h.guard.verifyCurrent(snap()));await denial(append(h.guard));
 assert.equal(h.calls.includes('CAS'),false);
});
test('rejected CAS does not report durable witness even when signature valid',async()=>{
 const h=fixture({writeReject:true});const r=await append(h.guard);assert.equal(r.status,'indeterminate');
 await denial(h.guard.verifyCurrent(snap()));
});
test('lost archive acknowledgement with durable record is reconciled by second read',async()=>{
 const h=fixture({lostAck:true,commitBeforeLoss:true});const r=await append(h.guard);
 assert.equal(r.status,'reconciled_witnessed');assert.equal(r.revision,1);
 assert.equal((await h.guard.verifyCurrent(snap())).status,'witnessed');
});
test('lost acknowledgement without durable record is indeterminate, never successful',async()=>{
 const h=fixture({lostAck:true,commitBeforeLoss:false});const r=await append(h.guard);
 assert.equal(r.status,'indeterminate');await denial(h.guard.verifyCurrent(snap()));
});
test('a forged success acknowledgement without durable persisted checkpoint is refused',async()=>{
 const h=fixture({skipPersist:true});await denial(append(h.guard));
});
test('wrong archive revision cannot silently change anti-rollback result',async()=>{
 const h=fixture({wrongRevision:true});await denial(append(h.guard));
});
test('stale archive read cannot certify historical checkpoint or commit',async()=>{
 const h=fixture({staleRead:true});await denial(append(h.guard));
 await denial(h.guard.verifyCurrent(snap()));
});
