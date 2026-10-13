// DPRO CAR02 R121 — upload-ambiguity safe candidate, ISOLATED MODEL ONLY.
// NOT WIRED into R47/R50/R51/R52, no real Storage, no real DB, no deployment.
// Integration requires independently proven durable ledger, real staging IAM and review.
import {createHash} from 'node:crypto';
const DB='car02_r121_qa_ci';
const BUCKET='ksh-car02-private-photos';
const TYPES=Object.freeze({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'});
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const MAX=5*1024*1024;
const err=(code)=>Object.assign(new Error(code),{code});
const ensure=(p,code)=>{if(!p)throw err('R121_'+code);};
const sum=x=>createHash('sha256').update(x).digest('hex');
function magic(bytes,mime){
 if(mime==='image/png')return bytes.length>=8&&[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b);
 if(mime==='image/webp')return bytes.length>=12&&[82,73,70,70,0,0,0,0,87,69,66,80].every((b,i)=>i>=4&&i<8||bytes[i]===b);
 if(mime==='image/jpeg')return bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 return false;
}
function validate(x){
 ensure(x?.actor?.verified===true&&['owner','staff'].includes(x.actor.role)&&
   x.actor.shopCode===x.shop&&/^staff:[0-9a-f-]{36}$/i.test(x.actor.subject||'')&&
   UUID.test(x.actor.subject.slice(6)),'AUTH');
 ensure(SHOP.test(x.shop||'')&&UUID.test(x.orderId||'')&&UUID.test(x.reportId||'')&&UUID.test(x.intentKey||''),'SCOPE');
 ensure(Object.hasOwn(TYPES,x.mimeType),'MIME');
 ensure(x.bytes instanceof Uint8Array&&x.bytes.byteLength>=4&&x.bytes.byteLength<=MAX&&magic(x.bytes,x.mimeType),'IMAGE');
 const path=`${x.shop}/${x.orderId.toLowerCase()}/${x.reportId.toLowerCase()}/${x.intentKey.toLowerCase()}.${TYPES[x.mimeType]}`;
 return Object.freeze({shop:x.shop,orderId:x.orderId.toLowerCase(),reportId:x.reportId.toLowerCase(),intentKey:x.intentKey.toLowerCase(),
  actor:x.actor.subject.toLowerCase(),role:x.actor.role,bucket:BUCKET,path,mime:x.mimeType,sha256:sum(x.bytes),size:x.bytes.byteLength});
}
function exact(row,want,state){return !!row&&row.state===state&&row.shop===want.shop&&row.intentKey===want.intentKey&&row.path===want.path&&row.sha256===want.sha256&&row.size===want.size&&row.mime===want.mime&&row.orderId===want.orderId&&row.reportId===want.reportId&&row.actor===want.actor&&row.role===want.role&&row.bucket===want.bucket;}
export function createR121IsolatedPhotoCandidate({environment,dbName,releaseGate,ledger,storage}={}){
 ensure(environment==='isolated_qa'&&dbName===DB&&typeof releaseGate==='function'&&
  typeof ledger?.reserve==='function'&&typeof ledger?.inspect==='function'&&typeof ledger?.quarantine==='function'&&
  typeof ledger?.markReady==='function'&&typeof storage?.putOnce==='function'&&typeof storage?.readBack==='function',
  'ISOLATION');
 return Object.freeze({async upload(x){
  ensure(await releaseGate()===true,'GATE_CLOSED');
  const m=validate(x);
  let row;
  try{row=await ledger.reserve(m);}catch{throw err('R121_RESERVE_UNCONFIRMED');}
  ensure(row?.intentKey===m.intentKey&&row?.shop===m.shop,'RESERVE_SCOPE');
  if(exact(row,m,'READY'))return Object.freeze({status:'READY',deduplicated:true});
  if(exact(row,m,'QUARANTINED'))throw err('R121_QUARANTINED_NO_REUPLOAD');
  ensure(exact(row,m,'PENDING'),'RESERVE_MISMATCH');
  if(row.existing===true){ // ACK was lost or process restarted: never blind reupload.
   const prior=await ledger.inspect(m).catch(()=>null);
   if(exact(prior,m,'READY'))return Object.freeze({status:'READY',deduplicated:true});
   if(exact(prior,m,'QUARANTINED'))throw err('R121_QUARANTINED_NO_REUPLOAD');
   await quarantine(m,'RETRY_UNCERTAIN');
   throw err('R121_RETRY_NEEDS_REVIEW');
  }
  async function quarantine(m,reason){
   try{const q=await ledger.quarantine(m,reason);if(exact(q,m,'QUARANTINED'))return true;}
   catch{}
   // If READY was committed but acknowledgement vanished, do not downgrade it.
   const fresh=await ledger.inspect(m).catch(()=>null);
   if(exact(fresh,m,'READY'))return 'READY';
   throw err('R121_QUARANTINE_UNCONFIRMED');
  }
  // Network/storage adapter is supplied by tests only. There is deliberately NO delete capability.
  let uploadError=null;
  try{await storage.putOnce(m,x.bytes)}catch(e){uploadError=e;}
  let readback=null;
  try{readback=await storage.readBack(m)}catch{}
  // The storage reader must return EXACT bytes, never merely an HTTP success or an ETag.
  if(!(readback instanceof Uint8Array)||readback.length!==m.size||sum(readback)!==m.sha256||!magic(readback,m.mime)){
   const q=await quarantine(m,uploadError?'UPLOAD_ACK_OR_READBACK_UNCERTAIN':'READBACK_MISMATCH');
   if(q==='READY')return Object.freeze({status:'READY',deduplicated:false,ackRecovered:true});
   throw err('R121_PHOTO_QUARANTINED');
  }
  try{const ready=await ledger.markReady(m);
   if(exact(ready,m,'READY')){
    const proof=await ledger.inspect(m);
    if(exact(proof,m,'READY'))return Object.freeze({status:'READY',deduplicated:false,ackRecovered:!!uploadError});
   }
  }catch{}
  const proof=await ledger.inspect(m).catch(()=>null);
  if(exact(proof,m,'READY'))return Object.freeze({status:'READY',deduplicated:false,ackRecovered:true});
  const q=await quarantine(m,'READY_ACK_UNCERTAIN');
  if(q==='READY')return Object.freeze({status:'READY',deduplicated:false,ackRecovered:true});
  throw err('R121_PHOTO_QUARANTINED');
 }});
}
export const R121_CONTRACT=Object.freeze({productionReady:false,releaseDecision:'NO_GO',migrationDecision:'HOLD',dbName:DB,
  realSupabaseTested:false,durablePostgresTested:false,requiresRealStagingProof:true,storageDeleteNeverInvoked:true,
  newWorkerRequired:false,replacesExistingProductionR47:false});
