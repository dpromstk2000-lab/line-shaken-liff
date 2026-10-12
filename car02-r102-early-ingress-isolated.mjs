// DPRO CAR02 R102: early-rejection ingress; isolated in-process storage + disposable PG17 ONLY.
// No deployment, production credentials, independent release gate or public runtime wiring.
import {createCar02R94AFullStagingPipeline} from './car02-r94a-full-staging-pipeline-isolated.mjs';
const DB='car02_r93q_qa_ci';
const UUID='[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}';
const UPLOAD=new RegExp(`^/api/car02/uploads/${UUID}/${UUID}$`,'i');
const PREFIXES=['/functions/v1/dpro-car02-stage','/dpro-car02-stage'];
const MAX=5*1024*1024;
const MIME=new Set(['image/jpeg','image/png','image/webp']);
const PREFLIGHT=new Set(['authorization','content-type','idempotency-key']);
const JSON_HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
 'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'",'Vary':'Origin'};
const deny=(status,code,origin='')=>new Response(JSON.stringify({ok:false,code}),{
 status,headers:{...JSON_HEADERS,...(origin?{'Access-Control-Allow-Origin':origin}:{})}});
function originsSet(input){
 if(!Array.isArray(input)||input.length<1||input.length>8)throw Error('R102_ORIGINS_REQUIRED');
 const set=new Set();
 for(const entry of input){
  if(typeof entry!=='string'||set.has(entry))throw Error('R102_ORIGIN_INVALID');
  let u;try{u=new URL(entry)}catch{throw Error('R102_ORIGIN_INVALID')}
  if(u.protocol!=='https:'||u.origin!==entry||u.username||u.password||u.search||u.hash)
   throw Error('R102_ORIGIN_INVALID');
  set.add(entry);
 }
 return set;
}
const matchingPath=(path)=>{
 for(const prefix of PREFIXES)if(path.startsWith(prefix+'/'))return path.slice(prefix.length);
 return null;
};
export const R102_CONTRACT=Object.freeze({environment:'isolated_qa',dbName:DB,storage:'in_process_http_fixture',
 maxUploadBytes:MAX,businessConnected:false,noProductionDeploy:true,sourceR47R50R51R52Unchanged:true,
 releaseDecision:'NO_GO',migrationDecision:'HOLD',productionReady:false});
export function createCar02R102IsolatedIngress({environment,dbName,shopCode,pool,storage,
 reviewGate,authenticate,origins}={}){
 if(environment!=='isolated_qa'||dbName!==DB||storage?.kind!=='isolated_memory'||
  storage?.transport!=='in_process_http_fixture'||storage?.testOnly!==true||
  typeof reviewGate!=='function'||typeof authenticate!=='function')throw Error('R102_DISPOSABLE_ONLY');
 const approved=originsSet(origins);
 // Downstream R94A independently checks the same disposable DB, in-process storage and review gate.
 const inner=createCar02R94AFullStagingPipeline({environment,dbName,shopCode,pool,storage,
  reviewGate,authenticate,origins:[...approved]});
 return async function handle(request){
  let u;try{u=new URL(request?.url)}catch{return deny(400,'CAR02_BAD_REQUEST')}
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||
   !UPLOAD.test(matchingPath(u.pathname)||''))return deny(404,'CAR02_NOT_FOUND');
  const origin=request.headers.get('origin');
  if(!origin||!approved.has(origin))return deny(403,'CAR02_ORIGIN_DENIED');
  if(!['POST','OPTIONS'].includes(request.method))return deny(405,'CAR02_METHOD_DENIED',origin);
  let allowed=false;try{allowed=(await reviewGate())===true}catch{}
  if(!allowed)return deny(503,'CAR02_NOT_RELEASED',origin);
  if(request.method==='OPTIONS'){
   const method=request.headers.get('access-control-request-method');
   const raw=request.headers.get('access-control-request-headers')||'';
   const keys=raw.split(',').map(k=>k.trim().toLowerCase()).filter(Boolean);
   if(method!=='POST'||keys.length!==3||new Set(keys).size!==3||
    keys.some(k=>!PREFLIGHT.has(k)))return deny(403,'CAR02_CORS_PREFLIGHT_DENIED',origin);
   return new Response(null,{status:204,headers:{'Cache-Control':'no-store','Vary':'Origin',
    'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST',
    'Access-Control-Allow-Headers':'Authorization, Content-Type, Idempotency-Key',
    'Access-Control-Max-Age':'0'}});
  }
  if(request.headers.has('x-line-id-token')||request.headers.has('x-shop-code')||
    request.headers.has('x-facility-code'))return deny(403,'CAR02_UNTRUSTED_IDENTITY_HEADER',origin);
  const token=request.headers.get('authorization')||'';
  if(!/^Bearer [^\s]{8,8192}$/.test(token))return deny(401,'CAR02_UNAUTHORIZED',origin);
  if(!new RegExp('^'+UUID+'$','i').test(request.headers.get('idempotency-key')||''))
    return deny(400,'CAR02_INTENT_KEY_REQUIRED',origin);
  if(!MIME.has(request.headers.get('content-type')))return deny(415,'CAR02_IMAGE_TYPE_DENIED',origin);
  if(request.headers.has('content-encoding')&&request.headers.get('content-encoding')!=='identity')
    return deny(415,'CAR02_CONTENT_ENCODING_DENIED',origin);
  const length=request.headers.get('content-length');
  if(length!==null){
   if(!/^(0|[1-9]\d*)$/.test(length)||!Number.isSafeInteger(Number(length)))
    return deny(400,'CAR02_BAD_LENGTH',origin);
   if(Number(length)>MAX)return deny(413,'CAR02_IMAGE_TOO_LARGE',origin);
  }
  // The actual stream is still bounded by R93U and R82, including unknown-length uploads.
  // Never read or clone the body prior to route, origin, server gate and header checks.
  return inner(request);
 };
}
