// DPRO CAR02 R50 — unified staging HTTP entrypoint (Node + PostgreSQL).
// NOT deployed, and NOT compatible with Cloudflare Workers without a server adapter.
// No frontend flag, client role, demo token, or origin header can enable CAR02.
import { createCar02VerifiedRuntimeR46 } from './car02-runtime-verified-r46.mjs';
import { createCar02AuthProvidersR46 } from './car02-auth-providers-r46.mjs';
import { createCar02Authenticator, createCar02ReleaseGate } from './car02-identity-r44.mjs';
import { createCar02PgPhotoViewR48 } from './car02-pg-photo-view-r48.mjs';
import { createCar02PrivatePhotoViewR48, createCar02PhotoHttpR48 } from './car02-private-photo-view-r48.mjs';

const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const PHOTO_PATH=/^\/api\/car02\/photos\/[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}\/?$/i;
const CAR_PATH=/^\/api\/car02(?:\/|$)/;
function response(status, code) {
  return new Response(JSON.stringify({ok:false,code}),{
    status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin'}
  });
}
function exactOrigins(input) {
  if(!Array.isArray(input)||input.length===0||input.length>8)throw Error('CAR02_ALLOWED_ORIGINS_REQUIRED');
  const seen=new Set();
  for(const origin of input){
    if(typeof origin!=='string')throw Error('CAR02_ORIGIN_CONFIG_INVALID');
    let url;try{url=new URL(origin)}catch{throw Error('CAR02_ORIGIN_CONFIG_INVALID')}
    if(url.protocol!=='https:'||url.origin!==origin||seen.has(origin))throw Error('CAR02_ORIGIN_CONFIG_INVALID');
    seen.add(origin);
  }
  return [...seen];
}
export function createCar02UnifiedRuntimeR50({
  pool,shopCode,lineChannelId,supabaseUrl,supabaseAnonKey,storageServiceRoleKey,
  releaseState,allowedOrigins,fetchImpl,nowSeconds,lookupStaffMembership
}={}) {
  if(!pool||typeof pool.connect!=='function'||typeof pool.query!=='function')throw Error('CAR02_DB_CONNECTION_REQUIRED');
  if(typeof shopCode!=='string'||!SHOP.test(shopCode))throw Error('CAR02_SHOP_CONFIG_INVALID');
  if(releaseState===undefined||releaseState===null)throw Error('CAR02_SERVER_RELEASE_REQUIRED');
  if(typeof storageServiceRoleKey!=='string'||storageServiceRoleKey.length<20||/\s/.test(storageServiceRoleKey))
    throw Error('CAR02_STORAGE_PRIVATE_KEY_REQUIRED');
  const origins=exactOrigins(allowedOrigins);
  const verifiers=createCar02AuthProvidersR46({pool,lineChannelId,supabaseUrl,supabaseAnonKey,
    lookupStaffMembership,...(fetchImpl?{fetchImpl}:{}),...(nowSeconds?{nowSeconds}:{})});
  const authenticate=createCar02Authenticator({shopCode,lineClientId:lineChannelId,...verifiers,
    ...(nowSeconds?{nowSeconds}:{})});
  // Release state is trusted server configuration (or an audited server-side callback).
  const releaseEnabled=createCar02ReleaseGate(releaseState);
  const business=createCar02VerifiedRuntimeR46({pool,shopCode,lineChannelId,supabaseUrl,supabaseAnonKey,
    lookupStaffMembership,releaseState,allowedOrigins:origins,
    ...(fetchImpl?{fetchImpl}:{}),...(nowSeconds?{nowSeconds}:{})});
  const repository=createCar02PgPhotoViewR48({pool});
  const viewer=createCar02PrivatePhotoViewR48({repository,releaseEnabled,
    baseUrl:supabaseUrl,serviceRoleKey:storageServiceRoleKey,...(fetchImpl?{fetchImpl}:{})});
  const photo=createCar02PhotoHttpR48({viewer,authenticate,releaseEnabled,allowedOrigins:origins});
  return async function handleCar02Request(request){
    // Strictly avoid catch-all proxying into the existing reservation / LINE runtime.
    let url;try{url=new URL(request.url)}catch{return response(400,'CAR02_BAD_REQUEST')}
    if(!CAR_PATH.test(url.pathname))return response(404,'CAR02_NOT_FOUND');
    if(PHOTO_PATH.test(url.pathname))return photo(request);
    // Malformed photo routes must not fall through to another service.
    if(url.pathname.startsWith('/api/car02/photos'))return response(404,'CAR02_NOT_FOUND');
    return business(request);
  };
}
