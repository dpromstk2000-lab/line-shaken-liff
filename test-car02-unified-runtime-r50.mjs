// DPRO CAR02 R50 integration assembly QA. All identities and storage responses below are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCar02UnifiedRuntimeR50} from './car02-unified-runtime-r50.mjs';
const ID='11111111-1111-4111-8111-111111111111';
const SHOP='street_house_kitsuki';
const BASE='https://example-ref.supabase.co';
const WEB='https://dpromstk2000-lab.github.io';
const key='ci-test-only-key-never-use-in-prod-123456';
const fixed=() => 1000;
let queryCount=0,connectCount=0,remoteCount=0;
const pool={query:async()=>{queryCount++;return{rows:[]}},connect:async()=>{connectCount++;throw Error('UNEXPECTED_DB_CONNECTION')}};
const fetchImpl=async()=>{remoteCount++;throw Error('UNEXPECTED_NETWORK')};
const closed={systemCode:'CAR02',contracted:false,goLiveApproved:false,migrationVerified:false,
 verifiedIdentityBound:false,workerBackendReady:false,externalNotificationsReviewed:false};
const open={systemCode:'CAR02',contracted:true,goLiveApproved:true,migrationVerified:true,
 verifiedIdentityBound:true,workerBackendReady:true,externalNotificationsReviewed:true};
function factory(override={}){return createCar02UnifiedRuntimeR50({pool,shopCode:SHOP,lineChannelId:'2010239091',
 supabaseUrl:BASE,supabaseAnonKey:'ci_anon_key_123456789',storageServiceRoleKey:key,
 releaseState:closed,allowedOrigins:[WEB],fetchImpl,nowSeconds:fixed,...override})}
function req(path,opts={}){return new Request('https://stage.invalid'+path,opts)}
const reset=()=>{queryCount=0;connectCount=0;remoteCount=0};
test('R50 cannot construct with no DB',()=>assert.throws(()=>factory({pool:null}),/CAR02_DB_CONNECTION_REQUIRED/));
test('R50 requires non-empty trusted release config',()=>assert.throws(()=>factory({releaseState:undefined}),/CAR02_SERVER_RELEASE_REQUIRED/));
test('R50 requires private storage credential even if closed',()=>assert.throws(()=>factory({storageServiceRoleKey:''}),/CAR02_STORAGE_PRIVATE_KEY_REQUIRED/));
test('R50 rejects wildcard, malformed and duplicate origin allowlists',()=>{
 for(const x of [[],['*'],['http://example.com'],[WEB+'/'],[WEB,WEB]])assert.throws(()=>factory({allowedOrigins:x}),/CAR02_(ORIGIN|ALLOWED_ORIGINS)/);
});
test('R50 does not route legacy reservation endpoints',async()=>{
 reset();const r=await factory()(req('/api/reservations'));assert.equal(r.status,404);
 assert.equal(queryCount+connectCount+remoteCount,0);
});
test('R50 closed business route blocks before auth and DB',async()=>{
 reset();const r=await factory()(req(`/api/car02/${ID}`,{headers:{Origin:WEB,Authorization:'Bearer fake-token-123456'}}));
 assert.equal(r.status,503);assert.equal((await r.json()).code,'CAR02_NOT_RELEASED');
 assert.equal(queryCount+connectCount+remoteCount,0);
});
test('R50 closed photo route blocks before auth and DB',async()=>{
 reset();const r=await factory()(req(`/api/car02/photos/${ID}`,{headers:{Origin:WEB,'X-Line-ID-Token':'fake-token-123456'}}));
 assert.equal(r.status,503);assert.equal((await r.json()).code,'CAR02_NOT_RELEASED');
 assert.equal(queryCount+connectCount+remoteCount,0);
});
test('R50 routes malformed private photos to 404, no I/O',async()=>{
 reset();for(const path of ['/api/car02/photos/garbage','/api/car02/photos','/api/car02/photos-extra/'+ID]){
  const r=await factory()(req(path));assert.equal(r.status,404);
 }assert.equal(queryCount+connectCount+remoteCount,0);
});
test('R50 unrecognized origin rejected before verification and DB',async()=>{
 reset();for(const path of [`/api/car02/${ID}`,`/api/car02/photos/${ID}`]){
  const r=await factory({releaseState:open})(req(path,{headers:{Origin:'https://example.invalid','X-Line-ID-Token':'fake-token-123456'}}));
  assert.equal(r.status,403);
 }assert.equal(queryCount+connectCount+remoteCount,0);
});
test('R50 unlocked business route rejects missing identity before DB',async()=>{
 reset();const r=await factory({releaseState:open})(req(`/api/car02/${ID}`,{headers:{Origin:WEB}}));
 assert.equal(r.status,401);assert.equal(queryCount+connectCount+remoteCount,0);
});
test('R50 unlocked photo route rejects missing identity before DB',async()=>{
 reset();const r=await factory({releaseState:open})(req(`/api/car02/photos/${ID}`,{headers:{Origin:WEB}}));
 assert.equal(r.status,401);assert.equal(queryCount+connectCount+remoteCount,0);
});
test('R50 unlocked photo route rejects invalid LINE proof, no DB',async()=>{
 reset();const r=await factory({releaseState:open})(req(`/api/car02/photos/${ID}`,{headers:{Origin:WEB,'X-Line-ID-Token':'fake-token-123456'}}));
 assert.equal(r.status,401);assert.equal(queryCount+connectCount,0);
});
test('R50 neither business nor photos permit cookie-based identity',async()=>{
 reset();const run=factory({releaseState:open});for(const path of [`/api/car02/${ID}`,`/api/car02/photos/${ID}`]){
  const r=await run(req(path,{headers:{Origin:WEB,Cookie:'session=demo'}}));assert.equal(r.status,401);
 }assert.equal(queryCount+connectCount+remoteCount,0);
});
test('R50 preflight exposes only listed auth headers, without querying DB',async()=>{
 reset();const r=await factory()(req('/api/car02/photos/'+ID,{method:'OPTIONS',headers:{Origin:WEB}}));
 assert.equal(r.status,204);assert.match(r.headers.get('access-control-allow-headers'),/X-Line-ID-Token/);
 assert.equal(queryCount+connectCount+remoteCount,0);
});
