import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reviewCar02QuoteR64,quoteApprovalKeyR64,R64_REVIEW_MAX_ITEMS} from './car02-quote-review-r64.mjs';
const item=(name='部品代',price=1001)=>({name,price});
const quote=(items=[item(),item('工賃',999)])=>({revision:3,items,subtotal:2000,tax:200,total:2200});
test('R64 itemized quote checks subtotal/tax/total',()=>{
  assert.deepEqual(reviewCar02QuoteR64(quote()),{ok:true,revision:3,items:[item(),item('工賃',999)],subtotal:2000,tax:200,total:2200});
});
test('R64 partial yen tax calculated once across lines',()=>{
  const q={revision:1,items:[item('a',1001),item('b',55)],subtotal:1056,tax:105,total:1161};
  assert.equal(reviewCar02QuoteR64(q).total,1161);
});
test('R64 fails closed on tampered tax, total, subtotal',()=>{
  for(const k of ['subtotal','tax','total']){const q=quote();q[k]++;assert.equal(reviewCar02QuoteR64(q).ok,false,k)}
});
test('R64 rejects tampered invalid revision',()=>{for(const x of [0,-1,'3',1.2,null,NaN]){const q=quote();q.revision=x;assert.equal(reviewCar02QuoteR64(q).ok,false)}});
test('R64 rejects empty and more than ten items',()=>{assert.equal(R64_REVIEW_MAX_ITEMS,10);for(const x of [[],Array(11).fill(item())]){const q=quote();q.items=x;assert.equal(reviewCar02QuoteR64(q).ok,false)}});
test('R64 accepts ten rows with integer totals',()=>{const q={revision:4,items:Array(10).fill(item('無償確認',0)),subtotal:0,tax:0,total:0};assert.equal(reviewCar02QuoteR64(q).ok,true)});
test('R64 rejects malformed item names, unsafe price, non integer money',()=>{
 for(const x of [null,'abc',0,1.5,-1,100000001,Infinity]){const q=quote();q.items=[{name:'部品',price:x}];assert.equal(reviewCar02QuoteR64(q).ok,false)}
 for(const x of ['', ' ', 'x'.repeat(161), null]){const q=quote();q.items=[{name:x,price:100}];assert.equal(reviewCar02QuoteR64(q).ok,false)}
});
test('R64 unknown quote and wrong structures fail closed',()=>{for(const x of [null,undefined,{},[],false,'x'])assert.equal(reviewCar02QuoteR64(x).ok,false)});
test('R64 approval key binds version, revision, items, total',()=>{
 const q=quote();const key=quoteApprovalKeyR64(q,2);
 assert.equal(typeof key,'string');assert.notEqual(key,quoteApprovalKeyR64(q,3));
 const q2=quote();q2.revision=4;assert.notEqual(key,quoteApprovalKeyR64(q2,2));
 const q3=quote();q3.items[0].name='変更';assert.notEqual(key,quoteApprovalKeyR64(q3,2));
});
test('R64 approval key requires valid state and version',()=>{
 const q=quote();for(const x of [null,0,-1,'2',2.5])assert.equal(quoteApprovalKeyR64(q,x),null);
 const bad=quote();bad.total=123;assert.equal(quoteApprovalKeyR64(bad,2),null);
});
test('R64 customer review UI includes acknowledgement and demo-only safety',()=>{
 const s=readFileSync(new URL('./CAR02_R64_WORKFLOW_REVIEW.html',import.meta.url),'utf8');
 assert.match(s,/car02-stage-status-r64\.mjs/);
 assert.match(s,/import \{reviewCar02QuoteR64,quoteApprovalKeyR64\} from '\.\/car02-quote-review-r64\.mjs'/);
 assert.match(s,/id="quoteAcknowledged"/);
 assert.match(s,/customerSubtotal/);
 assert.match(s,/customerTax/);
 assert.match(s,/renderedReviewKey|shownQuoteKey/);
 assert.match(s,/明細・税込合計を確認/);
 assert.match(s,/role!=='customer'/);
 assert.match(s,/noindex,nofollow/);
 assert.match(s,/実際の顧客・車両情報は入力しないでください/);
 assert.doesNotMatch(s,/localStorage\s*\.|sessionStorage\s*\.|indexedDB\s*\./i);
});
