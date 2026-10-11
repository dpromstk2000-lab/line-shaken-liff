// DPRO CAR02 R85 — isolated HTTP adapter for existing R70 staff permission changes.
// REVIEW/TEST ONLY. NOT deployed and NOT imported by R50/R52/Edge/Worker.
// Caller must inject the R44/R46 server-verified authenticator and R70 transactional
// changeExistingStaffPermission function. No client role/shop/identity is trusted.
const UUID=/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const PATH=/^\/api\/car02\/staff\/([a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12})\/access$/i;
const MAX_BODY=2048;
const FIELD_NAMES=new Set(['expectedRole','expectedActive','nextRole','nextActive','reason']);
const STATUS_CODES={
  'CAR02_GRANT_STALE_VERSION':[409,'CAR02_PERMISSION_CONFLICT'],
  'CAR02_OWNER_LAST_ACTIVE_REQUIRED':[409,'CAR02_LAST_OWNER_PROTECTED'],
  'CAR02_OWNER_SELF_CHANGE_DENIED':[403,'CAR02_SELF_CHANGE_DENIED'],
  'CAR02_OWNER_REQUIRED':[403,'CAR02_OWNER_REQUIRED'],
  'CAR02_IDENTITY_REJECTED':[403,'CAR02_IDENTITY_REJECTED'],
  'CAR02_STAFF_NOT_FOUND':[404,'CAR02_STAFF_NOT_FOUND']
};
const baseHeaders=Object.freeze({
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store',
  'Pragma':'no-cache',
  'Vary':'Origin',
  'X-Content-Type-Options':'nosniff',
  'Content-Security-Policy':"default-src 'none'",
  'Referrer-Policy':'no-referrer'
});
function reply(status,value,origin='',extra={}){
  return new Response(status===204?null:JSON.stringify(value),{status,headers:{
    ...baseHeaders,...(origin?{'Access-Control-Allow-Origin':origin}:{}),...extra
  }});
}
const deny=(status,code,origin='')=>reply(status,{ok:false,code},origin);
function allowedOrigin(o){
  if(typeof o!=='string')throw Error('CAR02_R85_ORIGIN_INVALID');
  let u;try{u=new URL(o)}catch{throw Error('CAR02_R85_ORIGIN_INVALID')}
  if(u.protocol!=='https:'||u.origin!==o||u.username||u.password||u.search||u.hash)
    throw Error('CAR02_R85_ORIGIN_INVALID');
  return o;
}
function exactOrigins(input){
  if(!Array.isArray(input)||input.length<1||input.length>8)throw Error('CAR02_R85_ORIGIN_INVALID');
  const all=input.map(allowedOrigin);
  if(new Set(all).size!==all.length)throw Error('CAR02_R85_ORIGIN_INVALID');
  return new Set(all);
}
const bearer=s=>typeof s==='string'&&/^Bearer [^\s]{8,8192}$/.test(s);
function ownerActor(actor,shopCode){
  return actor?.verified===true && actor?.role==='owner' && actor?.shopCode===shopCode &&
    typeof actor.subject==='string'&&actor.subject.startsWith('staff:')&&UUID.test(actor.subject.slice(6));
}
async function bodyBytes(request){
  // Reject oversized data while streaming without buffering an attacker-controlled payload.
  const reader=request.body?.getReader?.();
  if(!reader)throw Error('CAR02_EMPTY_BODY');
  const blocks=[];let n=0;
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      if(!(value instanceof Uint8Array))throw Error('CAR02_INVALID_BODY');
      n+=value.byteLength;
      if(n>MAX_BODY)throw Error('CAR02_BODY_TOO_LARGE');
      blocks.push(value);
    }
  }finally{if(n>MAX_BODY)await reader.cancel().catch(()=>{});reader.releaseLock()}
  if(n===0)throw Error('CAR02_EMPTY_BODY');
  const all=new Uint8Array(n);let p=0;
  for(const b of blocks){all.set(b,p);p+=b.length}
  return all;
}
// Strict flat JSON parser: precisely five unique fields, only strings/booleans.
// Unlike JSON.parse alone, duplicate keys and hidden fields cannot be accepted.
function strictPayload(text){
  let p=0;const out=Object.create(null);let count=0;
  const ws=()=>{while(/[\x20\x09\x0a\x0d]/.test(text[p]||'\uffff'))p++};
  const jsonString=()=>{
    const start=p;
    if(text[p++]!=='"')throw Error('CAR02_JSON_INVALID');
    let esc=false,closed=false;
    for(;p<text.length;p++){
      const c=text[p];
      if(esc){esc=false;continue}
      if(c==='\\'){esc=true;continue}
      if(c==='"'){p++;closed=true;break}
    }
    if(!closed)throw Error('CAR02_JSON_INVALID');
    let val;try{val=JSON.parse(text.slice(start,p))}catch{throw Error('CAR02_JSON_INVALID')}
    if(typeof val!=='string')throw Error('CAR02_JSON_INVALID');
    return val;
  };
  ws();if(text[p++]!=='{')throw Error('CAR02_JSON_INVALID');
  ws();if(text[p]==='}')throw Error('CAR02_JSON_INVALID');
  for(;;){
    ws();const key=jsonString();ws();
    if(text[p++]!==':'||!FIELD_NAMES.has(key)||Object.hasOwn(out,key))throw Error('CAR02_JSON_INVALID');
    ws();let value;
    if(text[p]==='"')value=jsonString();
    else if(text.startsWith('true',p)){value=true;p+=4}
    else if(text.startsWith('false',p)){value=false;p+=5}
    else throw Error('CAR02_JSON_INVALID');
    out[key]=value;count++;ws();
    if(text[p]==='}'){p++;break}
    if(text[p++]!==','||count>=5)throw Error('CAR02_JSON_INVALID');
  }
  ws();if(p!==text.length||count!==5)throw Error('CAR02_JSON_INVALID');
  if(!['owner','staff'].includes(out.expectedRole)||!['owner','staff'].includes(out.nextRole)||
    typeof out.expectedActive!=='boolean'||typeof out.nextActive!=='boolean'||
    typeof out.reason!=='string'||out.reason!==out.reason.trim()||out.reason.length<8||out.reason.length>512||
    /[\u0000-\u001f\u007f]/.test(out.reason))throw Error('CAR02_PERMISSION_INPUT_INVALID');
  return out;
}
export function createCar02StaffAccessHttpR85({shopCode,allowedOrigins,releaseEnabled,authenticate,
  changeExistingStaffPermission}={}){
  if(typeof shopCode!=='string'||!SHOP.test(shopCode)||typeof releaseEnabled!=='function'||
    typeof authenticate!=='function'||typeof changeExistingStaffPermission!=='function')
    throw Error('CAR02_R85_SECURE_DEPENDENCIES_REQUIRED');
  const origins=exactOrigins(allowedOrigins);
  return async function handleR85(request){
    let url;try{url=new URL(request?.url)}catch{return deny(400,'CAR02_BAD_REQUEST')}
    const origin=request.headers?.get?.('origin')||'';
    const trusted=origins.has(origin);
    const match=PATH.exec(url.pathname);
    if(!match||url.search||url.hash)return deny(404,'CAR02_NOT_FOUND');
    if(!trusted)return deny(403,'CAR02_ORIGIN_DENIED');
    // Check release before ANY external verifier, request body, or repository call.
    let released=false;try{released=(await releaseEnabled())===true}catch{}
    if(!released)return deny(503,'CAR02_NOT_RELEASED',origin);
    if(request.method==='OPTIONS'){
      const method=request.headers.get('access-control-request-method');
      const listed=request.headers.get('access-control-request-headers')||'';
      const headers=listed.split(',').map(x=>x.trim().toLowerCase());
      if(method!=='POST'||headers.length!==2||new Set(headers).size!==2||
        !headers.includes('authorization')||!headers.includes('content-type'))
        return deny(403,'CAR02_CORS_PREFLIGHT_DENIED',origin);
      return reply(204,null,origin,{
        'Access-Control-Allow-Methods':'POST',
        'Access-Control-Allow-Headers':'Authorization, Content-Type',
        'Access-Control-Max-Age':'0'
      });
    }
    if(request.method!=='POST')return deny(405,'CAR02_METHOD_DENIED',origin);
    if(request.headers.has('cookie')||request.headers.has('x-line-id-token')||
      !bearer(request.headers.get('authorization')))
      return deny(401,'CAR02_UNAUTHORIZED',origin);
    if(request.headers.get('content-type')!=='application/json'||
      request.headers.has('content-encoding'))return deny(415,'CAR02_CONTENT_TYPE_DENIED',origin);
    const declared=request.headers.get('content-length');
    if(declared!==null&&(!/^(?:0|[1-9]\d*)$/.test(declared)||!Number.isSafeInteger(Number(declared))))
      return deny(400,'CAR02_BAD_LENGTH',origin);
    if(declared!==null&&Number(declared)>MAX_BODY)return deny(413,'CAR02_BODY_TOO_LARGE',origin);
    let actor;try{actor=await authenticate(request)}catch{return deny(401,'CAR02_UNAUTHORIZED',origin)}
    if(!ownerActor(actor,shopCode))return deny(403,'CAR02_OWNER_REQUIRED',origin);
    let raw;try{raw=await bodyBytes(request)}catch(e){
      if(e.message==='CAR02_BODY_TOO_LARGE')return deny(413,'CAR02_BODY_TOO_LARGE',origin);
      return deny(400,'CAR02_BAD_BODY',origin);
    }
    if(declared!==null&&raw.byteLength!==Number(declared))return deny(400,'CAR02_BAD_LENGTH',origin);
    let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(raw)}catch{return deny(400,'CAR02_BAD_BODY',origin)}
    let payload;try{payload=strictPayload(text)}catch{return deny(400,'CAR02_PERMISSION_INPUT_INVALID',origin)}
    const targetUserSub=match[1].toLowerCase();
    if(actor.subject.slice(6).toLowerCase()===targetUserSub)return deny(403,'CAR02_SELF_CHANGE_DENIED',origin);
    let output;
    try{output=await changeExistingStaffPermission({actor,targetUserSub,...payload})}
    catch(e){const key=e?.message;const [status,code]=(typeof key==='string' && Object.hasOwn(STATUS_CODES,key)) ? STATUS_CODES[key] : [503,'CAR02_PERMISSION_CHANGE_UNAVAILABLE'];return deny(status,code,origin)}
    if(!output||typeof output.changed!=='boolean'||output.shopCode!==shopCode||
      output.targetUserSub!==targetUserSub||output.role!==payload.nextRole||output.active!==payload.nextActive)
      return deny(503,'CAR02_PERMISSION_CHANGE_UNAVAILABLE',origin);
    return reply(200,{ok:true,changed:output.changed,role:output.role,active:output.active},origin);
  };
}
