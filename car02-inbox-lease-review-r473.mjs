/**
 * CAR02 V4.73: OFFLINE disposable webhook inbox lease-review boundary.
 * No production worker, external IAM, LINE API, webhook acknowledgement, or business writes.
 * Does not process the event. Caller must independently prove receipt is committed
 * and identify a worker from trusted infrastructure, never from the request body.
 */
import {randomBytes,createHash} from 'node:crypto';
export const CAR02_V473_RELEASE_LOCK=true;
export const CAR02_V473_LEASE_MIN_MS=1000;
export const CAR02_V473_LEASE_MAX_MS=600000;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const ULID=/^[0-9A-HJKMNP-TV-Z]{26}$/;
const HEX=/^[a-f0-9]{64}$/;
const WORKER=/^worker_[a-z0-9]{1,32}$/;
const isExact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.getPrototypeOf(o)===Object.prototype&&Object.keys(o).sort().join('|')===keys.slice().sort().join('|');
const noGo=(reason,classification='refused')=>Object.freeze({status:'no_go',reason,classification,releasePermitted:false,
 realWebhookAcknowledged:false,jobDispatched:false,writeAuthorized:false,lineDeliveryProven:false,realWorkerVerified:false});
const VALID_RECEIPT=['source','shopCode','eventId','eventDigest','state'];
const VALID_LEASE=['source','shopCode','eventId','eventDigest','state','leaseEpoch','leaseTokenHash','workerId','expiresAtMs'];
export function createCar02OfflineInboxLeaseR473({authorizeAuditor,inspectIsolation,readPendingReceipt,acquireLease,readLease,
 trustedWorkerIdentity,expectedShopCode,nowMs=Date.now,leaseMs=30000,generateLeaseSecret=()=>randomBytes(32)}={}){
 if(CAR02_V473_RELEASE_LOCK!==true || !SHOP.test(expectedShopCode??'') ||
   ![authorizeAuditor,inspectIsolation,readPendingReceipt,acquireLease,readLease,trustedWorkerIdentity,nowMs,generateLeaseSecret].every(f=>typeof f==='function') ||
   !Number.isSafeInteger(leaseMs)||leaseMs<CAR02_V473_LEASE_MIN_MS||leaseMs>CAR02_V473_LEASE_MAX_MS)
   throw Error('CAR02_V473_DISPOSABLE_ADAPTERS_REQUIRED');
 async function inspect({request,eventId,eventDigest}={}){
  let auditor,environment,worker;
  try{[auditor,environment,worker]=await Promise.all([authorizeAuditor({request}),inspectIsolation(),trustedWorkerIdentity()]);}
  catch{return noGo('inspector_or_worker_unavailable');}
  if(auditor?.verified!==true||auditor.mode!=='isolated_qa'||auditor.role!=='inbox_lease_auditor'||auditor.shopCode!==expectedShopCode||
    environment?.verified!==true||environment.environment!=='disposable_pg17_or_offline_mock'||environment.testOnly!==true||
    worker?.verified!==true||worker.source!=='isolated_mock_worker_registry'||!WORKER.test(worker.workerId??'')||worker.shopCode!==expectedShopCode)
    return noGo('inspector_or_worker_unverified');
  if(typeof eventId!=='string'||!ULID.test(eventId)||typeof eventDigest!=='string'||!HEX.test(eventDigest))return noGo('invalid_event_reference');
  let stamp,receipt;
  try{stamp=nowMs();receipt=await readPendingReceipt({shopCode:expectedShopCode,eventId});}
  catch{return noGo('pending_receipt_unavailable');}
  if(!Number.isSafeInteger(stamp)||stamp<=0||!isExact(receipt,VALID_RECEIPT)||receipt.source!=='disposable_mock_webhook_inbox'||
    receipt.shopCode!==expectedShopCode||receipt.eventId!==eventId||receipt.eventDigest!==eventDigest||receipt.state!=='pending')
    return noGo('committed_pending_receipt_unverified');
  let secret,secretHash;
  try{secret=generateLeaseSecret();if(!Buffer.isBuffer(secret)||secret.byteLength!==32)throw Error('lease secret');
   secretHash=createHash('sha256').update(secret).digest('hex');
  }catch{return noGo('local_lease_secret_unavailable');}
  finally{if(Buffer.isBuffer(secret))secret.fill(0);}
  let outcome,saved;
  try{
   outcome=await acquireLease({shopCode:expectedShopCode,eventId,eventDigest,workerId:worker.workerId,tokenHash:secretHash,
    atMs:stamp,ttlMs:leaseMs});
   if(outcome==='active_lease_conflict')return noGo('another_mock_worker_owns_lease','lease_conflict_review_only');
   if(outcome!=='leased_mock')return noGo('lease_not_granted');
   saved=await readLease({shopCode:expectedShopCode,eventId});
  }catch{return noGo('lease_or_read_after_claim_failed');}
  if(!isExact(saved,VALID_LEASE)||saved.source!=='disposable_mock_worker_lease'||saved.shopCode!==expectedShopCode||
    saved.eventId!==eventId||saved.eventDigest!==eventDigest||saved.state!=='leased'||saved.workerId!==worker.workerId||
    !Number.isSafeInteger(saved.leaseEpoch)||saved.leaseEpoch<1||saved.leaseTokenHash!==secretHash||
    !Number.isSafeInteger(saved.expiresAtMs)||saved.expiresAtMs!==stamp+leaseMs)
    return noGo('lease_read_back_mismatch');
  return noGo('synthetic_lease_observed_never_dispatch','mock_lease_review_only');
 }
 return Object.freeze({inspect,scopedShopCode:expectedShopCode});
}
