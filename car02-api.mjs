// DPRO CAR02 R43 candidate Web Request router. NOT bound to public Worker.
// Caller must provide real cryptographically verified auth and migration/release gates.
// Deliberately DOES NOT accept client shopCode, actor.role, customerId as auth context.
import { Car02Error } from './car02-core.mjs';
const json=(body,status=200,origin='')=>new Response(JSON.stringify(body),{
  status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
  'Vary':'Origin',...(origin?{'Access-Control-Allow-Origin':origin}:{})}});
const uuid = v => typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const itemsAllowed=new Set(['name','price']);
const isPlain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
function pick(body,keys){if(!isPlain(body)||Object.keys(body).some(k=>!keys.includes(k)))throw new Car02Error('CAR02_BODY_FIELDS_INVALID',422);return body;}
async function bodyJson(req){
 const len=Number(req.headers.get('content-length')||0);
 if(len>32_768)throw new Car02Error('CAR02_BODY_TOO_LARGE',413);
 if(!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new Car02Error('CAR02_JSON_REQUIRED',415);
 const raw=await req.text();if(raw.length>32_768)throw new Car02Error('CAR02_BODY_TOO_LARGE',413);
 let data;try{data=JSON.parse(raw)}catch{throw new Car02Error('CAR02_JSON_INVALID',400)}
 if(!isPlain(data))throw new Car02Error('CAR02_BODY_INVALID',422);
 return data;
}
function block(code,status,origin=''){return json({ok:false,code},status,origin)}
export function createCar02Api({service,authenticate,releaseEnabled,allowedOrigins=[]}){
 if(!service||typeof authenticate!=='function'||typeof releaseEnabled!=='function')throw Error('CAR02_API_GATES_REQUIRED');
 return async function handle(req){
  let origin='';
  const requestOrigin=req.headers.get('origin')||'';
  if(requestOrigin){if(!allowedOrigins.includes(requestOrigin))return block('CAR02_ORIGIN_DENIED',403);origin=requestOrigin;}
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{'Cache-Control':'no-store','Vary':'Origin',
    ...(origin?{'Access-Control-Allow-Origin':origin}:{}) ,'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':'Authorization,Content-Type,Idempotency-Key,X-Line-ID-Token'}});
  if(!['GET','POST'].includes(req.method))return block('CAR02_METHOD_DENIED',405,origin);
  const url=new URL(req.url);
  if(url.search) return block('CAR02_QUERY_PARAMS_DENIED',400,origin);
  const route=url.pathname.replace(/\/+$/,'').match(/^\/api\/car02(?:\/([0-9a-fA-F-]{36}))?(?:\/(report|quote|decision|complete|history))?$/);
  if(!route) return block('CAR02_NOT_FOUND',404,origin);
  // Fail CLOSED before auth, DB, and any side effects.
  try {if(await releaseEnabled(req)!==true)return block('CAR02_NOT_RELEASED',503,origin);}
  catch {return block('CAR02_NOT_RELEASED',503,origin);}
  let actor;
  try{actor=await authenticate(req)}catch{return block('CAR02_UNAUTHORIZED',401,origin)}
  if(!actor||actor.verified!==true||!actor.subject||!actor.shopCode||!['owner','staff','customer'].includes(actor.role))
    return block('CAR02_UNAUTHORIZED',401,origin);
  const [,id,action]=route;
  if(id&&!uuid(id))return block('CAR02_ID_INVALID',422,origin);
  const key=req.headers.get('idempotency-key')||'';
  const input={actor,shop:actor.shopCode,id};
  try{
   let value;
   if(req.method==='GET'&&id&&!action)value=await service.get(input);
   else if(req.method==='GET'&&id&&action==='history')value=await service.history(input);
   else if(req.method==='POST'&&!id&&!action){const b=pick(await bodyJson(req),['customerId','vehicleId','reservationId']);value=await service.create({actor,shop:actor.shopCode,...b,key});}
   else if(req.method==='POST'&&id&&action==='report'){const b=pick(await bodyJson(req),['observation','photos','expectedVersion']);value=await service.report({...input,...b,key});}
   else if(req.method==='POST'&&id&&action==='quote'){const b=pick(await bodyJson(req),['items','expectedVersion']);if(Array.isArray(b.items)&&b.items.some(it=>!isPlain(it)||Object.keys(it).some(k=>!itemsAllowed.has(k))))throw new Car02Error('CAR02_ITEM_FIELDS_INVALID',422);value=await service.present({...input,...b,key});}
   else if(req.method==='POST'&&id&&action==='decision'){const b=pick(await bodyJson(req),['decision','reason','expectedVersion']);value=await service.decide({...input,...b,key});}
   else if(req.method==='POST'&&id&&action==='complete'){const b=pick(await bodyJson(req),['expectedVersion']);value=await service.complete({...input,...b,key});}
   else return block('CAR02_METHOD_NOT_FOUND',404,origin);
   return json({ok:true,data:value},200,origin);
  }catch(e){if(e instanceof Car02Error)return block(e.code,e.status,origin);
   // Deliberately no internal error detail in HTTP responses.
   return block('CAR02_INTERNAL_ERROR',500,origin);}
 };
}
