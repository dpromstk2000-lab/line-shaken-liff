/**
 * DPRO CAR02 V4.44 — OFFLINE witness monotonic anchor + pinned key epoch candidate.
 * NOT DEPLOYABLE. V4.43's Ed25519 signature is verified against pinned local trust roots.
 * The injected store is an *offline trusted mock/CI PG17*; it is NOT an independent
 * immutable external witness. SQL itself DOES NOT verify Ed25519 signatures.
 * Production needs server-only trust/key custody, append-only external WORM storage,
 * integrity/rollback proof across DB administrators, trusted identity and commit fence.
 * Never import into R44/R46/R50/R52 or use a production Supabase/LINE connection.
 */
import {inspectCar02ReviewSnapshotR443,verifyCar02OfflineWitnessR443,CAR02_V443_RELEASE_LOCK} from './car02-review-witness-r443.mjs';
export const CAR02_V444_RELEASE_LOCK=true;
export const CAR02_V444_READ_SQL='SELECT count,head_hash,issued_at_ms,key_id,key_epoch,signature FROM public.v444_qa_anchor_current WHERE shop_code=$1 AND event_id=$2';
export const CAR02_V444_CAS_SQL='SELECT public.v444_qa_append_anchor($1::text,$2::uuid,$3::integer,$4::text,$5::bigint,$6::text,$7::integer,$8::text,$9::integer,$10::text) AS recorded';
const GENESIS='0'.repeat(64),UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY_ID=/^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const reject=()=>{const e=Error('CAR02_WITNESS_ANCHOR_REJECTED');e.code='CAR02_WITNESS_ANCHOR_REJECTED';throw e;};
const validPositive=x=>Number.isSafeInteger(x)&&x>0;
/** Pinned keys and their permitted rotation epochs are configured server-side. */
export function createCar02OfflineWitnessAnchorR444({store,trustRoots}={}){
 if(!CAR02_V444_RELEASE_LOCK||!CAR02_V443_RELEASE_LOCK||typeof store?.query!=='function'||
    !trustRoots||typeof trustRoots!=='object'||Array.isArray(trustRoots)||
    Object.keys(trustRoots).length===0)throw Error('CAR02_V444_TRUST_STORE_REQUIRED');
 const roots=new Map();
 for(const [id,cfg] of Object.entries(trustRoots)){
  if(!KEY_ID.test(id)||cfg?.publicKey?.asymmetricKeyType!=='ed25519'||
      !validPositive(cfg.epoch)||cfg.epoch>1000)throw Error('CAR02_V444_PINNED_KEY_REQUIRED');
  roots.set(id,Object.freeze({publicKey:cfg.publicKey,epoch:cfg.epoch}));
 }
 async function append({snapshot,attestation,keyId}={}){
  try{
   if(typeof keyId!=='string'||!roots.has(keyId))reject();
   const root=roots.get(keyId),current=inspectCar02ReviewSnapshotR443(snapshot);
   if(current.count===0)reject();
   verifyCar02OfflineWitnessR443({snapshot,attestation,verificationKey:root.publicKey,
      expectedShop:current.shopCode,expectedEventId:current.eventId,requireExactHead:true});
   const cp=attestation.checkpoint;
   const priorRows=await store.query(CAR02_V444_READ_SQL,[current.shopCode,current.eventId]);
   if(!Array.isArray(priorRows?.rows)||priorRows.rows.length>1)reject();
   let prevCount=0,prevHead=GENESIS;
   if(priorRows.rows.length===1){
    const p=priorRows.rows[0];
    if(!Number.isSafeInteger(p.count)||p.count<1||p.count>=current.count||
       typeof p.head_hash!=='string'||!(/^[a-f0-9]{64}$/).test(p.head_hash)||
       !validPositive(p.issued_at_ms)||typeof p.key_id!=='string'||!roots.has(p.key_id)||
       !validPositive(p.key_epoch)||p.key_epoch!==roots.get(p.key_id).epoch||
       typeof p.signature!=='string'||!roots.has(p.key_id))reject();
    // Recheck prior persisted attestation using independently PINNED old trust key.
    verifyCar02OfflineWitnessR443({snapshot,attestation:{checkpoint:{
      domain:'CAR02_V443_OFFLINE_WITNESS_V1',shopCode:current.shopCode,
      eventId:current.eventId,count:p.count,headHash:p.head_hash,
      issuedAtMs:p.issued_at_ms},signature:p.signature},
      verificationKey:roots.get(p.key_id).publicKey,
      expectedShop:current.shopCode,expectedEventId:current.eventId,requireExactHead:false});
    if(cp.issuedAtMs<=p.issued_at_ms||root.epoch<p.key_epoch||
      current.hashes[p.count-1]!==p.head_hash)reject();
    prevCount=p.count;prevHead=p.head_hash;
   }
   const result=await store.query(CAR02_V444_CAS_SQL,[current.shopCode,current.eventId,
     cp.count,cp.headHash,cp.issuedAtMs,keyId,root.epoch,attestation.signature,prevCount,prevHead]);
   if(result?.rows?.length!==1||result.rows[0]?.recorded!==true)reject();
   return Object.freeze({status:'anchored_review_only',count:cp.count,keyId,headHash:cp.headHash});
  }catch{reject();}
 }
 return Object.freeze({append});
}
