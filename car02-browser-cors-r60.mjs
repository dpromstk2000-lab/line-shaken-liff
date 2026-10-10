// DPRO CAR02 R60 — browser-only read-only staging CORS QA.
// Do NOT use for production activation; credentials: omit; GET only.
export const CAR02_R60_EXPECTED_ORIGIN = 'https://dpromstk2000-lab.github.io';
export const CAR02_R60_EXPECTED_PATH = '/line-shaken-liff/CAR02_R60_BROWSER_CORS_QA.html';
export const CAR02_R60_STAGE_BASE = 'https://cbknucemarcpbscirzyv.supabase.co/functions/v1/dpro-car02-stage';
const LOCKED = Object.freeze({ok:false,code:'CAR02_NOT_RELEASED'});
const HEALTH = Object.freeze({ok:true,service:'DPRO CAR02 isolated staging gateway',deployment:'review-only',live:false});
const ZERO_UUID = '00000000-0000-4000-8000-000000000000';

export const CAR02_R60_CHECKS = Object.freeze([
  Object.freeze({id:'health',title:'ステージング稼働',path:'/health',expectedStatus:200,expectedBody:HEALTH,description:'review-only / live:false'}),
  Object.freeze({id:'locked',title:'整備受付の停止',path:'/api/car02',expectedStatus:503,expectedBody:LOCKED,description:'未公開のためCAR02_NOT_RELEASED'}),
  Object.freeze({id:'preflight',title:'ブラウザ事前通信',path:'/api/car02',expectedStatus:503,expectedBody:LOCKED,description:'GET＋Content-TypeでCORS事前確認'}),
  Object.freeze({id:'photo',title:'非公開写真の保護',path:`/api/car02/photos/${ZERO_UUID}`,expectedStatus:503,expectedBody:LOCKED,description:'架空IDへの読み取りも停止'}),
]);

export function isCar02R60TrustedPage(locationLike) {
  return Boolean(locationLike && locationLike.protocol==='https:' &&
    locationLike.origin===CAR02_R60_EXPECTED_ORIGIN &&
    locationLike.pathname===CAR02_R60_EXPECTED_PATH &&
    !locationLike.search && !locationLike.hash);
}

function sameEnvelope(observed, expected) {
  if (!observed || typeof observed!=='object' || Array.isArray(observed)) return false;
  return Object.keys(expected).every(key=>observed[key] === expected[key]);
}

// Return sanitized diagnostics only, never response bodies or user credentials.
export async function runCar02BrowserCorsR60({locationLike,fetchImpl=globalThis.fetch,timeoutMs=10000}={}) {
  const checks=[];
  if (!isCar02R60TrustedPage(locationLike)) return {
    ok:false, blocked:true, code:'R60_WRONG_PAGES_ORIGIN',checks,networkCalls:0
  };
  if (typeof fetchImpl!=='function') return {
    ok:false, blocked:true, code:'R60_FETCH_UNAVAILABLE',checks,networkCalls:0
  };
  let networkCalls=0;
  for (const spec of CAR02_R60_CHECKS) {
    let observedStatus=null;
    let ok=false;
    let code='R60_NETWORK_FAILED';
    try {
      const headers = spec.id==='preflight' ? {'Content-Type':'application/json'} : {};
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),timeoutMs);
      try {
        networkCalls++;
        const response=await fetchImpl(CAR02_R60_STAGE_BASE+spec.path,{
          method:'GET',mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',
          referrerPolicy:'no-referrer',headers,signal:controller.signal
        });
        observedStatus=response.status;
        const contentType=response.headers.get('content-type')||'';
        if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
          code='R60_NOT_JSON';
        } else {
          const body=await response.json();
          ok=observedStatus===spec.expectedStatus && sameEnvelope(body,spec.expectedBody);
          code=ok?'R60_PASS':'R60_UNEXPECTED_RESPONSE';
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      code='R60_NETWORK_OR_CORS_FAILED';
    }
    checks.push({id:spec.id,title:spec.title,description:spec.description,expectedStatus:spec.expectedStatus,observedStatus,ok,code});
  }
  return {ok:checks.length===4&&checks.every(c=>c.ok),blocked:false,code:checks.every(c=>c.ok)?'R60_ALL_PASS':'R60_CHECK_FAILED',checks,networkCalls};
}
