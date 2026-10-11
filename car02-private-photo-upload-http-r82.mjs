// DPRO CAR02 R82: isolated private photo upload HTTP adapter. REVIEW/TEST ONLY.
// Intentionally NOT imported by R50/R52, and NEVER enables the release gate.
// This is NOT a standalone server, database handler, or production deployment.
// Trusted dependencies must be supplied by a server-side composition root.
const ID='[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}';
const PATH=new RegExp(`^/api/car02/uploads/(${ID})/(${ID})$`,'i');
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const MIME=new Set(['image/jpeg','image/png','image/webp']);
const MAX_BYTES=5*1024*1024;
const HEADERS=Object.freeze({
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  'Content-Security-Policy':"default-src 'none'",
  'Vary':'Origin'
});
const error=(code,status,origin='')=>new Response(JSON.stringify({ok:false,code}),{
  status,headers:{...HEADERS,...(origin?{'Access-Control-Allow-Origin':origin}:{})}
});
function strictOrigins(origins){
  if(!Array.isArray(origins)||origins.length<1||origins.length>8)throw Error('CAR02_R82_ORIGINS_REQUIRED');
  const seen=new Set();
  for(const entry of origins){
    if(typeof entry!=='string'||seen.has(entry))throw Error('CAR02_R82_ORIGIN_INVALID');
    let u;try{u=new URL(entry);}catch{throw Error('CAR02_R82_ORIGIN_INVALID');}
    if(u.protocol!=='https:'||u.origin!==entry||u.username||u.password||u.search||u.hash)
      throw Error('CAR02_R82_ORIGIN_INVALID');
    seen.add(entry);
  }
  return seen;
}
async function cappedRead(request){
  let bytes;
  if(!request.body){return new Uint8Array(0)}
  const reader=request.body.getReader();
  let length=0;const chunks=[];
  try{
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      if(!(value instanceof Uint8Array))throw Error('CAR02_R82_BAD_BODY');
      length+=value.byteLength;
      if(length>MAX_BYTES)throw Error('CAR02_R82_TOO_LARGE');
      chunks.push(value);
    }
  }finally{try{await reader.cancel()}catch{}reader.releaseLock()}
  bytes=new Uint8Array(length);let cursor=0;
  for(const chunk of chunks){bytes.set(chunk,cursor);cursor+=chunk.byteLength}
  return bytes;
}
/**
 * Upload route contract: POST /api/car02/uploads/<order-uuid>/<report-uuid>
 * The untrusted request can NEVER specify shop, owner/staff role, bucket, storage path,
 * file ID, photo record state, client signed URL, or service-role credential.
 * auth callback MUST be the R44/R46 server-verified identity resolver.
 * uploadService MUST be the R47 private photo uploader, with R13 scoped repository.
 */
export function createCar02PhotoUploadHttpR82({shopCode,releaseEnabled,authenticate,uploadService,allowedOrigins}={}){
  if(typeof shopCode!=='string'||!SHOP.test(shopCode)||typeof releaseEnabled!=='function'||
     typeof authenticate!=='function'||!uploadService||typeof uploadService.upload!=='function')
    throw Error('CAR02_R82_SERVER_DEPS_REQUIRED');
  const origins=strictOrigins(allowedOrigins);
  return async function handlePhotoUpload(request){
    let url;try{url=new URL(request?.url)}catch{return error('CAR02_BAD_REQUEST',400)}
    // No query, fragment, prefixed or shadow routing. Outer R52 stays locked.
    if(url.search||url.hash)return error('CAR02_NOT_FOUND',404);
    const m=PATH.exec(url.pathname);if(!m)return error('CAR02_NOT_FOUND',404);
    const source=request.headers.get('origin');
    const origin=source&&origins.has(source)?source:'';
    // All browser uploads MUST come from an explicitly approved HTTPS origin.
    if(!origin)return error('CAR02_ORIGIN_DENIED',403);
    if(!['POST','OPTIONS'].includes(request.method))return error('CAR02_METHOD_DENIED',405,origin);
    // Fail closed before reading request body or authenticating or touching storage/DB.
    let released=false;try{released=await releaseEnabled()===true}catch{}
    if(!released)return error('CAR02_NOT_RELEASED',503,origin);
    // CORS preflight: browser must prove an approved HTTPS origin, then only
    // Authorization+Content-Type may be forwarded. No credential, DB or body access.
    if(request.method==='OPTIONS'){
      const proposed=request.headers.get('access-control-request-method');
      const requested=request.headers.get('access-control-request-headers')||'';
      const names=requested.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
      if(proposed!=='POST'||names.length>2||names.length!==new Set(names).size||
         !names.includes('authorization')||!names.includes('content-type'))
        return error('CAR02_CORS_PREFLIGHT_DENIED',403,origin);
      return new Response(null,{status:204,headers:{
        'Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Origin':origin,
        'Access-Control-Allow-Methods':'POST',
        'Access-Control-Allow-Headers':'Authorization, Content-Type',
        'Access-Control-Max-Age':'0'
      }});
    }
    if(request.headers.has('x-line-id-token'))return error('CAR02_STAFF_REQUIRED',403,origin);
    const auth=request.headers.get('authorization')||'';
    if(!/^Bearer [^\s]{8,8192}$/.test(auth))return error('CAR02_UNAUTHORIZED',401,origin);
    let actor;try{actor=await authenticate(request)}catch{return error('CAR02_UNAUTHORIZED',401,origin)}
    if(actor?.verified!==true||actor.shopCode!==shopCode||!['owner','staff'].includes(actor.role)||
       typeof actor.subject!=='string'||!/^staff:[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(actor.subject))
      return error('CAR02_STAFF_REQUIRED',403,origin);
    const mime=request.headers.get('content-type')||'';
    if(!MIME.has(mime))return error('CAR02_IMAGE_TYPE_DENIED',415,origin);
    if(request.headers.has('content-encoding')&&request.headers.get('content-encoding')!=='identity')
      return error('CAR02_CONTENT_ENCODING_DENIED',415,origin);
    const len=request.headers.get('content-length');
    if(len!==null&&(!/^(0|[1-9]\d*)$/.test(len)||!Number.isSafeInteger(Number(len))))
      return error('CAR02_BAD_LENGTH',400,origin);
    if(len!==null&&Number(len)>MAX_BYTES)return error('CAR02_IMAGE_TOO_LARGE',413,origin);
    let bytes;try{bytes=await cappedRead(request)}catch(e){
      return error(e?.message==='CAR02_R82_TOO_LARGE'?'CAR02_IMAGE_TOO_LARGE':'CAR02_BAD_BODY',
        e?.message==='CAR02_R82_TOO_LARGE'?413:400,origin);
    }
    if(bytes.length<4)return error('CAR02_IMAGE_INVALID',400,origin);
    if(len!==null&&Number(len)!==bytes.byteLength)return error('CAR02_BAD_LENGTH',400,origin);
    // R47 rechecks release gate + staff identity, validates magic bytes, private bucket,
    // tenant-scoped order/report, and verified SHA-256 storage round-trip.
    try {
      const result=await uploadService.upload({actor,shop:shopCode,orderId:m[1].toLowerCase(),
        reportId:m[2].toLowerCase(),mimeType:mime,bytes});
      if(!result||!new RegExp(`^${ID}$`,'i').test(result.photoId)||result.state!=='ready'||
         result.mimeType!==mime||result.byteSize!==bytes.byteLength)throw Error('INVALID_UPLOADER_RESULT');
      return new Response(JSON.stringify({ok:true,photoId:result.photoId,state:'ready',mimeType:mime,byteSize:bytes.length}),{
        status:201,headers:{...HEADERS,'Access-Control-Allow-Origin':origin}
      });
    }catch{return error('CAR02_PHOTO_UPLOAD_UNAVAILABLE',503,origin)}
  };
}
