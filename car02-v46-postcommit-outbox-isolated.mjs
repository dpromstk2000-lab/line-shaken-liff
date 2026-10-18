/**
 * DPRO CAR02 V4.6 -- in-memory atomic-outbox and uncertain-delivery review.
 * NEVER DEPLOY. No PostgreSQL, Worker, LINE, network, signatures or external effects.
 * This model does not prove PG transaction atomicity or exactly-once delivery.
 */
import {createHash} from 'node:crypto';
export const V46_MODE=Object.freeze({environment:'isolated_qa',deployable:false,
  realDb:false,realNetwork:false,realWorker:false,realLine:false,
  realPgAtomicityProven:false,exactlyOnceDeliveryProven:false,release:'NO_GO'});
const plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const bounded=s=>typeof s==='string'&&s.length>0&&s.length<=256&&s===s.trim()&&!/\s/.test(s);
const hex=s=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const copy=x=>structuredClone(x);
function deny(code='CAR02_V46_QA_DENIED'){const e=new Error(code);e.code=code;throw e;}
function mustIsolated(environment,allowIsolatedQa){
 if(environment!=='isolated_qa'||allowIsolatedQa!==true)deny();
}
function validRequest({shopCode,actor,requestKey,intentDigest,quoteId,workOrderId,eventType,channel}){
 if(!bounded(shopCode)||!plain(actor)||actor.verified!==true||!bounded(actor.subject)||
 !['owner','staff'].includes(actor.role)||!bounded(requestKey)||requestKey.length<12||
 !hex(intentDigest)||!uuid(quoteId)||!uuid(workOrderId)||eventType!=='quote_presented'||channel!=='LINE')deny();
}
/** In-memory data is copied on write. Only COMMIT publishes staged changes. */
export function createV46OutboxLab(){
 const orders=new Map(),outbox=new Map(),active=new Set();
 let leaseSequence=0;
 const receipts=[];
 function inspect(){return copy({orders:[...orders.entries()],outbox:[...outbox.entries()],receipts});}
 async function transact(args={}){
  const {environment,allowIsolatedQa,shopCode,actor,requestKey,intentDigest,quoteId,
   workOrderId,eventType='quote_presented',channel='LINE',onStage,faultAt}=args;
  mustIsolated(environment,allowIsolatedQa);
  validRequest({shopCode,actor,requestKey,intentDigest,quoteId,workOrderId,eventType,channel});
  if(onStage!==undefined&&typeof onStage!=='function'||
     faultAt!==undefined&&!['beforeInsert','afterInsert','beforeCommit'].includes(faultAt))deny();
  const key=sha([shopCode,actor.subject,actor.role,requestKey]);
  if(active.has(key))deny('CAR02_V46_INFLIGHT_RETRY_DENIED');
  active.add(key);
  const record={key,steps:['BEGIN'],outcome:'pending'};receipts.push(record);
  try{
   const prior=orders.get(key);
   if(prior){
    if(prior.intentDigest!==intentDigest||prior.quoteId!==quoteId||prior.workOrderId!==workOrderId)deny('CAR02_V46_INTENT_COLLISION_DENIED');
    record.steps.push('COMMIT');record.outcome='replay';
    return Object.freeze({mode:'replay',outboxKey:prior.outboxKey,queuedCount:0,reviewOnly:true});
   }
   const eventKey=`car02:quote:${quoteId}:presented`;
   if(outbox.has(eventKey))deny('CAR02_V46_CROSS_SCOPE_DEDUPE_DENIED');
   if(faultAt==='beforeInsert')deny('CAR02_V46_WRITE_DENIED');
   const stagedOrder={shopCode,subject:actor.subject,role:actor.role,requestKey,intentDigest,
     quoteId,workOrderId,outboxKey:eventKey};
   const stagedOutbox={shopCode,quoteId,workOrderId,eventType,channel,
     dedupeKey:eventKey,deliveryStatus:'pending',claimToken:null,attempts:0,providerMessageId:null};
   if(onStage)await onStage('afterInsert');
   if(faultAt==='afterInsert')deny('CAR02_V46_WRITE_DENIED');
   if(onStage)await onStage('beforeCommit');
   if(faultAt==='beforeCommit')deny('CAR02_V46_COMMIT_DENIED');
   // Synthetic COMMIT; NO outbound delivery from within the transaction.
   orders.set(key,copy(stagedOrder));outbox.set(eventKey,copy(stagedOutbox));
   record.steps.push('COMMIT');record.outcome='committed';
   return Object.freeze({mode:'new',outboxKey:eventKey,queuedCount:1,reviewOnly:true});
  }catch(err){
   record.steps.push('ROLLBACK');record.outcome='rolled_back';
   deny('CAR02_V46_TRANSACTION_REJECTED');
  }finally{active.delete(key);}
 }
 /** Claim only pending rows AFTER commit. Unknown results require manual reconciliation. */
 function claim({environment,allowIsolatedQa,shopCode,dedupeKey,operatorId}={}){
  mustIsolated(environment,allowIsolatedQa);
  if(!bounded(shopCode)||!bounded(dedupeKey)||!bounded(operatorId))deny();
  const r=outbox.get(dedupeKey);
  if(!r||r.shopCode!==shopCode||r.deliveryStatus!=='pending')deny('CAR02_V46_CLAIM_DENIED');
  const token=`v46-lease-${++leaseSequence}-${sha([shopCode,dedupeKey,operatorId]).slice(0,12)}`;
  r.claimToken=token;r.deliveryStatus='sending';r.attempts++;
  return Object.freeze({dedupeKey,shopCode,claimToken:token});
 }
 async function dispatch({environment,allowIsolatedQa,claim:lease,send}={}){
  mustIsolated(environment,allowIsolatedQa);
  if(!plain(lease)||!bounded(lease.shopCode)||!bounded(lease.dedupeKey)||!bounded(lease.claimToken)||
     typeof send!=='function')deny();
  const r=outbox.get(lease.dedupeKey);
  if(!r||r.shopCode!==lease.shopCode||r.claimToken!==lease.claimToken||
   r.deliveryStatus!=='sending')deny('CAR02_V46_DISPATCH_DENIED');
  let response;
  try{ response=await send(Object.freeze(copy({shopCode:r.shopCode,quoteId:r.quoteId,
      eventType:r.eventType,dedupeKey:r.dedupeKey,channel:r.channel}))); }
  catch{r.deliveryStatus='unknown';r.claimToken=null;return Object.freeze({status:'unknown',reviewOnly:true});}
  if(!plain(response)||response.accepted!==true||!bounded(response.providerMessageId)){
   r.deliveryStatus='unknown';r.claimToken=null;return Object.freeze({status:'unknown',reviewOnly:true});
  }
  r.deliveryStatus='sent';r.providerMessageId=response.providerMessageId;r.claimToken=null;
  return Object.freeze({status:'sent',reviewOnly:true});
 }
 /** Explicit isolated/manual reconciliation; cannot infer undelivered from a timeout. */
 function reconcileUnknown({environment,allowIsolatedQa,shopCode,dedupeKey,manualReviewConfirmedNotDelivered}={}){
  mustIsolated(environment,allowIsolatedQa);
  const r=outbox.get(dedupeKey);
  if(!r||r.shopCode!==shopCode||r.deliveryStatus!=='unknown'||manualReviewConfirmedNotDelivered!==true)
   deny('CAR02_V46_RECONCILIATION_DENIED');
  r.deliveryStatus='pending';return Object.freeze({status:'pending',reviewOnly:true});
 }
 return Object.freeze({mode:V46_MODE,transact,inspect,claim,dispatch,reconcileUnknown});
}
