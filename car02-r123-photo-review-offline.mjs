// DPRO CAR02 R123 — evidence-bound two-reviewer triage, ISOLATED OFFLINE QA ONLY.
// No customer data, live Storage, production authentication, SQL, or network calls.
// Review makes an OFFLINE DECISION RECORD, not a photo restoration, deletion or promotion.
import {createHash} from 'node:crypto';
const QA_DB='car02_r123_offline_qa_ci';
const BUCKET='ksh-car02-private-photos';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const TYPES=Object.freeze({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'});
const REASONS=new Set(['UPLOAD_ACK_OR_READBACK_UNCERTAIN','READBACK_MISMATCH','READY_ACK_UNCERTAIN','RETRY_UNCERTAIN']);
const HOUR=3600000;
function deny(code){throw Object.assign(new Error('R123_'+code),{code:'R123_'+code});}
function req(ok,code){if(!ok)deny(code);}
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const isTime=x=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
function identity(s){return typeof s==='string'&&/^staff:/i.test(s)&&UUID.test(s.slice(6));}
function validateSnapshot(s){
 req(s&&typeof s==='object'&&!Array.isArray(s),'SNAPSHOT');
 req(s.state==='QUARANTINED'&&s.revision>0&&Number.isSafeInteger(s.revision),'STATE');
 req(SHOP.test(s.shop||'')&&UUID.test(s.orderId||'')&&UUID.test(s.reportId||'')&&UUID.test(s.intentKey||''),'SCOPE');
 req(identity(s.uploader)&&['owner','staff'].includes(s.uploaderRole),'ACTOR');
 req(s.bucket===BUCKET&&Object.hasOwn(TYPES,s.mime),'BUCKET_MIME');
 req(Number.isSafeInteger(s.size)&&s.size>=4&&s.size<=5242880&&SHA.test(s.sha256||''),'INTEGRITY');
 req(s.path===`${s.shop}/${s.orderId.toLowerCase()}/${s.reportId.toLowerCase()}/${s.intentKey.toLowerCase()}.${TYPES[s.mime]}`,'PATH');
 req(REASONS.has(s.quarantineReason),'QUARANTINE_REASON');
 req(isTime(s.quarantinedAtMs),'QUARANTINE_TIME');
 // Bind only the exact contract fields. Never accept a client-provided status transition.
 return Object.freeze({shop:s.shop,orderId:s.orderId.toLowerCase(),reportId:s.reportId.toLowerCase(),
  intentKey:s.intentKey.toLowerCase(),revision:s.revision,state:s.state,uploader:s.uploader.toLowerCase(),
  uploaderRole:s.uploaderRole,bucket:s.bucket,path:s.path,mime:s.mime,size:s.size,
  sha256:s.sha256,quarantineReason:s.quarantineReason,quarantinedAtMs:s.quarantinedAtMs});
}
function validateEvidence(e,s,nowMs){
 req(e&&typeof e==='object'&&!Array.isArray(e),'EVIDENCE');
 req(UUID.test(e.evidenceId||'')&&e.shop===s.shop&&e.intentKey===s.intentKey&&e.revision===s.revision,'EVIDENCE_SCOPE');
 req(isTime(e.observedAtMs)&&e.observedAtMs>=s.quarantinedAtMs&&e.observedAtMs<=nowMs,
   'EVIDENCE_TIME');
 req(nowMs-e.observedAtMs<=24*HOUR,'STALE_EVIDENCE');
 req(e.observedState==='QUARANTINED','EVIDENCE_STATE');
 req(e.objectExists===true&&e.bucket===s.bucket&&e.path===s.path,'EVIDENCE_OBJECT');
 req(e.observedMime===s.mime&&e.observedSize===s.size&&e.observedSha256===s.sha256,'EVIDENCE_MISMATCH');
 // This is a synthetic assertion, not proof that a real remote Storage read occurred.
 req(e.readbackWasVerified===true,'READBACK_UNPROVEN');
 return Object.freeze({evidenceId:e.evidenceId.toLowerCase(),shop:e.shop,intentKey:e.intentKey,
  revision:e.revision,observedAtMs:e.observedAtMs,observedState:e.observedState,objectExists:e.objectExists,
  bucket:e.bucket,path:e.path,observedMime:e.observedMime,observedSize:e.observedSize,
  observedSha256:e.observedSha256,readbackWasVerified:true});
}
export function bindR123OfflineEvidence(snapshot,evidence){
 const s=validateSnapshot(snapshot);
 req(evidence?.shop===s.shop&&evidence?.intentKey===s.intentKey&&evidence?.revision===s.revision,'EVIDENCE_SCOPE');
 const e={evidenceId:evidence.evidenceId,shop:evidence.shop,intentKey:evidence.intentKey,
  revision:evidence.revision,observedAtMs:evidence.observedAtMs,observedState:evidence.observedState,
  objectExists:evidence.objectExists,bucket:evidence.bucket,path:evidence.path,
  observedMime:evidence.observedMime,observedSize:evidence.observedSize,
  observedSha256:evidence.observedSha256,readbackWasVerified:evidence.readbackWasVerified};
 return Object.freeze({snapshotHash:digest(s),evidenceHash:digest(e)});
}
export const R123_CONTRACT=Object.freeze({release:'NO_GO',migration:'HOLD',productionReady:false,
 realStorageTested:false,realAuthenticationTested:false,databaseWrites:false,networkCalls:false,
 doesNotWireR47:true,doesNotChangeR122:true,noDelete:true,noMarkReady:true,
 offlineReviewsAreNotCryptographicIdentities:true,noPersistentReplayGuard:true});
export function createR123OfflineReview({environment,dbName,releaseLock,nowMs}={}){
 req(environment==='isolated_qa'&&dbName===QA_DB&&releaseLock===true&&isTime(nowMs),'ISOLATED_ONLY');
 return Object.freeze({inspect(snapshot,evidence,reviews){
  const s=validateSnapshot(snapshot);const e=validateEvidence(evidence,s,nowMs);
  req(s.quarantinedAtMs<=nowMs,'SNAPSHOT_FUTURE');
  req(Array.isArray(reviews)&&reviews.length===2,'TWO_REVIEWERS_REQUIRED');
  const binding=bindR123OfflineEvidence(s,e);
  let ownerCount=0;
  const seen=new Set(),seenIds=new Set();
  const reviewers=reviews.map(r=>{
   req(r&&typeof r==='object'&&r.verified===true&&r.active===true&&r.shop===s.shop,'REVIEW_AUTH_SCOPE');
   req(['staff','owner'].includes(r.role)&&identity(r.subject),'REVIEW_IDENTITY');
   const subject=r.subject.toLowerCase();
   req(subject!==s.uploader&&!seen.has(subject),'INDEPENDENT_REVIEW');
   req(UUID.test(r.reviewId||'')&&!seenIds.has(r.reviewId.toLowerCase()),'REVIEW_ID_REPLAY');
   req(r.snapshotHash===binding.snapshotHash&&r.evidenceHash===binding.evidenceHash&&
     r.revision===s.revision,'STALE_REVIEW_BINDING');
   req(isTime(r.reviewedAtMs)&&r.reviewedAtMs>=e.observedAtMs&&r.reviewedAtMs<=nowMs,
     'REVIEW_TIME');
   req(r.decision==='request_manual_staging_validation','REVIEW_DECISION');
   seen.add(subject);seenIds.add(r.reviewId.toLowerCase());if(r.role==='owner')ownerCount++;
   return Object.freeze({reviewId:r.reviewId.toLowerCase(),subject,role:r.role,
    reviewedAtMs:r.reviewedAtMs,decision:r.decision});
  });
  req(ownerCount>=1,'OWNER_REVIEW_REQUIRED');
  const record={version:'R123',shop:s.shop,orderId:s.orderId,reportId:s.reportId,
   intentKey:s.intentKey,quarantineRevision:s.revision,quarantineState:s.state,
   snapshotHash:binding.snapshotHash,evidenceHash:binding.evidenceHash,
   evidenceId:e.evidenceId,reviewers,decision:'MANUAL_STAGING_VALIDATION_PENDING',
   mutationAllowed:false,deleteAllowed:false,markReadyAllowed:false,
   realStorageTested:false,realAuthTested:false,release:'NO_GO',migration:'HOLD'};
  return Object.freeze({...record,recordHash:digest(record)});
 }});
}
