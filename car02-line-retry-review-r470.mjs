/**
 * DPRO CAR02 V4.70 — OFFLINE ONLY LINE API acceptance/retry review contract.
 * LINE 2xx / 409 is acceptance of an API request, never proof of delivery.
 * Same X-Line-Retry-Key cannot safely be reused after 24h.
 * Read store and auditors are injected test doubles. NO network or side effects.
 * Never connect to production LINE, Supabase, or release-locked R52.
 */
export const CAR02_V470_RELEASE_LOCK=true;
export const CAR02_V470_RETRY_WINDOW_MS=24*60*60*1000;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const REQUEST_ID=/^[A-Za-z0-9_-]{3,128}$/;
const ENDPOINTS=new Set(['push','multicast','narrowcast','broadcast']);
const positive=x=>Number.isSafeInteger(x)&&x>0;
const plain=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.getPrototypeOf(x)===Object.prototype&&Object.keys(x).sort().join('|')===keys.slice().sort().join('|');
const ATTEMPT=['shopCode','eventId','attemptId','endpoint','retryKey','recipientSha256','bodySha256','retryKeyIssuedAtMs','firstAttemptAtMs'];
const OBS=['kind','status','retryKey','recipientSha256','bodySha256','observedAtMs','acceptedRequestId'];
function validAttempt(x,shop,event,now){return plain(x,ATTEMPT)&&x.shopCode===shop&&x.eventId===event&&
 UUID.test(x.attemptId)&&ENDPOINTS.has(x.endpoint)&&UUID.test(x.retryKey)&&
 SHA.test(x.recipientSha256)&&SHA.test(x.bodySha256)&&positive(x.retryKeyIssuedAtMs)&&
 positive(x.firstAttemptAtMs)&&x.firstAttemptAtMs>=x.retryKeyIssuedAtMs&&x.firstAttemptAtMs<=now;}
function validObservation(o,a,now){return plain(o,OBS)&&o.retryKey===a.retryKey&&
 o.recipientSha256===a.recipientSha256&&o.bodySha256===a.bodySha256&&
 positive(o.observedAtMs)&&o.observedAtMs>=a.firstAttemptAtMs&&o.observedAtMs<=now&&
 (o.acceptedRequestId===null||(typeof o.acceptedRequestId==='string'&&REQUEST_ID.test(o.acceptedRequestId)))&&
 ((o.kind==='timeout'&&o.status===null&&o.acceptedRequestId===null)||
 (o.kind==='response'&&Number.isInteger(o.status)&&o.status>=200&&o.status<=599&&
 (o.status===409?o.acceptedRequestId!==null:o.acceptedRequestId===null)));}
const result=(classification,code)=>Object.freeze({status:'no_go',classification,
 reason:code,releasePermitted:false,lineDispatchAllowed:false,automaticRetryAllowed:false,
 deliveredToUser:false,realLineProviderVerified:false});
/**
 * Only a trusted, isolated readAttempt adapter may provide stored attempt metadata.
 * This function NEVER calls LINE or creates a retry authorization.
 */
export function createCar02OfflineLineRetryReviewR470({authorizeAuditor,inspectIsolation,readAttempt,nowMs=()=>Date.now()}={}){
 if(CAR02_V470_RELEASE_LOCK!==true||![authorizeAuditor,inspectIsolation,readAttempt,nowMs].every(f=>typeof f==='function'))
   throw Error('CAR02_V470_ISOLATED_ADAPTERS_REQUIRED');
 async function inspect({request,eventId,observation}={}){
  let op,isolated;
  try{[op,isolated]=await Promise.all([authorizeAuditor({request}),inspectIsolation()]);}
  catch{return result('refused','auditor_or_isolation_error');}
  if(op?.verified!==true||op.mode!=='isolated_qa'||op.role!=='line_retry_auditor'||
    typeof op.shopCode!=='string'||!SHOP.test(op.shopCode)||isolated?.verified!==true||
    isolated.environment!=='offline_disposable_only'||isolated.testOnly!==true)
    return result('refused','auditor_or_isolation_unverified');
  if(typeof eventId!=='string'||!UUID.test(eventId))return result('refused','event_invalid');
  let attempt,now;
  try{now=nowMs();if(!positive(now))throw Error('clock');
      attempt=await readAttempt({shopCode:op.shopCode,eventId});}
  catch{return result('refused','stored_attempt_unavailable');}
  if(!validAttempt(attempt,op.shopCode,eventId,now))return result('refused','stored_attempt_untrusted');
  if(!validObservation(observation,attempt,now))return result('refused','observation_untrusted_or_payload_mismatch');
  const status=observation.status;
  if(observation.kind==='response'&&(status>=200&&status<=299))
    return result('accepted_not_delivered','line_2xx_is_not_delivery_confirmation');
  if(status===409)return result('already_accepted_not_delivered','line_409_same_retry_key_already_accepted');
  if(observation.kind==='response'&&status>=400&&status<=499)
    return result('provider_rejected','line_4xx_no_blind_retry');
  // 3xx and unexpected states have no well-defined acceptance evidence.
  if(observation.kind==='response'&&status<500)
    return result('manual_review','unexpected_provider_status');
  const age=now-attempt.retryKeyIssuedAtMs;
  if(age>=CAR02_V470_RETRY_WINDOW_MS)
    return result('expired_retry_key_manual_review','retry_key_24h_window_elapsed');
  // Retry may be evaluated by an independent policy/operator but never auto-sent here.
  return result('same_key_retry_review_only','unknown_acceptance_reuse_original_key_and_payload_only');
 }
 return Object.freeze({inspect});
}
