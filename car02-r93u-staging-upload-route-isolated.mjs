// DPRO CAR02 R93U — STAGING ROUTE COMPOSITION SPIKE; ISOLATED QA ONLY.
// Deliberately not imported by R47/R50/R51/R52, not deployed, no credentials.
// This bridges the prefixed R51 route shape to the existing R82 upload handler.
// It does NOT solve durable-intent propagation, outbox, or production migration.
const NAME='dpro-car02-stage';
const PREFIXES=Object.freeze(['/functions/v1/'+NAME,'/'+NAME]);
const UUID='[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}';
const UPLOAD=new RegExp(`^/api/car02/uploads/${UUID}/${UUID}$`,'i');
const BUSINESS=new RegExp(`^/api/car02(?:/${UUID}(?:/(?:report|quote|decision|complete|history))?)?/?$`,'i');
const PHOTO=new RegExp(`^/api/car02/photos/${UUID}/?$`,'i');
const UPLOAD_MAX=5*1024*1024;
const BUSINESS_MAX=32768;
const DB='car02_r93q_qa_ci';
const JSON_HEADERS=Object.freeze({
 'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'no-store',
 'X-Content-Type-Options':'nosniff',
 'Content-Security-Policy':"default-src 'none'"
});
function err(status,code){return new Response(JSON.stringify({ok:false,code}),{status,headers:JSON_HEADERS});}
function relPath(path){for(const p of PREFIXES)if(path.startsWith(p+'/'))return path.slice(p.length);return null;}
async function cappedBody(request,max){
 const declared=request.headers.get('content-length');
 if(declared!==null&&(!/^(0|[1-9]\d*)$/.test(declared)||!Number.isSafeInteger(Number(declared))))
  return {error:err(400,'CAR02_BAD_LENGTH')};
 if(declared!==null&&Number(declared)>max)return {error:err(413,'CAR02_BODY_TOO_LARGE')};
 if(!request.body){
  if(declared!==null&&Number(declared)!==0)return {error:err(400,'CAR02_BAD_LENGTH')};
  return {bytes:new Uint8Array(0)};
 }
 const chunks=[];let n=0;const reader=request.body.getReader();
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;
   if(!(value instanceof Uint8Array))return {error:err(400,'CAR02_BAD_BODY')};
   n+=value.byteLength;
   if(n>max){try{await reader.cancel()}catch{}return {error:err(413,'CAR02_BODY_TOO_LARGE')};}
   chunks.push(value);
  }
 }catch{return {error:err(400,'CAR02_BAD_BODY')};}
 finally{try{reader.releaseLock()}catch{}}
 if(declared!==null&&Number(declared)!==n)return {error:err(400,'CAR02_BAD_LENGTH')};
 const bytes=new Uint8Array(n);let offset=0;
 for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}
 return {bytes};
}
export function createCar02R93UIsolatedStagingRouter({environment,dbName,reviewGate,
 createUploadHandler,createBusinessHandler}={}){
 if(environment!=='isolated_qa'||dbName!==DB||typeof reviewGate!=='function'||
    typeof createUploadHandler!=='function'||typeof createBusinessHandler!=='function')
   throw Error('R93U_DISPOSABLE_ISOLATION_REQUIRED');
 return async function isolatedRoute(request){
  let url;try{url=new URL(request?.url);}catch{return err(400,'CAR02_BAD_REQUEST');}
  if(url.search||url.hash)return err(404,'CAR02_NOT_FOUND');
  const path=relPath(url.pathname);
  if(path===null)return err(404,'CAR02_NOT_FOUND');
  const isUpload=UPLOAD.test(path);
  const isBusiness=BUSINESS.test(path);
  // R48 photo reads are a separate existing path, never hijacked by upload.
  if(PHOTO.test(path)||(!isUpload&&!isBusiness))return err(404,'CAR02_NOT_FOUND');
  // This is an independent, SERVER-INJECTED ISOLATED REVIEW GATE.
  // The real R52 gate stays hard-locked and does not import this module.
  let allowed=false;
  try{allowed=(await reviewGate())===true;}catch{}
  if(!allowed)return err(503,'CAR02_NOT_RELEASED');
  const method=request.method;
  if(isUpload&&!['POST','OPTIONS'].includes(method))return err(405,'CAR02_METHOD_DENIED');
  if(isBusiness&&!['GET','POST','OPTIONS'].includes(method))return err(405,'CAR02_METHOD_DENIED');
  if(isUpload&&method==='OPTIONS'){
   try{const handler=await createUploadHandler();if(typeof handler!=='function')throw Error();
    return await handler(new Request(new URL(path,url.origin),{method,headers:request.headers}));}
   catch{return err(503,'CAR02_ISOLATED_UPLOAD_UNAVAILABLE');}
  }
  let body;
  if(method==='POST'){
   const bounded=await cappedBody(request,isUpload?UPLOAD_MAX:BUSINESS_MAX);
   if(bounded.error)return bounded.error;
   body=bounded.bytes;
  }
  // Create the selected handler only AFTER route, review gate, method, cap checks.
  try{
   const h=await (isUpload?createUploadHandler():createBusinessHandler());
   if(typeof h!=='function')throw Error('BAD_ISOLATED_HANDLER');
   const internal=new Request(new URL(path,url.origin),{method,headers:request.headers,
    ...(body===undefined?{}:{body})});
   return await h(internal);
  }catch{return err(503,'CAR02_ISOLATED_HANDLER_UNAVAILABLE');}
 };
}
export const R93U_CONTRACT=Object.freeze({environment:'isolated_qa',dbName:DB,
 qaOnly:true,releaseDecision:'NO_GO',migrationDecision:'HOLD',productionReady:false,
 deployAuthorized:false,productionCredentials:false,
 businessPostBytes:BUSINESS_MAX,uploadPostBytes:UPLOAD_MAX,
 r52HardLockUnchanged:true,r47DirectDeleteUnchanged:true,
 r82DurableIntentNotYetWired:true,notProductionRouter:true});
