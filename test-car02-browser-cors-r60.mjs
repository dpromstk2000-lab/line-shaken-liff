import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  CAR02_R60_EXPECTED_ORIGIN,CAR02_R60_EXPECTED_PATH,CAR02_R60_STAGE_BASE,
  CAR02_R60_CHECKS,isCar02R60TrustedPage,runCar02BrowserCorsR60
} from './car02-browser-cors-r60.mjs';

const locationLike={origin:CAR02_R60_EXPECTED_ORIGIN,protocol:'https:',pathname:CAR02_R60_EXPECTED_PATH,search:'',hash:''};
const invalid=(patch={})=>({...locationLike,...patch});
const health={ok:true,service:'DPRO CAR02 isolated staging gateway',deployment:'review-only',live:false};
const locked={ok:false,code:'CAR02_NOT_RELEASED'};
const stub=(audit=[])=>async(url,options)=>{
 audit.push({url,options});
 const isHealth=url.endsWith('/health');
 return new Response(JSON.stringify(isHealth?health:locked),{status:isHealth?200:503,headers:{'Content-Type':'application/json; charset=utf-8'}});
};

test('R60 runs ONLY from intended HTTPS GitHub Pages path',()=>{
 assert.equal(isCar02R60TrustedPage(locationLike),true);
 for(const variant of [invalid({origin:'https://evil.example'}),invalid({origin:'http://dpromstk2000-lab.github.io'}),invalid({pathname:'/line-shaken-liff/index.html'}),invalid({search:'?release=1'}),invalid({hash:'#bypass'}),invalid({protocol:'file:',origin:'null'})]) assert.equal(isCar02R60TrustedPage(variant),false);
});
test('R60 wrong page fails closed before any network I/O',async()=>{
 const calls=[];const r=await runCar02BrowserCorsR60({locationLike:invalid({origin:'https://bad.example'}),fetchImpl:stub(calls)});
 assert.equal(r.ok,false);assert.equal(r.blocked,true);assert.equal(r.networkCalls,0);assert.equal(calls.length,0);
});
test('R60 defines exactly four GET-only diagnostics',()=>{
 assert.deepEqual(CAR02_R60_CHECKS.map(x=>x.id),['health','locked','preflight','photo']);
 assert.equal(CAR02_R60_STAGE_BASE,'https://cbknucemarcpbscirzyv.supabase.co/functions/v1/dpro-car02-stage');
});
test('R60 normal read-only responses all pass',async()=>{
 const calls=[];const r=await runCar02BrowserCorsR60({locationLike,fetchImpl:stub(calls)});
 assert.equal(r.ok,true);assert.equal(r.networkCalls,4);assert.equal(r.checks.filter(x=>x.ok).length,4);
 assert.equal(calls.length,4);
});
test('R60 no cookies, no credentials, no writes, no redirects and referrers',async()=>{
 const calls=[];await runCar02BrowserCorsR60({locationLike,fetchImpl:stub(calls)});
 for(const {url,options} of calls){assert.ok(url.startsWith(CAR02_R60_STAGE_BASE));assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');assert.equal(options.mode,'cors');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');assert.equal('body' in options,false)}
});
test('R60 preflight case uses JSON Content-Type without sending POST',async()=>{
 const calls=[];await runCar02BrowserCorsR60({locationLike,fetchImpl:stub(calls)});
 assert.equal(calls[2].options.method,'GET');assert.equal(calls[2].options.headers['Content-Type'],'application/json');
});
test('R60 unexpected unlocked API response fails',async()=>{
 const fetchImpl=async(url,options)=>url.endsWith('/api/car02')?new Response(JSON.stringify({ok:true}),{status:200,headers:{'Content-Type':'application/json'}}):stub()(url,options);
 const r=await runCar02BrowserCorsR60({locationLike,fetchImpl});assert.equal(r.ok,false);assert.equal(r.checks.some(x=>x.code==='R60_UNEXPECTED_RESPONSE'),true);
});
test('R60 health live:true fails review-only safety gate',async()=>{
 const f=async(url,options)=>url.endsWith('/health')?new Response(JSON.stringify({...health,live:true}),{status:200,headers:{'Content-Type':'application/json'}}):stub()(url,options);
 const r=await runCar02BrowserCorsR60({locationLike,fetchImpl:f});assert.equal(r.ok,false);assert.equal(r.checks[0].ok,false);
});
test('R60 non-JSON HTTP response fails without exposing body',async()=>{
 const f=async()=>new Response('<html>failure</html>',{status:503,headers:{'Content-Type':'text/html'}});
 const r=await runCar02BrowserCorsR60({locationLike,fetchImpl:f});assert.equal(r.ok,false);assert.ok(r.checks.every(x=>x.code==='R60_NOT_JSON'));assert.ok(!JSON.stringify(r).includes('failure</html>'));
});
test('R60 CORS/network errors become safe failed results',async()=>{
 const r=await runCar02BrowserCorsR60({locationLike,fetchImpl:async()=>{throw Error('secret that must never surface')}});
 assert.equal(r.ok,false);assert.equal(r.networkCalls,4);assert.ok(r.checks.every(x=>x.code==='R60_NETWORK_OR_CORS_FAILED'));assert.ok(!JSON.stringify(r).includes('secret'));
});
test('R60 HTML is responsive and noindexed, imports module, does not store credentials',()=>{
 const html=readFileSync(new URL('./CAR02_R60_BROWSER_CORS_QA.html',import.meta.url),'utf8');
 assert.match(html,/<meta name="viewport"/);
 assert.match(html,/name="robots" content="noindex,nofollow,noarchive"/);
 assert.match(html,/from '\.\/car02-browser-cors-r60\.mjs'/);
 assert.match(html,/overflow-x:hidden/);
 assert.doesNotMatch(html,/localStorage|sessionStorage|service[_-]role|type="password"|fetch\([^)]*,\s*\{\s*method:\s*['"]POST/);
});
