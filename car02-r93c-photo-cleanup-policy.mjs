// DPRO CAR02 R93C — offline policy for orphaned private-photo cleanup.
// Pure functions only. NO storage API, DELETE request, network, DB, or credentials.
// Future implementation requires durable DB outbox and private Storage read-after-delete verification.
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SHOP=/^[a-z][a-z0-9_]{2,63}$/;
const PATH=/^[a-z][a-z0-9_]{2,63}\/([a-f0-9-]{36})\/([a-f0-9-]{36})\/([a-f0-9-]{36})\.(?:jpg|png|webp)$/i;
const BUCKET='ksh-car02-private-photos';
const MAX_ATTEMPTS=8;
const MIN_STALE_MS=60*60*1000;
function bad(code){throw Object.assign(new Error(code),{code});}
const VALID=new Set(['pending','deleted']);
const safeStamp=(s)=>typeof s==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s)&&Number.isFinite(Date.parse(s));
function requirePhoto(photo,shopCode){
 if(!photo||typeof photo!=='object'||Array.isArray(photo)||!SHOP.test(shopCode)||photo.shopCode!==shopCode||
   !UUID.test(photo.photoId||'')||!UUID.test(photo.orderId||'')||!UUID.test(photo.reportId||'')||
   photo.storageBucket!==BUCKET||typeof photo.storagePath!=='string'||photo.storagePath.length>230||
   !PATH.test(photo.storagePath)||
   !photo.storagePath.startsWith(`${shopCode}/${photo.orderId}/${photo.reportId}/`)||
   !VALID.has(photo.uploadState)||!safeStamp(photo.createdAt))bad('R93C_UNSAFE_CLEANUP_SCOPE');
 const m=photo.storagePath.match(PATH);
 if(!UUID.test(m[1])||!UUID.test(m[2])||!UUID.test(m[3]))bad('R93C_UNSAFE_CLEANUP_SCOPE');
}
export function planR93CRecovery({photo,shopCode,now,attempts=0,lockHeld=false,serverVerified=false}={}){
 if(!Number.isFinite(now)||!Number.isSafeInteger(attempts)||attempts<0||attempts>MAX_ATTEMPTS)
   bad('R93C_SCHEDULE_INVALID');
 if(!lockHeld||!serverVerified)bad('R93C_LOCK_AND_AUTH_REQUIRED');
 if(photo?.uploadState==='ready')return Object.freeze({decision:'SKIP_READY_NEVER_DELETE',networkOperations:0});
 requirePhoto(photo,shopCode);
 const age=now-Date.parse(photo.createdAt);
 if(!Number.isFinite(age)||age<0)bad('R93C_CLOCK_INVALID');
 if(age<MIN_STALE_MS)return Object.freeze({decision:'WAIT_FOR_UPLOAD_GRACE',retryAfterMs:MIN_STALE_MS-age,networkOperations:0});
 if(attempts>=MAX_ATTEMPTS)return Object.freeze({decision:'ESCALATE_MANUAL_REVIEW',networkOperations:0});
 return Object.freeze({decision:'REQUEST_PRIVATE_DELETE_AND_VERIFY',bucket:BUCKET,
  path:photo.storagePath,photoId:photo.photoId,shopCode,attempt:attempts+1,
  networkOperations:0,reviewOnly:true});
}
export function nextR93CRetryDelay({attempts,httpStatus=null,networkError=false}={}){
 if(!Number.isSafeInteger(attempts)||attempts<1||attempts>MAX_ATTEMPTS)bad('R93C_RETRY_INVALID');
 if(networkError!==true&&(!Number.isInteger(httpStatus)||httpStatus<100||httpStatus>599))bad('R93C_RETRY_INVALID');
 if(httpStatus===401||httpStatus===403)return Object.freeze({decision:'ESCALATE_AUTH_FAILURE',delayMs:null});
 if(attempts>=MAX_ATTEMPTS)return Object.freeze({decision:'ESCALATE_MANUAL_REVIEW',delayMs:null});
 if(networkError||httpStatus===408||httpStatus===409||httpStatus===425||httpStatus===429||httpStatus>=500)
   return Object.freeze({decision:'RETRY_WITH_DURABLE_OUTBOX',delayMs:Math.min(24*60*60*1000,5*60*1000*2**(attempts-1))});
 return Object.freeze({decision:'ESCALATE_UNEXPECTED_STORAGE_STATUS',delayMs:null});
}
export function interpretR93CDelete({status,networkError=false}={}){
 if(networkError===true)return Object.freeze({decision:'RETRY_STORAGE_DELETE',confirmedGone:false});
 if(!Number.isInteger(status)||status<100||status>599)bad('R93C_DELETE_INVALID');
 if([200,202,204,404].includes(status))return Object.freeze({decision:'VERIFY_STORAGE_OBJECT_ABSENCE',confirmedGone:false});
 if([401,403].includes(status))return Object.freeze({decision:'ESCALATE_AUTH_FAILURE',confirmedGone:false});
 if([408,409,425,429].includes(status)||status>=500)return Object.freeze({decision:'RETRY_STORAGE_DELETE',confirmedGone:false});
 return Object.freeze({decision:'ESCALATE_UNEXPECTED_STORAGE_STATUS',confirmedGone:false});
}
export function verifyR93CAbsence({status,networkError=false}={}){
 if(networkError===true)return Object.freeze({decision:'RETRY_PROBE',confirmedGone:false});
 if(!Number.isInteger(status)||status<100||status>599)bad('R93C_PROBE_INVALID');
 if(status===404)return Object.freeze({decision:'CLEANUP_CONFIRMED',confirmedGone:true});
 if(status===200||status===206||status===304)return Object.freeze({decision:'STILL_PRESENT_RETRY_DELETE',confirmedGone:false});
 if(status===401||status===403)return Object.freeze({decision:'ESCALATE_AUTH_FAILURE',confirmedGone:false});
 return Object.freeze({decision:'RETRY_PROBE_OR_ESCALATE',confirmedGone:false});
}
export const R93C_RULES=Object.freeze({bucket:BUCKET,gracePeriodMs:MIN_STALE_MS,maxAttempts:MAX_ATTEMPTS,liveExecution:false,durableOutboxRequired:true});
