// DPRO CAR02 R58 | REVIEW-ONLY CORS adaptor for the locked R53 staging Edge.
// This is NOT authentication and NOT a release gate. The existing Edge boundary
// MUST retain its server-owned CAR02_RELEASE_LOCK=true. Never enable a live API
// by adding this adapter. Does not read request bodies or call DB/auth/storage.

export const CAR02_R58_STAGE='dpro-car02-stage';
export const CAR02_R58_ORIGIN='https://dpromstk2000-lab.github.io';
const ROUTES=[`/functions/v1/${CAR02_R58_STAGE}`,`/${CAR02_R58_STAGE}`];
const UUID='[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}';
const WORK=new RegExp(`^/api/car02(?:/${UUID}(?:/(?:report|quote|decision|complete|history))?)?/?$`,'i');
const PHOTO=new RegExp(`^/api/car02/photos/${UUID}/?$`,'i');
const METHODS='GET, POST, OPTIONS';
const HEADERS='Authorization, Content-Type, Idempotency-Key, X-Line-ID-Token';
const ALLOWED_HEADERS=new Set(['authorization','content-type','idempotency-key','x-line-id-token','accept']);
const VARY='Origin, Access-Control-Request-Method, Access-Control-Request-Headers';
const safeResp=(status,code)=>new Response(JSON.stringify({ok:false,code}),{
  status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':VARY,'X-Content-Type-Options':'nosniff'}
});
function suffix(pathname){
  for(const base of ROUTES) if(pathname.startsWith(base+'/'))return pathname.slice(base.length);
  return null;
}
function isAllowedPath(path){return path==='/health'||WORK.test(path)||PHOTO.test(path)}
function includeCors(response,origin){
  // Preserve status, body, other headers and never grant cookies or wildcard origins.
  const headers=new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin',origin);
  headers.set('Vary',VARY);
  headers.set('Cache-Control','no-store');
  headers.set('X-Content-Type-Options','nosniff');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
export function createCar02StageCorsR58({handleEdge,allowedOrigin=CAR02_R58_ORIGIN}={}){
  if(typeof handleEdge!=='function'||allowedOrigin!==CAR02_R58_ORIGIN)throw Error('CAR02_CORS_CONFIG_INVALID');
  return async function handleStage(request){
    let url;
    try{url=new URL(request?.url)}catch{return safeResp(400,'CAR02_BAD_REQUEST')}
    // Reject unexpected path, query or fragment without CORS disclosure.
    const path=suffix(url.pathname);
    if(path===null||!isAllowedPath(path)||url.search||url.hash)return handleEdge(request);
    const origin=request.headers.get('origin');
    if(!origin)return handleEdge(request); // server-to-server requests behave as before
    if(origin!==allowedOrigin)return safeResp(403,'CAR02_ORIGIN_DENIED');
    if(request.method==='OPTIONS'){
      const wantedMethod=(request.headers.get('access-control-request-method')||'').toUpperCase();
      if(!((path==='/health'&&wantedMethod==='GET')||(path!=='/health'&&['GET','POST'].includes(wantedMethod))))
        return includeCors(safeResp(405,'CAR02_PREFLIGHT_DENIED'),origin);
      const requested=(request.headers.get('access-control-request-headers')||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
      if(requested.length>8||requested.some(h=>!ALLOWED_HEADERS.has(h)))
        return includeCors(safeResp(403,'CAR02_PREFLIGHT_HEADERS_DENIED'),origin);
      return new Response(null,{status:204,headers:{
        'Access-Control-Allow-Origin':origin,
        'Access-Control-Allow-Methods':METHODS,
        'Access-Control-Allow-Headers':HEADERS,
        'Access-Control-Max-Age':'300',
        'Vary':VARY,
        'Cache-Control':'no-store',
      }});
    }
    if(!['GET','POST'].includes(request.method))return includeCors(safeResp(405,'CAR02_METHOD_DENIED'),origin);
    const res=await handleEdge(request);
    return includeCors(res,origin);
  };
}
