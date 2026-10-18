/** DPRO CAR02 V4.7: in-memory design QA for DURABLE-INTENT lease fencing.
 * This is NOT a durable store, not a DB transaction, not a LINE sender.
 * Everything requires an explicit isolated_qa opt in. NO_GO / HOLD.
 */
import {randomUUID} from 'node:crypto';
export const V47_MODE=Object.freeze({environment:'isolated_qa',deployable:false,
  realPg:false,realLease:false,realLine:false,exactlyOnceDeliveryProven:false,
  sqlApplied:false,release:'NO_GO'});
const simple=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const tokenString=s=>typeof s==='string'&&s.length>0&&s.length<=160&&s.trim()===s&&!/\s/.test(s);
const hex64=s=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
const iso=x=>Number.isSafeInteger(x)&&x>=1;
const copy=x=>structuredClone(x);
function deny(code='CAR02_V47_QA_DENIED'){const e=new Error(code);e.code=code;throw e;}
function mode(x){if(!x||x.environment!=='isolated_qa'||x.allowIsolatedQa!==true)deny();}
function validRow(r){return simple(r)&&tokenString(r.shopCode)&&tokenString(r.workOrderId)&&
 tokenString(r.quoteId)&&tokenString(r.dedupeKey)&&r.dedupeKey===`car02:quote:${r.quoteId}:presented`&&
 r.deliveryStatus==='pending'&&r.claimToken===null&&r.providerMessageId===null;}
/** Model state only. Each row is copied when seeded, avoiding caller mutation. */
export function createV47OutboxLeaseLab(initialRows=[]){
 if(!Array.isArray(initialRows))deny();
 const rows=new Map(),history=[],sending=new Set();
 const key=(shop,dedupe)=>JSON.stringify([shop,dedupe]);
 for(const source of initialRows){
  if(!validRow(source))deny();
  const k=key(source.shopCode,source.dedupeKey);
  if(rows.has(k))deny('CAR02_V47_DEDUPE_COLLISION');
  rows.set(k,{...copy(source),claimOwner:null,leaseExpiresMs:null,attempts:0});
 }
 function inspect(){return copy({rows:[...rows.values()],history});}
 function row(shopCode,dedupeKey){
  if(!tokenString(shopCode)||!tokenString(dedupeKey))deny();
  const r=rows.get(key(shopCode,dedupeKey));
  if(!r)deny('CAR02_V47_SCOPE_DENIED');
  return r;
 }
 function claim(args={}){
  mode(args);const {shopCode,dedupeKey,workerId,nowMs,leaseMs=60000}=args;
  if(!tokenString(workerId)||!iso(nowMs)||!Number.isSafeInteger(leaseMs)||leaseMs<1000||leaseMs>300000||
   !Number.isSafeInteger(nowMs+leaseMs))deny();
  const r=row(shopCode,dedupeKey);
  // Claim can ONLY take a row marked pending. Expired sending rows require manual reconciliation.
  if(r.deliveryStatus!=='pending'||r.claimToken!==null)deny('CAR02_V47_NOT_CLAIMABLE');
  const claimToken=randomUUID();
  r.deliveryStatus='sending';r.claimToken=claimToken;r.claimOwner=workerId;
  r.leaseExpiresMs=nowMs+leaseMs;r.attempts++;
  history.push({kind:'claim',shopCode,dedupeKey,workerId,claimToken,atMs:nowMs});
  return Object.freeze({shopCode,dedupeKey,claimToken,workerId,expiresAtMs:r.leaseExpiresMs});
 }
 function validLease(lease){return simple(lease)&&tokenString(lease.shopCode)&&tokenString(lease.dedupeKey)&&
 tokenString(lease.claimToken)&&tokenString(lease.workerId)&&iso(lease.expiresAtMs);}
 function matching(lease){
  if(!validLease(lease))deny();
  const r=row(lease.shopCode,lease.dedupeKey);
  if(r.deliveryStatus!=='sending'||r.claimToken!==lease.claimToken||
   r.claimOwner!==lease.workerId||r.leaseExpiresMs!==lease.expiresAtMs)
   deny('CAR02_V47_STALE_LEASE');
  return r;
 }
 function quarantine(r,why,atMs){
  r.deliveryStatus='unknown';r.claimToken=null;r.claimOwner=null;r.leaseExpiresMs=null;
  history.push({kind:'quarantine',shopCode:r.shopCode,dedupeKey:r.dedupeKey,why,atMs});
 }
 /** Never automatically recycle an expired lease; the send may have reached the provider. */
 function sweep(args={}){
  mode(args);if(!iso(args.nowMs))deny();let count=0;
  for(const r of rows.values())if(r.deliveryStatus==='sending'&&r.leaseExpiresMs<=args.nowMs){
   quarantine(r,'lease_expired_unconfirmed',args.nowMs);count++;
  }
  return count;
 }
 async function dispatch(args={}){
  mode(args);const {lease,send,nowMs}=args;
  if(!validLease(lease)||typeof send!=='function'||typeof nowMs!=='function')deny();
  const now=nowMs();if(!iso(now))deny();
  const r=matching(lease);
  if(sending.has(lease.claimToken))deny('CAR02_V47_DUPLICATE_DISPATCH');
  if(now>=r.leaseExpiresMs){quarantine(r,'expired_before_send',now);deny('CAR02_V47_LEASE_EXPIRED');}
  sending.add(lease.claimToken);
  let response;
  try{
   try{response=await send(Object.freeze({shopCode:r.shopCode,quoteId:r.quoteId,
     dedupeKey:r.dedupeKey,eventType:'quote_presented',channel:'LINE'}));}
   catch{response=null;}
   const after=nowMs();if(!iso(after))deny();
   // Another worker might have quarantined the row while send() was in flight.
   if(r.deliveryStatus!=='sending'||r.claimToken!==lease.claimToken||r.claimOwner!==lease.workerId)
    deny('CAR02_V47_STALE_ACK');
   if(after>=r.leaseExpiresMs){quarantine(r,'expired_during_send',after);return Object.freeze({status:'unknown'});}
   if(!simple(response)||response.accepted!==true||!tokenString(response.providerMessageId)){
    quarantine(r,'provider_outcome_uncertain',after);return Object.freeze({status:'unknown'});
   }
   r.providerMessageId=response.providerMessageId;r.deliveryStatus='sent';
   r.claimToken=null;r.claimOwner=null;r.leaseExpiresMs=null;
   history.push({kind:'sent',shopCode:r.shopCode,dedupeKey:r.dedupeKey,atMs:after});
   return Object.freeze({status:'sent'});
  }finally{sending.delete(lease.claimToken);}
 }
 /** A manually verified fact, not a conclusion inferred from a timeout. */
 function reviewUnknown(args={}){
  mode(args);const {shopCode,dedupeKey,reviewer,verifiedEvidence,outcome,providerMessageId,nowMs}=args;
  if(!tokenString(reviewer)||typeof verifiedEvidence!=='string'||verifiedEvidence.length<16||
   verifiedEvidence.length>2048||verifiedEvidence!==verifiedEvidence.trim()||!iso(nowMs)||
   !['confirmed_not_delivered','confirmed_delivered'].includes(outcome))deny();
  const r=row(shopCode,dedupeKey);
  if(r.deliveryStatus!=='unknown'||r.claimToken!==null)deny('CAR02_V47_MANUAL_REVIEW_DENIED');
  if(outcome==='confirmed_not_delivered'){
   if(providerMessageId!==undefined)deny();r.deliveryStatus='pending';
  }else{
   if(!tokenString(providerMessageId))deny();
   r.providerMessageId=providerMessageId;r.deliveryStatus='sent';
  }
  history.push({kind:'manual_review',shopCode,dedupeKey,reviewer,verifiedEvidence,outcome,atMs:nowMs});
  return Object.freeze({status:r.deliveryStatus});
 }
 return Object.freeze({mode:V47_MODE,inspect,claim,sweep,dispatch,reviewUnknown});
}
