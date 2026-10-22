import test from 'node:test';
import assert from 'node:assert/strict';
import {createCar02OfflineInboxLeaseR473,CAR02_V473_RELEASE_LOCK,CAR02_V473_LEASE_MIN_MS,CAR02_V473_LEASE_MAX_MS} from './car02-inbox-lease-review-r473.mjs';
const SHOP='qa_shop_a',ID='01ARZ3NDEKTSV4RRFFQ69G5FAY',DIGEST='a'.repeat(64),AT=1800000000000;
function fixture({auth={},env={},worker={},receipt={},lease={},outcome='leased_mock',throwAt='',secret=Buffer.alloc(32,7),clock=AT,leaseMs=30000,
  expectedShopCode=SHOP,request}={}){
 const calls={receipt:0,acquire:0,read:0};let params,secretSource;
 const c=createCar02OfflineInboxLeaseR473({expectedShopCode,leaseMs,nowMs:()=>clock,
  authorizeAuditor:async()=>{if(throwAt==='auth')throw Error('auth');return{verified:true,mode:'isolated_qa',role:'inbox_lease_auditor',shopCode:SHOP,...auth}},
  inspectIsolation:async()=>{if(throwAt==='env')throw Error('env');return{verified:true,environment:'disposable_pg17_or_offline_mock',testOnly:true,...env}},
  trustedWorkerIdentity:async()=>{if(throwAt==='worker')throw Error('worker');return{verified:true,source:'isolated_mock_worker_registry',workerId:'worker_a',shopCode:SHOP,...worker}},
  readPendingReceipt:async({shopCode,eventId})=>{calls.receipt++;if(throwAt==='receipt')throw Error('down');return{source:'disposable_mock_webhook_inbox',shopCode,eventId,eventDigest:DIGEST,state:'pending',...receipt}},
  generateLeaseSecret:()=>{if(throwAt==='secret')throw Error('secret');secretSource=Buffer.from(secret);return secretSource},
  acquireLease:async(p)=>{calls.acquire++;params=p;if(throwAt==='acquire')throw Error('down');return outcome},
  readLease:async({shopCode,eventId})=>{calls.read++;if(throwAt==='read')throw Error('down');return{source:'disposable_mock_worker_lease',shopCode,eventId,eventDigest:DIGEST,state:'leased',leaseEpoch:1,leaseTokenHash:params?.tokenHash,workerId:'worker_a',expiresAtMs:clock+leaseMs,...lease}}
 });return {c,calls,getParams:()=>params,getSecret:()=>secretSource,request};
}
async function run(options={},input={}){const x=fixture(options);const result=await x.c.inspect({request:x.request,eventId:ID,eventDigest:DIGEST,...input});return{...x,result};}
const deny=r=>{assert.equal(r.status,'no_go');assert.ok(Object.isFrozen(r));for(const p of ['releasePermitted','realWebhookAcknowledged','jobDispatched','writeAuthorized','lineDeliveryProven','realWorkerVerified'])assert.equal(r[p],false);};
test('hard-lock is permanent',()=>assert.equal(CAR02_V473_RELEASE_LOCK,true));
test('all trusted adapters required',()=>assert.throws(()=>createCar02OfflineInboxLeaseR473(),/ADAPTERS/));
test('lease ttl lower and upper limits enforced',()=>{assert.equal(CAR02_V473_LEASE_MIN_MS,1000);assert.equal(CAR02_V473_LEASE_MAX_MS,600000);for(const ms of [-1,0,999,600001,1.2])assert.throws(()=>fixture({leaseMs:ms}),/ADAPTERS/);});
test('valid mock pending receipt only obtains NO_GO lease review',async()=>{const x=await run();deny(x.result);assert.equal(x.result.classification,'mock_lease_review_only');assert.equal(x.calls.acquire,1);assert.equal(x.calls.read,1);assert.equal(x.getParams().ttlMs,30000);assert.equal(x.getParams().shopCode,SHOP);assert.equal(x.getParams().workerId,'worker_a');assert.match(x.getParams().tokenHash,/^[a-f0-9]{64}$/);assert.equal(x.getSecret().every(v=>v===0),true);});
test('raw lease secret never appears in review result',async()=>{const x=await run();assert.doesNotMatch(JSON.stringify(x.result),/qa_shop_a|01ARZ|a{20}|worker_a|token/i);deny(x.result);});
test('lease conflict denies readback and never dispatches',async()=>{const x=await run({outcome:'active_lease_conflict'});deny(x.result);assert.equal(x.result.classification,'lease_conflict_review_only');assert.equal(x.calls.read,0);});
test('missing lease claim denies',async()=>{const x=await run({outcome:'refused_invalid'});deny(x.result);assert.equal(x.calls.read,0);});
test('claimed lease requires exact digest',async()=>{const x=await run({lease:{eventDigest:'b'.repeat(64)}});deny(x.result);assert.equal(x.result.reason,'lease_read_back_mismatch');});
test('claimed lease must match trusted worker',async()=>{const x=await run({lease:{workerId:'worker_b'}});deny(x.result);});
test('claimed lease must match token hash',async()=>{const x=await run({lease:{leaseTokenHash:'b'.repeat(64)}});deny(x.result);});
test('claimed lease must match expiry exactly',async()=>{const x=await run({lease:{expiresAtMs:AT+30001}});deny(x.result);});
test('claimed lease epoch is positive integer',async()=>{for(const leaseEpoch of [0,-1,1.5,'1']){const x=await run({lease:{leaseEpoch}});deny(x.result);}});
test('claimed lease must still be leased',async()=>{const x=await run({lease:{state:'review_only'}});deny(x.result);});
test('extra untrusted lease columns are rejected',async()=>{const x=await run({lease:{authGranted:true}});deny(x.result);});
test('committed pending receipt is mandatory before any claim',async()=>{for(const receipt of [{state:'processing'},{shopCode:'qa_shop_b'},{eventDigest:'b'.repeat(64)},{source:'production'},{unexpected:true}]){const x=await run({receipt});deny(x.result);assert.equal(x.calls.acquire,0);}});
test('missing valid ULID and signed digest rejected before read',async()=>{for(const p of [{eventId:'bad'},{eventDigest:'x'.repeat(64)},{eventId:undefined},{eventDigest:undefined}]){const x=await run({},p);deny(x.result);assert.equal(x.calls.receipt,0);}});
test('untrusted auditor cannot even read pending receipt',async()=>{const x=await run({auth:{verified:false}});deny(x.result);assert.equal(x.calls.receipt,0);});
test('cross-tenant auditor cannot read receipt',async()=>{const x=await run({auth:{shopCode:'qa_shop_b'}});deny(x.result);assert.equal(x.calls.receipt,0);});
test('non-disposable environment denied',async()=>{const x=await run({env:{environment:'production'}});deny(x.result);assert.equal(x.calls.receipt,0);});
test('unverified worker denied',async()=>{const x=await run({worker:{verified:false}});deny(x.result);assert.equal(x.calls.receipt,0);});
test('untrusted worker identifier is rejected',async()=>{for(const workerId of ['worker_', 'qa_admin','worker_a;DROP','worker_'.padEnd(45,'a')]){const x=await run({worker:{workerId}});deny(x.result);assert.equal(x.calls.receipt,0);}});
test('cross-tenant worker denied',async()=>{const x=await run({worker:{shopCode:'qa_shop_b'}});deny(x.result);assert.equal(x.calls.receipt,0);});
test('request cannot override expected shop code',async()=>{const x=await run({request:{shopCode:'qa_shop_b'}});deny(x.result);assert.equal(x.result.classification,'mock_lease_review_only');});
test('bad time and read failure cause no mutation',async()=>{for(const clock of [-1,NaN,1.5]){const x=await run({clock});deny(x.result);assert.equal(x.calls.acquire,0);}const x=await run({throwAt:'receipt'});deny(x.result);assert.equal(x.calls.acquire,0);});
test('inspector, isolation and worker errors deny pre-read',async()=>{for(const throwAt of ['auth','env','worker']){const x=await run({throwAt});deny(x.result);assert.equal(x.calls.receipt,0);}});
test('claim and readback errors deny real effects',async()=>{for(const throwAt of ['acquire','read']){const x=await run({throwAt});deny(x.result);assert.equal(x.result.classification,'refused');}});
test('invalid ephemeral lease secrets are rejected and cleared when applicable',async()=>{for(const secret of [Buffer.alloc(1),Buffer.alloc(33)]){const x=await run({secret});deny(x.result);assert.equal(x.calls.acquire,0);}const x=await run({throwAt:'secret'});deny(x.result);assert.equal(x.calls.acquire,0);});
test('invalid fixed shop code refused before adapter use',()=>{assert.throws(()=>fixture({expectedShopCode:'other shop'}),/ADAPTERS/);});
test('mock lease cannot be treated as event processing or LINE delivered',async()=>{const x=await run();deny(x.result);assert.equal('processed' in x.result,false);assert.equal('deliveryStatus' in x.result,false);});
