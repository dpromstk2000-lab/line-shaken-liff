import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createR93IIsolatedR47SafeBridge,R93I_CONTRACT} from './car02-r93i-r47-safe-bridge-isolated.mjs';
const SHOP='street_house_kitsuki';
const I='44444444-4444-4444-8444-444444444444';
const O='22222222-2222-4222-8222-222222222222';
const R='33333333-3333-4333-8333-333333333333';
const jpeg=()=>Uint8Array.from([255,216,255,225,13,10,11,12,255,217]);
const png=()=>Uint8Array.from([137,80,78,71,13,10,26,10,4,5,6]);
const webp=()=>Uint8Array.from([82,73,70,70,2,0,0,0,87,69,66,80,1]);
const actor=()=>({verified:true,role:'staff',shopCode:SHOP,subject:`staff:${I}`});
const request=(bytes=jpeg(),mimeType='image/jpeg')=>({actor:actor(),shop:SHOP,orderId:O,reportId:R,mimeType,bytes});
const asError=(fn,code)=>assert.rejects(fn,e=>e?.message===code);
function fixture({release=true,releaseThrows=false,failed='',postStatus=201,readbackValid=true,
  queue=true,ready=true,bucketPublic=false,mutateDuringRelease=false,commitBeforeFailure=false}={}){
 const calls=[],objects=new Map(),db={state:'none'};
 const check=n=>{calls.push(n);if(failed===n)throw Error('SECRET_OWNED_DATABASE_DSN');};
 let heldInput=null;
 const repository={
  async reserve(x){check('reserve');db.state='pending';db.path=x.path;db.record=x;return {photoId:I,state:'pending'}},
  async markReady(x){if(commitBeforeFailure)db.state='ready';check('markReady');if(ready){db.state='ready';return true}return false},
  async tombstoneAndEnqueue(x){check('tombstoneAndEnqueue');if(!queue||db.state!=='pending'||x.path!==db.path)return false;
    db.state='deleted';db.outbox=1;return true}
 };
 const storage={
  async verifyPrivateBucket(){check('verifyPrivateBucket');return {id:'ksh-car02-private-photos',public:bucketPublic}},
  async postObject({path,bytes}){check('postObject');objects.set(path,Uint8Array.from(bytes));return {status:postStatus}},
  async inspectObject({path}){check('inspectObject');return {private:true,mimeType:db.record.mimeType,
    bytes:readbackValid?objects.get(path):Uint8Array.from([255,216,255,0])}}
 };
 const releaseEnabled=async()=>{check('releaseEnabled');if(releaseThrows)throw Error('SECRET_TOKEN');
    if(mutateDuringRelease&&heldInput)heldInput[3]=99;return release};
 const bridge=createR93IIsolatedR47SafeBridge({environment:'isolated_qa',dbName:'car02_r93i_qa_fixture',
  releaseEnabled,repository,storage});
 return {bridge,calls,db,objects,bindInput:x=>{heldInput=x}};
}
const count=(f,k)=>f.calls.filter(s=>s===k).length;
test('R93I contract is not wired or production ready',()=>{
 assert.equal(R93I_CONTRACT.liveWiring,false);assert.equal(R93I_CONTRACT.productionReady,false);
 assert.equal(R93I_CONTRACT.releaseDecision,'NO_GO');assert.equal(R93I_CONTRACT.migrationDecision,'HOLD');
 assert.equal(R93I_CONTRACT.r47LegacyStillUnchanged,true);
});
for(const env of [undefined,'production','stage',null,'isolated_qa '])test('rejects non QA environment '+String(env),()=>{
 assert.throws(()=>createR93IIsolatedR47SafeBridge({environment:env,dbName:'car02_r93i_qa_fixture'}),/R93I_ISOLATION_REQUIRED/);
});
for(const dbName of [undefined,'postgres','liff-salon-reserve','car02_r93i_qa','car02_r93i_qa_../live','CAR02_R93I_QA',null])
 test('rejects non QA database '+String(dbName),()=>assert.throws(()=>createR93IIsolatedR47SafeBridge({environment:'isolated_qa',dbName}),/R93I_ISOLATION_REQUIRED/));
for(const bytesMime of [[jpeg,'image/jpeg'],[png,'image/png'],[webp,'image/webp']])
 test('R47 success surface for '+bytesMime[1]+' preserves bytes and digest',async()=>{
  const fx=fixture(),bytes=bytesMime[0](),r=await fx.bridge.upload(request(bytes,bytesMime[1]));
  assert.deepEqual(Object.keys(r),['photoId','state','mimeType','byteSize','sha256']);
  assert.equal(Object.isFrozen(r),true);
  assert.equal(r.photoId,I);assert.equal(r.state,'ready');assert.equal(r.byteSize,bytes.byteLength);
  assert.equal(r.mimeType,bytesMime[1]);assert.equal(r.sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.equal(fx.db.state,'ready');assert.equal(fx.db.outbox,undefined);
  assert.deepEqual(fx.calls,['releaseEnabled','verifyPrivateBucket','reserve','postObject','inspectObject','markReady']);
 });
for(const cfg of [{release:false},{releaseThrows:true}])
 test('release gate fail closed even in isolation '+JSON.stringify(cfg),async()=>{
  const fx=fixture(cfg);await asError(()=>fx.bridge.upload(request()),'R93I_NOT_RELEASED');
  assert.deepEqual(fx.calls,['releaseEnabled']);
 });
for(const bytes of [new Uint8Array(),new Uint8Array(5242881),null,'jpeg',[255,216,255,4]])
 test('invalid byte container or cap rejected without any adapter calls '+String(bytes?.length),async()=>{
  const fx=fixture();await asError(()=>fx.bridge.upload(request(bytes)),'R93I_IMAGE_INVALID');assert.deepEqual(fx.calls,[]);
 });
test('byte copy is not affected by a concurrent caller mutation during release check',async()=>{
 const fx=fixture({mutateDuringRelease:true}),bytes=jpeg(),copy=bytes.slice();fx.bindInput(bytes);
 const r=await fx.bridge.upload(request(bytes));
 assert.notDeepEqual(bytes,copy);assert.equal(r.sha256,createHash('sha256').update(copy).digest('hex'));
 assert.deepEqual([...fx.objects.values()][0],copy);
});
for(const cfg of [{failed:'postObject'},{postStatus:409},{postStatus:500},
  {failed:'inspectObject'},{readbackValid:false},{ready:false},{failed:'markReady'}])
 test('uncertain upload '+JSON.stringify(cfg)+' results in durable compensation without DELETE',async()=>{
  const fx=fixture(cfg);await asError(()=>fx.bridge.upload(request()),'R93H_UPLOAD_FAILED_RECOVERY_QUEUED');
  assert.equal(fx.db.state,'deleted');assert.equal(fx.db.outbox,1);
  assert.equal(count(fx,'tombstoneAndEnqueue'),1);assert.equal(count(fx,'deleteObject'),0);
 });
for(const cfg of [{failed:'postObject',queue:false},{postStatus:500,queue:false},
  {readbackValid:false,queue:false},{ready:false,queue:false},
  {commitBeforeFailure:true,failed:'markReady'}])
 test('unconfirmed cleanup remains failure, never success '+JSON.stringify(cfg),async()=>{
  const fx=fixture(cfg);await asError(()=>fx.bridge.upload(request()),'R93H_COMPENSATION_UNCONFIRMED');
  if(cfg.commitBeforeFailure)assert.equal(fx.db.state,'ready'); // ACK lost after commit: never tombstone a ready photo.
  else assert.notEqual(fx.db.state,'ready');
 });
for(const cfg of [{failed:'reserve'},{bucketPublic:true},{failed:'verifyPrivateBucket'}])
 test('reservation and bucket errors do not touch Storage '+JSON.stringify(cfg),async()=>{
  const fx=fixture(cfg);const e=cfg.failed==='reserve'?'R93H_RESERVATION_UNCERTAIN':'R93H_PRIVATE_BUCKET_UNVERIFIED';
  await asError(()=>fx.bridge.upload(request()),e);
  assert.equal(count(fx,'postObject'),0);assert.equal(count(fx,'tombstoneAndEnqueue'),0);
 });
for(const mutate of [q=>q.actor.verified=false,q=>q.actor.role='customer',q=>q.actor.shopCode='other_shop',
  q=>q.actor.subject='line:untrusted',q=>q.shop='other_shop',q=>q.orderId='../bad',q=>q.reportId='bad',
  q=>q.mimeType='image/svg+xml',q=>q.bytes[0]=0])
 test('R47 caller forgery rejected before DB reservation',async()=>{
  const fx=fixture(),q=request();mutate(q);await asError(()=>fx.bridge.upload(q),'R93H_INVALID_AUTH_OR_IMAGE');
  assert.equal(count(fx,'reserve'),0);assert.equal(count(fx,'postObject'),0);
 });

test('repository refuses durable enqueue with no pending tombstone; no fake success',async()=>{
 const fx=fixture({failed:'tombstoneAndEnqueue',postStatus:500});
 await asError(()=>fx.bridge.upload(request()),'R93H_COMPENSATION_UNCONFIRMED');
 assert.equal(count(fx,'tombstoneAndEnqueue'),1);assert.equal(fx.db.state,'pending');
});
