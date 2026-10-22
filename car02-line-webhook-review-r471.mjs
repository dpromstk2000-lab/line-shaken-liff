/**
 * DPRO CAR02 V4.71 - OFFLINE verified raw LINE webhook and redelivery review.
 * Accepts byte-for-byte webhook as an injected TEST FIXTURE, NOT a live route.
 * LINE HMAC-SHA256 signature does not prove business authorization/delivery.
 * No network, DB mutations, webhook ACK, LINE dispatch, PII output or GO state.
 * The caller must separately prove adapter authority and disposable isolation.
 * R44/R46/R50/R51/R52 remain unchanged and R52 stays hard RELEASE LOCKED.
 */
import {createHmac,createHash,timingSafeEqual} from 'node:crypto';
export const CAR02_V471_RELEASE_LOCK=true;
export const CAR02_V471_MAX_WEBHOOK_BYTES=65536;
const ULID=/^[0-9A-HJKMNP-TV-Z]{26}$/;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const DEST=/^U[a-f0-9]{32}$/i;
const DIGEST=/^[a-f0-9]{64}$/;
const SIGNATURE=/^[A-Za-z0-9+/]{43}=$/;
const nowPositive=x=>Number.isSafeInteger(x)&&x>0;
const exact=(o,fields)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.getPrototypeOf(o)===Object.prototype&&
 Object.keys(o).sort().join('|')===fields.slice().sort().join('|');
const status=(classification,code,novel=0,duplicates=0)=>Object.freeze({
 status:'no_go',classification,reason:code,novel,duplicates,
 releasePermitted:false,writeAuthorized:false,eventAcknowledged:false,
 businessEffectAllowed:false,lineDeliveryProven:false,realWebhookProviderVerified:false
});
const hash=s=>createHash('sha256').update(s).digest('hex');
function verifySignature(bytes,sig,secret){
 if(typeof sig!=='string'||!SIGNATURE.test(sig)||typeof secret!=='string'||
   secret.length<8||secret.length>256||!secret.trim()||secret!==secret.trim())return false;
 const received=Buffer.from(sig,'base64');
 if(received.length!==32||received.toString('base64')!==sig)return false;
 const digest=createHmac('sha256',Buffer.from(secret,'utf8')).update(bytes).digest();
 return timingSafeEqual(received,digest);
}
function stableDigest(e){
 // LINE redeliveries may change ONLY deliveryContext.isRedelivery.
 const x=structuredClone(e);
 delete x.deliveryContext.isRedelivery;
 return hash(Buffer.from(JSON.stringify(x),'utf8'));
}
function validEvent(e){
 return e&&typeof e==='object'&&!Array.isArray(e)&&typeof e.type==='string'&&
   /^[a-z][a-z0-9_]{1,31}$/.test(e.type)&&typeof e.webhookEventId==='string'&&
   ULID.test(e.webhookEventId)&&nowPositive(e.timestamp)&&
   exact(e.deliveryContext,['isRedelivery'])&&typeof e.deliveryContext.isRedelivery==='boolean';
}
/** This function DOES NOT persist dedup state and can NEVER acknowledge LINE. */
export function createCar02OfflineWebhookReviewR471({authorizeAuditor,inspectIsolation,readChannel,lookupEvent,nowMs=()=>Date.now()}={}){
 if(CAR02_V471_RELEASE_LOCK!==true||
  ![authorizeAuditor,inspectIsolation,readChannel,lookupEvent,nowMs].every(x=>typeof x==='function'))
   throw Error('CAR02_V471_DISPOSABLE_ADAPTERS_REQUIRED');
 async function inspect({request,rawBody,signature}={}){
  let op,isolation;
  try{[op,isolation]=await Promise.all([authorizeAuditor({request}),inspectIsolation()]);}
  catch{return status('refused','auditor_or_isolation_error');}
  if(op?.verified!==true||op.role!=='webhook_auditor'||op.mode!=='isolated_qa'||
     typeof op.shopCode!=='string'||!SHOP.test(op.shopCode)||
     isolation?.verified!==true||isolation.environment!=='offline_disposable_only'||
     isolation.testOnly!==true)return status('refused','auditor_or_isolation_unverified');
  if(!Buffer.isBuffer(rawBody)||rawBody.length===0||rawBody.length>CAR02_V471_MAX_WEBHOOK_BYTES||
     typeof signature!=='string'||!SIGNATURE.test(signature))return status('refused','raw_payload_or_signature_invalid');
  let channel;
  try{channel=await readChannel({shopCode:op.shopCode});}catch{return status('refused','channel_unavailable');}
  if(!exact(channel,['source','shopCode','destination','secret'])||
     channel.source!=='offline_disposable_line_channel'||channel.shopCode!==op.shopCode||
     typeof channel.destination!=='string'||!DEST.test(channel.destination)||
     !verifySignature(rawBody,signature,channel.secret))return status('refused','signature_or_channel_unverified');
  let payload;
  try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(rawBody));}
  catch{return status('refused','webhook_json_invalid');}
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||
   typeof payload.destination!=='string'||payload.destination!==channel.destination||
   !Array.isArray(payload.events)||payload.events.length>32)return status('refused','destination_or_events_invalid');
  if(payload.events.length===0)return status('verified_empty_review_only','no_event_verification_hook');
  const seen=new Set();let novel=0,duplicates=0;
  try{
   const time=nowMs();if(!nowPositive(time))throw Error('clock');
   for(const event of payload.events){
    if(!validEvent(event)||event.timestamp>time+300000||seen.has(event.webhookEventId))
      throw Error('invalid or duplicate id');
    seen.add(event.webhookEventId);
    const stored=await lookupEvent({shopCode:op.shopCode,eventId:event.webhookEventId});
    const digest=stableDigest(event);
    if(stored===null){novel++;continue;}
    if(!exact(stored,['source','shopCode','eventId','digestSha256'])||
      stored.source!=='offline_disposable_webhook_event_ledger'||
      stored.shopCode!==op.shopCode||stored.eventId!==event.webhookEventId||
      !DIGEST.test(stored.digestSha256)||stored.digestSha256!==digest)throw Error('store mismatch');
    duplicates++;
   }
  }catch{return status('refused','event_or_dedup_untrusted');}
  return status('signature_verified_review_only','no_event_persist_or_delivery_evidence',novel,duplicates);
 }
 return Object.freeze({inspect});
}
