/**
 * DPRO CAR02 V4.39 -- ISOLATED REVIEW MODEL: transactional outbox with fail-closed dispatch.
 * No production messaging provider, Supabase Auth, Worker, or R44/R46/R50/R52 wiring.
 * The optional injected sendSynthetic MUST be an OFFLINE fixture; never bind LINE APIs.
 * This candidate does not offer exactly-once external delivery: a lost provider ACK
 * requires manual reconciliation, NEVER blind retry. No real customer payloads.
 */
import {randomUUID} from 'node:crypto';
export const CAR02_V439_RELEASE_LOCK=true;
export const CAR02_V439_CLAIM_SQL='SELECT event_id,payload FROM public.v439_qa_claim_next($1::text,$2::uuid)';
export const CAR02_V439_FINISH_SQL='SELECT public.v439_qa_finish($1::text,$2::uuid,$3::uuid,$4::text) AS completed';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUUID=x=>typeof x==='string'&&UUID.test(x);
const shopOK=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(x);
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const validSyntheticPayload=(p,shop)=>object(p)&&
  Object.keys(p).sort().join(',')==='eventType,orderId,shopCode'&&
  p.eventType==='synthetic_version_touch'&&p.shopCode===shop&&isUUID(p.orderId);
function configError(){throw Error('CAR02_V439_REVIEW_CONFIG_REQUIRED');}
/**
 * This model's store executes each SELECT in its own committed transaction.
 * Claiming is durable BEFORE the offline send fixture is invoked.
 * Only a verified positive mock acknowledgement may become `delivered`.
 * Any thrown/unknown response is `manual_review`; if marking fails, `indeterminate`.
 */
export function createCar02OfflineOutboxR439({store,sendSynthetic,makeClaimToken=randomUUID}={}){
 if(CAR02_V439_RELEASE_LOCK!==true||typeof store?.query!=='function'||
    typeof sendSynthetic!=='function'||typeof makeClaimToken!=='function')configError();
 async function dispatchOne(shopCode){
  if(!shopOK(shopCode))return Object.freeze({status:'denied'});
  let token;
  try{token=makeClaimToken();if(!isUUID(token))throw Error('BAD_TOKEN');}catch{return Object.freeze({status:'indeterminate'});}
  let claimed;
  try {
   const r=await store.query(CAR02_V439_CLAIM_SQL,[shopCode,token]);
   if(!Array.isArray(r?.rows)||r.rows.length>1)throw Error('BAD_CLAIM');
   if(r.rows.length===0)return Object.freeze({status:'idle'});
   claimed=r.rows[0];
   if(!isUUID(claimed?.event_id))throw Error('BAD_EVENT');
  }catch{return Object.freeze({status:'indeterminate'});}
  const eventId=claimed.event_id;
  // After claim, DO NOT invoke transport for a malformed event. Record manual review.
  let outcome='uncertain';
  if(validSyntheticPayload(claimed.payload,shopCode)){
   try{
    const ack=await sendSynthetic(Object.freeze({eventId,shopCode,payload:Object.freeze({...claimed.payload})}));
    if(ack?.confirmed===true&&ack?.eventId===eventId&&isUUID(ack?.providerReceiptId))outcome='confirmed';
   }catch { /* Ambiguous external side effect. Never retry automatically. */ }
  }
  try{
   const finished=await store.query(CAR02_V439_FINISH_SQL,[shopCode,eventId,token,outcome]);
   if(finished?.rows?.length!==1||finished.rows[0]?.completed!==true)
    return Object.freeze({status:'indeterminate',eventId});
   return Object.freeze({status:outcome==='confirmed'?'delivered':'manual_review',eventId});
  }catch{return Object.freeze({status:'indeterminate',eventId});}
 }
 return Object.freeze({dispatchOne});
}
