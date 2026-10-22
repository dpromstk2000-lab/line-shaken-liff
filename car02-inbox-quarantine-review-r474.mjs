/**
 * DPRO CAR02 V4.74. Synthetic disposable webhook inbox quarantine review.
 * Quarantining a test event is NOT webhook ACK, processing, delivery, retry,
 * business mutation, authorization, or release. No real providers.
 * All identities/lease claims from independent trusted offline adapters.
 */
export const CAR02_V474_RELEASE_LOCK=true;
export const CAR02_V474_REASONS=Object.freeze(['integrity_mismatch','poison_event','manual_hold','max_retry_review']);
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const ULID=/^[0-9A-HJKMNP-TV-Z]{26}$/;
const HEX=/^[a-f0-9]{64}$/;
const WORKER=/^worker_[a-z0-9]{1,32}$/;
const exact=(v,ks)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join('|')===ks.slice().sort().join('|');
const leaseKeys=['source','shopCode','eventId','eventDigest','state','workerId','leaseEpoch','leaseTokenHash','leaseStartedMs','leaseUntilMs'];
const trustedKeys=['verified','source','shopCode','workerId','leaseEpoch','leaseTokenHash'];
const persistedKeys=['source','shopCode','eventId','eventDigest','workerId','leaseEpoch','quarantineReason','reviewState'];
const close=(reason,classification='refused')=>Object.freeze({status:'no_go',reason,classification,
 releasePermitted:false,writeAuthorized:false,jobDispatched:false,realWebhookAcknowledged:false,
 actualEventProcessed:false,lineDeliveryProven:false,realProviderVerified:false});
export function createCar02OfflineQuarantineReviewR474({expectedShopCode,authorizeAuditor,inspectIsolation,
 trustedWorkerLease,readLease,quarantine,readQuarantine,nowMs=Date.now}={}){
 if(CAR02_V474_RELEASE_LOCK!==true||!SHOP.test(expectedShopCode??'')||
   ![authorizeAuditor,inspectIsolation,trustedWorkerLease,readLease,quarantine,readQuarantine,nowMs].every(x=>typeof x==='function'))
  throw Error('CAR02_V474_OFFLINE_ADAPTERS_REQUIRED');
 async function inspect({request,eventId,eventDigest,reason}={}){
  if(!ULID.test(eventId??'')||!HEX.test(eventDigest??'')||!CAR02_V474_REASONS.includes(reason))return close('invalid_disposable_event_or_reason');
  let auditor,isolation,worker;
  try{[auditor,isolation,worker]=await Promise.all([authorizeAuditor({request}),inspectIsolation(),trustedWorkerLease()]);}
  catch{return close('trusted_inspection_unavailable');}
  if(auditor?.verified!==true||auditor.mode!=='isolated_qa'||auditor.role!=='quarantine_auditor'||auditor.shopCode!==expectedShopCode||
   isolation?.verified!==true||isolation.environment!=='disposable_pg17_or_offline_mock'||isolation.testOnly!==true||
   !exact(worker,trustedKeys)||worker.verified!==true||worker.source!=='isolated_mock_worker_registry'||
   worker.shopCode!==expectedShopCode||!WORKER.test(worker.workerId)||!Number.isSafeInteger(worker.leaseEpoch)||worker.leaseEpoch<1||
   !HEX.test(worker.leaseTokenHash))return close('trusted_inspection_unverified');
  let lease,stamp;
  try{stamp=nowMs();lease=await readLease({shopCode:expectedShopCode,eventId});}
  catch{return close('lease_unavailable');}
  if(!Number.isSafeInteger(stamp)||stamp<=0||!exact(lease,leaseKeys)||lease.source!=='disposable_mock_worker_lease'||
   lease.shopCode!==expectedShopCode||lease.eventId!==eventId||lease.eventDigest!==eventDigest||lease.state!=='leased'||
   lease.workerId!==worker.workerId||lease.leaseEpoch!==worker.leaseEpoch||lease.leaseTokenHash!==worker.leaseTokenHash||
   !Number.isSafeInteger(lease.leaseStartedMs)||!Number.isSafeInteger(lease.leaseUntilMs)||
   stamp<lease.leaseStartedMs||stamp>=lease.leaseUntilMs)return close('current_lease_not_verified');
  let outcome;
  try{outcome=await quarantine({shopCode:expectedShopCode,eventId,eventDigest,workerId:worker.workerId,
    leaseEpoch:worker.leaseEpoch,leaseTokenHash:worker.leaseTokenHash,reason,nowMs:stamp});}
  catch{return close('disposable_quarantine_unavailable');}
  if(outcome!=='quarantined_mock'&&outcome!=='already_quarantined')return close('disposable_quarantine_denied');
  let record;
  try{record=await readQuarantine({shopCode:expectedShopCode,eventId});}
  catch{return close('disposable_quarantine_readback_unavailable');}
  if(!exact(record,persistedKeys)||record.source!=='disposable_mock_quarantine'||record.shopCode!==expectedShopCode||
   record.eventId!==eventId||record.eventDigest!==eventDigest||record.workerId!==worker.workerId||
   record.leaseEpoch!==worker.leaseEpoch||record.quarantineReason!==reason||record.reviewState!=='quarantined_review_only')
   return close('quarantine_readback_mismatch');
  return close('synthetic_quarantine_observed_never_processed','quarantine_review_only');
 }
 return Object.freeze({inspect,scopedShopCode:expectedShopCode});
}
