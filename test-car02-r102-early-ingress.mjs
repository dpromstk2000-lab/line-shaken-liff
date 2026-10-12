import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCar02R102IsolatedIngress,R102_CONTRACT} from './car02-r102-early-ingress-isolated.mjs';
import {createR93YInProcessStorageFixture,createR93YIsolatedStorageProtocol} from './car02-r93y-qa-storage-http-fixture.mjs';
import {assertR102Environment,runR102Pg17} from './car02-r102-pg17-ingress-qa.mjs';
import {verifyR102Workflow} from './car02-r102-workflow-guard.mjs';
const DB='car02_r93q_qa_ci', ORIGIN='https://r102-fixture.invalid';
const URL=`${ORIGIN}/functions/v1/dpro-car02-stage/api/car02/uploads/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333`;
const make=({open=true,origins=[ORIGIN],fixtureConfig={}}={})=>{
 let auth=0,db=0,gate=0;
 const pool={connect:async()=>{db++;throw Error('UNEXPECTED_DB_CONNECTION')},
  query:async()=>{db++;throw Error('UNEXPECTED_DB_QUERY')}};
 const fixture=createR93YInProcessStorageFixture(fixtureConfig);
 const storage=createR93YIsolatedStorageProtocol({environment:'isolated_qa',dbName:DB,fixture});
 const props={environment:'isolated_qa',dbName:DB,shopCode:'street_house_kitsuki',pool,storage,
  origins,reviewGate:async()=>{gate++;return open},authenticate:async()=>{auth++;throw Error('SHOULD_NOT_AUTH')}};
 return {props,fixture,counts:()=>({auth,db,gate})};
};
const raw=new Uint8Array([255,216,255,224,21,22,23,24]);
const build=({url=URL,method='POST',headers={},body=raw}={})=>new Request(url,{method,headers:{origin:ORIGIN,
 authorization:'Bearer testing-fixture', 'idempotency-key':'88888888-8888-4888-8888-000000001102',
 'content-type':'image/jpeg',...headers},...(method==='POST'?{body,...(body instanceof ReadableStream?{duplex:'half'}:{})}:{})});
const requestProbe=()=>{
 let pulled=0;
 const stream=new ReadableStream({pull(c){pulled++;c.enqueue(new Uint8Array([255,216,255,224]));c.close()}});
 const request=build({body:stream});return {request,read:()=>pulled};
};
test('R102 strictly disposable in-process fixture and no production authorization',()=>{
 const a=make();const b=a.props;
 for(const delta of [{environment:'production'},{dbName:'postgres'},
  {storage:{kind:'external_live',testOnly:true,transport:'in_process_http_fixture'}}])
  assert.throws(()=>createCar02R102IsolatedIngress({...b,...delta}),/R102_DISPOSABLE_ONLY/);
 assert.equal(R102_CONTRACT.productionReady,false);assert.equal(R102_CONTRACT.noProductionDeploy,true);
 assert.equal(R102_CONTRACT.releaseDecision,'NO_GO');assert.equal(R102_CONTRACT.migrationDecision,'HOLD');
});
test('R102 origin allowlist rejects non-HTTPS, duplicates and malformed addresses',()=>{
 const p=make().props;
 for(const origins of [[],['http://r102-fixture.invalid'],[ORIGIN,ORIGIN],['https://r102-fixture.invalid/path'],['https://x.invalid?y=1']])
  assert.throws(()=>createCar02R102IsolatedIngress({...p,origins}));
});
test('R102 release lock blocks before stream, identity or database access',async()=>{
 const v=make({open:false}),h=createCar02R102IsolatedIngress(v.props),r=requestProbe();
 assert.equal((await h(r.request)).status,503);assert.equal(r.request.bodyUsed,false);assert.equal(v.counts().auth,0);
 assert.equal(v.counts().db,0);assert.equal(v.fixture.posts,0);
});
const rejects=[
 ['foreign_origin',{headers:{origin:'https://unapproved.invalid'}},403],
 ['unprefixed_path',{url:'https://r102-fixture.invalid/api/car02/uploads/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333'},404],
 ['shadow_path',{url:URL.replace('dpro-car02-stage','unrelated-stage')},404],
 ['query',{url:URL+'?shop=other'},404],
 ['invalid_token',{headers:{authorization:'bad'}},401],
 ['missing_key',{headers:{'idempotency-key':'not-a-uuid'}},400],
 ['tenant_header',{headers:{'x-shop-code':'other_shop'}},403],
 ['facility_header',{headers:{'x-facility-code':'test'}},403],
 ['line_token',{headers:{'x-line-id-token':'unverified'}},403],
 ['bad_mime',{headers:{'content-type':'text/html'}},415],
 ['compressed',{headers:{'content-encoding':'gzip'}},415],
 ['too_large',{headers:{'content-length':'5242881'}},413],
 ['bad_length',{headers:{'content-length':'5.5'}},400],
 ['conflicting_length',{headers:{'content-length':'9999999999999999999999999'}},400],
 ['business_path',{url:ORIGIN+'/functions/v1/dpro-car02-stage/api/car02'},404],
 ['invalid_method',{method:'DELETE'},405]
];
for(const [name,options,expected] of rejects)test('R102 early stream-free denial '+name,async()=>{
 const v=make(),h=createCar02R102IsolatedIngress(v.props),r=requestProbe();
 const req=build({...options,body:r.request.body});
 const res=await h(req);assert.equal(res.status,expected);
 assert.equal(req.bodyUsed,false,'BODY_CONSUMED_BEFORE_AUTH_'+name);assert.equal(v.counts().auth,0);
 assert.equal(v.counts().db,0);assert.equal(v.fixture.posts,0);
});
test('R102 unknown-length streaming oversize still rejected at downstream 5MiB cap',async()=>{
 const v=make(),h=createCar02R102IsolatedIngress(v.props);
 const oversized=new Uint8Array(5*1024*1024+1);
 const response=await h(build({body:oversized}));
 assert.equal(response.status,413);
 assert.equal(v.counts().auth,0);assert.equal(v.counts().db,0);assert.equal(v.fixture.posts,0);
});
test('R102 normal business route remains disconnected with zero side effects',async()=>{
 const v=make(),h=createCar02R102IsolatedIngress(v.props);
 const response=await h(build({url:ORIGIN+'/functions/v1/dpro-car02-stage/api/car02'}));
 assert.equal(response.status,404);assert.equal(v.counts().auth,0);
 assert.equal(v.counts().db,0);assert.equal(v.fixture.posts,0);
});
test('R102 OPTIONS permits only exact CORS preflight without touching body or DB',async()=>{
 const a=make(),h=createCar02R102IsolatedIngress(a.props);
 const good=build({method:'OPTIONS',headers:{'access-control-request-method':'POST',
  'access-control-request-headers':'Authorization, Content-Type, Idempotency-Key'}});
 const res=await h(good);assert.equal(res.status,204);
 assert.equal(res.headers.get('access-control-allow-origin'),ORIGIN);
 assert.equal((await h(build({method:'OPTIONS',headers:{'access-control-request-method':'POST',
  'access-control-request-headers':'authorization,content-type,idempotency-key,x-shop-code'}}))).status,403);
 assert.equal(a.counts().auth,0);assert.equal(a.counts().db,0);assert.equal(a.fixture.posts,0);
});
test('R102 no production API, live secrets, direct deletion or Worker deploy source',()=>{
 for(const file of ['car02-r102-early-ingress-isolated.mjs','car02-r102-pg17-ingress-qa.mjs']){
  const s=readFileSync(file,'utf8');
  assert.doesNotMatch(s,/SUPABASE_SERVICE_ROLE_KEY|CAR02_DATABASE_URL|wrangler\s+deploy|\.supabase\.co|\bfetch\s*\(/);
  assert.doesNotMatch(s,/\bdeleteObject\s*\(|\bDROP\s+DATABASE\b/);
 }
 assert.match(String(runR102Pg17),/R102_REJECTION_PERSISTED/);
});
test('R102 exact environment and manual safe workflow',()=>{
 const env={R102_DISPOSABLE_INGRESS_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',
  PGUSER:'postgres',PGPASSWORD:'disposable-r93s-ci-only',PGDATABASE:DB};
 assertR102Environment(env);
 for(const k of Object.keys(env))assert.throws(()=>assertR102Environment({...env,[k]:'wrong'}));
 const yaml=readFileSync('.github/workflows/car02-r102-early-ingress-qa.yml','utf8');
 assert.equal(verifyR102Workflow(yaml).ok,true);
 for(const modified of [yaml.replace('workflow_dispatch:','push:'),yaml.replace('postgres:17','postgres:16'),
  yaml.replace('contents: read','contents: write'),yaml+'\n# ${{ secrets.PRODUCTION }}',yaml+'\n# wrangler deploy'])
  assert.throws(()=>verifyR102Workflow(modified));
});
