import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {r62TrustedPage,checkCar02R62Stage,CAR02_R62_STAGE} from './car02-stage-status-r62.mjs';
const origin='https://dpromstk2000-lab.github.io';
const safePage={protocol:'https:',origin,pathname:'/line-shaken-liff/CAR02_R62_WORKFLOW_REVIEW.html',search:'',hash:''};
const html=fs.readFileSync(new URL('./CAR02_R62_WORKFLOW_REVIEW.html',import.meta.url),'utf8');
const health={ok:true,service:'DPRO CAR02 isolated staging gateway',deployment:'review-only',live:false};
const closed={ok:false,code:'CAR02_NOT_RELEASED'};
const reply=(data,status)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
test('R62 only trusts the exact GitHub Pages URL',()=>{
 assert.equal(r62TrustedPage(safePage),true);
 for(const bad of [{...safePage,protocol:'http:'},{...safePage,origin:'https://wrong.test'},{...safePage,pathname:'/line-shaken-liff/CAR02_R61_WORKFLOW_REVIEW.html'},{...safePage,hash:'#x'},{...safePage,search:'?mode=live'}])assert.equal(r62TrustedPage(bad),false);
});
test('R62 locked stage uses two GET requests without credentials or writes',async()=>{
 const calls=[];
 const out=await checkCar02R62Stage({locationLike:safePage,fetchImpl:async(url,opt)=>{
 calls.push({url,method:opt.method,credentials:opt.credentials});
 assert.equal(opt.method,'GET');assert.equal(opt.credentials,'omit');
 assert.equal(opt.body,undefined);return url.endsWith('/health')?reply(health,200):reply(closed,503);
 }});
 assert.deepEqual(out,{ok:true,locked:true,code:'R62_REVIEW_ONLY_LOCKED',networkCalls:2});
 assert.equal(calls.length,2);assert(calls.every(x=>x.url.startsWith(CAR02_R62_STAGE)));
});
test('R62 rejects wrong origins without I/O',async()=>{
 let calls=0;const out=await checkCar02R62Stage({locationLike:{...safePage,pathname:'/untrusted'},fetchImpl:async()=>{calls++;throw Error('bad')}});
 assert.equal(out.ok,false);assert.equal(calls,0);
});
test('R62 refuses unhealthy stage without touching API',async()=>{
 let calls=0;const r=await checkCar02R62Stage({locationLike:safePage,fetchImpl:async()=>{calls++;return reply({...health,live:true},200)}});
 assert.equal(r.locked,false);assert.equal(calls,1);
});
test('R62 refuses unlocked API',async()=>{
 const r=await checkCar02R62Stage({locationLike:safePage,fetchImpl:async(url)=>url.endsWith('/health')?reply(health,200):reply({ok:true},200)});
 assert.equal(r.locked,false);assert.equal(r.code,'R62_LOCK_FAILED');
});
test('R62 keeps mock, noindex, new stage bridge, server release not toggled',()=>{
 assert.match(html,/name="robots" content="noindex,nofollow"/);
 assert.match(html,/car02-stage-status-r62\.mjs/);
 assert.match(html,/checkCar02R62Stage/);
 assert.match(html,/https:\/\/car02-stage\.invalid\//);
 assert.doesNotMatch(html,/CAR02_RELEASE_LOCK\s*=\s*false/);
 assert.doesNotMatch(html,/<input[^>]*password/i);
});
test('R62 guides empty decline instead of leaking backend error code',()=>{
 assert.match(html,/見送る理由を1～2000文字で入力してください/);
 assert.match(html,/guide\(\$\('declineReason'\)/);
});
test('R62 rejects invalid price before mock API',()=>{
 assert.match(html,/quotePrice\(\)/);
 assert.match(html,/金額は0円以上1億円以下の整数/);
});
test('R62 keeps required confirmation and full workflow',()=>{
 for(const id of ['saveReport','presentQuote','approve','decline','finish','reset','staffTab','customerTab'])assert.match(html,new RegExp(`id="${id}"`));
 assert.match(html,/confirm\('追加見積を承認する操作/);
});
