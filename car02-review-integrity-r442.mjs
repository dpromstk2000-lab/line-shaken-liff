/**
 * CAR02 V4.42 — REVIEW-ONLY, READ-BACK HASH-CHAIN INTEGRITY PROTOTYPE.
 * No production storage/auth/LINE connections. R44/R46/R50/R52 remain disconnected.
 * Does NOT establish independently witnessed timestamps or prove real delivery.
 * A privileged database administrator could rewrite and rehash the whole chain;
 * external anchoring and server-side identity/commit-fence remain NOT IMPLEMENTED.
 */
import { createHash } from 'node:crypto';
export const CAR02_V442_RELEASE_LOCK=true;
export const CAR02_V442_APPEND_SQL='SELECT stored,entry_count,entry_hash FROM public.v442_qa_append_review($1::text,$2::uuid,$3::uuid,$4::text,$5::text)';
export const CAR02_V442_READ_SQL='SELECT snapshot FROM public.v442_qa_read_chain($1::text,$2::uuid)';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const GENESIS='0'.repeat(64);
const validShop=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(x);
const validUuid=x=>typeof x==='string'&&UUID.test(x);
const validHash=x=>typeof x==='string'&&HASH.test(x);
const allowedDisposition=x=>x==='investigated'||x==='escalated';
const deny=()=>{const e=Error('CAR02_UNAUTHORIZED');e.code='CAR02_UNAUTHORIZED';e.status=401;throw e;};
export const car02ReviewChainHashR442=({shop,eventId,seq,reviewerSub,evidenceSha256,disposition,previousHash})=>{
 if(!validShop(shop)||!validUuid(eventId)||!Number.isSafeInteger(seq)||seq<1||seq>2||
    !validUuid(reviewerSub)||!validHash(evidenceSha256)||!allowedDisposition(disposition)||!validHash(previousHash))deny();
 return createHash('sha256').update(['v442',shop,eventId,seq,reviewerSub,evidenceSha256,disposition,previousHash].join('|'),'utf8').digest('hex');
};
const validActor=(v,shop)=>v?.verified===true&&v?.active===true&&v?.role==='owner'&&v.shopCode===shop&&
  validUuid(v.userSub)&&Number.isSafeInteger(v.authVersion)&&v.authVersion>0;
/**
 * Only a trusted server must provide store/verifyReviewer and bind shopCode.
 * Issued actor objects are scoped to this factory, never accepted from JSON.
 * The SQL append function checks tenant/status, uniqueness, and row locks in PG17.
 */
export function createCar02OfflineReviewIntegrityR442({store,verifyReviewer}={}){
 if(CAR02_V442_RELEASE_LOCK!==true||typeof store?.query!=='function'||typeof verifyReviewer!=='function')
  throw Error('CAR02_V442_REVIEW_CONFIG_REQUIRED');
 const issued=new WeakSet();
 async function authenticateReviewer(request,shopCode){
  try{
   if(!validShop(shopCode)||request?.headers?.get?.('x-line-id-token'))deny();
   const v=await verifyReviewer({request,shopCode});
   if(!validActor(v,shopCode))deny();
   const actor=Object.freeze({verified:true,active:true,role:'owner',shopCode,userSub:v.userSub,authVersion:v.authVersion});
   issued.add(actor);return actor;
  }catch{deny()}
 }
 const check=(actor,shop,eventId)=>{if(!actor||!issued.has(actor)||!Object.isFrozen(actor)||!validShop(shop)||
   !validActor(actor,shop)||!validUuid(eventId))deny();};
 async function appendReview({actor,shopCode,eventId,evidenceSha256,disposition}={}){
  check(actor,shopCode,eventId);
  if(!validHash(evidenceSha256)||!allowedDisposition(disposition))deny();
  try{
   const r=await store.query(CAR02_V442_APPEND_SQL,[shopCode,eventId,actor.userSub,evidenceSha256,disposition]);
   if(r?.rows?.length!==1)deny();
   const x=r.rows[0];
   if(typeof x.stored!=='boolean'||!Number.isSafeInteger(Number(x.entry_count))||
      Number(x.entry_count)<0||Number(x.entry_count)>2||!validHash(x.entry_hash))deny();
   return Object.freeze({status:x.stored?'recorded':'duplicate',reviewCount:Number(x.entry_count),eventId});
  }catch{deny()}
 }
 async function inspect({actor,shopCode,eventId}={}){
  check(actor,shopCode,eventId);
  try{
   const r=await store.query(CAR02_V442_READ_SQL,[shopCode,eventId]);
   if(r?.rows?.length!==1)deny();
   const v=r.rows[0].snapshot;
   if(!v||typeof v!=='object'||Array.isArray(v)||v.shopCode!==shopCode||v.eventId!==eventId||
      v.status!=='manual_review'||!Array.isArray(v.entries)||v.entries.length>2)deny();
   let prev=GENESIS;const reviewers=new Set(),evidences=new Set();
   for(let i=0;i<v.entries.length;i++){
    const e=v.entries[i];
    if(!e||typeof e!=='object'||Array.isArray(e)||e.seq!==i+1||!validUuid(e.reviewerSub)||
       !validHash(e.evidenceSha256)||!allowedDisposition(e.disposition)||e.previousHash!==prev||
       reviewers.has(e.reviewerSub)||evidences.has(e.evidenceSha256))deny();
    const actual=car02ReviewChainHashR442({shop:shopCode,eventId,seq:i+1,reviewerSub:e.reviewerSub,
       evidenceSha256:e.evidenceSha256,disposition:e.disposition,previousHash:prev});
    if(e.entryHash!==actual)deny();
    reviewers.add(e.reviewerSub);evidences.add(e.evidenceSha256);prev=actual;
   }
   return Object.freeze({status:'manual_review',integrity:'verified',reviewCount:v.entries.length,eventId,
     headHash:prev});
  }catch{deny()}
 }
 return Object.freeze({authenticateReviewer,appendReview,inspect});
}
