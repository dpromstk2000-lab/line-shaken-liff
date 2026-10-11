// DPRO CAR02 R93Y — simulated Supabase-style Storage HTTP transport.
// STRICTLY ISOLATED QA: .invalid hostname, in-process fake fetch, no secrets,
// no real network, no authenticated production Storage and NO DELETE.
// This is NOT a production Storage adapter. A real backend remains an open gate.
const ORIGIN='https://car02-storage-fixture.invalid';
const BASE=ORIGIN+'/storage/v1';
const BUCKET='ksh-car02-private-photos';
const MAX=5242880;
const AUTH='QA_FIXTURE_HEADER_ONLY';
const MIME=Object.freeze({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'});
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const BRAND=Symbol('R93Y_IN_PROCESS_FIXTURE');
const failure=code=>{throw Object.assign(new Error(code),{code});};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const absPath=p=>p.split('/').map(encodeURIComponent).join('/');
function pathOK(path,mime){
 if(typeof path!=='string'||path.length>300||!Object.hasOwn(MIME,mime)||path.includes('%'))return false;
 const a=path.split('/');
 return a.length===4&&/^[a-z0-9][a-z0-9_-]{1,63}$/.test(a[0])&&
   UUID.test(a[1])&&UUID.test(a[2])&&a[3].length===37+MIME[mime].length&&
   UUID.test(a[3].slice(0,36))&&a[3].slice(36)==='.'+MIME[mime];
}
function parsePath(url,head){
 if(!url.startsWith(head))return null;
 const suffix=url.slice(head.length);
 if(!suffix||suffix.includes('?')||suffix.includes('#'))return null;
 try{return suffix.split('/').map(x=>decodeURIComponent(x)).join('/');}catch{return null;}
}
async function readBytes(response){
 if(!response?.body||typeof response.body.getReader!=='function')failure('R93Y_HTTP_BODY_UNVERIFIED');
 const reader=response.body.getReader();let size=0;const chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;
   if(!(value instanceof Uint8Array))failure('R93Y_HTTP_BAD_CHUNK');
   size+=value.byteLength;if(size>MAX)failure('R93Y_HTTP_OVERSIZE');
   chunks.push(value);
 }}finally{try{await reader.cancel()}catch{}reader.releaseLock();}
 const result=new Uint8Array(size);let i=0;
 for(const chunk of chunks){result.set(chunk,i);i+=chunk.length;}
 return result;
}
export function createR93YInProcessStorageFixture(config={}){
 // Fakes every response in-process. User-supplied remote URLs/functions forbidden.
 if(Object.keys(config).some(k=>![
  'publicBucket','bucketMalformed','bucketRedirect','postAckLost','postFailure',
  'readFailure','readRedirect','readTruncated','corruptRead','wrongMime','offline',
  'ambiguousMissing','oversizeRead','postConflict','postFailedButWritten'
 ].includes(k)))failure('R93Y_FIXTURE_CONFIG_INVALID');
 const objects=new Map();const calls=[];let posts=0;
 const fixture={kind:'car02_r93y_in_process_http_fixture',testOnly:true,[BRAND]:true,
  calls,objects,get posts(){return posts;},
  async fetch(url,options={}){
   if(typeof url!=='string'||!url.startsWith(BASE+'/')||
    options.redirect!=='error'||options.headers?.['x-qa-fixture']!==AUTH)
     failure('R93Y_EXTERNAL_OR_UNAUTHORIZED_FETCH');
   const method=options.method||'GET';calls.push({method,path:new URL(url).pathname});
   if(config.offline)throw Error('R93Y_NETWORK_OFFLINE');
   if(url===`${BASE}/bucket/${BUCKET}`&&method==='GET'){
    if(config.bucketRedirect)return new Response(null,{status:302,headers:{location:'https://other.invalid/'}});
    if(config.bucketMalformed)return new Response('invalid-json',{status:200});
    return json({id:BUCKET,public:!!config.publicBucket});
   }
   if(method==='POST'){
    const p=parsePath(url,`${BASE}/object/${BUCKET}/`);
    if(p===null||!pathOK(p,options.headers?.['content-type'])||options.headers?.['x-upsert']!=='false'||
       !(options.body instanceof Uint8Array)||options.body.length>MAX)
      failure('R93Y_FIXTURE_POST_INVALID');
    posts++;
    if(config.postFailure)return json({code:'STORAGE_ERROR'},500);
    if(objects.has(p)||config.postConflict)return json({code:'RESOURCE_EXISTS'},409);
    objects.set(p,{bytes:new Uint8Array(options.body),mime:options.headers['content-type']});
    if(config.postFailedButWritten)return json({code:'STORAGE_UNKNOWN'},500);
    if(config.postAckLost)throw Error('R93Y_POST_ACK_LOST');
    return json({Key:p},201);
   }
   if(method==='GET'){
    const p=parsePath(url,`${BASE}/object/authenticated/${BUCKET}/`);
    if(p===null||!pathOK(p,options.expectedMime))failure('R93Y_FIXTURE_READ_INVALID');
    if(config.readRedirect)return new Response(null,{status:302,headers:{location:'https://other.invalid/'}});
    if(config.readFailure)return json({error:'Unavailable'},503);
    const o=objects.get(p);
    if(!o)return config.ambiguousMissing?json({error:'uncertain'},503):json({error:'not found'},404);
    let bytes=o.bytes;
    if(config.readTruncated)bytes=bytes.slice(0,-1);
    if(config.corruptRead){bytes=new Uint8Array(bytes);bytes[bytes.length-1]^=1;}
    if(config.oversizeRead)bytes=new Uint8Array(MAX+1);
    return new Response(bytes,{status:200,headers:{'content-type':config.wrongMime?'image/png':o.mime}});
   }
   failure('R93Y_FIXTURE_ROUTE_FORBIDDEN');
  }
 };
 return Object.freeze(fixture);
}
export function createR93YIsolatedStorageProtocol({environment,dbName,fixture}={}){
 if(environment!=='isolated_qa'||dbName!=='car02_r93q_qa_ci'||
    fixture?.[BRAND]!==true||fixture.kind!=='car02_r93y_in_process_http_fixture'||
    fixture.testOnly!==true)failure('R93Y_IN_PROCESS_ONLY');
 const headers=(extras={})=>({'x-qa-fixture':AUTH,...extras});
 let verified=false;
 return Object.freeze({
  // Only to plug into R93X's already-locked isolated_memory Storage interface.
  kind:'isolated_memory',testOnly:true,transport:'in_process_http_fixture',
  async verifyPrivateBucket({bucket}={}){
   verified=false;
   if(bucket!==BUCKET)failure('R93Y_BUCKET_DENIED');
   let response;
   try{response=await fixture.fetch(`${BASE}/bucket/${BUCKET}`,{method:'GET',headers:headers(),redirect:'error'});}
   catch{failure('R93Y_BUCKET_UNAVAILABLE');}
   if(response.status!==200)failure('R93Y_BUCKET_UNVERIFIED');
   let body;try{body=await response.json()}catch{failure('R93Y_BUCKET_UNVERIFIED');}
   if(body?.id!==BUCKET||body?.public!==false)failure('R93Y_BUCKET_NOT_PRIVATE');
   verified=true;return Object.freeze({id:BUCKET,public:false});
  },
  async postObject({bucket,path,mimeType,bytes,upsert}={}){
   if(!verified||bucket!==BUCKET||upsert!==false||!pathOK(path,mimeType)||
     !(bytes instanceof Uint8Array)||bytes.byteLength<4||bytes.byteLength>MAX)
    failure('R93Y_POST_SCOPE_DENIED');
   let response;
   try{response=await fixture.fetch(`${BASE}/object/${BUCKET}/${absPath(path)}`,{
    method:'POST',headers:headers({'content-type':mimeType,'x-upsert':'false'}),
    body:new Uint8Array(bytes),redirect:'error'});}
   catch{failure('R93Y_POST_RESULT_UNKNOWN');}
   if(response.status===201||response.status===409)return Object.freeze({status:response.status});
   failure('R93Y_POST_RESULT_UNKNOWN');
  },
  async inspectObject({bucket,path}={}){
   if(!verified||bucket!==BUCKET||typeof path!=='string')failure('R93Y_INSPECT_SCOPE_DENIED');
   // Guessing a MIME from the validated extension is ONLY for the fixture.
   const ext=path.split('.').at(-1);const mime=Object.keys(MIME).find(k=>MIME[k]===ext);
   if(!mime||!pathOK(path,mime))failure('R93Y_INSPECT_SCOPE_DENIED');
   let response;
   try{response=await fixture.fetch(`${BASE}/object/authenticated/${BUCKET}/${absPath(path)}`,{
    method:'GET',headers:headers(),expectedMime:mime,redirect:'error'});}
   catch{failure('R93Y_INSPECT_UNKNOWN');}
   if(response.status===404)return Object.freeze({found:false,definitive:true});
   if(response.status!==200)failure('R93Y_INSPECT_UNKNOWN');
   if(response.headers.get('content-type')!==mime)failure('R93Y_MIME_MISMATCH');
   const bytes=await readBytes(response);
   return Object.freeze({found:true,private:true,bucket,path,mimeType:mime,bytes});
  }
 });
}
export const R93Y_CONTRACT=Object.freeze({mode:'isolated_qa',releaseDecision:'NO_GO',migrationDecision:'HOLD',
 productionReady:false,liveSupabaseConnected:false,onlyInvalidOrigin:true,realNetworkAllowed:false,
 productionCredentialsAllowed:false,directDeleteAllowed:false,usesInProcessHttpResponses:true,
 storageImplementationStillSimulation:true,existingR47R50R51R52Untouched:true});
