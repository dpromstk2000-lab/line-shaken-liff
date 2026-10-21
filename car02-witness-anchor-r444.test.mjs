import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {car02ReviewChainHashR442} from './car02-review-integrity-r442.mjs';
import {signCar02OfflineWitnessR443} from './car02-review-witness-r443.mjs';
import {CAR02_V444_RELEASE_LOCK,CAR02_V444_READ_SQL,CAR02_V444_CAS_SQL,
 createCar02OfflineWitnessAnchorR444} from './car02-witness-anchor-r444.mjs';
const shop='qa_shop_a',evt='00000000-0000-0000-0000-000000004421',
 user1='00000000-0000-0000-0000-000000004422',user2='00000000-0000-0000-0000-000000004423';
const k1=generateKeyPairSync('ed25519'), k2=generateKeyPairSync('ed25519'), evil=generateKeyPairSync('ed25519');
const now=2_000_000_000_000;
function snapshot(n=2,tenant=shop,event=evt,mutate=false){
 const entries=[];let previousHash='0'.repeat(64);
 for(let i=0;i<n;i++){
  const row={seq:i+1,reviewerSub:[user1,user2][i],evidenceSha256:(mutate&&i===0?'f':i===0?'a':'b').repeat(64),
   disposition:i===0?'investigated':'escalated',previousHash};
  row.entryHash=car02ReviewChainHashR442({shop:tenant,eventId:event,seq:row.seq,reviewerSub:row.reviewerSub,
    evidenceSha256:row.evidenceSha256,disposition:row.disposition,previousHash});
  previousHash=row.entryHash;entries.push(row);
 }
 return {shopCode:tenant,eventId:event,status:'manual_review',entries};
}
const att=(snap,key=k1.privateKey,issuedAtMs=now)=>signCar02OfflineWitnessR443({snapshot:snap,privateKey:key,issuedAtMs});
const denied=p=>assert.rejects(p,e=>e.code==='CAR02_WITNESS_ANCHOR_REJECTED');
function setup(){
 const map=new Map(),calls=[];let failRead=false,failWrite=false,duplicateRows=false;
 const store={query:async(sql,params)=>{
   calls.push({sql,params});const id=`${params[0]}|${params[1]}`;
   if(sql===CAR02_V444_READ_SQL){if(failRead)throw Error('secret DB error');
     const x=map.get(id);return {rows:duplicateRows?[x,x]:x?[{...x}]:[]};}
   if(sql!==CAR02_V444_CAS_SQL)throw Error('UNREVIEWED_SQL');
   if(failWrite)return {rows:[{recorded:false}]};
   const [s,e,count,head,issued,keyId,keyEpoch,signature,expectedCount,expectedHead]=params;
   const before=map.get(id),oldCount=before?.count??0,oldHead=before?.head_hash??'0'.repeat(64);
   if(expectedCount!==oldCount||expectedHead!==oldHead||count<=oldCount||
      (before&&(issued<=before.issued_at_ms||keyEpoch<before.key_epoch)))return {rows:[{recorded:false}]};
   map.set(id,{count,head_hash:head,issued_at_ms:issued,key_id:keyId,key_epoch:keyEpoch,signature});
   return {rows:[{recorded:true}]};
 }};
 const anchor=createCar02OfflineWitnessAnchorR444({store,trustRoots:{K1:{publicKey:k1.publicKey,epoch:1},K2:{publicKey:k2.publicKey,epoch:2}}});
 return {anchor,map,calls,set failRead(v){failRead=v},set failWrite(v){failWrite=v},set duplicateRows(v){duplicateRows=v}};
}
test('hard release lock and fixed parameterized storage calls',()=>{
 assert.equal(CAR02_V444_RELEASE_LOCK,true);assert.match(CAR02_V444_READ_SQL,/^SELECT count,head_hash/);
 assert.match(CAR02_V444_CAS_SQL,/^SELECT public\.v444_qa_append_anchor/);
 const x=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
 assert.match(x,/const\s+CAR02_RELEASE_LOCK\s*=\s*true/);
 assert.doesNotMatch(x,/car02-witness-anchor-r444/);
});
test('missing trust roots or storage cannot initialize',()=>{
 assert.throws(()=>createCar02OfflineWitnessAnchorR444(),/TRUST_STORE_REQUIRED/);
 assert.throws(()=>createCar02OfflineWitnessAnchorR444({store:{query:async()=>{}},trustRoots:{BAD:{publicKey:null,epoch:1}}}),/PINNED_KEY_REQUIRED/);
});
test('first checkpoint is signature-verified and archived in isolated store',async()=>{
 const h=setup(),s=snapshot(1),a=att(s),r=await h.anchor.append({snapshot:s,attestation:a,keyId:'K1'});
 assert.equal(r.status,'anchored_review_only');assert.equal(r.count,1);
 assert.equal(h.map.size,1);assert.equal(h.calls[0].sql,CAR02_V444_READ_SQL);
 assert.equal(h.calls[1].sql,CAR02_V444_CAS_SQL);
});
test('second checkpoint with a pinned higher key epoch advances the archive',async()=>{
 const h=setup();await h.anchor.append({snapshot:snapshot(1),attestation:att(snapshot(1)),keyId:'K1'});
 const r=await h.anchor.append({snapshot:snapshot(2),attestation:att(snapshot(2),k2.privateKey,now+1000),keyId:'K2'});
 assert.equal(r.count,2);assert.equal(h.map.values().next().value.key_epoch,2);
});
test('same signed checkpoint cannot be appended twice',async()=>{
 const h=setup(),s=snapshot(1),a=att(s);await h.anchor.append({snapshot:s,attestation:a,keyId:'K1'});
 await denied(h.anchor.append({snapshot:s,attestation:a,keyId:'K1'}));assert.equal(h.map.size,1);
});
test('after key rotation older pinned epoch is rejected',async()=>{
 const h=setup();await h.anchor.append({snapshot:snapshot(1),attestation:att(snapshot(1),k2.privateKey),keyId:'K2'});
 await denied(h.anchor.append({snapshot:snapshot(2),attestation:att(snapshot(2),k1.privateKey,now+1000),keyId:'K1'}));
});
test('same-epoch key can progress without implicit downgrade',async()=>{
 const h=setup();await h.anchor.append({snapshot:snapshot(1),attestation:att(snapshot(1)),keyId:'K1'});
 assert.equal((await h.anchor.append({snapshot:snapshot(2),attestation:att(snapshot(2),k1.privateKey,now+1000),keyId:'K1'})).count,2);
});
test('unsigned, unknown-key and incorrectly signed attestations denied before database calls',async()=>{
 const h=setup(),s=snapshot(1);
 await denied(h.anchor.append({snapshot:s,attestation:att(s),keyId:'unknown'}));
 await denied(h.anchor.append({snapshot:s,attestation:att(s,evil.privateKey),keyId:'K1'}));
 await denied(h.anchor.append({snapshot:s,attestation:{checkpoint:att(s).checkpoint,signature:'forged'},keyId:'K1'}));
 assert.equal(h.calls.length,0);
});
test('valid but completely rewritten chain conflicts with existing detached checkpoint',async()=>{
 const h=setup(),old=snapshot(1);await h.anchor.append({snapshot:old,attestation:att(old),keyId:'K1'});
 const changed=snapshot(2,shop,evt,true);
 await denied(h.anchor.append({snapshot:changed,attestation:att(changed,k2.privateKey,now+1000),keyId:'K2'}));
 assert.equal(h.map.values().next().value.count,1);
});
test('cross-tenant and cross-event witnesses do not overwrite each other',async()=>{
 const h=setup();const a=snapshot(1),b=snapshot(1,'qa_shop_b','00000000-0000-0000-0000-000000004429');
 await h.anchor.append({snapshot:a,attestation:att(a),keyId:'K1'});
 await h.anchor.append({snapshot:b,attestation:att(b),keyId:'K1'});
 assert.equal(h.map.size,2);
});
test('earlier issuance timestamp cannot roll forward count',async()=>{
 const h=setup();await h.anchor.append({snapshot:snapshot(1),attestation:att(snapshot(1),k1.privateKey,now),keyId:'K1'});
 await denied(h.anchor.append({snapshot:snapshot(2),attestation:att(snapshot(2),k2.privateKey,now),keyId:'K2'}));
});
test('failed archive CAS rejects even valid trusted signed witness',async()=>{
 const h=setup();h.failWrite=true;const s=snapshot(1);
 await denied(h.anchor.append({snapshot:s,attestation:att(s),keyId:'K1'}));
});
test('unavailable or duplicated archive read fails closed, no signatures accepted',async()=>{
 const h=setup();h.failRead=true;const s=snapshot(1);
 await denied(h.anchor.append({snapshot:s,attestation:att(s),keyId:'K1'}));
 const z=setup();z.duplicateRows=true;
 await denied(z.anchor.append({snapshot:s,attestation:att(s),keyId:'K1'}));
});
test('zero-record snapshot cannot be anchored as an authoritative audit finding',async()=>{
 const h=setup(),s=snapshot(0);await denied(h.anchor.append({snapshot:s,attestation:att(s),keyId:'K1'}));
});
test('trusted prior anchor whose signature was modified is rejected on roll-forward',async()=>{
 const h=setup(),s=snapshot(1);await h.anchor.append({snapshot:s,attestation:att(s),keyId:'K1'});
 h.map.values().next().value.signature='tampered-signature';
 await denied(h.anchor.append({snapshot:snapshot(2),attestation:att(snapshot(2),k2.privateKey,now+1000),keyId:'K2'}));
});
