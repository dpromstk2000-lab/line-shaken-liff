import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {createCar02OfflineWebhookReviewR471,CAR02_V471_RELEASE_LOCK,CAR02_V471_MAX_WEBHOOK_BYTES} from './car02-line-webhook-review-r471.mjs';
const shop='qa_shop_a',destination='U'+'a'.repeat(32),secret='offline_qa_line_channel_secret_only';
const id='01ARZ3NDEKTSV4RRFFQ69G5FAV',id2='01ARZ3NDEKTSV4RRFFQ69G5FAW';
const now=1800000000000;
const event=(i=id,redelivery=false)=>({type:'message',webhookEventId:i,timestamp:now-5000,
 deliveryContext:{isRedelivery:redelivery},source:{type:'user',userId:'U'+'b'.repeat(32)},message:{id:'123',type:'text',text:'mock'}});
const stableDigest=e=>{const x=structuredClone(e);delete x.deliveryContext.isRedelivery;return createHash('sha256').update(JSON.stringify(x)).digest('hex');};
const hmac=bytes=>createHmac('sha256',secret).update(bytes).digest('base64');
function make({events=[event()],content,secretOverride=secret,stored=null,op={},isolation={},dest=destination,throws='',time=now}={}){
 const reads={channel:0,ledger:[]};
 const payload=content===undefined?{destination:dest,events}:content;
 const raw=Buffer.isBuffer(payload)?payload:Buffer.from(typeof payload==='string'?payload:JSON.stringify(payload));
 const sig=hmac(raw);
 const handler=createCar02OfflineWebhookReviewR471({
  authorizeAuditor:async()=>{if(throws==='authorize')throw Error('fail');return{verified:true,role:'webhook_auditor',mode:'isolated_qa',shopCode:shop,...op}},
  inspectIsolation:async()=>{if(throws==='isolation')throw Error('fail');return{verified:true,environment:'offline_disposable_only',testOnly:true,...isolation}},
  readChannel:async()=>{reads.channel++;if(throws==='channel')throw Error('fail');return{source:'offline_disposable_line_channel',shopCode:shop,destination,secret:secretOverride}},
  lookupEvent:async(x)=>{reads.ledger.push(x);if(throws==='ledger')throw Error('fail');return typeof stored==='function'?stored(x):stored},
  nowMs:()=>time});
 return{handler,raw,sig,reads};
}
async function check(opts={},overrides={}){const x=make(opts);return{...x,res:await x.handler.inspect({request:{offline:true},rawBody:overrides.body??x.raw,signature:overrides.signature??x.sig})};}
function noGo(x,classification){assert.equal(x.status,'no_go');if(classification)assert.equal(x.classification,classification);
 for(const k of ['releasePermitted','writeAuthorized','eventAcknowledged','businessEffectAllowed','lineDeliveryProven','realWebhookProviderVerified'])assert.equal(x[k],false);
 assert.ok(Object.isFrozen(x));assert.doesNotMatch(JSON.stringify(x),/offline_qa_line_channel_secret_only|Ubbbbbbbb|01ARZ3NDE/);}
test('hard lock and adapters mandatory',()=>{assert.equal(CAR02_V471_RELEASE_LOCK,true);assert.equal(CAR02_V471_MAX_WEBHOOK_BYTES,65536);assert.throws(()=>createCar02OfflineWebhookReviewR471(),/ADAPTERS/);});
test('valid signed raw body is classified but never acknowledges or mutates',async()=>{const {res}=await check();noGo(res,'signature_verified_review_only');assert.deepEqual([res.novel,res.duplicates],[1,0]);});
test('LINE official published HMAC example agrees with raw bytes',async()=>{
 const b=Buffer.from('{"destination":"U8e742f61d673b39c7fff3cecb7536ef0","events":[]}');
 const h=createHmac('sha256','8c570fa6dd201bb328f1c1eac23a96d8').update(b).digest('base64');
 assert.equal(h,'GhRKmvmHys4Pi8DxkF4+EayaH0OqtJtaZxgTD9fMDLs=');
});
test('empty legitimate webhook remains review only',async()=>{const{res}=await check({events:[]});noGo(res,'verified_empty_review_only');});
test('body alteration after signing is refused before ledger lookup',async()=>{const x=make();const changed=Buffer.from(JSON.stringify({destination,events:[event()]}).replace('mock','altered'));const r=await x.handler.inspect({rawBody:changed,signature:x.sig});noGo(r,'refused');assert.equal(x.reads.ledger.length,0);});
test('whitespace reformat after signing refuses even semantically same JSON',async()=>{const x=make();const changed=Buffer.from(JSON.stringify(JSON.parse(x.raw.toString()),null,2));noGo(await x.handler.inspect({rawBody:changed,signature:x.sig}),'refused');});
test('wrong channel secret fails signature even with correct destination',async()=>{noGo((await check({secretOverride:'wrong_test_secret'})).res,'refused');});
test('other destination is denied after signature check',async()=>{noGo((await check({dest:'U'+'c'.repeat(32)})).res,'refused');});
test('invalid signature and malformed base64 fail closed',async()=>{
 const x=make();for(const signature of ['',x.sig.slice(1),'z'+x.sig.slice(1), 'A'.repeat(44), '='+x.sig.slice(1)])noGo(await x.handler.inspect({rawBody:x.raw,signature}),'refused');
});
test('signed but invalid JSON and UTF8 are not processed',async()=>{
 for(const content of ['{broken',Buffer.from([0xc3,0x28])]){const x=make({content});noGo(await x.handler.inspect({rawBody:x.raw,signature:x.sig}),'refused');}
});
test('non-Buffer / zero / oversize rejected before reading channel',async()=>{const x=make();for(const body of ['abc',Buffer.alloc(0),Buffer.alloc(65537)])noGo(await x.handler.inspect({rawBody:body,signature:x.sig}),'refused');assert.equal(x.reads.channel,0);});
test('duplicate redelivery matches original digest although isRedelivery changes',async()=>{const original=event(),redelivered=event(id,true);const d=stableDigest(original);const x=await check({events:[redelivered],stored:()=>({source:'offline_disposable_webhook_event_ledger',shopCode:shop,eventId:id,digestSha256:d})});noGo(x.res,'signature_verified_review_only');assert.deepEqual([x.res.novel,x.res.duplicates],[0,1]);});
test('changed payload with same event id is rejected',async()=>{const altered=event(id,true);altered.message.text='tampered';noGo((await check({events:[altered],stored:()=>({source:'offline_disposable_webhook_event_ledger',shopCode:shop,eventId:id,digestSha256:stableDigest(event())})})).res,'refused');});
test('cross tenant ledger record with same webhook event id is rejected',async()=>{noGo((await check({stored:()=>({source:'offline_disposable_webhook_event_ledger',shopCode:'qa_shop_b',eventId:id,digestSha256:stableDigest(event())})})).res,'refused');});
test('two events in one envelope are reviewed independently',async()=>{const x=await check({events:[event(),event(id2)],stored:({eventId})=>eventId===id?{source:'offline_disposable_webhook_event_ledger',shopCode:shop,eventId:id,digestSha256:stableDigest(event())}:null});noGo(x.res,'signature_verified_review_only');assert.deepEqual([x.res.novel,x.res.duplicates],[1,1]);assert.equal(x.reads.ledger.length,2);});
test('same event twice inside one envelope refused',async()=>noGo((await check({events:[event(),event(id,true)]})).res,'refused'));
test('malformed event id, non-boolean redelivery, missing timestamp denied',async()=>{for(const patch of [{webhookEventId:'bad'},{timestamp:'soon'},{deliveryContext:{isRedelivery:'true'}},{deliveryContext:{isRedelivery:false,unexpected:true}}])noGo((await check({events:[{...event(),...patch}]})).res,'refused');});
test('future event timestamp beyond tolerance denied',async()=>noGo((await check({events:[{...event(),timestamp:now+300001}]})).res,'refused'));
test('out of order timestamps are not assumed to equal arrival order',async()=>{const old={...event(),timestamp:now-80000},newer={...event(id2),timestamp:now-1};const x=await check({events:[newer,old]});noGo(x.res,'signature_verified_review_only');assert.equal(x.res.novel,2);});
test('33 events are refused to enforce cap',async()=>noGo((await check({events:Array.from({length:33},()=>event())})).res,'refused'));
test('untrusted auditor never reads channel or dedup ledger',async()=>{for(const op of [{role:'owner'},{verified:false},{mode:'production'},{shopCode:'OTHER'}]){const x=await check({op});noGo(x.res,'refused');assert.equal(x.reads.channel,0);assert.equal(x.reads.ledger.length,0);}});
test('untrusted environment never reads channels',async()=>{for(const isolation of [{verified:false},{environment:'production'},{testOnly:false}]){const x=await check({isolation});noGo(x.res,'refused');assert.equal(x.reads.channel,0);}});
test('read failures always fail closed',async()=>{for(const throws of ['authorize','isolation','channel','ledger'])noGo((await check({throws})).res,'refused');});
test('ledger injection and digest mismatch denied',async()=>{for(const stored of [{source:'bad'}, {source:'offline_disposable_webhook_event_ledger',shopCode:shop,eventId:id,digestSha256:'c'.repeat(64)}])noGo((await check({stored})).res,'refused');});
test('payload with invalid destinations or events type is denied',async()=>{for(const content of [{destination,events:'bad'}, {events:[]},{destination,events:null},{destination,events:[null]}])noGo((await check({content})).res,'refused');});
test('signed payload alone never proves LINE message delivery',async()=>{const x=await check();assert.equal(x.res.lineDeliveryProven,false);assert.equal(x.res.eventAcknowledged,false);assert.equal(x.res.writeAuthorized,false);});
