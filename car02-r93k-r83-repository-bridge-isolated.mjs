// CAR02 R93K — isolated R83-shaped repository / R93H port compatibility bridge.
// QA/REVIEW ONLY. Does not instantiate a PG pool, Storage client, HTTP route or credentials.
// R83's QA DB guard is intentionally incompatible with R93H's QA name: this module
// proves the API contract only. Real transactional DB adapter / migration NOT DONE.
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const DB=/^car02_r93k_qa_[a-z0-9_]{1,36}$/;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const BUCKET='ksh-car02-private-photos';
const MIME=Object.freeze({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'});
const SHA=/^[0-9a-f]{64}$/;
const fail=code=>{throw Object.assign(new Error(code),{code})};
const sourceApproved=(s)=>s?.verified===true && ['owner','staff'].includes(s?.role) &&
 typeof s?.shopCode==='string' && SHOP.test(s.shopCode) && typeof s.subject==='string' &&
 /^staff:[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(s.subject);
function verifiedPath(x){
 if(!x||typeof x.path!=='string'||!Object.hasOwn(MIME,x.mimeType))return false;
 const prefix=`${x.shopCode}/${x.orderId}/${x.reportId}/`;
 if(!x.path.startsWith(prefix))return false;
 const leaf=x.path.slice(prefix.length);
 return leaf.length===37+MIME[x.mimeType].length && UUID.test(leaf.slice(0,36)) && leaf.slice(36)===`.${MIME[x.mimeType]}`;
}
const approvedRequest=(x)=>x&&sourceApproved(x.actor)&&x.actor.shopCode===x.shopCode&&
 SHOP.test(x.shopCode)&&UUID.test(x.orderId||'')&&UUID.test(x.reportId||'')&&
 x.bucket===BUCKET&&verifiedPath(x);
const verifyReceipt=(r,x,id)=>r&&r.id===id&&r.upload_state==='pending'&&
 r.storage_bucket===BUCKET&&r.storage_path===x.path&&r.mime_type===x.mimeType&&
 r.byte_size===x.byteSize&&r.sha256===x.sha256;
function ensurePhotoIdentity(x){
 if(!x||!sourceApproved(x.actor)||x.shopCode!==x.actor.shopCode||!SHOP.test(x.shopCode)||
 !UUID.test(x.photoId||'')||!UUID.test(x.orderId||'')||!UUID.test(x.reportId||'')||
 x.bucket!==BUCKET||x.expectedState!=='pending'||typeof x.path!=='string')fail('R93K_UNVERIFIED_SCOPE');
 const prefix=`${x.shopCode}/${x.orderId}/${x.reportId}/`;
 if(!x.path.startsWith(prefix)||x.path.length>300||!/^[-0-9a-f]{36}\.(?:jpg|png|webp)$/i.test(x.path.slice(prefix.length)))
   fail('R93K_UNVERIFIED_SCOPE');
}
export function createR93KIsolatedR83RepositoryBridge({environment,dbName,r83Port,atomicCompensationPort}={}){
 if(environment!=='isolated_qa'||!DB.test(dbName||'')||!r83Port||
 ['reserve','getPending','markReady'].some(x=>typeof r83Port[x]!=='function')||
 !atomicCompensationPort||typeof atomicCompensationPort.tombstoneAndEnqueue!=='function')
   fail('R93K_ISOLATED_DEPENDENCIES_REQUIRED');
 const pending=async x=>{
   const r=await r83Port.getPending({actor:x.actor,shop:x.shopCode,photoId:x.photoId});
   if(!r||r.id!==x.photoId||r.upload_state!=='pending'||r.storage_bucket!==BUCKET||
      r.storage_path!==x.path)fail('R93K_PENDING_IDENTITY_MISMATCH');
   return r;
 };
 return Object.freeze({
   async reserve(x){
     if(!approvedRequest(x)||!Number.isSafeInteger(x.byteSize)||x.byteSize<4||x.byteSize>5242880||
       typeof x.sha256!=='string'||!SHA.test(x.sha256))fail('R93K_UNVERIFIED_SCOPE');
     const row=await r83Port.reserve({actor:x.actor,shop:x.shopCode,orderId:x.orderId,reportId:x.reportId,
       mimeType:x.mimeType,byteSize:x.byteSize,sha256:x.sha256,bucket:BUCKET,path:x.path});
     if(!UUID.test(row?.id||''))fail('R93K_RESERVE_RESULT_UNVERIFIED');
     // Confirm exact R83 row identity before allowing any Storage POST.
     const receipt=await pending({...x,photoId:row.id});
     if(!verifyReceipt(receipt,x,row.id))fail('R93K_RESERVED_METADATA_MISMATCH');
     return Object.freeze({photoId:row.id,state:'pending'});
   },
   async markReady(x){
     ensurePhotoIdentity(x);
     const row=await pending(x);
     if(!verifiedPath({...x,mimeType:row.mime_type}))fail('R93K_PENDING_IDENTITY_MISMATCH');
     const answer=await r83Port.markReady({actor:x.actor,shop:x.shopCode,photoId:x.photoId,expectedState:'pending'});
     // R83 replies {id,state:'ready'} rather than the boolean expected by R93H.
     return Boolean(answer&&answer.id===x.photoId&&answer.state==='ready');
   },
   async tombstoneAndEnqueue(x){
     ensurePhotoIdentity(x);
     if(x.reason!=='UPLOAD_UNCERTAIN')fail('R93K_UNVERIFIED_REASON');
     const row=await pending(x);
     if(!verifiedPath({...x,mimeType:row.mime_type}))fail('R93K_PENDING_IDENTITY_MISMATCH');
     // Never call R83.cancel: it does not atomically enqueue a durable cleanup job.
     const result=await atomicCompensationPort.tombstoneAndEnqueue({actor:x.actor,shop:x.shopCode,
       photoId:x.photoId,orderId:x.orderId,reportId:x.reportId,bucket:BUCKET,
       path:x.path,expectedState:'pending',reason:'UPLOAD_UNCERTAIN'});
     // This is a port receipt only; verification of its DB transaction is a separate gate.
     if(!result||result.photoId!==x.photoId||result.state!=='deleted'||
       result.cleanupState!=='queued'||result.shopCode!==x.shopCode||
       result.storagePath!==x.path||!UUID.test(result.jobId||'')||result.atomicCommit!==true)
       fail('R93K_ATOMIC_RECEIPT_UNVERIFIED');
     return true;
   }
 });
}
export const R93K_CONTRACT=Object.freeze({mode:'isolated_qa',productionReady:false,liveWiring:false,
 releaseDecision:'NO_GO',migrationDecision:'HOLD',r83PortTranslation:true,
 requiresGetPendingMetadataMatch:true,requiresAtomicCompensationPort:true,
 neverCallsR83Cancel:true,r83AndR93hDatabaseNamesCurrentlyIncompatible:true,
 r83ProductionMigrationNotReviewed:true,transactionalAdapterNotYetImplemented:true});
