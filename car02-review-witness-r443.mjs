/**
 * DPRO CAR02 V4.43 — OFFLINE DETACHED ED25519 WITNESS CHECKPOINT MODEL.
 * REVIEW-ONLY / NOT DEPLOYABLE. Existing R44/R46/R50/R52 and V4.42 are unchanged.
 * A checkpoint MUST be persisted in an independently controlled immutable archive
 * with a pinned verification key before it can protect against a privileged DB rewrite.
 * This CI uses an ephemeral key and an in-memory witness. Neither immutable storage,
 * external trust roots, secure key custody nor real reviewer authentication exist.
 * A DB hash chain alone cannot detect fully recomputed history. This model can detect
 * changes ONLY relative to an independently retained, authentic checkpoint.
 */
import {createHash, sign, verify} from 'node:crypto';
import {car02ReviewChainHashR442, CAR02_V442_RELEASE_LOCK} from './car02-review-integrity-r442.mjs';
export const CAR02_V443_RELEASE_LOCK=true;
const HEX=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHOP=/^[A-Za-z0-9_-]{1,64}$/;
const B64=/^[A-Za-z0-9_-]{86}$/;
const GENESIS='0'.repeat(64);
const unauthorized=()=>{const e=new Error('CAR02_WITNESS_REJECTED');e.code='CAR02_WITNESS_REJECTED';throw e;};
const exact=(o,fields)=>o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).sort().join(',')===fields.slice().sort().join(',');
const validCount=n=>Number.isSafeInteger(n)&&n>=0&&n<=2;
const validMs=n=>Number.isSafeInteger(n)&&n>0;
const validHead=s=>typeof s==='string'&&HEX.test(s);
const frozen=o=>Object.freeze(o);

export function inspectCar02ReviewSnapshotR443(snapshot){
 if(!exact(snapshot,['shopCode','eventId','status','entries']) ||
   !SHOP.test(snapshot.shopCode)||!UUID.test(snapshot.eventId)||
   snapshot.status!=='manual_review'||!Array.isArray(snapshot.entries)||
   !validCount(snapshot.entries.length))unauthorized();
 let prev=GENESIS;const reviewers=new Set(),evidences=new Set();const hashes=[];
 for(let n=0;n<snapshot.entries.length;n++){
   const row=snapshot.entries[n];
   if(!exact(row,['seq','reviewerSub','evidenceSha256','disposition','previousHash','entryHash'])||
      row.seq!==n+1||!UUID.test(row.reviewerSub)||!validHead(row.evidenceSha256)||
      !['investigated','escalated'].includes(row.disposition)||row.previousHash!==prev||
      !validHead(row.entryHash)||reviewers.has(row.reviewerSub)||evidences.has(row.evidenceSha256))unauthorized();
   const hash=car02ReviewChainHashR442({shop:snapshot.shopCode,eventId:snapshot.eventId,seq:row.seq,
     reviewerSub:row.reviewerSub,evidenceSha256:row.evidenceSha256,disposition:row.disposition,previousHash:prev});
   if(hash!==row.entryHash)unauthorized();
   hashes.push(hash);reviewers.add(row.reviewerSub);evidences.add(row.evidenceSha256);prev=hash;
 }
 return frozen({shopCode:snapshot.shopCode,eventId:snapshot.eventId,count:hashes.length,
   headHash:prev,hashes:frozen(hashes)});
}
function validCheckpoint(cp){
 return exact(cp,['domain','shopCode','eventId','count','headHash','issuedAtMs'])&&
  cp.domain==='CAR02_V443_OFFLINE_WITNESS_V1'&&typeof cp.shopCode==='string'&&SHOP.test(cp.shopCode)&&
  typeof cp.eventId==='string'&&UUID.test(cp.eventId)&&validCount(cp.count)&&
  validHead(cp.headHash)&&validMs(cp.issuedAtMs)&&
  (cp.count>0||cp.headHash===GENESIS);
}
function payloadOf(cp){
 return JSON.stringify({domain:cp.domain,shopCode:cp.shopCode,eventId:cp.eventId,
   count:cp.count,headHash:cp.headHash,issuedAtMs:cp.issuedAtMs});
}
export function signCar02OfflineWitnessR443({snapshot,privateKey,issuedAtMs}={}){
 if(!CAR02_V443_RELEASE_LOCK||!CAR02_V442_RELEASE_LOCK||
   privateKey?.asymmetricKeyType!=='ed25519'||!validMs(issuedAtMs))unauthorized();
 const verified=inspectCar02ReviewSnapshotR443(snapshot);
 const checkpoint=frozen({domain:'CAR02_V443_OFFLINE_WITNESS_V1',shopCode:verified.shopCode,
   eventId:verified.eventId,count:verified.count,headHash:verified.headHash,issuedAtMs});
 const signature=sign(null,Buffer.from(payloadOf(checkpoint)),privateKey).toString('base64url');
 return frozen({checkpoint,signature});
}
/**
 * verificationKey MUST be pinned independently from this report and database.
 * `snapshot` is recomputed entirely. A witnessed prefix may have a valid extension;
 * requireExactHead must be true before treating the full current history as witnessed.
 */
export function verifyCar02OfflineWitnessR443({snapshot,attestation,verificationKey,
 expectedShop,expectedEventId,requireExactHead=true,minimumIssuedAtMs=0}={}){
 if(!CAR02_V443_RELEASE_LOCK||verificationKey?.asymmetricKeyType!=='ed25519'||
    !exact(attestation,['checkpoint','signature'])||!validCheckpoint(attestation.checkpoint)||
    typeof attestation.signature!=='string'||!B64.test(attestation.signature)||
    typeof expectedShop!=='string'||!SHOP.test(expectedShop)||
    typeof expectedEventId!=='string'||!UUID.test(expectedEventId)||
    typeof requireExactHead!=='boolean'||!Number.isSafeInteger(minimumIssuedAtMs)||minimumIssuedAtMs<0)unauthorized();
 const cp=attestation.checkpoint;
 if(cp.shopCode!==expectedShop||cp.eventId!==expectedEventId||cp.issuedAtMs<minimumIssuedAtMs)unauthorized();
 const sig=Buffer.from(attestation.signature,'base64url');
 if(sig.length!==64||sig.toString('base64url')!==attestation.signature||
   !verify(null,Buffer.from(payloadOf(cp)),verificationKey,sig))unauthorized();
 const v=inspectCar02ReviewSnapshotR443(snapshot);
 if(v.shopCode!==expectedShop||v.eventId!==expectedEventId||v.count<cp.count)unauthorized();
 const witnessed=cp.count===0?GENESIS:v.hashes[cp.count-1];
 if(witnessed!==cp.headHash || (requireExactHead&&v.count!==cp.count))unauthorized();
 return frozen({status:v.count===cp.count?'witnessed':'valid_extension_unwitnessed',
   witnessedCount:cp.count,currentCount:v.count,headHash:v.headHash});
}
