// DPRO CAR02 R93G — immutable photo tombstone + durable cleanup outbox contract.
// REVIEW/QA ONLY. No HTTP, storage, database, credentials or production wiring.
// This policy cannot substitute for scoped authorization or a transactional DB trigger.
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const BUCKET='ksh-car02-private-photos';
const MIME={ 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp' };
const SHA=/^[a-f0-9]{64}$/;
const states=new Set(['pending','ready','deleted']);
const fields=['id','shopCode','orderId','reportId','storageBucket','storagePath','mimeType','byteSize','sha256','uploadState','createdAt'];
const own=(x)=>x!==null && typeof x==='object' && !Array.isArray(x) &&
  Object.getPrototypeOf(x)===Object.prototype && Object.keys(x).length===fields.length &&
  fields.every(f=>Object.hasOwn(x,f));
const immutables=fields.filter(f=>f!=='uploadState');
const result=(decision,extra={})=>Object.freeze({decision,productionReady:false,releaseDecision:'NO_GO',migrationDecision:'HOLD',storageOperations:0,dbOperations:0,...extra});
function valid(row){
 if(!own(row)||![row.id,row.orderId,row.reportId].every(x=>typeof x==='string'&&UUID.test(x))||
    typeof row.shopCode!=='string'||!SHOP.test(row.shopCode)||row.storageBucket!==BUCKET||
    !Object.hasOwn(MIME,row.mimeType)||!Number.isSafeInteger(row.byteSize)||row.byteSize<4||row.byteSize>5242880||
    typeof row.sha256!=='string'||!SHA.test(row.sha256)||!states.has(row.uploadState)||
    typeof row.createdAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(row.createdAt)||
    !Number.isFinite(Date.parse(row.createdAt))||new Date(Date.parse(row.createdAt)).toISOString()!==row.createdAt||
    typeof row.storagePath!=='string'||row.storagePath.length>300)return false;
 const prefix=`${row.shopCode}/${row.orderId}/${row.reportId}/`;
 const leaf=row.storagePath.startsWith(prefix)?row.storagePath.slice(prefix.length):'';
 return leaf.length===36+1+MIME[row.mimeType].length && UUID.test(leaf.slice(0,36)) &&
   leaf.slice(36)===`.${MIME[row.mimeType]}`;
}
export function evaluateR93GPhotoMutation({before,after,operation='UPDATE',authorized=false}={}){
 if(operation==='DELETE')return result('DENY_HARD_DELETE'); // keep the row as immutable evidence
 if(operation!=='UPDATE'||authorized!==true||!valid(before)||!valid(after))return result('DENY_UNVERIFIED_SCOPE');
 if(immutables.some(k=>before[k]!==after[k]))return result('DENY_IDENTITY_OR_METADATA_CHANGE');
 if(before.uploadState==='deleted')return result('DENY_TERMINAL_TOMBSTONE');
 if(before.uploadState==='ready'&&after.uploadState==='pending')return result('DENY_STATE_REGRESSION');
 if(before.uploadState==='pending' && !['pending','ready','deleted'].includes(after.uploadState))return result('DENY_STATE_REGRESSION');
 if(before.uploadState==='ready' && !['ready','deleted'].includes(after.uploadState))return result('DENY_STATE_REGRESSION');
 if(after.uploadState==='deleted')return result('ALLOW_ATOMIC_TOMBSTONE_AND_OUTBOX',{mustEnqueue:true,
   tombstone:{photoId:before.id,shopCode:before.shopCode,storagePath:before.storagePath,
     storageBucket:BUCKET,uploadState:'deleted'}});
 return result('ALLOW_NO_CLEANUP',{mustEnqueue:false});
}
export const R93G_INVARIANTS=Object.freeze({isolation:'isolated_qa',liveWiring:false,releaseDecision:'NO_GO',
  migrationDecision:'HOLD',immutablePhotoIdentity:true,terminalDeletedState:true,
  hardDeleteDenied:true,tombstoneOutboxAtomicRequired:true,productionMigrationReviewed:false});
