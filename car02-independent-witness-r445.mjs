/**
 * DPRO CAR02 V4.45 — REVIEW-ONLY external witness ADAPTER CONTRACT and anti-rollback QA.
 * NEVER DEPLOY. No external archive is integrated. Only a disposable in-memory adapter
 * is used in QA. This module DOES NOT establish that an injected adapter is actually
 * independent, immutable, durable, accessible, authenticated, or beyond a DBA's reach.
 * Caller must supply an independently authenticated append-only/WORM-backed adapter
 * that protects revisions, pinned Ed25519 keys, and records across process restarts.
 * Not tied to real R44/R46/R50/R52, Supabase, LINE, business writes or real identities.
 * Rejects absent/archive-inconsistent witness; never falls back to a DB-local anchor.
 */
import {inspectCar02ReviewSnapshotR443,verifyCar02OfflineWitnessR443} from './car02-review-witness-r443.mjs';
export const CAR02_V445_RELEASE_LOCK=true;
const ID=/^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const deny=()=>{const e=Error('CAR02_INDEPENDENT_WITNESS_REJECTED');e.code='CAR02_INDEPENDENT_WITNESS_REJECTED';throw e;};
const safeRevision=n=>Number.isSafeInteger(n)&&n>=0&&n<=Number.MAX_SAFE_INTEGER-1;
const ownKeys=(x,fields)=>x&&typeof x==='object'&&!Array.isArray(x)&&
  Object.keys(x).sort().join(',')===fields.slice().sort().join(',');
function pinnedRoots(roots){
 if(!roots||typeof roots!=='object'||Array.isArray(roots)||!Object.keys(roots).length)throw Error('CAR02_V445_PINNED_TRUST_REQUIRED');
 const result=new Map();const epochs=new Set();
 for(const [id,item] of Object.entries(roots)){
  if(!ID.test(id)||item?.publicKey?.asymmetricKeyType!=='ed25519'||!Number.isSafeInteger(item.epoch)||
     item.epoch<=0||item.epoch>1000||epochs.has(item.epoch))throw Error('CAR02_V445_PINNED_TRUST_REQUIRED');
  epochs.add(item.epoch);result.set(id,Object.freeze({publicKey:item.publicKey,epoch:item.epoch}));
 }
 return result;
}
function envelopeValid(envelope,roots,snapshot,{exactHead=true}={}){
 if(!ownKeys(envelope,['keyId','attestation'])||!roots.has(envelope.keyId))deny();
 const key=roots.get(envelope.keyId);
 const scope=inspectCar02ReviewSnapshotR443(snapshot);
 verifyCar02OfflineWitnessR443({snapshot,attestation:envelope.attestation,verificationKey:key.publicKey,
   expectedShop:scope.shopCode,expectedEventId:scope.eventId,requireExactHead:exactHead});
 return {keyId:envelope.keyId,epoch:key.epoch,cp:envelope.attestation.checkpoint,scope};
}
function exactEnvelope(a,b){
 return a?.keyId===b?.keyId&&a?.attestation?.signature===b?.attestation?.signature&&
 JSON.stringify(a?.attestation?.checkpoint)===JSON.stringify(b?.attestation?.checkpoint);
}
/** archive.readCurrent({shopCode,eventId}) -> {revision:nonnegative integer,record:null|envelope}
 * archive.compareAndAppend({shopCode,eventId,expectedRevision,envelope}) -> {accepted:boolean}
 * Those methods are TRUST BOUNDARIES; QA tests only a separate memory fixture.
 */
export function createCar02IndependentWitnessR445({archive,trustRoots}={}){
 if(CAR02_V445_RELEASE_LOCK!==true||typeof archive?.readCurrent!=='function'||
    typeof archive?.compareAndAppend!=='function')throw Error('CAR02_V445_ARCHIVE_REQUIRED');
 const roots=pinnedRoots(trustRoots);
 const read=async(scope)=>{
  const r=await archive.readCurrent({shopCode:scope.shopCode,eventId:scope.eventId});
  if(!ownKeys(r,['revision','record'])||!safeRevision(r.revision)||
    ((r.revision===0)!==(r.record===null)))deny();
  return r;
 };
 const checkRecord=(snapshot,record,exactHead)=>envelopeValid(record,roots,snapshot,{exactHead});
 async function verifyCurrent(snapshot){
  try{
   const scope=inspectCar02ReviewSnapshotR443(snapshot);
   const held=await read(scope);
   if(!held.record)deny(); // missing external checkpoint -> no DB-local fallback
   const verified=checkRecord(snapshot,held.record,true);
   return Object.freeze({status:'witnessed',count:verified.cp.count,revision:held.revision,keyId:verified.keyId});
  }catch{deny();}
 }
 async function append({snapshot,attestation,keyId}={}){
  let scope,envelope,before;
  try{
   if(typeof keyId!=='string'||!roots.has(keyId))deny();
   scope=inspectCar02ReviewSnapshotR443(snapshot);
   if(scope.count===0)deny();
   envelope=Object.freeze({keyId,attestation});
   const proposed=checkRecord(snapshot,envelope,true);
   before=await read(scope);
   if(before.record){
    const prior=checkRecord(snapshot,before.record,false);
    if(prior.cp.count>=proposed.cp.count||prior.cp.issuedAtMs>=proposed.cp.issuedAtMs||
       proposed.epoch<prior.epoch)deny();
   }
  }catch{deny();}
  let acked=false;
  try{
   const response=await archive.compareAndAppend({shopCode:scope.shopCode,eventId:scope.eventId,
     expectedRevision:before.revision,envelope});
   if(!ownKeys(response,['accepted'])||response.accepted!==true)deny();
   acked=true;
  }catch{
   // An exception may follow a successful write: NEVER assume it rolled back.
   // Reread below. If not provably present, report an indeterminate state.
  }
  try{
   const after=await read(scope);
   if(after.revision!==before.revision+1||!exactEnvelope(after.record,envelope)){
    if(acked)deny();
    return Object.freeze({status:'indeterminate'});
   }
   checkRecord(snapshot,after.record,true);
   return Object.freeze({status:acked?'witnessed':'reconciled_witnessed',
     count:scope.count,revision:after.revision,keyId});
  }catch{
   if(acked)deny();
   return Object.freeze({status:'indeterminate'});
  }
 }
 return Object.freeze({verifyCurrent,append});
}
