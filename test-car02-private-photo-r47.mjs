import test from 'node:test';
import assert from 'node:assert/strict';
import {createCar02PrivatePhotoR47} from './car02-private-photo-r47.mjs';
const SHOP='street_house_kitsuki';
const ID='11111111-1111-4111-8111-111111111111';
const actor={verified:true,role:'staff',shopCode:SHOP,subject:'verified-staff'};
const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0,1,2,3,4,5]);
const config={baseUrl:'https://abc.supabase.co',serviceRoleKey:'qa_private_server_only_key_000001',releaseEnabled:async()=>true};
function fixture({publicBucket=false,mismatch=false,uploadFail=false,finalFail=false}={}){
  const req=[];const state={reserve:0,ready:0,cancel:0};
  const repository={async reserve(p){state.reserve++;return{id:ID}},async markReady(p){state.ready++;if(finalFail)throw Error('DB_REJECTED')},async cancel(p){state.cancel++}};
  const fetchImpl=async(url,opts={})=>{req.push({url,method:opts.method||'GET',header:opts.headers||{},redirect:opts.redirect});
    if(url.includes('/bucket/'))return Response.json({id:'ksh-car02-private-photos',public:publicBucket});
    if(opts.method==='POST')return new Response('error',{status:uploadFail?403:200});
    if(opts.method==='DELETE')return new Response(null,{status:200});
    if(url.includes('/authenticated/'))return new Response(mismatch?new Uint8Array([1,2,3]):png,{status:200});
    throw Error('unexpected request')};
  return {repository,fetchImpl,req,state};
}
const svc=(f)=>createCar02PrivatePhotoR47({...config,repository:f.repository,fetchImpl:f.fetchImpl});
const run=(f,overrides={})=>svc(f).upload({actor,shop:SHOP,orderId:ID,reportId:ID,mimeType:'image/png',bytes:png,...overrides});

test('private server upload -> digest readback -> ready',async()=>{const f=fixture();const r=await run(f);assert.equal(r.state,'ready');assert.deepEqual([f.state.reserve,f.state.ready,f.state.cancel],[1,1,0]);assert.equal(f.req.some(x=>x.url.includes('public/')),false);assert.equal(f.req.some(x=>x.header.Authorization?.includes('qa_private_server_only_key_000001')),true);assert.equal(JSON.stringify(r).includes('qa_private_server_only_key'),false)});
test('bucket must be private before DB reserve',async()=>{const f=fixture({publicBucket:true});await assert.rejects(run(f),/BUCKET_MUST_BE_PRIVATE/);assert.equal(f.state.reserve,0)});
test('unverified actor cannot call storage or DB',async()=>{const f=fixture();await assert.rejects(run(f,{actor:{...actor,verified:false}}),/STAFF_REQUIRED/);assert.equal(f.req.length,0)});
test('foreign shop actor rejected',async()=>{const f=fixture();await assert.rejects(run(f,{shop:'other_shop'}),/STAFF_REQUIRED/);assert.equal(f.req.length,0)});
test('invalid image signature fails before I/O',async()=>{const f=fixture();await assert.rejects(run(f,{bytes:new Uint8Array([1,2,3,4])}),/IMAGE_INVALID/);assert.equal(f.req.length,0)});
test('image size over 5MiB fails before I/O',async()=>{const f=fixture();await assert.rejects(run(f,{bytes:new Uint8Array(5*1024*1024+1)}),/IMAGE_INVALID/);assert.equal(f.req.length,0)});
test('Supabase upload error cancels pending reservation',async()=>{const f=fixture({uploadFail:true});await assert.rejects(run(f),/STORAGE_REJECTED/);assert.deepEqual([f.state.reserve,f.state.ready,f.state.cancel],[1,0,1])});
test('readback mismatch triggers DELETE plus cancel',async()=>{const f=fixture({mismatch:true});await assert.rejects(run(f),/INTEGRITY_FAILED/);assert.equal(f.req.some(x=>x.method==='DELETE'),true);assert.deepEqual([f.state.reserve,f.state.ready,f.state.cancel],[1,0,1])});
test('DB finalization failure deletes verified object',async()=>{const f=fixture({finalFail:true});await assert.rejects(run(f),/DB_REJECTED/);assert.equal(f.req.some(x=>x.method==='DELETE'),true);assert.deepEqual([f.state.reserve,f.state.ready,f.state.cancel],[1,1,1])});
test('credential and URL validation rejects insecure configs',()=>{const f=fixture();assert.throws(()=>createCar02PrivatePhotoR47({...config,baseUrl:'http://abc.supabase.co',repository:f.repository,fetchImpl:f.fetchImpl}),/BASE_URL_INVALID/);assert.throws(()=>createCar02PrivatePhotoR47({...config,serviceRoleKey:'x',repository:f.repository,fetchImpl:f.fetchImpl}),/SERVER_KEY_INVALID/)});

test('release gate is obligatory and blocks ALL DB/storage calls',async()=>{const f=fixture();assert.throws(()=>createCar02PrivatePhotoR47({...config,releaseEnabled:undefined,repository:f.repository,fetchImpl:f.fetchImpl}),/RELEASE_GATE_REQUIRED/);const locked=createCar02PrivatePhotoR47({...config,releaseEnabled:async()=>false,repository:f.repository,fetchImpl:f.fetchImpl});await assert.rejects(locked.upload({actor,shop:SHOP,orderId:ID,reportId:ID,mimeType:'image/png',bytes:png}),/NOT_RELEASED/);assert.equal(f.req.length,0);assert.equal(f.state.reserve,0)});
