// DPRO CAR02 R63 - Review page staging status bridge.
// GET only. No credentials, tokens, database writes or customer data.
export const CAR02_R63_ORIGIN='https://dpromstk2000-lab.github.io';
export const CAR02_R63_PATH='/line-shaken-liff/CAR02_R63_WORKFLOW_REVIEW.html';
export const CAR02_R63_STAGE='https://cbknucemarcpbscirzyv.supabase.co/functions/v1/dpro-car02-stage';
const HEALTH={ok:true,service:'DPRO CAR02 isolated staging gateway',deployment:'review-only',live:false};
const CLOSED={ok:false,code:'CAR02_NOT_RELEASED'};
export function r63TrustedPage(location){
  return Boolean(location?.protocol==='https:'&&location?.origin===CAR02_R63_ORIGIN&&
    location?.pathname===CAR02_R63_PATH&&!location?.search&&!location?.hash);
}
function exact(obj, expected){
  return obj&&typeof obj==='object'&&!Array.isArray(obj)&&
    Object.keys(obj).length===Object.keys(expected).length&&
    Object.keys(expected).every(k=>obj[k]===expected[k]);
}
async function checkOne(fetchImpl,path,status,expected){
  try{
    const res=await fetchImpl(CAR02_R63_STAGE+path,{
      method:'GET',mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',
      referrerPolicy:'no-referrer',headers:{'Accept':'application/json'},
      signal:AbortSignal.timeout(8000),
    });
    if(res.status!==status) return {ok:false,code:'R63_UNEXPECTED_STATUS'};
    const type=res.headers?.get('content-type')||'';
    if(!/^application\/json(?:\s*;|$)/i.test(type))return {ok:false,code:'R63_INVALID_CONTENT_TYPE'};
    const declared=Number(res.headers?.get('content-length')||0);
    if(declared>2048)return {ok:false,code:'R63_RESPONSE_TOO_LARGE'};
    const txt=await res.text();
    if(txt.length>2048)return {ok:false,code:'R63_RESPONSE_TOO_LARGE'};
    let data;try{data=JSON.parse(txt)}catch{return {ok:false,code:'R63_INVALID_JSON'}}
    return exact(data,expected)?{ok:true,code:'R63_PASS'}:{ok:false,code:'R63_UNEXPECTED_BODY'};
  }catch{return {ok:false,code:'R63_NETWORK_OR_CORS_FAILED'}}
}
export async function checkCar02R63Stage({locationLike,fetchImpl=globalThis.fetch}={}){
  if(!r63TrustedPage(locationLike))return {ok:false,locked:false,code:'R63_UNTRUSTED_PAGE',networkCalls:0};
  if(typeof fetchImpl!=='function')return {ok:false,locked:false,code:'R63_NO_FETCH',networkCalls:0};
  // Only two read-only requests; never propagate remote response data to the page.
  const health=await checkOne(fetchImpl,'/health',200,HEALTH);
  if(!health.ok)return {ok:false,locked:false,code:'R63_HEALTH_FAILED',networkCalls:1};
  const gate=await checkOne(fetchImpl,'/api/car02',503,CLOSED);
  if(!gate.ok)return {ok:false,locked:false,code:'R63_LOCK_FAILED',networkCalls:2};
  return {ok:true,locked:true,code:'R63_REVIEW_ONLY_LOCKED',networkCalls:2};
}
