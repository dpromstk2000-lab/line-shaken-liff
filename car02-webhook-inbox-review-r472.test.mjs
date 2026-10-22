import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {createCar02OfflineWebhookReviewR471} from './car02-line-webhook-review-r471.mjs';
import {CAR02_V472_RELEASE_LOCK,createCar02OfflineWebhookInboxR472} from './car02-webhook-inbox-review-r472.mjs';
const SHOP='qa_shop_a',DEST='U'+'a'.repeat(32),SECRET='offline_qa_line_channel_secret_only';
const ID='01ARZ3NDEKTSV4RRFFQ69G5FAY',AT=1800000000000;
const evt=(id=ID,redelivery=false)=>({type:'message',webhookEventId:id,timestamp:AT-5000,
 deliveryContext:{isRedelivery:redelivery},source:{type:'user',userId:'U'+'b'.repeat(32)},message:{id:'m',type:'text',text:'offline'}});
const digest=e=>{const x=structuredClone(e);delete x.deliveryContext.isRedelivery;return createHash('sha256').update(JSON.stringify(x)).digest('hex');};
const deny=res=>{assert.equal(res.status,'no_go');for(const k of ['releasePermitted','realWebhookAcknowledged','writeAuthorized','jobDispatched','lineDeliveryProven'])assert.equal(res[k],false);assert.ok(Object.isFrozen(res));};
function fixture({events=[evt()],stored=null,claimMode='claimed_pending',readMode='valid',op={},env={},signatureBad=false,body=null,throwAt='',reviewerOverride}={}){
 const event=events[0]??evt();let calls={claim:0,read:0,review:0,ledger:0};
 const rawBody=body??Buffer.from(JSON.stringify({destination:DEST,events}));
 const signature=createHmac('sha256',SECRET).update(rawBody).digest('base64');
 const led=stored===true?{source:'offline_disposable_webhook_event_ledger',shopCode:SHOP,eventId:event.webhookEventId,digestSha256:digest(evt(event.webhookEventId))}:stored;
 const reviewV471=reviewerOverride??createCar02OfflineWebhookReviewR471({
  authorizeAuditor:async()=>({verified:true,role:'webhook_auditor',mode:'isolated_qa',shopCode:SHOP}),
  inspectIsolation:async()=>({verified:true,environment:'offline_disposable_only',testOnly:true}),
  readChannel:async()=>({source:'offline_disposable_line_channel',shopCode:SHOP,destination:DEST,secret:SECRET}),
  lookupEvent:async()=>{calls.ledger++;return led;},nowMs:()=>AT});
 const inbox=createCar02OfflineWebhookInboxR472({expectedShopCode:SHOP,
  authorizeAuditor:async()=>{if(throwAt==='auth')throw Error('down');return{verified:true,role:'inbox_auditor',mode:'isolated_qa',shopCode:SHOP,...op}},
  inspectIsolation:async()=>{if(throwAt==='env')throw Error('down');return{verified:true,environment:'disposable_pg17_or_offline_mock',testOnly:true,...env}},
  reviewV471:{scopedShopCode:SHOP,inspect:async p=>{calls.review++;if(throwAt==='review')throw Error('down');return reviewV471.inspect(p);}},
  claimEvent:async ({shopCode,eventId,eventDigest})=>{calls.claim++;if(throwAt==='claim')throw Error('down');return claimMode==='invalid'? 'unknown':claimMode;},
  readClaim:async ({shopCode,eventId})=>{calls.read++;if(throwAt==='read')throw Error('down');return readMode==='empty'?null:{
   source:readMode==='untrusted'?'live':'disposable_mock_webhook_inbox',
   shopCode:readMode==='wrong_shop'?'qa_shop_b':shopCode,
   eventId:readMode==='wrong_id'?'01ARZ3NDEKTSV4RRFFQ69G5FAZ':eventId,
   eventDigest:readMode==='wrong_digest'?'b'.repeat(64):digest(event),
   state:readMode==='processed'?'processed':'pending'};}});
 return{inbox,request:{offline:true},rawBody,signature:signatureBad?'x'+signature.slice(1):signature,calls};
}
async function run(opts={},overrides={}){const f=fixture(opts);return{...f,result:await f.inbox.inspect({request:f.request,rawBody:overrides.rawBody??f.rawBody,signature:overrides.signature??f.signature})};}
test('release hard-lock and required external adapters',()=>{assert.equal(CAR02_V472_RELEASE_LOCK,true);assert.throws(()=>createCar02OfflineWebhookInboxR472(),/ADAPTERS/)});
test('signed novel event goes pending with NO REAL acknowledgement',async()=>{const x=await run();deny(x.result);assert.equal(x.result.classification,'durable_mock_review_only');assert.equal(x.result.reason,'mock_inbox_pending_not_acknowledged');assert.deepEqual([x.calls.claim,x.calls.read],[1,1]);});
test('racing identical claim can return mock duplicate without ACK',async()=>{const x=await run({claimMode:'duplicate_pending'});deny(x.result);assert.equal(x.result.reason,'mock_duplicate_pending_not_acknowledged');});
test('V471 known duplicate never makes a second claim',async()=>{const x=await run({stored:true,events:[evt(ID,true)]});deny(x.result);assert.equal(x.result.classification,'duplicate_review_only');assert.equal(x.calls.claim,0);});
test('V471 mismatched digest rejects before claim',async()=>{const x=await run({stored:true,events:[{...evt(),message:{id:'m',type:'text',text:'changed'}}]});deny(x.result);assert.equal(x.calls.claim,0);});
test('tampered HMAC refuses before claim',async()=>{const x=await run({signatureBad:true});deny(x.result);assert.equal(x.calls.claim,0);});
test('body formatting change without resigning refuses',async()=>{const x=fixture();const edited=Buffer.from(JSON.stringify(JSON.parse(x.rawBody.toString()),null,2));const result=await x.inbox.inspect({request:x.request,rawBody:edited,signature:x.signature});deny(result);assert.equal(x.calls.claim,0);});
test('manual collision in insert never performs a read',async()=>{const x=await run({claimMode:'collision_review'});deny(x.result);assert.equal(x.result.reason,'inbox_collision_manual_review');assert.equal(x.calls.read,0);});
test('invalid claim response fails closed',async()=>{const x=await run({claimMode:'invalid'});deny(x.result);assert.equal(x.result.reason,'claim_or_durability_unverified');});
test('claim failure denies any acknowledgement',async()=>{const x=await run({throwAt:'claim'});deny(x.result);assert.equal(x.calls.read,0);});
test('durability read failure refuses after mock claim',async()=>{const x=await run({throwAt:'read'});deny(x.result);assert.equal(x.result.reason,'claim_or_durability_unverified');});
test('no committed receipt read means NO GO',async()=>{const x=await run({readMode:'empty'});deny(x.result);assert.equal(x.result.reason,'read_after_claim_mismatch');});
for(const readMode of ['wrong_shop','wrong_id','wrong_digest','untrusted','processed'])test(`receipt ${readMode} fails closed`,async()=>{const x=await run({readMode});deny(x.result);assert.equal(x.result.reason,'read_after_claim_mismatch');});
test('unverified reviewer role blocks upstream signature access',async()=>{const x=await run({op:{role:'customer'}});deny(x.result);assert.equal(x.calls.review,0);});
test('cross-tenant auditor mismatch fails at V471',async()=>{const x=await run({op:{shopCode:'qa_shop_b'}});deny(x.result);assert.equal(x.calls.claim,0);});
test('non-disposable environment blocks without signature review',async()=>{const x=await run({env:{environment:'production'}});deny(x.result);assert.equal(x.calls.review,0);});
test('authorization, isolation and signer failures deny',async()=>{for(const throwAt of ['auth','env','review']){const x=await run({throwAt});deny(x.result);assert.equal(x.calls.claim,0);}});
test('batch of two signed events refuses partial persistence',async()=>{const x=await run({events:[evt(),evt('01ARZ3NDEKTSV4RRFFQ69G5FAZ')]});deny(x.result);assert.equal(x.calls.claim,0);});
test('empty legitimate webhook cannot create inbox record',async()=>{const x=await run({events:[]});deny(x.result);assert.equal(x.calls.claim,0);});
test('malformed raw bytes refused before signing adapter',async()=>{const x=await run({}, {rawBody:Buffer.from('{')});deny(x.result);assert.equal(x.calls.review,0);});
test('missing Buffer and oversize are refused early',async()=>{const x=fixture();for(const rawBody of [null,Buffer.alloc(65537)]){const r=await x.inbox.inspect({rawBody,signature:x.signature});deny(r);}assert.equal(x.calls.review,0);});
test('signature review returned by untrusted adapter cannot claim release',async()=>{const x=await run({reviewerOverride:{inspect:async()=>({status:'go',classification:'signature_verified_review_only',novel:1,duplicates:0})}});deny(x.result);assert.equal(x.calls.claim,0);});
test('forged V471 inconsistent novelty count refused',async()=>{const x=await run({reviewerOverride:{inspect:async()=>({status:'no_go',classification:'signature_verified_review_only',novel:2,duplicates:0,releasePermitted:false,writeAuthorized:false,eventAcknowledged:false,lineDeliveryProven:false})}});deny(x.result);assert.equal(x.calls.claim,0);});
test('no real job effects ever appear even when mock ledger is pending',async()=>{const x=await run();const s=JSON.stringify(x.result);assert.doesNotMatch(s,/offline_qa_line_channel_secret_only|01ARZ3|Ubbbbbbbb/);deny(x.result);});

test('V471 adapter cannot be constructed for a different shop scope',()=>{assert.throws(()=>createCar02OfflineWebhookInboxR472({expectedShopCode:SHOP,reviewV471:{scopedShopCode:'qa_shop_b',inspect:async()=>null},authorizeAuditor:async()=>null,inspectIsolation:async()=>null,claimEvent:async()=>null,readClaim:async()=>null}),/ADAPTERS/);});
