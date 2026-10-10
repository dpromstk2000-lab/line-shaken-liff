// DPRO CAR02 R52 hardened route compatibility; historical public export name retained.
// REVIEW ONLY. Strict locked stage, no deployment or production data access.
// Supabase Edge paths may arrive as /functions/v1/<name>/... or /<name>/...
// No unprefixed CAR02 or legacy reservation endpoints are accepted.
const NAME='dpro-car02-stage';
const PREFIXES=['/functions/v1/'+NAME,'/'+NAME];
const UUID='[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}';
const PATH=new RegExp('^/api/car02(?:/'+UUID+'(?:/(?:report|quote|decision|complete|history))?)?/?$','i');
const PHOTO_PATH=new RegExp('^/api/car02/photos/'+UUID+'/?$','i');
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json=(status,code)=>new Response(JSON.stringify({ok:false,code}),{status,headers});
const MAX_BODY=32768;
function relativePath(pathname){
  for(const prefix of PREFIXES){
    if(pathname.startsWith(prefix+'/'))return pathname.slice(prefix.length);
  }
  return null;
}
export function createCar02EdgeBoundaryR51({isServerReleased,createRuntime}={}){
  if(typeof isServerReleased!=='function'||typeof createRuntime!=='function')throw Error('CAR02_EDGE_SECURE_DEPENDENCIES_REQUIRED');
  let runtimePromise;
  return async function handleEdge(request){
    let url;
    try{url=new URL(request?.url)}catch{return json(400,'CAR02_BAD_REQUEST')}
    if(url.search||url.hash)return json(404,'CAR02_NOT_FOUND');
    const path=relativePath(url.pathname);
    if(path===null)return json(404,'CAR02_NOT_FOUND');
    if(path==='/health'&&request.method==='GET')return new Response(JSON.stringify({
      ok:true,service:'DPRO CAR02 isolated staging gateway',deployment:'review-only',live:false,
    }),{status:200,headers});
    if(!PATH.test(path)&&!PHOTO_PATH.test(path))return json(404,'CAR02_NOT_FOUND');
    // Fail closed before reading body or touching DB, identity provider or storage.
    let released=false;
    try{released=await isServerReleased()===true}catch{}
    if(!released)return json(503,'CAR02_NOT_RELEASED');
    if(!['GET','POST','OPTIONS'].includes(request.method))return json(405,'CAR02_METHOD_DENIED');
    let body;
    if(request.method==='POST'){
      const length=Number(request.headers.get('content-length')||0);
      if(!Number.isFinite(length)||length>MAX_BODY)return json(413,'CAR02_BODY_TOO_LARGE');
      try{body=await request.arrayBuffer()}catch{return json(400,'CAR02_BAD_REQUEST')}
      if(body.byteLength>MAX_BODY)return json(413,'CAR02_BODY_TOO_LARGE');
    }
    try{
      if(!runtimePromise)runtimePromise=Promise.resolve().then(()=>createRuntime());
      const runtime=await runtimePromise;
      if(typeof runtime!=='function')throw Error('CAR02_NO_RUNTIME');
      // Only use a validated CAR02 internal path; never forward the old reservation path.
      const normalized=new Request(new URL(path,url.origin),{
        method:request.method,headers:request.headers,...(body===undefined?{}:{body}),
      });
      return await runtime(normalized);
    }catch{
      runtimePromise=undefined;
      return json(503,'CAR02_BACKEND_UNAVAILABLE');
    }
  };
}
