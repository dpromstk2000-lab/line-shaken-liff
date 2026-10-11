import test from 'node:test';
import assert from 'node:assert/strict';
import {planR93CRecovery,nextR93CRetryDelay,interpretR93CDelete,verifyR93CAbsence,R93C_RULES} from './car02-r93c-photo-cleanup-policy.mjs';
const SH='street_house_kitsuki';
const ID='11111111-1111-4111-8111-111111111111',ORDER='22222222-2222-4222-8222-222222222222',REPORT='33333333-3333-4333-8333-333333333333',KEY='44444444-4444-4444-8444-444444444444';
const now=Date.parse('2026-10-11T05:00:00.000Z');
function photo(){return {shopCode:SH,photoId:ID,orderId:ORDER,reportId:REPORT,storageBucket:R93C_RULES.bucket,storagePath:`${SH}/${ORDER}/${REPORT}/${KEY}.jpg`,uploadState:'pending',createdAt:'2026-10-10T04:00:00.000Z'}}
function plan(p=photo(),extra={}){return planR93CRecovery({photo:p,shopCode:SH,now,lockHeld:true,serverVerified:true,...extra})}
const deny=(fn,code)=>assert.throws(fn,{code});
test('R93C is policy only and requires durable backend to operate',()=>{assert.equal(R93C_RULES.liveExecution,false);assert.equal(R93C_RULES.durableOutboxRequired,true)});
test('ready photo skipped forever',()=>{assert.equal(plan({...photo(),uploadState:'ready'}).decision,'SKIP_READY_NEVER_DELETE');});
test('old pending photo generates plan without network calls',()=>{const p=plan();assert.equal(p.decision,'REQUEST_PRIVATE_DELETE_AND_VERIFY');assert.equal(p.networkOperations,0);assert.equal(p.reviewOnly,true);assert.equal(p.path,photo().storagePath)});
test('old deleted tombstone also checked for leftovers',()=>{assert.equal(plan({...photo(),uploadState:'deleted'}).decision,'REQUEST_PRIVATE_DELETE_AND_VERIFY')});
test('young in-flight pending never deleted',()=>{const p=photo();p.createdAt='2026-10-11T04:50:00.000Z';const r=plan(p);assert.equal(r.decision,'WAIT_FOR_UPLOAD_GRACE');assert.equal(r.retryAfterMs,50*60*1000)});
test('max attempts require manual review instead of pretending success',()=>{assert.equal(plan(photo(),{attempts:8}).decision,'ESCALATE_MANUAL_REVIEW')});
for(const [name,change] of [
 ['other shop',p=>p.shopCode='attacker_shop'],['path traversal',p=>p.storagePath='../secret.jpg'],
 ['wrong storage bucket',p=>p.storageBucket='public'],['wrong report path',p=>p.storagePath=p.storagePath.replace(REPORT,ID)],
 ['wrong uuid',p=>p.photoId='oops'],['missing createdAt',p=>delete p.createdAt],
 ['weird extension',p=>p.storagePath=p.storagePath.replace('.jpg','.svg')],
 ['object URL',p=>p.storagePath='https://example.com/storage/object'],
 ['path encoded bypass',p=>p.storagePath=p.storagePath.replace(SH,SH+'%2fsecret')],
 ['other state',p=>p.uploadState='approved'],['proto object',p=>p.storagePath='/'+p.storagePath],
 ['record missing',()=>{}]
])test('R93C rejects unsafe storage cleanup scope: '+name,()=>{const p=name==='record missing'?null:photo();change(p);deny(()=>plan(p),'R93C_UNSAFE_CLEANUP_SCOPE')});
for(const change of [o=>o.serverVerified=false,o=>o.lockHeld=false])test('R93C requires server authorization and lock',()=>{const o={lockHeld:true,serverVerified:true};change(o);deny(()=>plan(photo(),o),'R93C_LOCK_AND_AUTH_REQUIRED')});
test('future timestamp rejected',()=>{const p=photo();p.createdAt='2026-10-12T04:00:00.000Z';deny(()=>plan(p),'R93C_CLOCK_INVALID')});
for(const attempts of [-1,8.5,9,NaN])test('unsafe attempt value rejected '+attempts,()=>deny(()=>plan(photo(),{attempts}),'R93C_SCHEDULE_INVALID'));
for(const status of [200,202,204,404])test('DELETE '+status+' never equals confirmed gone without re-probe',()=>{const r=interpretR93CDelete({status});assert.equal(r.confirmedGone,false);assert.equal(r.decision,'VERIFY_STORAGE_OBJECT_ABSENCE')});
for(const status of [401,403])test('DELETE '+status+' escalates auth failure',()=>assert.equal(interpretR93CDelete({status}).decision,'ESCALATE_AUTH_FAILURE'));
for(const status of [408,409,425,429,500,502,503])test('DELETE '+status+' requires retry',()=>assert.equal(interpretR93CDelete({status}).decision,'RETRY_STORAGE_DELETE'));
test('network error during DELETE requires retry',()=>assert.equal(interpretR93CDelete({networkError:true}).confirmedGone,false));
for(const status of [200,206,304])test('probe '+status+' proves object remains',()=>{let r=verifyR93CAbsence({status});assert.equal(r.confirmedGone,false);assert.equal(r.decision,'STILL_PRESENT_RETRY_DELETE')});
test('only verified 404 confirms absence',()=>{const r=verifyR93CAbsence({status:404});assert.equal(r.confirmedGone,true);assert.equal(r.decision,'CLEANUP_CONFIRMED')});
for(const status of [401,403])test('probe '+status+' escalates credentials',()=>assert.equal(verifyR93CAbsence({status}).decision,'ESCALATE_AUTH_FAILURE'));
test('probe network error does not confirm deletion',()=>assert.equal(verifyR93CAbsence({networkError:true}).confirmedGone,false));
for(const attempts of [1,2,3,4,7])test('retry backoff monotonic and bounded '+attempts,()=>{const r=nextR93CRetryDelay({attempts,httpStatus:503});assert.equal(r.decision,'RETRY_WITH_DURABLE_OUTBOX');assert.ok(r.delayMs>=300000&&r.delayMs<=24*60*60*1000)});
test('repeated auth error escalates immediately',()=>assert.equal(nextR93CRetryDelay({attempts:1,httpStatus:401}).decision,'ESCALATE_AUTH_FAILURE'));
test('retry ceiling never pretends cleanup succeeded',()=>assert.equal(nextR93CRetryDelay({attempts:8,httpStatus:503}).decision,'ESCALATE_MANUAL_REVIEW'));
