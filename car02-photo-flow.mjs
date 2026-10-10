// CAR02 R43 private photo orchestration contract (not a Supabase Storage client).
// Integrate only with a server-held storage credential and an authenticated PG repository.
// No URL is exposed until backend scope + capacity reservation succeeds.
import { randomUUID } from 'node:crypto';
import { Car02Error } from './car02-core.mjs';
const err=(code,status=422)=>{throw new Car02Error(code,status)};
const maxSize=5*1024*1024;
const validUuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const mimeExt={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
const validDigest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function assertAccess(actor,shop){
 if(!actor||actor.verified!==true||actor.shopCode!==shop||!actor.subject||!['staff','owner'].includes(actor.role))err('CAR02_PHOTO_UNAUTHORIZED',403);
}
export function createCar02PhotoFlow({repository,storage}){
 if(!repository||!storage||!['reserve','getPending','markReady','cancel'].every(x=>typeof repository[x]==='function')||
    !['signUpload','inspect'].every(x=>typeof storage[x]==='function'))throw Error('CAR02_PRIVATE_PHOTO_DEPENDENCIES_REQUIRED');
 const bucket='ksh-car02-private-photos';
 return {
  async begin({actor,shop,orderId,reportId,mimeType,byteSize,sha256}){
   assertAccess(actor,shop);
   if(!validUuid(orderId)||!validUuid(reportId))err('CAR02_PHOTO_REFERENCE_INVALID');
   if(!Object.hasOwn(mimeExt,mimeType)||!Number.isSafeInteger(byteSize)||byteSize<=0||byteSize>maxSize||!validDigest(sha256))err('CAR02_PHOTO_METADATA_INVALID');
   const path=`${encodeURIComponent(shop)}/${orderId}/${reportId}/${randomUUID()}.${mimeExt[mimeType]}`;
   const details={actor,shop,orderId,reportId,mimeType,byteSize,sha256,bucket,path};
   // The repository MUST lock the work order+report, assert draft and tenant scope,
   // and insert pending with max-3-photo enforcement before a signed upload is issued.
   const pending=await repository.reserve(details);
   if(!pending?.id||!validUuid(pending.id))err('CAR02_PHOTO_RESERVATION_FAILED',503);
   try {
    const ticket=await storage.signUpload({bucket,path,expiresInSeconds:300});
    if(!ticket?.url||typeof ticket.url!=='string')err('CAR02_PHOTO_UPLOAD_TICKET_FAILED',503);
    return{photoId:pending.id,uploadUrl:ticket.url,expiresInSeconds:300,mimeType,byteSize};
   } catch(e) {
    // Compensating action: pending file must not exhaust capacity on signing failure.
    await repository.cancel({actor,shop,photoId:pending.id}).catch(()=>{});
    throw e;
   }
  },
  async finalize({actor,shop,photoId}){
   assertAccess(actor,shop);
   if(!validUuid(photoId))err('CAR02_PHOTO_REFERENCE_INVALID');
   const pending=await repository.getPending({actor,shop,photoId});
   if(!pending||pending.upload_state!=='pending'||pending.storage_bucket!==bucket)err('CAR02_PHOTO_NOT_PENDING',409);
   // inspect MUST compute the real object digest server-side, not trust browser metadata.
   const blob=await storage.inspect({bucket,path:pending.storage_path});
   if(!blob||blob.private!==true||blob.byteSize!==Number(pending.byte_size)||
     blob.mimeType!==pending.mime_type||blob.sha256!==pending.sha256)
     err('CAR02_PHOTO_OBJECT_INTEGRITY_FAILED',409);
   await repository.markReady({actor,shop,photoId,expectedState:'pending'});
   return{photoId,state:'ready'};
  }
 };
}
