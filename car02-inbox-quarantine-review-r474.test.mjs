import test from 'node:test';
import assert from 'node:assert/strict';
import {createCar02OfflineQuarantineReviewR474,CAR02_V474_RELEASE_LOCK,CAR02_V474_REASONS} from './car02-inbox-quarantine-review-r474.mjs';
const SHOP='qa_shop_a',E='01ARZ3NDEKTSV4RRFFQ69G5FAZ',DIGEST='c'.repeat(64),HASH='d'.repeat(64),NOW=1800000005000;
function fixture(options={}){
 let calls={lease:0,write:0,read:0},result='quarantined_mock',record;
 const o={auth:{},isolation:{},worker:{},lease:{},stored:{},time:NOW,...options};
 const c=createCar02OfflineQuarantineReviewR474({expectedShopCode:o.expectedShopCode??SHOP,nowMs:()=>o.time,
  authorizeAuditor:async()=>{if(o.throws==='auth')throw Error('auth');return{verified:true,mode:'isolated_qa',role:'quarantine_auditor',shopCode:SHOP,...o.auth}},
  inspectIsolation:async()=>{if(o.throws==='isolation')throw Error('isolation');return{verified:true,environment:'disposable_pg17_or_offline_mock',testOnly:true,...o.isolation}},
  trustedWorkerLease:async()=>{if(o.throws==='worker')throw Error('worker');return{verified:true,source:'isolated_mock_worker_registry',shopCode:SHOP,workerId:'worker_a',leaseEpoch:2,leaseTokenHash:HASH,...o.worker}},
  readLease:async({shopCode,eventId})=>{calls.lease++;if(o.throws==='lease')throw Error('lease');return{source:'disposable_mock_worker_lease',shopCode,eventId,eventDigest:DIGEST,state:'leased',workerId:'worker_a',leaseEpoch:2,leaseTokenHash:HASH,leaseStartedMs:NOW-1000,leaseUntilMs:NOW+30000,...o.lease}},
  quarantine:async x=>{calls.write++;record=x;if(o.throws==='write')throw Error('write');return o.outcome??result},
  readQuarantine:async({shopCode,eventId})=>{calls.read++;if(o.throws==='read')throw Error('read');return{source:'disposable_mock_quarantine',shopCode,eventId,eventDigest:DIGEST,workerId:'worker_a',leaseEpoch:2,quarantineReason:record?.reason,reviewState:'quarantined_review_only',...o.stored}}
 });return{c,calls};
}
const failClosed=x=>{assert.equal(x.status,'no_go');assert.ok(Object.isFrozen(x));for(const k of ['releasePermitted','writeAuthorized','jobDispatched','realWebhookAcknowledged','actualEventProcessed','lineDeliveryProven','realProviderVerified'])assert.equal(x[k],false);assert.equal(x.status==='success',false)};
const go=async(o={},input={})=>{const f=fixture(o);return{...f,result:await f.c.inspect({eventId:E,eventDigest:DIGEST,reason:'manual_hold',...input})}};
test('hard release lock',()=>assert.equal(CAR02_V474_RELEASE_LOCK,true));
test('all mock adapters required',()=>assert.throws(()=>createCar02OfflineQuarantineReviewR474(),/ADAPTERS/));
test('reason enum fixed to four non-personal classifications',()=>assert.deepEqual(CAR02_V474_REASONS,['integrity_mismatch','poison_event','manual_hold','max_retry_review']));
test('happy-path synthetic quarantine is still NO_GO',async()=>{let x=await go();failClosed(x.result);assert.equal(x.result.classification,'quarantine_review_only');assert.deepEqual(x.calls,{lease:1,write:1,read:1});});
test('idempotent duplicate quarantine remains review only',async()=>{const x=await go({outcome:'already_quarantined'});failClosed(x.result);assert.equal(x.result.classification,'quarantine_review_only');});
test('quarantine never claims LINE delivery or webhook ack',async()=>{let x=await go();failClosed(x.result);assert.equal('acknowledged' in x.result,false);assert.equal('deliveryReceipt' in x.result,false);});
test('invalid ULID refused before external readers',async()=>{const x=await go({},{eventId:'bad'});failClosed(x.result);assert.equal(x.calls.lease,0);});
test('invalid digest refused before readers',async()=>{const x=await go({},{eventDigest:'A'.repeat(64)});failClosed(x.result);assert.equal(x.calls.lease,0);});
test('free-form quarantine reasons rejected to prevent PII injection',async()=>{const x=await go({},{reason:'customer_id=123'});failClosed(x.result);assert.equal(x.calls.write,0);});
test('all allowed quarantine reasons can be recorded in mock',async()=>{for(const reason of CAR02_V474_REASONS){const x=await go({},{reason});failClosed(x.result);assert.equal(x.calls.write,1);}});
test('tenant code is fixed by construction',async()=>{const x=await go({},{shopCode:'qa_shop_b'});failClosed(x.result);assert.equal(x.calls.write,1);assert.equal(x.c.scopedShopCode,SHOP);});
test('invalid constructor tenant rejected',()=>assert.throws(()=>fixture({expectedShopCode:'bad shop'}),/ADAPTERS/));
test('unverified auditor rejected before lease read',async()=>{const x=await go({auth:{verified:false}});failClosed(x.result);assert.equal(x.calls.lease,0);});
test('wrong-role auditor rejected before read',async()=>{const x=await go({auth:{role:'admin'}});failClosed(x.result);assert.equal(x.calls.lease,0);});
test('cross-tenant auditor rejected',async()=>{const x=await go({auth:{shopCode:'qa_shop_b'}});failClosed(x.result);assert.equal(x.calls.lease,0);});
test('production isolation rejected',async()=>{const x=await go({isolation:{environment:'production'}});failClosed(x.result);assert.equal(x.calls.lease,0);});
test('unverified worker rejected',async()=>{const x=await go({worker:{verified:false}});failClosed(x.result);assert.equal(x.calls.lease,0);});
test('worker from other shop rejected',async()=>{const x=await go({worker:{shopCode:'qa_shop_b'}});failClosed(x.result);assert.equal(x.calls.lease,0);});
test('forged worker identity structure rejected',async()=>{const x=await go({worker:{extra:true}});failClosed(x.result);assert.equal(x.calls.lease,0);});
test('invalid trusted worker identifier rejected',async()=>{for(const workerId of ['untrusted','worker_', 'worker_a;drop']){const x=await go({worker:{workerId}});failClosed(x.result);assert.equal(x.calls.lease,0);}});
test('nonpositive or fractional epoch rejected',async()=>{for(const leaseEpoch of [0,-2,2.5,'2']){const x=await go({worker:{leaseEpoch}});failClosed(x.result);assert.equal(x.calls.lease,0);}});
test('untrusted lease token hash rejected before row read',async()=>{const x=await go({worker:{leaseTokenHash:'z'.repeat(64)}});failClosed(x.result);assert.equal(x.calls.lease,0);});
test('lease read throw denies without writes',async()=>{const x=await go({throws:'lease'});failClosed(x.result);assert.equal(x.calls.write,0);});
test('missing current lease state denies',async()=>{const x=await go({lease:{state:'review_only'}});failClosed(x.result);assert.equal(x.calls.write,0);});
test('lease epoch mismatch refuses stale worker',async()=>{const x=await go({lease:{leaseEpoch:3}});failClosed(x.result);assert.equal(x.calls.write,0);});
test('lease token hash mismatch refuses stale owner',async()=>{const x=await go({lease:{leaseTokenHash:'a'.repeat(64)}});failClosed(x.result);assert.equal(x.calls.write,0);});
test('lease worker mismatch refused',async()=>{const x=await go({lease:{workerId:'worker_b'}});failClosed(x.result);assert.equal(x.calls.write,0);});
test('lease shop mismatch refused',async()=>{const x=await go({lease:{shopCode:'qa_shop_b'}});failClosed(x.result);assert.equal(x.calls.write,0);});
test('lease digest mismatch refused',async()=>{const x=await go({lease:{eventDigest:'b'.repeat(64)}});failClosed(x.result);assert.equal(x.calls.write,0);});
test('lease unknown extra field refused',async()=>{const x=await go({lease:{businessAuthorized:true}});failClosed(x.result);assert.equal(x.calls.write,0);});
test('expired lease refuses quarantine before mutation',async()=>{const x=await go({lease:{leaseUntilMs:NOW}});failClosed(x.result);assert.equal(x.calls.write,0);});
test('future lease start refuses quarantine',async()=>{const x=await go({lease:{leaseStartedMs:NOW+1}});failClosed(x.result);assert.equal(x.calls.write,0);});
test('invalid current time denies action',async()=>{for(const time of [0,-1,2.3,NaN]){const x=await go({time});failClosed(x.result);assert.equal(x.calls.write,0);}});
test('DB refused, expired or conflict status denies',async()=>{for(const outcome of ['stale_or_invalid_lease','collision_refused','unknown_event_refused']){const x=await go({outcome});failClosed(x.result);assert.equal(x.calls.read,0);}});
test('write failure denies without readback',async()=>{const x=await go({throws:'write'});failClosed(x.result);assert.equal(x.calls.read,0);});
test('readback failure denies',async()=>{const x=await go({throws:'read'});failClosed(x.result);assert.equal(x.result.classification,'refused');});
test('quarantine audit readback reason mismatch denies',async()=>{const x=await go({stored:{quarantineReason:'poison_event'}});failClosed(x.result);assert.equal(x.result.reason,'quarantine_readback_mismatch');});
test('quarantine audit readback worker mismatch denies',async()=>{const x=await go({stored:{workerId:'worker_b'}});failClosed(x.result);assert.equal(x.result.reason,'quarantine_readback_mismatch');});
test('quarantine audit readback tenant mismatch denies',async()=>{const x=await go({stored:{shopCode:'qa_shop_b'}});failClosed(x.result);assert.equal(x.result.reason,'quarantine_readback_mismatch');});
test('quarantine audit readback epoch mismatch denies',async()=>{const x=await go({stored:{leaseEpoch:1}});failClosed(x.result);assert.equal(x.result.reason,'quarantine_readback_mismatch');});
test('quarantine audit readback untrusted extra fields deny',async()=>{const x=await go({stored:{customerData:'leak'}});failClosed(x.result);assert.equal(x.result.reason,'quarantine_readback_mismatch');});
test('unavailable auditor, environment, worker all deny before lease read',async()=>{for(const throws of ['auth','isolation','worker']){const x=await go({throws});failClosed(x.result);assert.equal(x.calls.lease,0);}});
