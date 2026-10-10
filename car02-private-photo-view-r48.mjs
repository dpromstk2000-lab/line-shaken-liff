// DPRO CAR02 R48: authenticated, no-URL private photo read and HTTP response.
// TEST/REVIEW ONLY. Must be assembled server-side behind R46 identity and release gate.
// No signed URL, service key, object path or customer identifiers go into the response.
import {createHash} from 'node:crypto';
const LIMIT=5*1024*1024;
const ID=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const BUCKET='ksh-car02-private-photos';
const MIME_EXT={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'};
const fail=(code='CAR02_PHOTO_UNAVAILABLE')=>{throw Error(code)};
function actualImage(data,mime){
 if(mime==='image/png')return data.length>=8&&[137,80,78,71,13,10,26,10].every((x,i)=>data[i]===x);
 if(mime==='image/jpeg')return data.length>=4&&data[0]===255&&data[1]===216&&data[2]===255;
 if(mime==='image/webp')return data.length>=12&&[82,73,70,70].every((x,i)=>data[i]===x)&&[87,69,66,80].every((x,i)=>data[i+8]===x);
 return false;
}
async function limitedBytes(response){
 const r=response.body?.getReader?.();if(!r)fail();
 let n=0;const chunks=[];
 try{for(;;){const {done,value}=await r.read();if(done)break;n+=value?.byteLength||0;
  if(n>LIMIT){await r.cancel().catch(()=>{});fail()}chunks.push(value)}}finally{r.releaseLock()}
 const data=new Uint8Array(n);let offset=0;
 for(const c of chunks){data.set(c,offset);offset+=c.byteLength}return data;
}
function configUrl(value){
 let u;try{u=new URL(value)}catch{fail('CAR02_STORAGE_CONFIG_INVALID')}
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/'||
   !/^[-a-z0-9]+\.supabase\.co$/.test(u.hostname))fail('CAR02_STORAGE_CONFIG_INVALID');
 return u.origin;
}
const urlPart=x=>encodeURIComponent(x);
const sha256=x=>createHash('sha256').update(x).digest('hex');
function validateMeta(m,shop,photoId){
 if(!m||m.id!==photoId||m.shop!==shop||!ID.test(m.orderId)||!ID.test(m.reportId)||
  m.bucket!==BUCKET||!Object.hasOwn(MIME_EXT,m.mime)||!Number.isSafeInteger(m.bytes)||m.bytes<4||m.bytes>LIMIT||
  typeof m.sha256!=='string'||!/^[a-f0-9]{64}$/.test(m.sha256)||typeof m.path!=='string')fail();
 const p=m.path.split('/');
 if(p.length!==4||p[0]!==shop||p[1]!==m.orderId||p[2]!==m.reportId||
  !new RegExp('^'+ID.source.slice(1,-1)+'\\.'+MIME_EXT[m.mime]+'$','i').test(p[3]))fail();
 return p;
}
export function createCar02PrivatePhotoViewR48({repository,releaseEnabled,baseUrl,serviceRoleKey,fetchImpl=fetch}={}){
 if(typeof releaseEnabled!=='function'||!repository||typeof repository.findReady!=='function'||typeof fetchImpl!=='function')throw Error('CAR02_PHOTO_VIEW_DEPENDENCIES_REQUIRED');
 const origin=configUrl(baseUrl);
 if(typeof serviceRoleKey!=='string'||serviceRoleKey.length<20||serviceRoleKey.trim()!==serviceRoleKey||/[\r\n]/.test(serviceRoleKey))throw Error('CAR02_STORAGE_KEY_INVALID');
 const headers={'apikey':serviceRoleKey,'Authorization':'Bearer '+serviceRoleKey};
 return {async download({actor,shop,photoId}={}){
  let enabled=false;try{enabled=await releaseEnabled()===true}catch{}
  if(!enabled)fail('CAR02_NOT_RELEASED'); // ALWAYS before DB or storage
  if(!actor||actor.verified!==true||actor.shopCode!==shop||!actor.subject||!SHOP.test(shop)||!ID.test(photoId)||
    !['owner','staff','customer'].includes(actor.role)||
    (actor.role==='customer'&&!ID.test(actor.customerId)))fail('CAR02_PHOTO_ACCESS_DENIED');
  const meta=await repository.findReady({actor,shop,photoId});
  const path=validateMeta(meta,shop,photoId);
  const url=origin+'/storage/v1/object/authenticated/'+BUCKET+'/'+path.map(urlPart).join('/');
  let response;try{response=await fetchImpl(url,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(8000),cache:'no-store'})}
  catch{fail()}
  if(!response?.ok)fail();
  const ct=(response.headers?.get('content-type')||'').split(';')[0].trim().toLowerCase();
  if(ct!==meta.mime)fail();
  const bytes=await limitedBytes(response);
  if(bytes.byteLength!==meta.bytes||!actualImage(bytes,meta.mime)||sha256(bytes)!==meta.sha256)fail('CAR02_PHOTO_INTEGRITY_FAILED');
  return {bytes,mimeType:meta.mime};
 }};
}
function json(code,status,origin=''){return new Response(JSON.stringify({ok:false,code}),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin',...(origin?{'Access-Control-Allow-Origin':origin}:{})}})}
export function createCar02PhotoHttpR48({viewer,authenticate,releaseEnabled,allowedOrigins=[]}={}){
 if(!viewer||typeof viewer.download!=='function'||typeof authenticate!=='function'||typeof releaseEnabled!=='function'||!Array.isArray(allowedOrigins))throw Error('CAR02_PHOTO_HTTP_DEPENDENCIES_REQUIRED');
 return async request=>{
  const providedOrigin=request.headers.get('origin')||'';
  if(providedOrigin&&!allowedOrigins.includes(providedOrigin))return json('CAR02_ORIGIN_DENIED',403);
  const o=providedOrigin;
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'Authorization,X-Line-ID-Token',...(o?{'Access-Control-Allow-Origin':o}:{})}});
  if(request.method!=='GET')return json('CAR02_METHOD_DENIED',405,o);
  const url=new URL(request.url);
  if(url.search||!/^\/api\/car02\/photos\/[a-f\d-]{36}$/i.test(url.pathname))return json('CAR02_NOT_FOUND',404,o);
  try{if(await releaseEnabled(request)!==true)return json('CAR02_NOT_RELEASED',503,o)}catch{return json('CAR02_NOT_RELEASED',503,o)}
  let actor;try{actor=await authenticate(request)}catch{return json('CAR02_UNAUTHORIZED',401,o)}
  if(!actor||actor.verified!==true||!actor.shopCode||!actor.subject)return json('CAR02_UNAUTHORIZED',401,o);
  try{
   const {bytes,mimeType}=await viewer.download({actor,shop:actor.shopCode,photoId:url.pathname.split('/').pop()});
   if(!(bytes instanceof Uint8Array)||!Object.hasOwn(MIME_EXT,mimeType)||bytes.length>LIMIT)throw Error('BAD_VIEWER_OUTPUT');
   return new Response(bytes,{status:200,headers:{'Content-Type':mimeType,'Content-Length':String(bytes.byteLength),
    'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin',
    'Content-Disposition':'inline; filename="car02-photo.'+MIME_EXT[mimeType]+'"','Vary':'Origin',
    ...(o?{'Access-Control-Allow-Origin':o}:{})}});
  }catch{return json('CAR02_PHOTO_UNAVAILABLE',404,o)}
 };
}
