import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CAR02_V455_RELEASE_LOCK,CAR02_V455_REVIEW_SQL,createCar02OfflineDualReviewR455} from './car02-manual-review-dual-control-r455.mjs';
const shop='qa_shop_a',event='00000000-0000-0000-0000-000000004533';
const investigator='00000000-0000-0000-0000-000000004551';
const supervisor='00000000-0000-0000-0000-000000004552';
const ev1='a'.repeat(64),ev2='b'.repeat(64);
const denied=p=>assert.rejects(p,e=>e?.code==='CAR02_REVIEW_UNAUTHORIZED'&&e.status===401);
function setup({shopCode=shop,verified=true,mode='isolated_qa',reviewRole='investigator',userSub=null,
  quarantined=true,dbThrows=false,returnRows=null,missingSource=false,reviewerActive=true,
  otherCase=false}={}){
 let role=reviewRole, actor=userSub??(role==='supervisor'?supervisor:investigator);
 let caseRow=null;const audit=[],calls=[];
 const store={query:async(sql,params)=>{
  calls.push({sql,params});if(dbThrows)throw Error('secret database error');
  if(sql!==CAR02_V455_REVIEW_SQL)throw Error('UNTRUSTED_SQL');
  if(returnRows!==null)return{rows:returnRows};
  const [tenant,id,who,action,evidence]=params;
  if(missingSource||!quarantined||tenant!==shop||id!==event||!reviewerActive||otherCase)return{rows:[]};
  if(action==='investigate'&&role==='investigator'&&who===investigator&&caseRow===null){
   caseRow={state:'awaiting_independent_signoff',investigator:who,investigatorEvidence:evidence};
   audit.push({seq:1,reviewer:who});
   return{rows:[{stage:caseRow.state,case_id:event}]};
  }
  if(action==='close_no_delivery_claim'&&role==='supervisor'&&who===supervisor&&caseRow&&
     caseRow.state==='awaiting_independent_signoff'&&caseRow.investigator!==who&&
     caseRow.investigatorEvidence!==evidence){
   caseRow.state='closed_without_delivery_assertion';audit.push({seq:2,reviewer:who});
   return{rows:[{stage:caseRow.state,case_id:event}]};
  }
  return{rows:[]};
 }};
 const api=createCar02OfflineDualReviewR455({store,authorizeReviewer:async()=>({
  verified,mode,shopCode,reviewRole:role,userSub:actor})});
 return{api,calls,audit,get caseRow(){return caseRow},set role(v){role=v},set userSub(v){actor=v}};
}
const submit=(f,evidenceSha256=ev1,eventId=event,request={})=>f.api.submit({request,eventId,evidenceSha256});
test('release lock, one fixed SQL and required trusted adapter',()=>{
 assert.equal(CAR02_V455_RELEASE_LOCK,true);
 assert.equal(CAR02_V455_REVIEW_SQL,'SELECT stage,case_id FROM v455_private.qa_review_attest($1::text,$2::uuid,$3::uuid,$4::text,$5::text)');
 assert.throws(()=>createCar02OfflineDualReviewR455(),/OFFLINE_SERVER_ADAPTER_REQUIRED/);
});
test('verified investigator opens a quarantined manual case',async()=>{
 const f=setup(),r=await submit(f);
 assert.deepEqual(r,{status:'awaiting_independent_signoff'});assert.ok(Object.isFrozen(r));
 assert.deepEqual(f.calls[0].params,[shop,event,investigator,'investigate',ev1]);
 assert.equal(f.audit.length,1);
});
test('independent supervisor signs off and never marks delivery',async()=>{
 const f=setup();await submit(f);f.role='supervisor';f.userSub=supervisor;
 assert.deepEqual(await submit(f,ev2),{status:'closed_without_delivery_assertion'});
 assert.equal(f.audit.length,2);assert.deepEqual(Object.keys(f.caseRow),['state','investigator','investigatorEvidence']);
 assert.equal(f.api.dispatch,undefined);
});
test('supervisor cannot sign before an investigator',async()=>{
 const f=setup({reviewRole:'supervisor'});
 assert.deepEqual(await submit(f,ev2),{status:'indeterminate'});assert.equal(f.audit.length,0);
});
test('duplicate investigation never creates two audit rows',async()=>{
 const f=setup();await submit(f);
 assert.equal((await submit(f)).status,'indeterminate');assert.equal(f.audit.length,1);
});
test('double supervisor signoff rejected',async()=>{
 const f=setup();await submit(f);f.role='supervisor';f.userSub=supervisor;
 await submit(f,ev2);assert.equal((await submit(f,ev2)).status,'indeterminate');
 assert.equal(f.audit.length,2);
});
test('same evidence cannot represent independent investigation and signoff',async()=>{
 const f=setup();await submit(f);f.role='supervisor';f.userSub=supervisor;
 assert.equal((await submit(f,ev1)).status,'indeterminate');assert.equal(f.audit.length,1);
});
test('same actor cannot self signoff even when claiming supervisor role',async()=>{
 const f=setup();await submit(f);f.role='supervisor';
 assert.equal((await submit(f,ev2)).status,'indeterminate');
});
test('only server-verified role decides phase not user-supplied action',async()=>{
 const f=setup();await f.api.submit({request:{reviewRole:'supervisor',shopCode:'qa_shop_b'},
  eventId:event,evidenceSha256:ev1,action:'close_no_delivery_claim',role:'supervisor'});
 assert.equal(f.calls[0].params[3],'investigate');
});
test('cross-shop review cannot open another shop case',async()=>{
 const f=setup({shopCode:'qa_shop_b'});assert.equal((await submit(f)).status,'indeterminate');
});
test('non-quarantined V454 claim denied',async()=>{
 for(const v of [{quarantined:false},{missingSource:true},{otherCase:true}]){
  const f=setup(v);assert.equal((await submit(f)).status,'indeterminate');
 }
});
test('revoked review roster fails closed',async()=>{
 const f=setup({reviewerActive:false});assert.equal((await submit(f)).status,'indeterminate');
});
test('invalid worker identity, unauthorized role or non-isolated mode rejected before SQL',async()=>{
 for(const v of [{verified:false},{mode:'production'},{reviewRole:'dispatcher'},
 {reviewRole:'owner'},{shopCode:'../../evil'},{userSub:'not-a-uuid'}]){
  const f=setup(v);await denied(submit(f));assert.equal(f.calls.length,0);
 }
});
test('malformed and zero hash evidence refused before SQL',async()=>{
 for(const x of ['','A'.repeat(64),'0'.repeat(64),'a'.repeat(63),'x'.repeat(64)]){
  const f=setup();await denied(submit(f,x));assert.equal(f.calls.length,0);
 }
});
test('untrusted event ID rejected before DB',async()=>{
 const f=setup();await denied(submit(f,ev1,'bad'));assert.equal(f.calls.length,0);
});
test('bad or duplicated DB result rows cannot claim closure',async()=>{
 for(const rows of [[],[{stage:'delivered',case_id:event}],
 [{stage:'awaiting_independent_signoff',case_id:'00000000-0000-0000-0000-000000004999'}],
 [{stage:'awaiting_independent_signoff',case_id:event},{stage:'awaiting_independent_signoff',case_id:event}]]){
  const f=setup({returnRows:rows});assert.equal((await submit(f)).status,'indeterminate');
 }
});
test('database read/write error never causes auto retry',async()=>{
 const f=setup({dbThrows:true});assert.equal((await submit(f)).status,'indeterminate');assert.equal(f.calls.length,1);
});
test('response never leaks reviewer identifiers, evidence or claim token',async()=>{
 const f=setup();const r=await submit(f);const text=JSON.stringify(r);
 assert.equal(text.includes(investigator),false);assert.equal(text.includes(ev1),false);assert.deepEqual(Object.keys(r),['status']);
});
test('r454 SQL correction uses unambiguous constraint name and all release locks intact',()=>{
 const fix=readFileSync(new URL('./car02-v454-disposable-pg17.sql',import.meta.url),'utf8');
 assert.match(fix,/ON CONFLICT ON CONSTRAINT qa_claims_pkey DO NOTHING/);
 assert.doesNotMatch(fix,/ON CONFLICT\(shop_code,event_id\) DO NOTHING/);
 const original=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
 assert.match(original,/const\s+CAR02_RELEASE_LOCK\s*=\s*true/);
 assert.doesNotMatch(original,/manual-review-dual-control-r455|v455_private/);
 for(const p of ['car02-outbox-claim-r454.mjs','car02-atomic-job-outbox-r453.mjs']){
  assert.match(readFileSync(new URL('./'+p,import.meta.url),'utf8'),/RELEASE_LOCK\s*=\s*true/);
 }
});
test('manual closure cannot emit delivery success or open automatic resend methods',()=>{
 const f=setup();assert.equal(f.api.send,undefined);assert.equal(f.api.retry,undefined);
 assert.equal(f.api.markDelivered,undefined);assert.equal(typeof f.api.submit,'function');
});
