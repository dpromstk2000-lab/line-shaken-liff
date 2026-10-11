// DPRO CAR02 R93I: R47-compatible call surface backed by R93H's durable-compensation contract.
// ISOLATED QA ONLY. Not imported by R50/R51/R52/R47 and not a production replacement.
// Does not create HTTP handlers, use secrets, fetch, modify a DB or delete Storage objects.
import { createHash } from 'node:crypto';
import {createR93HIsolatedUploadCompensation} from './car02-r93h-upload-compensation-isolated.mjs';

const MAX_BYTES=5242880;
const dbPattern=/^car02_r93i_qa_[a-z0-9_]{1,36}$/;
const fail=code=>{throw Object.assign(new Error(code),{code})};
const sha256=x=>createHash('sha256').update(x).digest('hex');

export function createR93IIsolatedR47SafeBridge({environment,dbName,releaseEnabled,repository,storage}={}){
  if(environment!=='isolated_qa'||!dbPattern.test(dbName||'')||typeof releaseEnabled!=='function'||
     !repository||!['reserve','markReady','tombstoneAndEnqueue'].every(k=>typeof repository[k]==='function')||
     !storage||!['verifyPrivateBucket','postObject','inspectObject'].every(k=>typeof storage[k]==='function'))
     fail('R93I_ISOLATION_REQUIRED');
  const service=createR93HIsolatedUploadCompensation({environment:'isolated_qa',
    dbName:dbName.replace('r93i','r93h'),repository,storage});
  return Object.freeze({
    // Matches R47's caller-facing parameter names and success result keys.
    async upload({actor,shop,orderId,reportId,mimeType,bytes}={}){
      // Reject before even requesting release status when bytes are unbounded or untrusted.
      if(!(bytes instanceof Uint8Array)||bytes.byteLength<4||bytes.byteLength>MAX_BYTES)
        fail('R93I_IMAGE_INVALID');
      // Snapshot the incoming array: async release checks cannot alter its validated bytes.
      const owned=Uint8Array.from(bytes);
      let released=false;
      try{released=(await releaseEnabled())===true}catch{}
      if(!released)fail('R93I_NOT_RELEASED');
      let result;
      try{result=await service.upload({actor,shopCode:shop,orderId,reportId,mimeType,bytes:owned});}
      catch(e){
        // Surface only explicit R93H public error codes; never pass raw adapter errors.
        if(typeof e?.message==='string'&&/^R93H_[A-Z_]+$/.test(e.message))fail(e.message);
        fail('R93I_UPLOAD_UNAVAILABLE');
      }
      if(result?.state!=='ready'||typeof result.photoId!=='string'||result.byteSize!==owned.byteLength||
         result.mimeType!==mimeType||result.productionReady!==false||result.releaseDecision!=='NO_GO')
         fail('R93I_RESULT_UNVERIFIED');
      return Object.freeze({photoId:result.photoId,state:'ready',mimeType,byteSize:owned.byteLength,
        sha256:sha256(owned)});
    }
  });
}
export const R93I_CONTRACT=Object.freeze({environment:'isolated_qa',productionReady:false,liveWiring:false,
  releaseDecision:'NO_GO',migrationDecision:'HOLD',callerSurface:'R47_UPLOAD',
  uploadRecovery:'R93H_ATOMIC_TOMBSTONE_AND_OUTBOX',deleteObjectImmediately:false,
  requiresR93GSqlMigrationBeforeLive:true,requiresRealAdapterReviewBeforeLive:true,
  r47LegacyStillUnchanged:true});
