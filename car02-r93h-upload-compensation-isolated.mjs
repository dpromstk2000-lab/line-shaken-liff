// DPRO CAR02 R93H -- upload uncertainty compensation (ISOLATED QA ONLY).
// Not wired into R47/R50/R51/R52, not a live Storage client or DB implementation.
// Treat any attempted POST as potentially committed, even if its response is lost.
// A future DB adapter MUST atomically tombstone the exact pending photo + insert
// a durable cleanup outbox job in the SAME transaction (R93G invariant).
import { createHash, randomUUID } from 'node:crypto';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const MIME=Object.freeze({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'});
const BUCKET='ksh-car02-private-photos';
const MAX_BYTES=5242880;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const validImage=(bytes,mime)=>{
 if(!(bytes instanceof Uint8Array)||bytes.byteLength<4||bytes.byteLength>MAX_BYTES)return false;
 if(mime==='image/jpeg')return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(mime==='image/png')return bytes.length>=8&&[137,80,78,71,13,10,26,10].every((x,i)=>bytes[i]===x);
 if(mime==='image/webp')return bytes.length>=12&&[82,73,70,70,87,69,66,80].every((x,i)=>bytes[i<4?i:i+4]===x);
 return false;
};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const actorValid=(actor,shop)=>actor?.verified===true&&actor.shopCode===shop&&
  ['staff','owner'].includes(actor.role)&&typeof actor.subject==='string'&&
  /^staff:[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(actor.subject);
const adapter=(obj,fields)=>obj&&fields.every(k=>typeof obj[k]==='function');

export function createR93HIsolatedUploadCompensation({environment,dbName,repository,storage}={}) {
 if(environment!=='isolated_qa'||!/^car02_r93h_qa_[a-z0-9_]{1,36}$/.test(dbName||'')||
   !adapter(repository,['reserve','markReady','tombstoneAndEnqueue'])||
   !adapter(storage,['verifyPrivateBucket','postObject','inspectObject']))fail('R93H_ISOLATED_DEPENDENCIES_REQUIRED');
 return Object.freeze({
  async upload({actor,shopCode,orderId,reportId,mimeType,bytes}={}) {
   if(!SHOP.test(shopCode||'')||!actorValid(actor,shopCode)||!UUID.test(orderId||'')||
      !UUID.test(reportId||'')||!Object.hasOwn(MIME,mimeType)||!validImage(bytes,mimeType))
     fail('R93H_INVALID_AUTH_OR_IMAGE');
   let privateMeta;
   try{privateMeta=await storage.verifyPrivateBucket({bucket:BUCKET});}catch{}
   if(privateMeta?.id!==BUCKET||privateMeta.public!==false)fail('R93H_PRIVATE_BUCKET_UNVERIFIED');
   const path=`${shopCode}/${orderId}/${reportId}/${randomUUID()}.${MIME[mimeType]}`;
   const meta={actor,shopCode,orderId,reportId,bucket:BUCKET,path,mimeType,
     byteSize:bytes.byteLength,sha256:hash(bytes)};
   let id;
   try{
    const r=await repository.reserve(meta);
    if(!r||!UUID.test(r.photoId||'')||r.state!=='pending')fail('R93H_RESERVATION_UNCERTAIN');
    id=r.photoId;
   }catch{fail('R93H_RESERVATION_UNCERTAIN');}
   const key={actor,shopCode,photoId:id,orderId,reportId,bucket:BUCKET,path,expectedState:'pending'};
   let attempted=false;
   try{
    // Record the possibility of a remote write BEFORE the Storage call.
    // Network timeout does not prove that remote Storage never committed the object.
    attempted=true;
    const put=await storage.postObject({bucket:BUCKET,path,mimeType,bytes,upsert:false});
    if(put?.status!==201)fail('R93H_STORAGE_WRITE_UNCONFIRMED');
    const check=await storage.inspectObject({bucket:BUCKET,path});
    if(check?.private!==true||check.mimeType!==mimeType||
       !(check.bytes instanceof Uint8Array)||check.bytes.byteLength!==bytes.byteLength||
       hash(check.bytes)!==meta.sha256||!validImage(check.bytes,mimeType))
      fail('R93H_READBACK_UNCONFIRMED');
    const ready=await repository.markReady({...key,expectedState:'pending'});
    if(ready!==true)fail('R93H_READY_UNCONFIRMED');
    return Object.freeze({photoId:id,state:'ready',byteSize:bytes.byteLength,
      mimeType,productionReady:false,releaseDecision:'NO_GO',migrationDecision:'HOLD'});
   }catch{
    // NEVER fire-and-forget DELETE here. An unsuccessful HTTP exchange can still
    // have created a blob. The durable outbox must schedule a later 404-verified cleanup.
    if(!attempted)fail('R93H_UPLOAD_ABORTED');
    let queued=false;
    try{queued=(await repository.tombstoneAndEnqueue({...key,reason:'UPLOAD_UNCERTAIN'}))===true;}catch{}
    if(!queued)fail('R93H_COMPENSATION_UNCONFIRMED');
    fail('R93H_UPLOAD_FAILED_RECOVERY_QUEUED');
   }
  }
 });
}
export const R93H_CONTRACT=Object.freeze({mode:'isolated_qa',productionReady:false,
  releaseDecision:'NO_GO',migrationDecision:'HOLD',liveWiring:false,
  neverImmediateDelete:true,postTimeoutMayHaveWrittenBlob:true,
  requiresAtomicPendingTombstoneAndOutbox:true,requiresSeparate404Probe:true});
