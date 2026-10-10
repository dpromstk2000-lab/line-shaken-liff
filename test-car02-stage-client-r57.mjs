import test from 'node:test';
import assert from 'node:assert/strict';
import { createCar02BrowserClientR57, Car02ClientError } from './car02-browser-client-r57.mjs';
import { createCar02BrowserClientR49 } from './car02-browser-client-r49.mjs';
import { createCar02EdgeBoundaryR51 } from './car02-edge-boundary-r51.mjs';
const STAGE='https://cbknucemarcpbscirzyv.supabase.co/functions/v1/dpro-car02-stage';
const ID='12345678-1234-4234-8234-123456789abc';
const make=(opts={})=>createCar02BrowserClientR57({apiOrigin:STAGE,credentials:async()=>({kind:'staff',token:'1234567890abcdef'}),cryptoImpl:{randomUUID:()=>ID},...opts});
const assertCode=async(fn,code)=>assert.rejects(fn,e=>e instanceof Car02ClientError&&e.code===code);

test('R49 could not target the deployed staging function path',()=>{
 assert.throws(()=>createCar02BrowserClientR49({apiOrigin:STAGE,credentials:async()=>({kind:'staff',token:'1234567890abcdef'}),cryptoImpl:{randomUUID:()=>ID}}),e=>e.code==='CAR02_API_ORIGIN_INVALID');
});
test('R57 matches exactly the Supabase Edge function path',async()=>{
 let called;
 const c=make({connectionEnabled:true,fetchImpl:async(url,opts)=>{called={url,opts};return new Response(JSON.stringify({ok:true,data:{id:ID}}),{status:200,headers:{'Content-Type':'application/json'}})}});
 assert.deepEqual(await c.get(ID),{id:ID});
 assert.equal(called.url,STAGE+'/api/car02/'+ID);
 assert.match(called.opts.headers.get('Authorization'),/^Bearer /);
 assert.equal(called.opts.credentials,'omit');
 assert.equal(called.opts.redirect,'error');
});
test('R57 defaults to disconnected even with stage configured',async()=>{
 let requests=0;
 const c=make({fetchImpl:async()=>{requests++;throw Error('must not call network')}});
 await assertCode(()=>c.get(ID),'CAR02_BROWSER_CONNECTION_CLOSED');
 assert.equal(requests,0);
});
test('R57 integration: locked Edge gives CAR02_NOT_RELEASED and never creates runtime',async()=>{
 let initialized=0,called='';
 const locked=createCar02EdgeBoundaryR51({isServerReleased:()=>false,createRuntime:()=>{initialized++;throw Error('unreachable')}});
 const c=make({connectionEnabled:true,fetchImpl:async(url,options)=>{called=url;return locked(new Request(url,options));}});
 await assertCode(()=>c.get(ID),'CAR02_NOT_RELEASED');
 assert.equal(called,STAGE+'/api/car02/'+ID);
 assert.equal(initialized,0);
});
test('R57 staging photo GET also blocked by server before DB',async()=>{
 let initialized=0;
 const locked=createCar02EdgeBoundaryR51({isServerReleased:()=>false,createRuntime:()=>{initialized++;throw Error('not called')}});
 const c=make({connectionEnabled:true,fetchImpl:async(url,options)=>locked(new Request(url,options))});
 await assertCode(()=>c.photo(ID),'CAR02_PHOTO_UNAVAILABLE');
 assert.equal(initialized,0);
});
test('R57 POST sends JSON idempotency key and remains locked',async()=>{
 let sent;
 const locked=createCar02EdgeBoundaryR51({isServerReleased:()=>false,createRuntime:()=>{throw Error('cannot run')}});
 const c=make({connectionEnabled:true,fetchImpl:async(url,options)=>{sent=options;return locked(new Request(url,options));}});
 await assertCode(()=>c.create({customerId:ID,vehicleId:ID}),'CAR02_NOT_RELEASED');
 assert.equal(sent.method,'POST');assert.equal(sent.headers.get('Idempotency-Key'),'car02-'+ID);
 assert.equal(sent.headers.get('content-type'),'application/json');
});
for(const url of [
 'http://cbknucemarcpbscirzyv.supabase.co/functions/v1/dpro-car02-stage',
 STAGE+'/', STAGE+'?mode=live', STAGE+'#fragment',
 'https://evil.example/functions/v1/dpro-car02-stage',
 'https://cbknucemarcpbscirzyv.supabase.co/functions/v1/another-function',
 'https://cbknucemarcpbscirzyv.supabase.co/functions/v1/dpro-car02-stage/api',
 'https://user:pass@cbknucemarcpbscirzyv.supabase.co/functions/v1/dpro-car02-stage'
]){
 test('R57 refuses unsafe API base: '+url,()=>{
  assert.throws(()=>make({apiOrigin:url}),e=>e instanceof Car02ClientError&&['CAR02_API_ORIGIN_INVALID','CAR02_STAGING_ORIGIN_MISMATCH'].includes(e.code));
 });
}
test('legacy root origin remains compatible',async()=>{
 let requested;
 const c=make({apiOrigin:'https://example.test',connectionEnabled:true,fetchImpl:async(u)=>{requested=u;return new Response(JSON.stringify({ok:true,data:[]}),{headers:{'Content-Type':'application/json'}})}});
 await c.get(ID);assert.equal(requested,'https://example.test/api/car02/'+ID);
});
test('CORS remains an explicit separate release blocker, not a bypass',async()=>{
 const locked=createCar02EdgeBoundaryR51({isServerReleased:()=>false,createRuntime:()=>{throw Error('not run')}});
 const r=await locked(new Request(STAGE+'/api/car02/'+ID,{headers:{Origin:'https://dpromstk2000-lab.github.io'}}));
 assert.equal(r.status,503);
 assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);
 assert.equal((await r.json()).code,'CAR02_NOT_RELEASED');
});
