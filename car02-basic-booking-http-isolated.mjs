/** DPRO CAR02 V1.5: disposable-only HTTP booking entry, for CI in-process QA.
 * Not routable through R51/R52. No real customers, browser credentials, production DB,
 * Worker or LINE integration. R44's server-authoritative actor is required.
 * Booking is STAFF-assisted only: it is NOT customer self-booking.
 */
export const CAR02_BOOKING_HTTP_QA_MODE=Object.freeze({environment:'disposable_qa',release:'NO_GO',migration:'HOLD',staffAssistedOnly:true,productionReady:false,deployable:false,realAuth:false});
const PATH='/api/car02/booking';
const FIELDS=['customerId','vehicleId','day','time'];
const KEY=/^[A-Za-z0-9_-]{12,100}$/;
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const HDR={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const fail=(status,code)=>({status,code});
const own=x=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const identicalKeys=(obj,keys)=>own(obj)&&Object.keys(obj).sort().join('|')===keys.slice().sort().join('|');
function reply(status,body,origin){return new Response(JSON.stringify(body),{status,headers:{...HDR,...(origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{})}})}
export function createCar02BookingHttpIsolated({environment,allowDisposableQa=false,authenticate,booking,releaseEnabled,allowedOrigins=[]}={}){
 if(environment!=='disposable_qa'||allowDisposableQa!==true||
   typeof authenticate!=='function'||typeof booking?.create!=='function'||typeof releaseEnabled!=='function'||
   !Array.isArray(allowedOrigins)||allowedOrigins.length<1||
   !allowedOrigins.every(v=>typeof v==='string'&&/^https:\/\/[^/]+$/.test(v)))throw Error('CAR02_BOOKING_HTTP_DISPOSABLE_ONLY');
 const origins=new Set(allowedOrigins);
 return async function handle(request){
  let url;
  try{url=new URL(request?.url)}catch{return reply(400,{ok:false,code:'CAR02_BOOKING_BAD_REQUEST'})}
  if(url.pathname!==PATH||url.search||url.hash)return reply(404,{ok:false,code:'CAR02_BOOKING_NOT_FOUND'});
  // Fail closed before reading identity, body, or opening a DB connection.
  let released=false;try{released=await releaseEnabled()===true}catch{}
  if(!released)return reply(503,{ok:false,code:'CAR02_NOT_RELEASED'});
  const origin=request.headers?.get('origin')||'';
  if(!origins.has(origin))return reply(403,{ok:false,code:'CAR02_BOOKING_ORIGIN_DENIED'});
  if(request.method==='OPTIONS'){
   if(request.headers.get('access-control-request-method')!=='POST')return reply(405,{ok:false,code:'CAR02_BOOKING_METHOD_DENIED'},origin);
   return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type, Idempotency-Key','Access-Control-Max-Age':'0','Vary':'Origin','Cache-Control':'no-store'}});
  }
  if(request.method!=='POST')return reply(405,{ok:false,code:'CAR02_BOOKING_METHOD_DENIED'},origin);
  let actor;
  try{actor=await authenticate(request)}catch{return reply(401,{ok:false,code:'CAR02_BOOKING_UNAUTHORIZED'},origin)}
  if(actor?.verified!==true||!['staff','owner'].includes(actor.role)||
     typeof actor.shopCode!=='string'||typeof actor.subject!=='string'||!actor.subject.startsWith('staff:'))
     return reply(403,{ok:false,code:'CAR02_BOOKING_STAFF_REQUIRED'},origin);
  const key=request.headers.get('idempotency-key')||'';
  if(!KEY.test(key))return reply(422,{ok:false,code:'CAR02_BOOKING_REQUEST_KEY_INVALID'},origin);
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))return reply(415,{ok:false,code:'CAR02_BOOKING_MEDIA_TYPE'},origin);
  if(Number(request.headers.get('content-length')||0)>4096)return reply(413,{ok:false,code:'CAR02_BOOKING_BODY_TOO_LARGE'},origin);
  let data;
  try{
   const body=await request.text();
   if(Buffer.byteLength(body,'utf8')>4096)return reply(413,{ok:false,code:'CAR02_BOOKING_BODY_TOO_LARGE'},origin);
   data=JSON.parse(body);
  }catch{return reply(400,{ok:false,code:'CAR02_BOOKING_BAD_JSON'},origin)}
  if(!identicalKeys(data,FIELDS))return reply(422,{ok:false,code:'CAR02_BOOKING_FIELDS_INVALID'},origin);
  try{
   // R44 verified server identity is translated solely to the explicit QA-only
   // identity shape accepted by the synthetic atomic booking fixture.
   const synthetic=Object.freeze({verified:true,role:actor.role,shopCode:actor.shopCode,subject:'qa-r44-'+actor.subject});
   const result=await booking.create({actor:synthetic,input:{...data,requestKey:key}});
   if(!UUID.test(result?.id)||result.syntheticOnly!==true||result.shopCode!==actor.shopCode||result.day!==data.day||result.time!==data.time)
     return reply(503,{ok:false,code:'CAR02_BOOKING_QA_RESULT_INVALID'},origin);
   return reply(201,{ok:true,data:{reservationId:result.id,day:result.day,time:result.time,syntheticOnly:true}},origin);
  }catch(e){
   const code=e?.code;
   if(['CAR02_BOOKING_SLOT_OCCUPIED','CAR02_BOOKING_IDEMPOTENCY_CONFLICT'].includes(code))return reply(409,{ok:false,code},origin);
   if(code==='CAR02_BOOKING_REFERENCE_SCOPE_MISMATCH')return reply(403,{ok:false,code},origin);
   if(typeof code==='string'&&/^CAR02_BOOKING_(?:FIELDS_INVALID|UUID_REQUIRED|REQUEST_KEY_INVALID|DATE_INVALID|CLOSED_DAY|TIME_INVALID|BUSINESS_HOURS|WINDOW_INVALID)$/.test(code))
     return reply(422,{ok:false,code},origin);
   return reply(503,{ok:false,code:'CAR02_BOOKING_QA_UNAVAILABLE'},origin);
  }
 };
}
