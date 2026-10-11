import test from 'node:test';
import assert from 'node:assert/strict';
import {createCar02PhotoUploadHttpR82} from './car02-private-photo-upload-http-r82.mjs';

const ID1='11111111-1111-4111-8111-111111111111';
const ID2='22222222-2222-4222-8222-222222222222';
const ID3='33333333-3333-4333-8333-333333333333';
const SHOP='street_house_kitsuki';
const ORIGIN='https://example.com';
const URL=`https://api.example.com/api/car02/uploads/${ID1}/${ID2}`;
const IMAGE=new Uint8Array([137,80,78,71,13,10,26,10,1,2,3]);
const ACTOR=Object.freeze({verified:true,shopCode:SHOP,role:'staff',subject:'staff:'+ID3});
function make(overrides={}){
 const events={gate:0,auth:0,upload:0,inputs:[]};
 const opts={shopCode:SHOP,allowedOrigins:[ORIGIN],
   releaseEnabled:async()=>{events.gate++;return true},
   authenticate:async()=>{events.auth++;return ACTOR},
   uploadService:{upload:async input=>{
     events.upload++;events.inputs.push(input);
     return {photoId:ID3,state:'ready',mimeType:input.mimeType,byteSize:input.bytes.length,sha256:'SECRET_DIGEST_NOT_EXPOSED',storageUrl:'https://private.example/photo'};
   }},...overrides};
 return {route:createCar02PhotoUploadHttpR82(opts),events};
}
function req({url=URL,method='POST',headers={},body=IMAGE}={}){
 const h={origin:ORIGIN,authorization:'Bearer '+'a'.repeat(32),'content-type':'image/png',...headers};
 return new Request(url,{method,headers:h,...(!['GET','HEAD'].includes(method)&&body!==null?{body}:{}),
   ...(body instanceof ReadableStream?{duplex:'half'}:{})});
}
async function denial(route,request,status,code){
 const response=await route(request);assert.equal(response.status,status);
 const value=await response.json();assert.deepEqual(value,{ok:false,code});
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 assert.equal(response.headers.get('content-security-policy'),"default-src 'none'");
 return response;
}

test('R82 valid isolated POST returns only minimally scoped receipt',async()=>{
 const {route,events}=make();const r=await route(req());assert.equal(r.status,201);
 assert.deepEqual(await r.json(),{ok:true,photoId:ID3,state:'ready',mimeType:'image/png',byteSize:IMAGE.length});
 assert.equal(r.headers.get('access-control-allow-origin'),ORIGIN);
 assert.equal(events.gate,1);assert.equal(events.auth,1);assert.equal(events.upload,1);
 assert.equal(events.inputs[0].shop,SHOP);assert.equal(events.inputs[0].orderId,ID1);assert.equal(events.inputs[0].reportId,ID2);
 assert.equal(events.inputs[0].actor,ACTOR);
});
const CONFIG=[
 ['missing shop',{shopCode:null}],
 ['invalid shop',{shopCode:'../../other'}],
 ['missing gate',{releaseEnabled:null}],
 ['missing auth',{authenticate:null}],
 ['missing uploader',{uploadService:null}],
 ['missing uploader method',{uploadService:{}}]
];
for(const [name,patch] of CONFIG)test('R82 rejects '+name,()=>assert.throws(()=>make(patch),/CAR02_R82_SERVER_DEPS_REQUIRED/));
const BAD_ORIGINS=[[],['http://example.com'],['https://example.com/'],['https://example.com/path'],['https://x.example','https://x.example'],['https://x.example?x=1'],[5],new Array(9).fill('https://example.com')];
for(const [i,origins] of BAD_ORIGINS.entries())test('R82 refuses unsafe origin configuration '+(i+1),()=>assert.throws(()=>make({allowedOrigins:origins}),/CAR02_R82_ORIGIN/));
for(const bad of [`${URL}/`,`https://api.example.com/api/car02/uploads/${ID1}/${ID2}?role=owner`,
 `https://api.example.com/api/car02/uploads/${ID1}/${ID2}#hidden`,
 `https://api.example.com/functions/v1/dpro-car02-stage/api/car02/uploads/${ID1}/${ID2}`,
 `https://api.example.com/api/car02/${ID1}/report`,
 `https://api.example.com/api/car02/uploads/${ID1}/not-uuid`]){
 test('R82 rejects route drift '+bad.slice(-48),async()=>{
  const {route,events}=make();await denial(route,req({url:bad}),404,'CAR02_NOT_FOUND');
  assert.equal(events.upload,0);assert.equal(events.gate,0);
 });
}
for(const method of ['GET','PUT','DELETE'])test('R82 rejects method '+method,async()=>{
 const {route,events}=make();await denial(route,req({method}),405,'CAR02_METHOD_DENIED');assert.equal(events.gate,0);assert.equal(events.upload,0);
});
test('R82 denies disallowed Origin with no ACAO and no DB/storage',async()=>{
 const {route,events}=make();const r=await denial(route,req({headers:{origin:'https://attacker.example'}}),403,'CAR02_ORIGIN_DENIED');
 assert.equal(r.headers.get('access-control-allow-origin'),null);assert.equal(events.gate,0);
});
test('R82 denies missing Origin',async()=>{
 const {route,events}=make();await denial(route,req({headers:{origin:undefined}}),403,'CAR02_ORIGIN_DENIED');assert.equal(events.upload,0);
});
for(const [name,fn] of [['false',async()=>false],['throw',async()=>{throw Error('SECRET_PASSWORD')}],['notBoolean',async()=>1]]){
 test('R82 hard release gate blocks before identity/body: '+name,async()=>{
  const {route,events}=make({releaseEnabled:async()=>{events.gate++;return fn()}});
  await denial(route,req(),503,'CAR02_NOT_RELEASED');assert.equal(events.gate,1);assert.equal(events.auth,0);assert.equal(events.upload,0);
 });
}
for(const [name,patch] of [['no bearer',{authorization:undefined}],['invalid bearer',{authorization:'Bearer short'}]]){
 test('R82 denies missing/invalid credentials '+name,async()=>{
  const {route,events}=make();await denial(route,req({headers:patch}),401,'CAR02_UNAUTHORIZED');assert.equal(events.auth,0);assert.equal(events.upload,0);
 });
}
test('R82 disallows LINE credential on upload',async()=>{
 const {route,events}=make();await denial(route,req({headers:{'x-line-id-token':'x'.repeat(32)}}),403,'CAR02_STAFF_REQUIRED');assert.equal(events.auth,0);
});
test('R82 auth exception is sanitized',async()=>{
 const {route,events}=make({authenticate:async()=>{events.auth++;throw Error('SECRET_KEY_EXAMPLE')}});
 await denial(route,req(),401,'CAR02_UNAUTHORIZED');assert.equal(events.upload,0);
});
for(const [label,actor] of [['customer',{...ACTOR,role:'customer'}],['unverified',{...ACTOR,verified:false}],
 ['wrong shop',{...ACTOR,shopCode:'other_shop'}],['missing subject',{...ACTOR,subject:null}],
 ['spoofed LINE subject',{...ACTOR,subject:'line:'+ID3}],['forged role',{...ACTOR,role:'admin'}]]){
 test('R82 rejects unauthorized identity '+label,async()=>{
  const {route,events}=make({authenticate:async()=>actor});await denial(route,req(),403,'CAR02_STAFF_REQUIRED');assert.equal(events.upload,0);
 });
}
test('R82 owner with server-verified staff: UUID allowed',async()=>{
 const {route}=make({authenticate:async()=>({...ACTOR,role:'owner'})});assert.equal((await route(req())).status,201);
});
for(const contentType of ['text/plain','application/json','image/svg+xml','image/png; charset=utf-8','image/gif','IMAGE/PNG']){
 test('R82 denies unsafe MIME '+contentType,async()=>{
  const {route,events}=make();await denial(route,req({headers:{'content-type':contentType}}),415,'CAR02_IMAGE_TYPE_DENIED');assert.equal(events.upload,0);
 });
}
test('R82 rejects compressed upload',async()=>{
 const {route,events}=make();await denial(route,req({headers:{'content-encoding':'gzip'}}),415,'CAR02_CONTENT_ENCODING_DENIED');assert.equal(events.upload,0);
});
for(const len of ['abc','-4','5.1','99999999999999999999999','5242881']){
 test('R82 rejects bad declared byte count '+len,async()=>{
  const {route,events}=make();const expected=len==='5242881'?{code:'CAR02_IMAGE_TOO_LARGE',status:413}:{code:'CAR02_BAD_LENGTH',status:400};
  await denial(route,req({headers:{'content-length':len}}),expected.status,expected.code);assert.equal(events.upload,0);
 });
}
test('R82 compares declared and actual content length',async()=>{
 const {route,events}=make();await denial(route,req({headers:{'content-length':'12'}}),400,'CAR02_BAD_LENGTH');assert.equal(events.upload,0);
});
test('R82 rejects streamed request that exceeds 5 MiB even without content-length',async()=>{
 const bytes=new Uint8Array(5*1024*1024+1);bytes.set(IMAGE);
 const stream=new ReadableStream({start(controller){controller.enqueue(bytes);controller.close()}});
 const {route,events}=make();await denial(route,req({body:stream}),413,'CAR02_IMAGE_TOO_LARGE');assert.equal(events.upload,0);
});
test('R82 rejects tiny image before storage',async()=>{
 const {route,events}=make();await denial(route,req({body:new Uint8Array([1,2,3])}),400,'CAR02_IMAGE_INVALID');assert.equal(events.upload,0);
});
test('R82 makes no guesses about image magic bytes: delegates to R47 and sanitizes failure',async()=>{
 const {route,events}=make({uploadService:{upload:async()=>{events.upload++;throw Error('CAR02_R47_IMAGE_INVALID')}}});
 await denial(route,req({body:new Uint8Array([1,2,3,4,5,6])}),503,'CAR02_PHOTO_UPLOAD_UNAVAILABLE');assert.equal(events.upload,1);
});
test('R82 uploader/storage exception never leaks service key',async()=>{
 const {route}=make({uploadService:{upload:async()=>{throw Error('SUPABASE_SERVICE_ROLE_KEY=secret')}}});
 const r=await route(req());assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/secret|SUPABASE|postgresql|storage_path/i);
});
for(const [name,result] of [['missing ID',{state:'ready',mimeType:'image/png',byteSize:IMAGE.length}],
 ['not ready',{photoId:ID3,state:'pending',mimeType:'image/png',byteSize:IMAGE.length}],
 ['bad byte count',{photoId:ID3,state:'ready',mimeType:'image/png',byteSize:0}],
 ['wrong mime',{photoId:ID3,state:'ready',mimeType:'image/jpeg',byteSize:IMAGE.length}]]){
 test('R82 refuses inconsistent upload result '+name,async()=>{
  const {route}=make({uploadService:{upload:async()=>result}});await denial(route,req(),503,'CAR02_PHOTO_UPLOAD_UNAVAILABLE');
 });
}
test('R82 request-supplied shop/role/bucket/URL cannot override server scope',async()=>{
 const {route,events}=make();
 const r=await route(req({headers:{'x-shop-code':'another','x-role':'owner','x-storage-bucket':'public','x-photo-url':'https://evil.example'}}));
 assert.equal(r.status,201);const scope=events.inputs[0];assert.equal(scope.shop,SHOP);assert.equal(scope.actor,ACTOR);
 assert.equal(Object.keys(scope).sort().join(','),'actor,bytes,mimeType,orderId,reportId,shop');
});

for(const [label,heads,code] of [
 ['missing method',{'access-control-request-headers':'authorization,content-type'},403],
 ['wrong method',{'access-control-request-method':'GET','access-control-request-headers':'authorization,content-type'},403],
 ['extra header',{'access-control-request-method':'POST','access-control-request-headers':'authorization,content-type,x-line-id-token'},403],
 ['missing auth',{'access-control-request-method':'POST','access-control-request-headers':'content-type'},403],
 ['duplicate header',{'access-control-request-method':'POST','access-control-request-headers':'authorization,authorization,content-type'},403]
]){
 test('R82 preflight rejects '+label,async()=>{
  const {route,events}=make();await denial(route,req({method:'OPTIONS',headers:heads}),code,'CAR02_CORS_PREFLIGHT_DENIED');
  assert.equal(events.upload,0);assert.equal(events.auth,0);
 });
}
test('R82 allows strictly scoped CORS preflight without auth/storage',async()=>{
 const {route,events}=make();
 const r=await route(req({method:'OPTIONS',headers:{'access-control-request-method':'POST','access-control-request-headers':'Content-Type,Authorization'}}));
 assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),ORIGIN);
 assert.equal(r.headers.get('access-control-allow-methods'),'POST');
 assert.equal(r.headers.get('access-control-allow-headers'),'Authorization, Content-Type');
 assert.equal(events.gate,1);assert.equal(events.auth,0);assert.equal(events.upload,0);
});
test('R82 release gate prevents CORS preflight when not yet approved',async()=>{
 const {route,events}=make({releaseEnabled:async()=>false});
 await denial(route,req({method:'OPTIONS',headers:{'access-control-request-method':'POST','access-control-request-headers':'authorization,content-type'}}),503,'CAR02_NOT_RELEASED');
 assert.equal(events.auth,0);assert.equal(events.upload,0);
});
