// DPRO CAR02 R93W: verified R93V HTTP request -> durable R93S pending intent.
// ISOLATED QA ONLY. Deliberately no live Storage upload, mark-ready or DELETE.
// In this phase HTTP must report 503, never a false 201; R93X will integrate
// verified private Storage upload + ready proof before any successful response.
import {createHash} from 'node:crypto';
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const EXT=Object.freeze({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'});
const DB='car02_r93q_qa_ci';
const BUCKET='ksh-car02-private-photos';
const fail=(code)=>{throw Object.assign(new Error(code),{code});};
const validImage=(mime,bytes)=>{
 if(!(bytes instanceof Uint8Array)||bytes.byteLength<4||bytes.byteLength>5*1024*1024||!Object.hasOwn(EXT,mime))return false;
 if(mime==='image/jpeg')return bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(mime==='image/png')return bytes.length>=8&&[137,80,78,71,13,10,26,10].every((x,i)=>bytes[i]===x);
 return bytes.length>=12&&String.fromCharCode(...bytes.subarray(0,4))==='RIFF'&&
   String.fromCharCode(...bytes.subarray(8,12))==='WEBP';
};
export function buildR93WDurableEnvelope({actor,shop,orderId,reportId,mimeType,bytes,intentKey}={}){
 if(!SHOP.test(shop||'')||!UUID.test(orderId||'')||!UUID.test(reportId||'')||!UUID.test(intentKey||''))
  fail('R93W_BAD_SCOPE_OR_KEY');
 if(actor?.verified!==true||actor.shopCode!==shop||!['owner','staff'].includes(actor.role)||
    typeof actor.subject!=='string'||!/^staff:[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(actor.subject))
  fail('R93W_UNVERIFIED_STAFF');
 if(!validImage(mimeType,bytes))fail('R93W_UNVERIFIED_IMAGE');
 const norm=id=>id.toLowerCase();
 const o=norm(orderId),r=norm(reportId),key=norm(intentKey);
 return Object.freeze({actor:Object.freeze({...actor,subject:`staff:${actor.subject.slice(6).toLowerCase()}`}),
  shopCode:shop,orderId:o,reportId:r,intentKey:key,bucket:BUCKET,
  path:`${shop}/${o}/${r}/${key}.${EXT[mimeType]}`,
  mimeType,byteSize:bytes.byteLength,sha256:createHash('sha256').update(bytes).digest('hex')});
}
export function createR93WIsolatedDurableHttpPort({environment,dbName,shopCode,intents}={}){
 if(environment!=='isolated_qa'||dbName!==DB||!SHOP.test(shopCode||'')||
    typeof intents?.reserve!=='function')fail('R93W_DISPOSABLE_INTENT_PORT_REQUIRED');
 return Object.freeze({async upload(request){
   const envelope=buildR93WDurableEnvelope(request);
   if(envelope.shopCode!==shopCode)fail('R93W_SHOP_MISMATCH');
   const reservation=await intents.reserve(envelope); // real PG transaction in R93S.
   if(!UUID.test(reservation?.photoId||'')||!['pending','ready'].includes(reservation.state)||
      !['VERIFY_STORAGE_OR_COMPENSATE','DO_NOT_REUPLOAD'].includes(reservation.action))
      fail('R93W_INVALID_DURABLE_RESERVATION');
   // No Storage adapter connected. A pending or ready DB record alone is NOT proof
   // that the object was durably stored, independently verified and scoped.
   fail('R93W_STORAGE_AND_READY_PROOF_NOT_CONNECTED');
 }});
}
export const R93W_CONTRACT=Object.freeze({mode:'isolated_qa',dbName:DB,productionReady:false,
 releaseDecision:'NO_GO',migrationDecision:'HOLD',liveStorageOperations:false,
 readyProofConnected:false,neverReturnsHttp201:true,usesDurableIntent:true,
 r47DirectDeleteUnchanged:true,r50R51R52Unchanged:true,deployAuthorized:false});
