import test from 'node:test';
import assert from 'node:assert/strict';
import {createCar02EdgeBoundaryR51} from './car02-edge-boundary-r51.mjs';
const PREFIX='https://mockproject.supabase.co/functions/v1/dpro-car02-stage';
const ID='11111111-1111-4111-8111-111111111111';
const req=(path,options)=>new Request(PREFIX+path,options);
const env=(released=false)=>{
  const state={released,runtimeCount:0,requests:[]};
  const handler=createCar02EdgeBoundaryR51({isServerReleased:async()=>state.released,
    createRuntime:()=>{state.runtimeCount++;return async request=>{
      state.requests.push(request);return Response.json({ok:true,received:new URL(request.url).pathname,token:request.headers.get('X-Line-ID-Token'),method:request.method,body:request.method==='POST'?await request.json():null});
    };}
  });return{state,handler};
};
test('R51 requires server-side security callbacks',()=>assert.throws(()=>createCar02EdgeBoundaryR51({}),/REQUIRED/));
test('R51 health is non-sensitive; does not configure DB',async()=>{const e=env();const r=await e.handler(req('/health'));assert.equal(r.status,200);assert.equal((await r.json()).live,false);assert.equal(e.state.runtimeCount,0)});
test('R51 rejects anything outside its isolated CAR02 prefix',async()=>{const e=env(true);for(const path of ['/api/reservations','/ksh/api/inquiries','/api/car02evil','/api/car02/photos-extra/'+ID]){assert.equal((await e.handler(req(path))).status,404)}assert.equal(e.state.runtimeCount,0)});
test('R51 unauthorized precontract route never connects DB',async()=>{const e=env();const r=await e.handler(req('/api/car02',{method:'POST',body:JSON.stringify({customerId:ID})}));assert.equal(r.status,503);assert.equal((await r.json()).code,'CAR02_NOT_RELEASED');assert.equal(e.state.runtimeCount,0)});
test('R51 precontract closure blocks malicious origins before runtime',async()=>{const e=env();assert.equal((await e.handler(req('/api/car02/'+ID,{headers:{Origin:'https://evil.example'}}))).status,503);assert.equal(e.state.runtimeCount,0)});
test('R51 rejects query flags even when released',async()=>{const e=env(true);assert.equal((await e.handler(req('/api/car02?demo=1'))).status,404);assert.equal(e.state.runtimeCount,0)});
test('R51 rejects unsupported methods before initializing DB',async()=>{const e=env(true);assert.equal((await e.handler(req('/api/car02',{method:'DELETE'}))).status,405);assert.equal(e.state.runtimeCount,0)});
test('R51 forward passes verified LINE header and exact API path',async()=>{const e=env(true);const r=await e.handler(req('/api/car02/'+ID,{headers:{'X-Line-ID-Token':'ci-identity-test-123456',Origin:'https://trusted.example'}}));assert.equal(r.status,200);const d=await r.json();assert.equal(d.received,'/api/car02/'+ID);assert.equal(d.token,'ci-identity-test-123456');assert.equal(e.state.runtimeCount,1)});
test('R51 preserves POST JSON and does not consume it before release gate',async()=>{const e=env(true);const r=await e.handler(req('/api/car02',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({x:1})}));assert.deepEqual((await r.json()).body,{x:1});assert.equal(e.state.requests[0].method,'POST')});
test('R51 rejects >32KB bodies without reaching runtime',async()=>{const e=env(true);const r=await e.handler(req('/api/car02',{method:'POST',body:'x'.repeat(33000)}));assert.equal(r.status,413);assert.equal(e.state.runtimeCount,0)});
test('R51 construction or runtime errors remain generic',async()=>{const handler=createCar02EdgeBoundaryR51({isServerReleased:()=>true,createRuntime:()=>{throw Error('private database secret')}});const r=await handler(req('/api/car02'));assert.equal(r.status,503);assert.ok(!JSON.stringify(await r.json()).includes('secret'))});
test('R51 server-side lock may close after previous good request',async()=>{const e=env(true);assert.equal((await e.handler(req('/api/car02/'+ID))).status,200);e.state.released=false;assert.equal((await e.handler(req('/api/car02/'+ID))).status,503);assert.equal(e.state.requests.length,1)});
