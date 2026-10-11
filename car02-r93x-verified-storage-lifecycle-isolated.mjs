// CAR02 R93X: R93V HTTP -> R93S durable intent -> memory-only Storage simulation
// -> transactional READY / independent PG proof or durable cleanup job.
// ISOLATED QA ONLY. No live Supabase, no DELETE, no production wiring.
import {createHash} from 'node:crypto';
import {buildR93WDurableEnvelope} from './car02-r93w-durable-http-reservation-isolated.mjs';
const DB='car02_r93q_qa_ci',BUCKET='ksh-car02-private-photos';
const ID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SHA=x=>createHash('sha256').update(x).digest('hex');
const own=code=>Object.assign(new Error(code),{code});
const reject=code=>{throw own(code)};
const imageTypeOk=(bytes,mime)=>{
 if(!(bytes instanceof Uint8Array))return false;
 if(mime==='image/jpeg')return bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(mime==='image/png')return bytes.length>=8&&[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b);
 if(mime==='image/webp')return bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
 return false;
};
function same(meta,env){
 return meta?.found===true&&meta.private===true&&meta.bucket===BUCKET&&meta.path===env.path&&
  meta.mimeType===env.mimeType&&meta.bytes instanceof Uint8Array&&
  meta.bytes.byteLength===env.byteSize&&imageTypeOk(meta.bytes,env.mimeType)&&
  SHA(meta.bytes)===env.sha256;
}
const definitelyMissing=r=>r?.found===false&&r.definitive===true;
export function createR93XIsolatedVerifiedStorageLifecycle({environment,dbName,shopCode,intents,readyPort,storage,reviewGate}={}){
 if(environment!=='isolated_qa'||dbName!==DB||typeof shopCode!=='string'||
  !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(shopCode)||
  typeof reviewGate!=='function'||
  !['reserve','resume'].every(k=>typeof intents?.[k]==='function')||
  !['markReady','proveReady','enqueueUncertain'].every(k=>typeof readyPort?.[k]==='function')||
  storage?.kind!=='isolated_memory'||storage.testOnly!==true||
  !['verifyPrivateBucket','postObject','inspectObject'].every(k=>typeof storage?.[k]==='function'))
  reject('R93X_ISOLATED_DEPENDENCIES_REQUIRED');
 return Object.freeze({async upload(request={}){
  // Immutable envelope includes SHA-256 of actual bounded image bytes.
  const env=buildR93WDurableEnvelope(request);
  if(env.shopCode!==shopCode)reject('R93X_TENANT_MISMATCH');
  let open=false;try{open=(await reviewGate())===true}catch{}
  if(!open)reject('R93X_GATE_CLOSED');
  const bucket=await storage.verifyPrivateBucket({bucket:BUCKET});
  if(bucket?.id!==BUCKET||bucket.public!==false)reject('R93X_PRIVATE_BUCKET_UNVERIFIED');
  // Reserve before any Storage write. The same intent always yields the same photo.
  const reserved=await intents.reserve(env);
  if(!ID.test(reserved?.photoId||'')||!['pending','ready'].includes(reserved.state))
   reject('R93X_DURABLE_RESERVATION_UNVERIFIED');
  const photoId=reserved.photoId;
  if(reserved.state==='ready'&&reserved.action!=='DO_NOT_REUPLOAD')reject('R93X_INTENT_STATE_INVALID');
  if(reserved.state==='pending'&&reserved.action!=='VERIFY_STORAGE_OR_COMPENSATE')reject('R93X_INTENT_STATE_INVALID');
  const inspect=async()=>{
   try{return await storage.inspectObject({bucket:BUCKET,path:env.path})}catch{return null}
  };
  const finished=async()=>{
   // Every success requires an independent DB transaction and storage read-back.
   const record=await intents.resume(env);
   if(record?.photoId!==photoId||record.state!=='ready'||record.action!=='DO_NOT_REUPLOAD')
    reject('R93X_INTENT_NOT_READY');
   if((await readyPort.proveReady(env,photoId))!==true)reject('R93X_READY_PROOF_DENIED');
   const check=await inspect();
   if(!same(check,env))reject('R93X_STORAGE_PROOF_DENIED');
   return Object.freeze({photoId,state:'ready',mimeType:env.mimeType,byteSize:env.byteSize,
    productionReady:false,releaseDecision:'NO_GO',migrationDecision:'HOLD'});
  };
  if(reserved.state==='ready')return finished(); // No new Storage POST.
  let wroteOrUncertain=false;
  try{
   let present=await inspect();
   if(!same(present,env)){
    if(!definitelyMissing(present))reject('R93X_INITIAL_STORAGE_UNKNOWN');
    wroteOrUncertain=true; // timeout MAY have committed; no immediate DELETE.
    try{
     const put=await storage.postObject({bucket:BUCKET,path:env.path,mimeType:env.mimeType,
      bytes:new Uint8Array(request.bytes),upsert:false});
     // Even status=201 must be independently inspected, not trusted as proof.
     if(put?.status!==201&&put?.status!==409)reject('R93X_STORAGE_POST_UNCONFIRMED');
    }catch{ /* resolve by fresh read-back below */ }
    present=await inspect();
    if(!same(present,env))reject('R93X_STORAGE_WRITE_UNCERTAIN');
   }
   try{await readyPort.markReady(env,photoId)}catch(e){
    // COMMIT ACK may be lost, but a deterministic denial cannot be ignored.
    if(e?.code!=='R93X_DB_UNAVAILABLE')throw e;
   }
   return await finished();
  }catch(e){
   // A positive READY proof wins over a lost ACK, but only if Storage also proves.
   // Never downgrade a committed READY row to a tombstone.
   try{return await finished()}catch{}
   try{await readyPort.enqueueUncertain(env,photoId)}catch{
    reject('R93X_RECOVERY_NOT_CONFIRMED');
   }
   reject('R93X_RECOVERY_QUEUED');
  }
 }});
}
export const R93X_CONTRACT=Object.freeze({mode:'isolated_qa',productionReady:false,
 releaseDecision:'NO_GO',migrationDecision:'HOLD',storageMode:'isolated_memory_only',
 durableReserveBeforeStorage:true,noImmediateDelete:true,readBackSHA256:true,
 proofInIndependentDatabaseTransaction:true,liveSupabaseStorageConnected:false,
 r47R50R51R52Unchanged:true});
