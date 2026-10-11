// CAR02 R93J — end-to-end R82 -> R93I -> R93H using only IN-PROCESS QA stubs.
// NO network/database/storage access. Never import in R50/R51/R52; do not deploy.
// Intended solely for isolated Node.js request/response integration testing.
import {randomUUID} from 'node:crypto';
import {createCar02PhotoUploadHttpR82} from './car02-private-photo-upload-http-r82.mjs';
import {createR93IIsolatedR47SafeBridge} from './car02-r93i-r47-safe-bridge-isolated.mjs';

const QA_DB=/^car02_r93j_qa_[a-z0-9_]{1,36}$/;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const FAKE_ORIGIN=/^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.invalid$/;
const TOKENS=Object.freeze({staff:'R93J-FAKE-STAFF-TOKEN-LOCAL-ONLY',owner:'R93J-FAKE-OWNER-TOKEN-LOCAL-ONLY'});
const MODES={post:['ok','lost_ack','rejected'],readback:['ok','corrupt','throw'],markReady:['ok','reject','committed_ack_lost'],outbox:['ok','reject'],bucket:['private','public']};
const fail=()=>{throw Error('R93J_ISOLATED_LOCAL_TEST_ONLY')};
const COPY=x=>Uint8Array.from(x);

export function createR93JIsolatedHttpMemoryPipeline({environment,dbName,shopCode,allowedOrigins,
 qaEnabled=false,faults={}}={}){
 if(environment!=='isolated_qa'||typeof dbName!=='string'||!QA_DB.test(dbName)||!SHOP.test(shopCode||'')||
  !Array.isArray(allowedOrigins)||allowedOrigins.length<1||allowedOrigins.length>8||
  allowedOrigins.some(x=>typeof x!=='string'||!FAKE_ORIGIN.test(x))||
  typeof qaEnabled!=='boolean'||!faults||typeof faults!=='object'||Array.isArray(faults)||
  Object.keys(faults).some(k=>!Object.hasOwn(MODES,k)||!MODES[k].includes(faults[k])))fail();
 const mode={post:'ok',readback:'ok',markReady:'ok',outbox:'ok',bucket:'private',...faults};
 const rows=new Map(),blobs=new Map(),jobs=new Map(),events=[];
 const note=x=>events.push(x);
 const repository={
  async reserve(meta){
   note('reserve');
   if(!rows.has(meta.path) && [...rows.values()].filter(r=>r.reportId===meta.reportId&&r.shopCode===meta.shopCode&&r.state!=='deleted').length>=3)
    throw Error('CAR02_MAX_THREE_ACTIVE_PHOTOS');
   if(rows.has(meta.path))throw Error('CAR02_DUPLICATE_PATH');
   const photoId=randomUUID();rows.set(meta.path,{photoId,state:'pending',shopCode:meta.shopCode,reportId:meta.reportId,orderId:meta.orderId});
   return {photoId,state:'pending'};
  },
  async markReady({shopCode,photoId,reportId,orderId,path,expectedState}){
   note('markReady');const row=rows.get(path);
   if(!row||row.photoId!==photoId||row.shopCode!==shopCode||row.reportId!==reportId||row.orderId!==orderId||row.state!==expectedState)return false;
   if(mode.markReady==='reject')return false;
   row.state='ready';
   if(mode.markReady==='committed_ack_lost')throw Error('DB_REPLIED_AFTER_COMMIT_WITH_LOST_ACK');
   return true;
  },
  async tombstoneAndEnqueue({shopCode,photoId,reportId,orderId,path,expectedState,reason}){
   note('tombstoneAndEnqueue');const row=rows.get(path);
   if(!row||row.photoId!==photoId||row.shopCode!==shopCode||row.reportId!==reportId||row.orderId!==orderId||
     row.state!==expectedState||reason!=='UPLOAD_UNCERTAIN'||mode.outbox==='reject')return false;
   // Both changes occur synchronously in this test-only memory model.
   row.state='deleted';jobs.set(photoId,{shopCode,photoId,path,state:'queued'});return true;
  }
 };
 const storage={
  async verifyPrivateBucket({bucket}){
   note('verifyPrivateBucket');return {id:bucket,public:mode.bucket!=='private'};
  },
  async postObject({bucket,path,mimeType,bytes,upsert}){
   note('postObject');
   if(bucket!=='ksh-car02-private-photos'||upsert!==false||blobs.has(path))throw Error('QA_UPSERT_FORBIDDEN');
   if(mode.post==='rejected')return {status:503};
   blobs.set(path,{mimeType,bytes:COPY(bytes)});
   if(mode.post==='lost_ack')throw Error('QA_STORAGE_ACK_LOST');
   return {status:201};
  },
  async inspectObject({path,bucket}){
   note('inspectObject');if(mode.readback==='throw')throw Error('QA_READBACK_FAILURE');
   const blob=blobs.get(path);if(!blob||bucket!=='ksh-car02-private-photos')return null;
   return {private:true,mimeType:blob.mimeType,bytes:mode.readback==='corrupt'?new Uint8Array([1,2,3,4]):COPY(blob.bytes)};
  }
 };
 const releaseEnabled=async()=>qaEnabled===true;
 const uploadService=createR93IIsolatedR47SafeBridge({environment:'isolated_qa',
  dbName:dbName.replace('r93j','r93i'),releaseEnabled,repository,storage});
 const authenticate=async request=>{
  const token=request.headers.get('authorization')||'';
  const role=token==='Bearer '+TOKENS.staff?'staff':token==='Bearer '+TOKENS.owner?'owner':null;
  return role?{verified:true,shopCode,role,subject:'staff:44444444-4444-4444-8444-444444444444'}:null;
 };
 const handle=createCar02PhotoUploadHttpR82({shopCode,allowedOrigins,authenticate,uploadService,releaseEnabled});
 return Object.freeze({handle,
  // Test-only observation: no live URLs, real credentials, or raw stored image bytes exposed.
  inspectForQA:()=>Object.freeze({rows:[...rows.values()].map(r=>({...r})),
   queued:[...jobs.values()].map(j=>({...j})),blobCount:blobs.size,events:[...events]})
 });
}
export const R93J_QA_TOKENS=TOKENS;
export const R93J_CONTRACT=Object.freeze({environment:'isolated_qa',dbAccess:false,networkAccess:false,
 productionReady:false,liveWiring:false,releaseDecision:'NO_GO',migrationDecision:'HOLD',
 callsExistingR82:true,callsExistingR93I:true,containsRealCredentials:false,
 ephemeralInMemoryOnly:true,qaOnlyOrigins:true,requiresRealR47ReplacementBeforeProduction:true});
