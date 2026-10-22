import test from 'node:test';
import assert from 'node:assert/strict';
import {createCar02OfflineLineRetryReviewR470,CAR02_V470_RETRY_WINDOW_MS,CAR02_V470_RELEASE_LOCK} from './car02-line-retry-review-r470.mjs';
const shop='qa_shop_a',event='00000000-0000-0000-0000-000000004701',attemptId='00000000-0000-0000-0000-000000004702';
const retryKey='00000000-0000-0000-0000-000000004703';
const now=1800000000000,body='b'.repeat(64),recipient='a'.repeat(64);
function make({operator={},isolated={},stored={},response={},eventId=event,clock=now,throws='',readOverride}={}){
 const reads=[];
 const attempt={shopCode:shop,eventId:event,attemptId,endpoint:'push',retryKey,bodySha256:body,recipientSha256:recipient,
   retryKeyIssuedAtMs:now-4000,firstAttemptAtMs:now-3000,...stored};
 const observation={kind:'response',status:200,retryKey,bodySha256:body,recipientSha256:recipient,
   observedAtMs:now-2000,acceptedRequestId:null,...response};
 const h=createCar02OfflineLineRetryReviewR470({
  authorizeAuditor:async()=>{if(throws==='authorize')throw Error('no');return{verified:true,mode:'isolated_qa',role:'line_retry_auditor',shopCode:shop,...operator}},
  inspectIsolation:async()=>{if(throws==='isolation')throw Error('no');return{verified:true,environment:'offline_disposable_only',testOnly:true,...isolated}},
  readAttempt:async(v)=>{reads.push(v);if(throws==='read')throw Error('no');return readOverride===undefined?attempt:readOverride},nowMs:()=>clock});
 return{h,reads,observation,eventId};
}
async function execute(opts){const x=make(opts);return{...x,result:await x.h.inspect({eventId:x.eventId,observation:x.observation,request:{mock:true}})};}
function noGo(x,classification,reason){assert.equal(x.status,'no_go');assert.equal(x.classification,classification);
 if(reason)assert.equal(x.reason,reason);
 for(const k of ['releasePermitted','lineDispatchAllowed','automaticRetryAllowed','deliveredToUser','realLineProviderVerified'])assert.equal(x[k],false,k);
 assert.ok(Object.isFrozen(x));assert.equal(JSON.stringify(x).includes(retryKey),false);}
test('hard release lock and isolated dependencies always required',()=>{
 assert.equal(CAR02_V470_RELEASE_LOCK,true);assert.equal(CAR02_V470_RETRY_WINDOW_MS,86400000);
 assert.throws(()=>createCar02OfflineLineRetryReviewR470(),/ISOLATED_ADAPTERS/);
});
test('200 is accepted by API not delivered',async()=>noGo((await execute()).result,'accepted_not_delivered'));
test('202 is accepted by API not delivered',async()=>noGo((await execute({response:{status:202}})).result,'accepted_not_delivered'));
test('299 remains accepted not delivered',async()=>noGo((await execute({response:{status:299}})).result,'accepted_not_delivered'));
test('409 with provider original accepted id is already accepted, not delivered',async()=>noGo((await execute({response:{status:409,acceptedRequestId:'original-accepted-id-1'}})).result,'already_accepted_not_delivered'));
test('409 without accepted request id is untrusted',async()=>noGo((await execute({response:{status:409}})).result,'refused'));
test('400 is rejected and never an automatic retry',async()=>noGo((await execute({response:{status:400}})).result,'provider_rejected'));
test('401, 403, 404, 410, 429 deny automatic retries',async()=>{
 for(const status of [401,403,404,410,429])noGo((await execute({response:{status}})).result,'provider_rejected');
});
test('timeout may be reviewed only with original retry key inside 24h',async()=>noGo((await execute({response:{kind:'timeout',status:null}})).result,'same_key_retry_review_only'));
test('500 and 503 may only enter independent manual review',async()=>{
 for(const status of [500,503])noGo((await execute({response:{status}})).result,'same_key_retry_review_only');
});
test('expired retry key after exactly 24h cannot be reused',async()=>{
 const t=await execute({stored:{retryKeyIssuedAtMs:now-CAR02_V470_RETRY_WINDOW_MS,firstAttemptAtMs:now-5000},response:{kind:'timeout',status:null}});
 noGo(t.result,'expired_retry_key_manual_review');
});
test('expired retry key after >24h cannot be reused',async()=>{
 const t=await execute({stored:{retryKeyIssuedAtMs:now-CAR02_V470_RETRY_WINDOW_MS-1,firstAttemptAtMs:now-5000},response:{status:502}});
 noGo(t.result,'expired_retry_key_manual_review');
});
test('just inside 24h stays REVIEW-ONLY without dispatch grant',async()=>{
 const t=await execute({stored:{retryKeyIssuedAtMs:now-CAR02_V470_RETRY_WINDOW_MS+1,firstAttemptAtMs:now-5000},response:{status:500}});
 noGo(t.result,'same_key_retry_review_only');
});
test('body hash mismatch rejects a mutated retry',async()=>noGo((await execute({response:{bodySha256:'c'.repeat(64),status:500}})).result,'refused'));
test('recipient hash mismatch rejects retry to another LINE user',async()=>noGo((await execute({response:{recipientSha256:'d'.repeat(64),status:500}})).result,'refused'));
test('retry key mismatch rejects duplicate key substitution',async()=>noGo((await execute({response:{retryKey:'00000000-0000-0000-0000-000000004799',status:500}})).result,'refused'));
test('reply endpoint unsupported for retry key',async()=>noGo((await execute({stored:{endpoint:'reply'}})).result,'refused'));
test('all four supported endpoints remain review only',async()=>{
 for(const endpoint of ['push','multicast','narrowcast','broadcast'])noGo((await execute({stored:{endpoint},response:{kind:'timeout',status:null}})).result,'same_key_retry_review_only');
});
test('malformed store extra fields, invalid uuid and digest fail closed',async()=>{
 for(const stored of [{extra:'injected'},{attemptId:'bad'},{retryKey:'bad'},{bodySha256:'BAD'},
   {firstAttemptAtMs:now+1},{shopCode:'qa_shop_b'},{eventId:'00000000-0000-0000-0000-000000004799'}])noGo((await execute({stored})).result,'refused');
});
test('untrusted response status, extra observation or clock rollback fail closed',async()=>{
 for(const response of [{status:600},{status:1},{extra:'secret'},{kind:'timeout',status:200},
   {kind:'response',status:null},{observedAtMs:now+1},{observedAtMs:now-8000},
   {status:200,acceptedRequestId:'unexpected'}])noGo((await execute({response})).result,'refused');
});
test('provider redirect is not evidence of accepted send',async()=>noGo((await execute({response:{status:302}})).result,'manual_review'));
test('reviewer role, tenant and environment are mandatory and refuse before reading storage',async()=>{
 for(const x of [{operator:{role:'owner'}},{operator:{mode:'production'}},{operator:{verified:false}},
  {operator:{shopCode:'Wrong Tenant'}},{isolated:{environment:'production'}},{isolated:{testOnly:false}},
  {isolated:{verified:false}},{throws:'authorize'},{throws:'isolation'}]){
  const o=await execute(x);noGo(o.result,'refused');assert.equal(o.reads.length,0);
 }
});
test('trusted shop code and event id are passed to storage instead of request body',async()=>{
 const x=await execute();assert.deepEqual(x.reads,[{shopCode:shop,eventId:event}]);
});
test('unknown event, absent record, and store error never yield permission',async()=>{
 for(const opts of [{eventId:'bad'},{readOverride:null},{throws:'read'}])noGo((await execute(opts)).result,'refused');
});
test('no PII tokens, body, recipient or retry key ever emitted',async()=>{
 for(const opts of [{},{response:{status:409,acceptedRequestId:'original-accepted-id-1'}},{response:{kind:'timeout',status:null}}]){
  const o=JSON.stringify((await execute(opts)).result);
  for(const secret of [shop,event,attemptId,retryKey,body,recipient,'Bearer','LINE user','original-accepted-id-1'])assert.equal(o.includes(secret),false);
 }
});
