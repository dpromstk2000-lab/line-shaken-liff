import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CAR02_R61_ORIGIN,CAR02_R61_PATH,CAR02_R61_STAGE,r61TrustedPage,checkCar02R61Stage} from './car02-stage-status-r61.mjs';
const page=new URL(CAR02_R61_ORIGIN+CAR02_R61_PATH);
const HEALTH={ok:true,service:'DPRO CAR02 isolated staging gateway',deployment:'review-only',live:false};
const LOCKED={ok:false,code:'CAR02_NOT_RELEASED'};
const respond=(status,obj,headers={'Content-Type':'application/json; charset=utf-8'})=>new Response(JSON.stringify(obj),{status,headers});
function mock(health=HEALTH,locked=LOCKED){
  const calls=[];
  const fetchImpl=async (url,options)=>{
    calls.push({url,options});
    if(url===CAR02_R61_STAGE+'/health')return respond(200,health);
    if(url===CAR02_R61_STAGE+'/api/car02')return respond(503,locked);
    throw Error('unexpected endpoint');
  };
  return {calls,fetchImpl};
}
test('R61 requires exact HTTPS published GitHub Pages URL',()=>{
  assert.equal(r61TrustedPage(page),true);
  for(const url of ['http://dpromstk2000-lab.github.io'+CAR02_R61_PATH,
    CAR02_R61_ORIGIN+CAR02_R61_PATH+'?release=1',
    'https://dpromstk2000-lab.github.io.evil.invalid'+CAR02_R61_PATH,
    'file:///tmp/CAR02_R61_WORKFLOW_REVIEW.html',
    'https://dpromstk2000-lab.github.io/line-shaken-liff/CAR02_R49_UI_REVIEW.html',
    CAR02_R61_ORIGIN+CAR02_R61_PATH+'#hash',
    'https://other.example'+CAR02_R61_PATH])assert.equal(r61TrustedPage(new URL(url)),false,url);
});
test('R61 always starts locked with no network from wrong origin',async()=>{
  const m=mock();const r=await checkCar02R61Stage({locationLike:new URL('https://evil.example/'+CAR02_R61_PATH),fetchImpl:m.fetchImpl});
  assert.deepEqual(r,{ok:false,locked:false,code:'R61_UNTRUSTED_PAGE',networkCalls:0});assert.equal(m.calls.length,0);
});
test('R61 fails closed if browser fetch unavailable',async()=>{
  const r=await checkCar02R61Stage({locationLike:page,fetchImpl:null});
  assert.equal(r.ok,false);assert.equal(r.networkCalls,0);
});
test('R61 success verifies health and API lock with exactly two GET requests',async()=>{
  const m=mock();const r=await checkCar02R61Stage({locationLike:page,fetchImpl:m.fetchImpl});
  assert.deepEqual(r,{ok:true,locked:true,code:'R61_REVIEW_ONLY_LOCKED',networkCalls:2});
  assert.deepEqual(m.calls.map(x=>x.url),[CAR02_R61_STAGE+'/health',CAR02_R61_STAGE+'/api/car02']);
  for(const {options} of m.calls){
    assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');assert.equal(options.mode,'cors');
    assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');
    assert.equal(options.body,undefined);assert.equal(options.headers.Accept,'application/json');
    assert.ok(options.signal);
  }
});
test('R61 refuses health live=true and never calls API',async()=>{
  const m=mock({...HEALTH,live:true});const r=await checkCar02R61Stage({locationLike:page,fetchImpl:m.fetchImpl});
  assert.equal(r.code,'R61_HEALTH_FAILED');assert.equal(m.calls.length,1);
});
test('R61 refuses extra health response data',async()=>{
  const m=mock({...HEALTH,secret:'must-not-display'});const r=await checkCar02R61Stage({locationLike:page,fetchImpl:m.fetchImpl});
  assert.equal(r.ok,false);assert.equal(m.calls.length,1);
});
test('R61 refuses unlocked API even with HTTP 503',async()=>{
  const m=mock(HEALTH,{ok:true,code:'CAR02_NOT_RELEASED'});const r=await checkCar02R61Stage({locationLike:page,fetchImpl:m.fetchImpl});
  assert.equal(r.code,'R61_LOCK_FAILED');assert.equal(m.calls.length,2);
});
test('R61 refuses API response HTTP 200 with locked body',async()=>{
  const m=mock();m.fetchImpl=async (url,options)=>{m.calls.push({url,options});return url.endsWith('/health')?respond(200,HEALTH):respond(200,LOCKED)};
  const r=await checkCar02R61Stage({locationLike:page,fetchImpl:m.fetchImpl});assert.equal(r.code,'R61_LOCK_FAILED');
});
test('R61 refuses non-JSON',async()=>{
  const fetchImpl=async()=>new Response('OK',{status:200,headers:{'Content-Type':'text/html'}});
  assert.equal((await checkCar02R61Stage({locationLike:page,fetchImpl})).code,'R61_HEALTH_FAILED');
});
test('R61 rejects malformed response JSON',async()=>{
  const fetchImpl=async()=>new Response('{not-json',{status:200,headers:{'Content-Type':'application/json'}});
  assert.equal((await checkCar02R61Stage({locationLike:page,fetchImpl})).ok,false);
});
test('R61 rejects unexpected oversized body before processing',async()=>{
  const fetchImpl=async()=>new Response('x'.repeat(3000),{status:200,headers:{'Content-Type':'application/json'}});
  assert.equal((await checkCar02R61Stage({locationLike:page,fetchImpl})).code,'R61_HEALTH_FAILED');
});
test('R61 hides network errors and fails closed',async()=>{
  const fetchImpl=async()=>{throw Error('private password should never appear')};
  const r=await checkCar02R61Stage({locationLike:page,fetchImpl});
  assert.equal(r.code,'R61_HEALTH_FAILED');assert.equal(JSON.stringify(r).includes('private password'),false);
});
test('R61 HTML keeps all R49 demo interactions and labels them mock-only',()=>{
  const html=fs.readFileSync(new URL('./CAR02_R61_WORKFLOW_REVIEW.html',import.meta.url),'utf8');
  for(const marker of ['id="staffTab"','id="customerTab"','id="saveReport"','id="presentQuote"','id="approve"','id="decline"','id="finish"','id="reset"','id="checkStageR61"',"from './car02-stage-status-r61.mjs'",'実データは入力しないでください'])assert.ok(html.includes(marker),marker);
  assert.match(html,/<meta name="robots" content="noindex,nofollow">/);
  assert.match(html,/<meta name="referrer" content="no-referrer">/);
});
test('R61 HTML contains no live release switch or authentication input',()=>{
 const html=fs.readFileSync(new URL('./CAR02_R61_WORKFLOW_REVIEW.html',import.meta.url),'utf8');
 assert.doesNotMatch(html,/id="(?:password|lineToken|supabaseKey)"/i);
 assert.doesNotMatch(html,/CAR02_RELEASE_LOCK\s*=\s*false/);
 assert.ok(html.includes('この欄の確認ボタンだけ'));
});
