// DPRO CAR02 R57 — browser-side transport contract (Supabase Edge path compatible).
// REVIEW/QA ONLY. The server-side R44/R46 release and identity gates remain authoritative.
// Starts CLOSED. This module alone does not activate live CAR02 endpoints.
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME=new Set(['image/png','image/jpeg','image/webp']);
const MAX_PHOTO=5*1024*1024;
export class Car02ClientError extends Error{
  constructor(code,status=0){super(code);this.name='Car02ClientError';this.code=code;this.status=status;}
}
const reject=(code,status=0)=>{throw new Car02ClientError(code,status)};
const validId=x=>typeof x==='string'&&ID.test(x);
const isPlain=x=>x!==null&&typeof x==='object'&&Object.getPrototypeOf(x)===Object.prototype;
const exactKeys=(x,keys)=>isPlain(x)&&Object.keys(x).every(k=>keys.includes(k));
const trimToken=x=>typeof x==='string'&&x.length>=8&&x.length<=8192&&x.trim()===x&&!/\s/.test(x);
// R57: the existing R49 client assumed a domain-root API. Supabase functions
// are mounted under /functions/v1/dpro-car02-stage, so routing failed there.
// Accept ONLY the legacy root and the exact isolated staging mount. Never
// accept another function name, arbitrary prefix, redirect or query override.
function secureApiBase(apiOrigin){
  let u;try{u=new URL(apiOrigin)}catch{reject('CAR02_API_ORIGIN_INVALID')}
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||!u.hostname||
      (u.href!==apiOrigin&&!(u.pathname==='/'&&apiOrigin===u.origin)))reject('CAR02_API_ORIGIN_INVALID');
  // Legacy root origin remains supported without changing its route semantics.
  if(u.pathname!=='/'&&u.pathname!=='/functions/v1/dpro-car02-stage')
    reject('CAR02_API_ORIGIN_INVALID');
  if(u.pathname==='/functions/v1/dpro-car02-stage'&&
     u.origin!=='https://cbknucemarcpbscirzyv.supabase.co')
    reject('CAR02_STAGING_ORIGIN_MISMATCH');
  return u.pathname==='/'?u.origin:u.origin+u.pathname;
}
const methodKeys={
  report:['observation','photos','expectedVersion'],
  quote:['items','expectedVersion'],
  decision:['decision','reason','expectedVersion'],
  complete:['expectedVersion'],
  create:['customerId','vehicleId','reservationId']
};
function validPayload(action,data){
  if(!exactKeys(data,methodKeys[action]))reject('CAR02_INPUT_INVALID');
  if(action==='create'&&(!validId(data.customerId)||!validId(data.vehicleId)||(data.reservationId!=null&&!validId(data.reservationId))))reject('CAR02_REFERENCE_INVALID');
  if(action==='report'&&(!Number.isSafeInteger(data.expectedVersion)||data.expectedVersion<1||typeof data.observation!=='string'||!data.observation.trim()||data.observation.length>10000||!Array.isArray(data.photos)||data.photos.length>3||!data.photos.every(validId)))reject('CAR02_REPORT_INVALID');
  if(action==='quote'&&(!Number.isSafeInteger(data.expectedVersion)||data.expectedVersion<1||!Array.isArray(data.items)||data.items.length<1||data.items.length>30||data.items.some(x=>!exactKeys(x,['name','price'])||typeof x.name!=='string'||!x.name.trim()||x.name.length>160||!Number.isSafeInteger(x.price)||x.price<0||x.price>100_000_000)))reject('CAR02_QUOTE_INVALID');
  if(action==='decision'&&(!Number.isSafeInteger(data.expectedVersion)||data.expectedVersion<1||!['approved','declined'].includes(data.decision)||(data.decision==='declined'&&(!data.reason||typeof data.reason!=='string'||!data.reason.trim()||data.reason.length>2000))))reject('CAR02_DECISION_INVALID');
  if(action==='complete'&&(!Number.isSafeInteger(data.expectedVersion)||data.expectedVersion<1))reject('CAR02_VERSION_REQUIRED');
}
function safeCode(v){return typeof v==='string'&&/^CAR02_[A-Z0-9_]{2,60}$/.test(v)?v:'CAR02_HTTP_ERROR'}
async function readJson(resp){
 const ct=resp.headers?.get('content-type')||'';
 if(!ct.toLowerCase().includes('application/json'))reject('CAR02_RESPONSE_INVALID');
 const size=Number(resp.headers.get('content-length')||0);
 if(size>256_000)reject('CAR02_RESPONSE_TOO_LARGE');
 const raw=await resp.text();
 if(raw.length>256_000)reject('CAR02_RESPONSE_TOO_LARGE');
 let data;try{data=JSON.parse(raw)}catch{reject('CAR02_RESPONSE_INVALID')}
 if(!isPlain(data))reject('CAR02_RESPONSE_INVALID');
 if(!resp.ok||data.ok!==true)reject(safeCode(data.code),resp.status);
 if(!Object.hasOwn(data,'data'))reject('CAR02_RESPONSE_INVALID');
 return data.data;
}
async function readPhoto(resp){
 if(!resp.ok)reject('CAR02_PHOTO_UNAVAILABLE',resp.status);
 const mime=(resp.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
 if(!MIME.has(mime))reject('CAR02_PHOTO_INVALID');
 const length=Number(resp.headers.get('content-length')||0);
 if(length>MAX_PHOTO)reject('CAR02_PHOTO_TOO_LARGE');
 let bytes;
 if(resp.body?.getReader){
  const reader=resp.body.getReader(),chunks=[];let n=0;
  try{for(;;){const{done,value}=await reader.read();if(done)break;n+=value?.byteLength||0;
    if(n>MAX_PHOTO){await reader.cancel().catch(()=>{});reject('CAR02_PHOTO_TOO_LARGE')}
    chunks.push(value);
  }}finally{reader.releaseLock()}
  bytes=new Uint8Array(n);let p=0;for(const c of chunks){bytes.set(c,p);p+=c.byteLength}
 }else{bytes=new Uint8Array(await resp.arrayBuffer());if(bytes.length>MAX_PHOTO)reject('CAR02_PHOTO_TOO_LARGE')}
 if(bytes.length<4)reject('CAR02_PHOTO_INVALID');
 if(mime==='image/png'&&!(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((x,i)=>bytes[i]===x)))reject('CAR02_PHOTO_INVALID');
 if(mime==='image/jpeg'&&!(bytes[0]===255&&bytes[1]===216&&bytes[2]===255))reject('CAR02_PHOTO_INVALID');
 if(mime==='image/webp'&&!(bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'))reject('CAR02_PHOTO_INVALID');
 return{bytes,mimeType:mime};
}
export function createCar02BrowserClientR57({apiOrigin,credentials,fetchImpl=fetch,cryptoImpl=crypto,connectionEnabled=false}={}){
 const origin=secureApiBase(apiOrigin);
 if(typeof credentials!=='function'||typeof fetchImpl!=='function'||typeof cryptoImpl?.randomUUID!=='function')throw Error('CAR02_BROWSER_DEPENDENCIES_REQUIRED');
 // An opt-in UI flag is NOT a security gate. Backend release gate must be enabled too.
 async function request(method,path,{data,requestId,isPhoto=false}={}){
  if(connectionEnabled!==true)reject('CAR02_BROWSER_CONNECTION_CLOSED');
  if(!/^\/api\/car02(?:\/[a-z0-9-]+)*$/i.test(path))reject('CAR02_ROUTE_INVALID');
  let c;try{c=await credentials()}catch{reject('CAR02_IDENTITY_REQUIRED')}
  if(!c||!['staff','customer'].includes(c.kind)||!trimToken(c.token))reject('CAR02_IDENTITY_REQUIRED');
  const h=new Headers({'Accept':isPhoto?'image/png,image/jpeg,image/webp':'application/json'});
  if(c.kind==='staff')h.set('Authorization','Bearer '+c.token);
  else h.set('X-Line-ID-Token',c.token);
  if(data!==undefined){h.set('Content-Type','application/json');
    const k=requestId===undefined?'car02-'+cryptoImpl.randomUUID():requestId;
    if(typeof k!=='string'||k.length<12||k.length>150||!/^[a-z0-9-]+$/i.test(k))reject('CAR02_IDEMPOTENCY_INVALID');
    h.set('Idempotency-Key',k);
  }
  let response;
  try{response=await fetchImpl(origin+path,{method,headers:h,body:data===undefined?undefined:JSON.stringify(data),redirect:'error',cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(12000)})}
  catch{reject('CAR02_CONNECTION_FAILED')}
  if(!response||typeof response.status!=='number')reject('CAR02_CONNECTION_FAILED');
  return isPhoto?readPhoto(response):readJson(response);
 }
 const getId=id=>{if(!validId(id))reject('CAR02_ID_INVALID');return id};
 return Object.freeze({
  get: async id=>request('GET','/api/car02/'+getId(id)),
  history: async id=>request('GET','/api/car02/'+getId(id)+'/history'),
  create:async (data,requestId)=>{validPayload('create',data);return request('POST','/api/car02',{data,requestId})},
  saveReport:async (id,data,requestId)=>{validPayload('report',data);return request('POST','/api/car02/'+getId(id)+'/report',{data,requestId})},
  presentQuote:async (id,data,requestId)=>{validPayload('quote',data);return request('POST','/api/car02/'+getId(id)+'/quote',{data,requestId})},
  decision:async (id,data,requestId)=>{validPayload('decision',data);return request('POST','/api/car02/'+getId(id)+'/decision',{data,requestId})},
  complete:async (id,data,requestId)=>{validPayload('complete',data);return request('POST','/api/car02/'+getId(id)+'/complete',{data,requestId})},
  photo:async id=>request('GET','/api/car02/photos/'+getId(id),{isPhoto:true})
 });
}
