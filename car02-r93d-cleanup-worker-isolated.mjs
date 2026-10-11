// DPRO CAR02 R93D — offline contract for a future durable photo-cleanup worker.
// NOT wired to R50/R51/R52, production DB, Supabase Storage, cron, or credentials.
// All adapters MUST be injected by disposable QA. No production setup is permitted.
import {planR93CRecovery, interpretR93CDelete, verifyR93CAbsence, nextR93CRetryDelay} from './car02-r93c-photo-cleanup-policy.mjs';

const UUID=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const REJECT='R93D_INVALID_ISOLATED_WORKER_CONFIGURATION';
const fail=code=>{throw Object.assign(new Error(code),{code})};
const okFunction=(x,names)=>x&&names.every(n=>typeof x[n]==='function');
const saneJob=(job,now)=>job&&typeof job==='object'&&!Array.isArray(job)&&
  UUID.test(job.jobId||'')&&UUID.test(job.leaseId||'')&&
  Number.isSafeInteger(job.leasedUntilMs)&&job.leasedUntilMs>now&&job.leasedUntilMs<=now+60000&&
  Number.isSafeInteger(job.attempts)&&job.attempts>=0&&job.attempts<=8&&
  typeof job.shopCode==='string'&&typeof job.storagePath==='string'&&
  typeof job.photoId==='string'&&typeof job.orderId==='string'&&typeof job.reportId==='string';

// This machine enforces safe sequencing, not durability; the future ledger adapter must
// atomically lease by SKIP LOCKED, reject stale lease IDs, and keep an immutable tombstone.
export function createR93DIsolatedCleanupWorker({environment,dbName,ledger,storage,clock=()=>Date.now()}={}){
  if(environment!=='isolated_qa'||!/^car02_r93d_qa_[a-z0-9_]{1,36}$/.test(dbName||'')||
     !okFunction(ledger,['claim','confirmTombstone','markVerified','reschedule','escalate'])||
     !okFunction(storage,['remove','probe'])||typeof clock!=='function')fail(REJECT);
  async function safeWrite(method,detail){
    try{return await ledger[method](detail)===true}catch{return false}
  }
  const receipt=(action,extra={})=>Object.freeze({action,reviewOnly:true,productionReady:false,
    releaseDecision:'NO_GO',migrationDecision:'HOLD',...extra});
  async function one(){
    const now=clock();
    if(!Number.isSafeInteger(now)||now<0)return receipt('UNSAFE_CLOCK');
    let job;
    try{job=await ledger.claim({at:now})}catch{return receipt('LEDGER_CLAIM_UNAVAILABLE')}
    if(job==null)return receipt('IDLE');
    // Treat malformed leases as an incident. Don't issue any Storage call or mutate an
    // untrusted job; the DB lease will expire and the operator must inspect its record.
    if(!saneJob(job,now))return receipt('REJECT_UNTRUSTED_LEASE');
    const lease={jobId:job.jobId,leaseId:job.leaseId,shopCode:job.shopCode};
    async function escalate(reason){return receipt(await safeWrite('escalate',{...lease,reason})?'ESCALATED':'LEDGER_WRITE_UNCERTAIN',{reason})}
    async function reschedule(reason,delayMs){
      if(!Number.isSafeInteger(delayMs)||delayMs<1||delayMs>86400000)return escalate('INVALID_RETRY_DELAY');
      return receipt(await safeWrite('reschedule',{...lease,reason,runAfter:now+delayMs})?'RETRY_SCHEDULED':'LEDGER_WRITE_UNCERTAIN',{reason,delayMs});
    }
    if(job.uploadState!=='deleted')return escalate('NOT_TOMBSTONED');
    // Authorization is an atomic, scoped check of the same lease and a terminal DB
    // photo tombstone. A previously ready photo must NEVER be deleted.
    let tombstone=false;
    try{tombstone=(await ledger.confirmTombstone({...lease,photoId:job.photoId,storagePath:job.storagePath}))===true}
    catch{return receipt('LEDGER_AUTH_UNAVAILABLE')}
    if(!tombstone)return escalate('TOMBSTONE_OR_LEASE_MISMATCH');
    let plan;
    try{plan=planR93CRecovery({photo:{photoId:job.photoId,orderId:job.orderId,reportId:job.reportId,
      shopCode:job.shopCode,storageBucket:job.storageBucket,storagePath:job.storagePath,
      uploadState:job.uploadState,createdAt:job.photoCreatedAt},shopCode:job.shopCode,
      now,attempts:job.attempts,lockHeld:true,serverVerified:true})}
    catch{return escalate('UNSAFE_PHOTO_SCOPE')}
    if(plan.decision==='WAIT_FOR_UPLOAD_GRACE')return reschedule('UPLOAD_GRACE',plan.retryAfterMs);
    if(plan.decision==='ESCALATE_MANUAL_REVIEW')return escalate('MAX_ATTEMPTS');
    if(plan.decision!=='REQUEST_PRIVATE_DELETE_AND_VERIFY')return escalate('UNEXPECTED_CLEANUP_STATE');
    const scoped={bucket:plan.bucket,path:plan.path};
    async function retry(reason,status,networkError=false){
      const p=nextR93CRetryDelay({attempts:plan.attempt,httpStatus:status,networkError});
      if(p.decision!=='RETRY_WITH_DURABLE_OUTBOX')return escalate(p.decision);
      return reschedule(reason,p.delayMs);
    }
    let deletion;
    try{deletion=interpretR93CDelete({status:(await storage.remove(scoped))?.status})}
    catch{deletion=interpretR93CDelete({networkError:true})}
    if(deletion.decision==='ESCALATE_AUTH_FAILURE'||deletion.decision==='ESCALATE_UNEXPECTED_STORAGE_STATUS')return escalate(deletion.decision);
    if(deletion.decision==='RETRY_STORAGE_DELETE')return retry('DELETE_NOT_CONFIRMED',503);
    // A 2xx/404 DELETE acknowledgement alone is not evidence of object absence.
    let probe;
    try{probe=verifyR93CAbsence({status:(await storage.probe(scoped))?.status})}
    catch{probe=verifyR93CAbsence({networkError:true})}
    if(probe.confirmedGone===true){
      return receipt(await safeWrite('markVerified',{...lease,proof:'PRIVATE_OBJECT_PROBE_404'})?'VERIFIED_GONE':'LEDGER_WRITE_UNCERTAIN');
    }
    if(probe.decision==='ESCALATE_AUTH_FAILURE')return escalate('PROBE_AUTH_FAILURE');
    return retry(probe.decision,503);
  }
  return Object.freeze({one});
}
export const R93D_ISOLATION=Object.freeze({live:false,credentials:false,serviceWiring:false,sqlProductionWrite:false,
  requiresDurableLeases:true,requiresServerTombstone:true,requiresProbe404:true});
