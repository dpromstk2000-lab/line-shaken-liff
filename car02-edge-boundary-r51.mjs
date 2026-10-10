// CAR02 R51: isolated Supabase Edge Function path gateway.
// Requires an explicit hard-locked server-owned switch and never reads a client flag.
// This module does NOT itself authorize release or inspect credentials; R50 provides both.
const PREFIX = '/functions/v1/dpro-car02-stage';
const UUID = '[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}';
const PATH = new RegExp('^/api/car02(?:/' + UUID + '(?:/(?:report|quote|decision|complete|history))?)?/?$', 'i');
const PHOTO_PATH = new RegExp('^/api/car02/photos/' + UUID + '/?$', 'i');
const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json = (status, code) => new Response(JSON.stringify({ok:false,code}),{status,headers});
const MAX_BODY = 32768;
export function createCar02EdgeBoundaryR51({isServerReleased, createRuntime}={}) {
  if(typeof isServerReleased!=='function' || typeof createRuntime!=='function')
    throw Error('CAR02_EDGE_SECURE_DEPENDENCIES_REQUIRED');
  let runtimePromise;
  return async function fetch(request) {
    let url;
    try{url=new URL(request?.url)}catch{return json(400,'CAR02_BAD_REQUEST')}
    if(url.search) return json(404,'CAR02_NOT_FOUND');
    if(!url.pathname.startsWith(PREFIX+'/')) return json(404,'CAR02_NOT_FOUND');
    const path=url.pathname.substring(PREFIX.length);
    if(path==='/health' && request.method==='GET')return new Response(JSON.stringify({
      ok:true,service:'DPRO CAR02 isolated staging gateway',deployment:'review-only',live:false,
    }),{status:200,headers});
    if(!PATH.test(path)&&!PHOTO_PATH.test(path))return json(404,'CAR02_NOT_FOUND');
    // Fail CLOSED before parsing body, building DB pool or contacting external services.
    let allowed=false;
    try {allowed=await isServerReleased()===true;}catch{}
    if(!allowed)return json(503,'CAR02_NOT_RELEASED');
    if(!['GET','POST','OPTIONS'].includes(request.method))return json(405,'CAR02_METHOD_DENIED');
    let body;
    if(request.method==='POST'){
      if(Number(request.headers.get('content-length')||0)>MAX_BODY)return json(413,'CAR02_BODY_TOO_LARGE');
      body=await request.arrayBuffer();
      if(body.byteLength>MAX_BODY)return json(413,'CAR02_BODY_TOO_LARGE');
    }
    try {
      if(!runtimePromise) runtimePromise=Promise.resolve().then(()=>createRuntime());
      const runtime=await runtimePromise;
      if(typeof runtime!=='function')throw Error('CAR02_NO_RUNTIME');
      // Keep the real Origin, Authorization and X-Line-ID-Token unchanged.
      const internal=new URL(url.origin+path);
      const normalized=new Request(internal,{method:request.method,headers:request.headers,...(body===undefined?{}:{body})});
      return await runtime(normalized);
    }catch{
      // Reset failed async initialization to permit retry without ever opening access.
      runtimePromise=undefined;
      return json(503,'CAR02_BACKEND_UNAVAILABLE');
    }
  };
}
