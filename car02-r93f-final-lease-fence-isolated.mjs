// DPRO CAR02 R93F: ISOLATED QA terminal lease/photo fence before cleanup finalization.
// Does not contact production; only injected disposable adapters. Never wire R50/R51/R52.
// A plain textual 404 receipt is not evidence: an independent trusted private-object
// probe must return 404, then the DB adapter must atomically verify exact lease/row.
import {createR93EIsolatedTombstoneGate} from './car02-r93e-tombstone-binding-isolated.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHOP=/^[a-z][a-z0-9_]{2,63}$/;
const BUCKET='ksh-car02-private-photos';
const EXACT=['jobId','leaseId','shopCode','proof'];
const own=(x,fields)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k));
const reject=()=>{throw Error('R93F_ISOLATED_DEPENDENCIES_REQUIRED')};

export function createR93FIsolatedFinalLeaseFence({environment,dbName,readLeasedJob,readPhotoRecord,
  trustedProbe,commitVerified,clock=()=>Date.now()}={}) {
 if(environment!=='isolated_qa'||!/^car02_r93f_qa_[a-z0-9_]{1,36}$/.test(dbName||'')||
   ![readLeasedJob,readPhotoRecord,trustedProbe,commitVerified,clock].every(f=>typeof f==='function'))reject();
 const gate=createR93EIsolatedTombstoneGate({environment,dbName:dbName.replace('r93f','r93e'),
   readLeasedJob,readPhotoRecord,clock});
 async function markVerified(receipt){
  if(!own(receipt,EXACT)||!UUID.test(receipt.jobId)||!UUID.test(receipt.leaseId)||
     !SHOP.test(receipt.shopCode)||receipt.proof!=='PRIVATE_OBJECT_PROBE_404')return false;
  try {
   const now=clock();if(!Number.isSafeInteger(now)||now<0)return false;
   const lease=await readLeasedJob({jobId:receipt.jobId,leaseId:receipt.leaseId,shopCode:receipt.shopCode});
   if(!lease||!UUID.test(lease.photoId||'')||typeof lease.storagePath!=='string'||
      lease.jobId!==receipt.jobId||lease.leaseId!==receipt.leaseId||lease.shopCode!==receipt.shopCode)return false;
   const scoped={jobId:receipt.jobId,leaseId:receipt.leaseId,shopCode:receipt.shopCode,
     photoId:lease.photoId,storagePath:lease.storagePath};
   if(await gate.confirmTombstone(scoped)!==true)return false;
   // A second, independent private-object read-after-delete check prevents
   // a forged/stale receipt string from directly authorizing finalization.
   const probe=await trustedProbe({bucket:BUCKET,path:lease.storagePath});
   if(!probe||Object.keys(probe).length!==1||probe.status!==404)return false;
   // Check identity again after I/O to reject a lost/expired lease or a replaced row.
   if(await gate.confirmTombstone(scoped)!==true)return false;
   const at=clock();if(!Number.isSafeInteger(at)||at<now)return false;
   // commitVerified MUST be a single conditional DB transaction checking matching
   // job/photo/lease/shop/path, state=deleted and lease expiry at database time.
   // A success boolean is never inferred from the prior probe or a SELECT alone.
   return (await commitVerified({...scoped,proof:'PRIVATE_OBJECT_PROBE_404',atMs:at}))===true;
  }catch{return false} // Fail-closed, never leak credentials/DB diagnostics.
 }
 return Object.freeze({markVerified});
}
export const R93F_CONTRACT=Object.freeze({mode:'isolated_qa',productionReady:false,releaseDecision:'NO_GO',
 migrationDecision:'HOLD',liveWiring:false,requiresIndependentProbe404:true,
 requiresAtomicConditionalCommit:true,protectsSameRowBinding:true,canProveRealProductionDurability:false});
