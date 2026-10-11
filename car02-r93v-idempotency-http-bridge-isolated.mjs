// DPRO CAR02 R93V — isolated R82 HTTP -> durable intent bridge (NOT production code).
// No credentials, DB or Storage network calls; no R47 import or direct DELETE.
// This supplies a validated, actor-bound Idempotency-Key to a separately reviewed
// durable upload port without changing the approved R82 source.
import {createCar02PhotoUploadHttpR82} from './car02-private-photo-upload-http-r82.mjs';
const UUID='[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}';
const ROUTE=new RegExp(`^/api/car02/uploads/${UUID}/${UUID}$`,'i');
const KEY=new RegExp(`^${UUID}$`,'i');
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const DB='car02_r93q_qa_ci';
const JSON_HEADERS=Object.freeze({'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'});
const deny=(status,code,origin='')=>new Response(JSON.stringify({ok:false,code}),{
 status,headers:{...JSON_HEADERS,...(origin?{'Access-Control-Allow-Origin':origin}:{})}
});
function allowedOrigins(origins){
 if(!Array.isArray(origins)||origins.length<1||origins.length>8)throw Error('R93V_ORIGINS_REQUIRED');
 const approved=new Set();
 for(const value of origins){
  if(typeof value!=='string'||approved.has(value))throw Error('R93V_ORIGIN_INVALID');
  let url;try{url=new URL(value);}catch{throw Error('R93V_ORIGIN_INVALID');}
  if(url.protocol!=='https:'||url.origin!==value||url.username||url.password||url.search||url.hash)
   throw Error('R93V_ORIGIN_INVALID');
  approved.add(value);
 }
 return approved;
}
const parseKey=request=>{
 const v=request.headers.get('idempotency-key');
 return typeof v==='string'&&KEY.test(v)?v.toLowerCase():null;
};
const PREFLIGHT=new Set(['authorization','content-type','idempotency-key']);
export function createCar02R93VIsolatedIdempotencyBridge({environment,dbName,shopCode,
 releaseEnabled,authenticate,durableUpload,origins}={}){
 if(environment!=='isolated_qa'||dbName!==DB||!SHOP.test(shopCode||'')||
    typeof releaseEnabled!=='function'||typeof authenticate!=='function'||
    typeof durableUpload?.upload!=='function')throw Error('R93V_ISOLATION_REQUIRED');
 const approved=allowedOrigins(origins);
 // Each R82 authenticate callback creates a unique immutable actor snapshot; the
 // request key cannot be supplied by the request body or an untrusted actor object.
 const intents=new WeakMap();
 const r82=createCar02PhotoUploadHttpR82({shopCode,allowedOrigins:[...approved],releaseEnabled,
  authenticate:async request=>{
   const key=parseKey(request);
   if(!key)throw Error('R93V_INTENT_KEY_REQUIRED');
   const original=await authenticate(request);
   if(!original||original.verified!==true||original.shopCode!==shopCode||
      !['staff','owner'].includes(original.role)||typeof original.subject!=='string')
    throw Error('R93V_STAFF_NOT_VERIFIED');
   const actor=Object.freeze({...original}); // unique identity for overlapping requests
   intents.set(actor,key);
   return actor;
  },
  uploadService:{upload:async ({actor,shop,orderId,reportId,mimeType,bytes})=>{
   const key=intents.get(actor);
   if(!key)throw Error('R93V_NO_BOUND_INTENT');
   if(actor.verified!==true||actor.shopCode!==shop||shop!==shopCode)
    throw Error('R93V_ACTOR_SCOPE_INVALID');
   return durableUpload.upload({actor,shop,orderId,reportId,mimeType,bytes,intentKey:key});
  }}
 });
 return async function handleIsolatedIdempotentUpload(request){
  let url;try{url=new URL(request?.url);}catch{return deny(400,'CAR02_BAD_REQUEST');}
  if(url.search||url.hash||!ROUTE.test(url.pathname))return deny(404,'CAR02_NOT_FOUND');
  const headerOrigin=request.headers.get('origin');
  const origin=headerOrigin&&approved.has(headerOrigin)?headerOrigin:'';
  if(!origin)return deny(403,'CAR02_ORIGIN_DENIED');
  if(!['POST','OPTIONS'].includes(request.method))return deny(405,'CAR02_METHOD_DENIED',origin);
  let released=false;try{released=(await releaseEnabled())===true;}catch{}
  // No authentication, no DB/Storage port, and no reading the upload body if locked.
  if(!released)return deny(503,'CAR02_NOT_RELEASED',origin);
  if(request.method==='OPTIONS'){
   const proposed=request.headers.get('access-control-request-method');
   const raw=request.headers.get('access-control-request-headers')||'';
   const names=raw.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
   if(proposed!=='POST'||names.length!==3||new Set(names).size!==3||
      names.some(s=>!PREFLIGHT.has(s)))return deny(403,'CAR02_CORS_PREFLIGHT_DENIED',origin);
   return new Response(null,{status:204,headers:{'Cache-Control':'no-store','Vary':'Origin',
    'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST',
    'Access-Control-Allow-Headers':'Authorization, Content-Type, Idempotency-Key',
    'Access-Control-Max-Age':'0'}});
  }
  if(!parseKey(request))return deny(400,'CAR02_INTENT_KEY_REQUIRED',origin);
  // R82 itself performs its existing bearer-auth, staff and size checks; this
  // bridge only supplies the request-bound key and safe browser preflight.
  return r82(request);
 };
}
export const R93V_CONTRACT=Object.freeze({qaOnly:true,environment:'isolated_qa',dbName:DB,
 durablePortRequired:true,sourceR82Unchanged:true,sourceR52Unchanged:true,
 productionReady:false,releaseDecision:'NO_GO',migrationDecision:'HOLD',
 productionCredentials:false,liveStorageOperations:false,deployAuthorized:false,
 conflictResponseStillR82Generic503:true,notProductionComposition:true});
