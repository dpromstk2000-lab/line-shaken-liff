import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {CAR02_V441_RELEASE_LOCK,CAR02_V441_AUDIT_SQL,CAR02_V441_SUMMARY_SQL,createCar02OfflineManualReviewR441} from './car02-manual-review-ledger-r441.mjs';
const shop='qa_shop_a', other='qa_shop_b';
const reviewer1='00000000-0000-0000-0000-000000004411', reviewer2='00000000-0000-0000-0000-000000004412';
const event='00000000-0000-0000-0000-000000004401';
const digest=createHash('sha256').update('synthetic-evidence-with-no-private-info').digest('hex');
const denied=p=>assert.rejects(p,e=>e?.code==='CAR02_UNAUTHORIZED'&&e?.status===401);
const req=(second=false)=>new Request('https://car02.test/locked-review',{headers:{authorization:second?'Bearer synthetic-reviewer-two':'Bearer synthetic-auth-review'}});
function fixture({role='owner',active=true,badIdentity=false,throws=false,missing=false,status='manual_review',malformed=false}={}){
 const actions=[];const reviews=new Map();
 const store={query:async(sql,args)=>{
  actions.push({sql,args});if(throws)throw Error('sensitive internal database exception');
  if(sql===CAR02_V441_AUDIT_SQL){
   if(missing)throw Error('V441_MISSING_CASE');
   const [tenant,id,user,evidence,disposition]=args;
   if(tenant!==shop||id!==event||status!=='manual_review')throw Error('CASE_IS_NOT_IN_MANUAL_REVIEW');
   const k=`${tenant}:${id}:${user}`;const existed=reviews.has(k);
   if(!existed && reviews.size<2)reviews.set(k,{evidence,disposition});
   return {rows:[malformed?{stored:'yes',review_count:reviews.size}:{stored:!existed&&reviews.size<=2,review_count:reviews.size}]};
  }
  if(sql===CAR02_V441_SUMMARY_SQL){
   if(missing)return{rows:[]};
   return{rows:[{status,review_count:reviews.size}]};
  }
  throw Error('UNREVIEWED_SQL');
 }};
 const access=createCar02OfflineManualReviewR441({store,verifyReviewer:async({shopCode,request})=>({verified:!badIdentity,active,role,shopCode,userSub:request.headers.get('authorization')==='Bearer synthetic-reviewer-two'?reviewer2:reviewer1,authVersion:8})});
 return{access,actions,reviews};
}
const record=(f,actor,over={})=>f.access.recordReview({actor,shopCode:shop,eventId:event,evidenceSha256:digest,disposition:'investigated',...over});
test('release lock, exact parameterized SQL, no fallback when adapter absent',()=>{
 assert.equal(CAR02_V441_RELEASE_LOCK,true);
 assert.equal(CAR02_V441_AUDIT_SQL,'SELECT stored,review_count FROM public.v441_qa_record_review($1::text,$2::uuid,$3::uuid,$4::text,$5::text)');
 assert.match(CAR02_V441_SUMMARY_SQL,/^SELECT review_count,status FROM public\.v441_qa_review_summary/);
 assert.throws(()=>createCar02OfflineManualReviewR441(),/CAR02_V441_REVIEW_CONFIG_REQUIRED/);
});
test('verified owner on selected tenant may append hash-only review',async()=>{
 const f=fixture(),actor=await f.access.authenticateReviewer(req(),shop);const r=await record(f,actor);
 assert.deepEqual(r,{status:'recorded',reviewCount:1,eventId:event});
 assert.deepEqual(f.actions[0].args,[shop,event,reviewer1,digest,'investigated']);
 assert.equal(Object.isFrozen(actor),true);assert.equal(Object.isFrozen(r),true);
});
test('duplicate reviewer cannot create another record',async()=>{
 const f=fixture(),a=await f.access.authenticateReviewer(req(),shop);
 await record(f,a);assert.equal((await record(f,a)).status,'duplicate');assert.equal(f.reviews.size,1);
});
test('owner is required: staff and inactive identities denied',async()=>{
 for(const c of [{role:'staff'},{active:false},{badIdentity:true}]){
  const f=fixture(c);await denied(f.access.authenticateReviewer(req(),shop));assert.equal(f.actions.length,0);
 }
});
test('mixed LINE + staff request denied before review',async()=>{
 const f=fixture();await denied(f.access.authenticateReviewer(new Request('https://test',{headers:{'x-line-id-token':'synthetic-line','authorization':'Bearer token'}}),shop));
 assert.equal(f.actions.length,0);
});
test('wrong shop and forged actor refused before DB',async()=>{
 const f=fixture(),a=await f.access.authenticateReviewer(req(),shop);
 await denied(record(f,a,{shopCode:other}));await denied(record(f,{...a}));
 assert.equal(f.actions.length,0);
});
test('malformed or private cleartext evidence and unexpected dispositions rejected',async()=>{
 const f=fixture(),a=await f.access.authenticateReviewer(req(),shop);
 for(const x of [{evidenceSha256:'Customer phone 080-1234-5678'},{evidenceSha256:digest.toUpperCase()},{evidenceSha256:'0'.repeat(63)},
                 {disposition:'delivered'},{disposition:'requeue'},{disposition:'confirmed_not_sent'}])await denied(record(f,a,x));
 assert.equal(f.actions.length,0);
});
test('bad event ID and missing shop rejected before DB',async()=>{
 const f=fixture(),a=await f.access.authenticateReviewer(req(),shop);
 await denied(record(f,a,{eventId:'invalid'}));await denied(record(f,a,{shopCode:''}));assert.equal(f.actions.length,0);
});
test('DB error or unexpected row never returns success',async()=>{
 for(const c of [{throws:true},{malformed:true},{missing:true}]){
  const f=fixture(c),a=await f.access.authenticateReviewer(req(),shop);await denied(record(f,a));
 }
});
test('summary is only manual_review count and no payload or delivery status',async()=>{
 const f=fixture(),a=await f.access.authenticateReviewer(req(),shop);
 await record(f,a);const s=await f.access.summary({actor:a,shopCode:shop,eventId:event});
 assert.deepEqual(s,{status:'manual_review',reviewCount:1,eventId:event});
 assert.deepEqual(Object.keys(s).sort(),['eventId','reviewCount','status']);
});
test('summary rejects non-review and non-existent notifications',async()=>{
 for(const c of [{status:'delivered'},{missing:true}]){
  const f=fixture(c),a=await f.access.authenticateReviewer(req(),shop);
  await denied(f.access.summary({actor:a,shopCode:shop,eventId:event}));
 }
});
test('two distinct reviewer records do not infer external delivery',async()=>{
 const f=fixture(),a=await f.access.authenticateReviewer(req(),shop);
 await record(f,a);const b=await f.access.authenticateReviewer(req(true),shop);
 const second=await record(f,b,{disposition:'escalated'});
 assert.equal(second.reviewCount,2);assert.equal((await f.access.summary({actor:a,shopCode:shop,eventId:event})).status,'manual_review');
});
test('source entry release remains hard-locked and new review module is detached',()=>{
 const text=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
 assert.match(text,/CAR02_RELEASE_LOCK\s*=\s*true/);assert.doesNotMatch(text,/car02-manual-review-ledger-r441|v441_qa_/);
});
