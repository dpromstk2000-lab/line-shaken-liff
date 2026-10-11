// DPRO CAR02 R93E — isolated, read-only verification of a leased photo tombstone.
// Supplies a strengthened ledger.confirmTombstone callback to the R93D QA worker.
// NO real DB, Storage, Service Role key, network, cron or production wiring.
// The future database adapters MUST atomically read and authenticate their records.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHOP=/^[a-z][a-z0-9_]{2,63}$/;
const KEY=/^([a-z][a-z0-9_]{2,63})\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.(jpg|png|webp)$/;
const BUCKET='ksh-car02-private-photos';
const bad=()=>{throw Error('R93E_ISOLATED_CONFIG_REQUIRED')};
const keys=(x,expected)=>x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).length===expected.length&&expected.every(k=>Object.hasOwn(x,k));
const validStamp=x=>typeof x==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x) &&
 Number.isFinite(Date.parse(x)) && new Date(Date.parse(x)).toISOString()===x;
const photoFields=['id','shopCode','orderId','reportId','storageBucket','storagePath','uploadState','createdAt'];
const leaseFields=['jobId','leaseId','shopCode','photoId','orderId','reportId','storageBucket','storagePath','photoCreatedAt','photoState','state','leaseExpiresMs'];
const requestedFields=['jobId','leaseId','shopCode','photoId','storagePath'];
function goodKey(path,shop,order,report){
 if(typeof path!=='string'||path.length>230)return false;
 const m=KEY.exec(path);
 return !!m&&m[1]===shop&&m[2]===order&&m[3]===report&&UUID.test(m[4]);
}
function matchingRows(request,lease,photo,now){
 if(!keys(request,requestedFields)||!keys(lease,leaseFields)||!keys(photo,photoFields))return false;
 if(!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(lease.leaseExpiresMs)||
    lease.leaseExpiresMs<=now||lease.leaseExpiresMs>now+60000)return false;
 if(!SHOP.test(request.shopCode)||!UUID.test(request.jobId)||!UUID.test(request.leaseId)||
    !UUID.test(request.photoId)||!UUID.test(lease.orderId)||!UUID.test(lease.reportId))return false;
 if(lease.state!=='leased'||lease.photoState!=='deleted'||photo.uploadState!=='deleted'||
    lease.storageBucket!==BUCKET||photo.storageBucket!==BUCKET)return false;
 if(!validStamp(lease.photoCreatedAt)||!validStamp(photo.createdAt)||lease.photoCreatedAt!==photo.createdAt)return false;
 if(!goodKey(request.storagePath,request.shopCode,lease.orderId,lease.reportId))return false;
 if(lease.jobId!==request.jobId||lease.leaseId!==request.leaseId||
    lease.shopCode!==request.shopCode||lease.photoId!==request.photoId||
    lease.storagePath!==request.storagePath)return false;
 if(photo.id!==request.photoId||photo.shopCode!==request.shopCode||
    photo.orderId!==lease.orderId||photo.reportId!==lease.reportId||
    photo.storagePath!==lease.storagePath)return false;
 // The leaf of storagePath is its own randomly generated blob UUID, not the photo-row ID.
 // It must nevertheless match the same immutable metadata row and leased cleanup job.
 return true;
}
export function createR93EIsolatedTombstoneGate({environment,dbName,readLeasedJob,readPhotoRecord,clock=()=>Date.now()}={}){
 if(environment!=='isolated_qa'||!/^car02_r93e_qa_[a-z0-9_]{1,36}$/.test(dbName||'')||
    typeof readLeasedJob!=='function'||typeof readPhotoRecord!=='function'||typeof clock!=='function')bad();
 return Object.freeze({
  async confirmTombstone(request){
   if(!keys(request,requestedFields))return false;
   try{
    const now=clock();
    if(!Number.isSafeInteger(now)||now<0||!UUID.test(request.jobId)||!UUID.test(request.leaseId)||
       !UUID.test(request.photoId)||!SHOP.test(request.shopCode)||typeof request.storagePath!=='string')return false;
    const lease=await readLeasedJob({jobId:request.jobId,leaseId:request.leaseId,shopCode:request.shopCode});
    if(!lease||!keys(lease,leaseFields)||lease.state!=='leased'||lease.leaseId!==request.leaseId||
       lease.leaseExpiresMs<=now||lease.photoId!==request.photoId||lease.storagePath!==request.storagePath)return false;
    const photo=await readPhotoRecord({photoId:request.photoId,shopCode:request.shopCode});
    return matchingRows(request,lease,photo,now);
   }catch{return false} // No record details, service errors, tokens or SQL text leak to the caller.
  }
 });
}
export const R93E_CONTRACT=Object.freeze({environment:'isolated_qa',productionReady:false,releaseDecision:'NO_GO',
 migrationDecision:'HOLD',liveWiring:false,needsAtomicDatabaseLease:true,needsSameRowBinding:true,
 photoRowIdMayDifferFromStorageBlobId:true,networkOperations:0});
