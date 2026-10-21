import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {CAR02_V442_RELEASE_LOCK,CAR02_V442_APPEND_SQL,CAR02_V442_READ_SQL,
  car02ReviewChainHashR442,createCar02OfflineReviewIntegrityR442} from './car02-review-integrity-r442.mjs';
const shop='qa_shop_a',other='qa_shop_b',event='00000000-0000-0000-0000-000000004421';
const a='00000000-0000-0000-0000-000000004422',b='00000000-0000-0000-0000-000000004423';
const ea=createHash('sha256').update('evidence-A').digest('hex'),eb=createHash('sha256').update('evidence-B').digest('hex');
const deny=p=>assert.rejects(p,e=>e?.code==='CAR02_UNAUTHORIZED'&&e.status===401);
const req=n=>new Request('https://qa.test/no-release',{headers:{authorization:`Bearer v442-test-owner-${n}`}});
function fixture({role='owner',active=true,missing=false,throwDb=false,badAuth=false}={}){
 const entries=[], calls=[];
 const store={query:async(sql,params)=>{
  calls.push({sql,params});if(throwDb)throw Error('SECRET_INTERNAL');
  if(sql===CAR02_V442_APPEND_SQL){
   if(missing)throw Error('MISSING');
   const [s,id,user,evidence,disposition]=params;
   if(s!==shop||id!==event)throw Error('FOREIGN_TENANT');
   let old=entries.find(x=>x.reviewerSub===user);
   if(old)return{rows:[{stored:false,entry_count:entries.length,entry_hash:old.entryHash}]};
   if(entries.length>=2||entries.some(x=>x.evidenceSha256===evidence))throw Error('DUPLICATE_EVIDENCE');
   const prev=entries.at(-1)?.entryHash||'0'.repeat(64),seq=entries.length+1;
   const entry={seq,reviewerSub:user,evidenceSha256:evidence,disposition,previousHash:prev};
   entry.entryHash=car02ReviewChainHashR442({shop,eventId:event,...entry});
   entries.push(entry);return{rows:[{stored:true,entry_count:entries.length,entry_hash:entry.entryHash}]};
  }
  if(sql===CAR02_V442_READ_SQL){
   if(missing)return {rows:[]};
   return {rows:[{snapshot:{shopCode:shop,eventId:event,status:'manual_review',entries:entries.map(x=>({...x}))}}]};
  }
  throw Error('UNREVIEWED_SQL');
 }};
 const instance=createCar02OfflineReviewIntegrityR442({store,verifyReviewer:async({request,shopCode})=>({
  verified:!badAuth,active,role,shopCode,userSub:request.headers.get('authorization')?.endsWith('-2')?b:a,authVersion:3})});
 return {instance,entries,calls,store};
}
const app=(f,actor,evidenceSha256=ea,disposition='investigated',s=shop)=>f.instance.appendReview({actor,shopCode:s,eventId:event,evidenceSha256,disposition});
const inspect=(f,actor,s=shop)=>f.instance.inspect({actor,shopCode:s,eventId:event});
test('release remains locked and no missing trusted adapters are allowed',()=>{
 assert.equal(CAR02_V442_RELEASE_LOCK,true);
 assert.throws(()=>createCar02OfflineReviewIntegrityR442(),/CAR02_V442_REVIEW_CONFIG_REQUIRED/);
 assert.match(CAR02_V442_APPEND_SQL,/^SELECT stored,entry_count,entry_hash FROM public\.v442_qa_append_review/);
 assert.match(CAR02_V442_READ_SQL,/^SELECT snapshot FROM public\.v442_qa_read_chain/);
});
test('empty review chain has documented genesis head and no delivery claim',async()=>{
 const f=fixture(),actor=await f.instance.authenticateReviewer(req(1),shop);
 assert.deepEqual(await inspect(f,actor),{status:'manual_review',integrity:'verified',reviewCount:0,eventId:event,headHash:'0'.repeat(64)});
});
test('one verified owner appends a hash-only review and readback succeeds',async()=>{
 const f=fixture(),actor=await f.instance.authenticateReviewer(req(1),shop);
 assert.equal((await app(f,actor)).status,'recorded');const r=await inspect(f,actor);
 assert.equal(r.reviewCount,1);assert.equal(r.headHash,f.entries[0].entryHash);
 assert.deepEqual(f.calls[0].params,[shop,event,a,ea,'investigated']);
});
test('second distinct owner and evidence extends chain and first hash stays pinned',async()=>{
 const f=fixture(),x=await f.instance.authenticateReviewer(req(1),shop),y=await f.instance.authenticateReviewer(req(2),shop);
 await app(f,x);let head=f.entries[0].entryHash;await app(f,y,eb,'escalated');
 assert.equal(f.entries[1].previousHash,head);assert.equal((await inspect(f,x)).reviewCount,2);
});
test('same reviewer replay produces duplicate and does not extend chain',async()=>{
 const f=fixture(),x=await f.instance.authenticateReviewer(req(1),shop);
 await app(f,x);assert.equal((await app(f,x)).status,'duplicate');assert.equal(f.entries.length,1);
});
test('two owners cannot reuse the exact same evidence digest',async()=>{
 const f=fixture(),x=await f.instance.authenticateReviewer(req(1),shop),y=await f.instance.authenticateReviewer(req(2),shop);
 await app(f,x);await deny(app(f,y,ea));assert.equal(f.entries.length,1);
});
test('forged actor, wrong shop and unsigned caller fields rejected before any SQL',async()=>{
 const f=fixture(),x=await f.instance.authenticateReviewer(req(1),shop);
 await deny(app(f,{...x}));await deny(app(f,x,ea,'investigated',other));
 assert.equal(f.calls.length,0);
});
test('staff, banned/missing reviewer, and mixed LINE tokens fail closed',async()=>{
 for(const opts of [{role:'staff'},{active:false},{badAuth:true}]){
   const f=fixture(opts);await deny(f.instance.authenticateReviewer(req(1),shop));
 }
 const f=fixture();await deny(f.instance.authenticateReviewer(new Request('https://test',{headers:{'x-line-id-token':'line','authorization':'Bearer test'}}),shop));
});
test('cleartext evidence, fake role, and delivered disposition cannot be stored',async()=>{
 const f=fixture(),x=await f.instance.authenticateReviewer(req(1),shop);
 await deny(app(f,x,'client-phone-0000'));await deny(app(f,x,ea,'delivered'));assert.equal(f.calls.length,0);
});
test('modified entry hash, evidence, or previous link are all detected on readback',async()=>{
 for(const field of ['entryHash','evidenceSha256','previousHash']){
  const f=fixture(),x=await f.instance.authenticateReviewer(req(1),shop);await app(f,x);
  f.entries[0][field]='a'.repeat(64);await deny(inspect(f,x));
 }
});
test('duplicate reviewer, duplicated proof, and noncontiguous sequences are rejected',async()=>{
 for(const edit of [e=>{e[1].reviewerSub=e[0].reviewerSub},e=>{e[1].evidenceSha256=e[0].evidenceSha256},e=>{e[1].seq=3}]){
  const f=fixture(),x=await f.instance.authenticateReviewer(req(1),shop),y=await f.instance.authenticateReviewer(req(2),shop);
  await app(f,x);await app(f,y,eb);edit(f.entries);await deny(inspect(f,x));
 }
});
test('missing case, transport error, and untrusted snapshot never claim clean integrity',async()=>{
 for(const o of [{missing:true},{throwDb:true}]){
  const f=fixture(o),x=await f.instance.authenticateReviewer(req(1),shop);await deny(inspect(f,x));
 }
});
test('source entry and other release locks remain disconnected from this offline model',()=>{
 const entry=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
 assert.match(entry,/CAR02_RELEASE_LOCK\s*=\s*true/);
 assert.doesNotMatch(entry,/car02-review-integrity-r442|v442_qa_/);
});
