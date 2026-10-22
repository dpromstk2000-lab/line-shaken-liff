/**
 * CAR02 V4.72 — offline verified webhook -> disposable inbox ledger adapter.
 * Not a deployable LINE endpoint. V471 must first verify raw body signature,
 * destination, auditor and event-ledger collision. All adapters are synthetic.
 * No real acknowledgement, worker/job/LINE dispatch, IAM, Supabase, or GO.
 * Durable receipt must be committed BEFORE any later real HTTP ACK; this QA
 * only validates a mock read-after-claim contract and does not certify that.
 */
import {createHash} from 'node:crypto';
export const CAR02_V472_RELEASE_LOCK=true;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const ULID=/^[0-9A-HJKMNP-TV-Z]{26}$/;
const HEX=/^[0-9a-f]{64}$/;
const exactly=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.getPrototypeOf(o)===Object.prototype&&Object.keys(o).sort().join('|')===keys.slice().sort().join('|');
const noGo=(classification,reason)=>Object.freeze({status:'no_go',classification,reason,releasePermitted:false,
 realWebhookAcknowledged:false,writeAuthorized:false,jobDispatched:false,lineDeliveryProven:false});
const digestEvent=e=>{const x=structuredClone(e);delete x.deliveryContext.isRedelivery;
 return createHash('sha256').update(JSON.stringify(x),'utf8').digest('hex');};
const EVENT_KEYS=['source','shopCode','eventId','eventDigest','state'];
function validReceipt(r,shop,eventId,eventDigest){return exactly(r,EVENT_KEYS)&&r.source==='disposable_mock_webhook_inbox'&&
 r.shopCode===shop&&r.eventId===eventId&&r.eventDigest===eventDigest&&r.state==='pending';}
/** All dependencies must originate from separate trusted test harness, never requests. */
export function createCar02OfflineWebhookInboxR472({authorizeAuditor,inspectIsolation,reviewV471,claimEvent,readClaim,expectedShopCode}={}){
 if(CAR02_V472_RELEASE_LOCK!==true||![authorizeAuditor,inspectIsolation,claimEvent,readClaim].every(f=>typeof f==='function')||
   typeof reviewV471?.inspect!=='function'||reviewV471.scopedShopCode!==expectedShopCode||typeof expectedShopCode!=='string'||!SHOP.test(expectedShopCode))throw Error('CAR02_V472_ISOLATED_ADAPTERS_REQUIRED');
 async function inspect({request,rawBody,signature}={}){
  let op,isolation;
  try{[op,isolation]=await Promise.all([authorizeAuditor({request}),inspectIsolation()]);}
  catch{return noGo('refused','unverified_inspector_or_environment');}
  if(op?.verified!==true||op.mode!=='isolated_qa'||op.role!=='inbox_auditor'||
    typeof op.shopCode!=='string'||!SHOP.test(op.shopCode)||op.shopCode!==expectedShopCode||isolation?.verified!==true||
    isolation.environment!=='disposable_pg17_or_offline_mock'||isolation.testOnly!==true)
    return noGo('refused','unverified_inspector_or_environment');
  if(!Buffer.isBuffer(rawBody)||rawBody.length===0||rawBody.length>65536||typeof signature!=='string')
    return noGo('refused','invalid_signed_body');
  // Refuse batches: partial persist cannot be interpreted as a safe atomic ACK.
  let payload,event;
  try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(rawBody));
    if(!Array.isArray(payload?.events)||payload.events.length!==1)throw Error('not one');
    event=payload.events[0];
    if(typeof event?.webhookEventId!=='string'||!ULID.test(event.webhookEventId)||
      !exactly(event.deliveryContext,['isRedelivery'])||typeof event.deliveryContext.isRedelivery!=='boolean')throw Error('bad event');
  }catch{return noGo('refused','single_valid_event_required');}
  let verified;
  try{verified=await reviewV471.inspect({request,rawBody,signature});}
  catch{return noGo('refused','v471_signature_review_failed');}
  // V471 is the raw-body HMAC and cross-tenant ledger validation boundary.
  if(verified?.status!=='no_go'||verified.classification!=='signature_verified_review_only'||
    verified.releasePermitted!==false||verified.writeAuthorized!==false||
    verified.eventAcknowledged!==false||verified.lineDeliveryProven!==false||
    !Number.isSafeInteger(verified.novel)||!Number.isSafeInteger(verified.duplicates)||
    verified.novel+verified.duplicates!==1)return noGo('refused','v471_signature_review_failed');
  if(verified.duplicates===1)return noGo('duplicate_review_only','already_seen_no_new_claim');
  const id=event.webhookEventId, d=digestEvent(event);
  if(!HEX.test(d))return noGo('refused','invalid_event_digest');
  let claim,stored;
  try{
   claim=await claimEvent({shopCode:op.shopCode,eventId:id,eventDigest:d});
   if(!['claimed_pending','duplicate_pending','collision_review'].includes(claim))
      throw Error('untrusted claim classification');
   if(claim==='collision_review')return noGo('refused','inbox_collision_manual_review');
   stored=await readClaim({shopCode:op.shopCode,eventId:id});
  }catch{return noGo('refused','claim_or_durability_unverified');}
  if(!validReceipt(stored,op.shopCode,id,d))return noGo('refused','read_after_claim_mismatch');
  return noGo('durable_mock_review_only',claim==='claimed_pending'?'mock_inbox_pending_not_acknowledged':'mock_duplicate_pending_not_acknowledged');
 }
 return Object.freeze({inspect});
}
