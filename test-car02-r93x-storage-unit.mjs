import test from 'node:test';
import assert from 'node:assert/strict';
import {createR93XIsolatedVerifiedStorageLifecycle,R93X_CONTRACT} from './car02-r93x-verified-storage-lifecycle-isolated.mjs';
const SHOP='street_house_kitsuki',ORDER='22222222-2222-4222-8222-222222222222',REPORT='33333333-3333-4333-8333-333333333333';
const STAFF='11111111-1111-4111-8111-111111111111',KEY='88888888-8888-4888-8888-000000000001',PHOTO='99999999-9999-4999-8999-999999999999';
const JPEG=new Uint8Array([255,216,255,224,4,5,6,7,8,9]);
const payload=()=>({actor:{verified:true,role:'staff',shopCode:SHOP,subject:`staff:${STAFF}`},shop:SHOP,orderId:ORDER,reportId:REPORT,mimeType:'image/jpeg',bytes:new Uint8Array(JPEG),intentKey:KEY});
function rig(opts={}){
 let photoState=opts.initialState||'pending',jobs=0;
 const objects=new Map(),count={reserve:0,resume:0,inspect:0,post:0,ready:0,prove:0,recover:0,bucket:0};
 const storage={kind:'isolated_memory',testOnly:true,
  async verifyPrivateBucket(){count.bucket++;return opts.publicBucket?{id:'ksh-car02-private-photos',public:true}:{id:'ksh-car02-private-photos',public:false}},
  async inspectObject({bucket,path}){count.inspect++;if(opts.inspectThrows)throw Error('READ_TIMEOUT');
   const data=objects.get(path);return data?{found:true,private:true,bucket,path,mimeType:'image/jpeg',bytes:opts.corruptRead?new Uint8Array([255,216,255,224,0,1,2,3,4,5]):data}:{found:false,definitive:opts.unknownMissing!==true};},
  async postObject({path,bytes,upsert}){count.post++;assert.equal(upsert,false);
   if(opts.postFailsBeforeWrite)throw Error('POST_FAILED');
   if(!objects.has(path))objects.set(path,new Uint8Array(bytes));
   if(opts.postAckLost)throw Error('ACK_LOST');
   return {status:201};}
 };
 const intents={async reserve(){count.reserve++;return {photoId:PHOTO,state:photoState,
  action:photoState==='ready'?'DO_NOT_REUPLOAD':'VERIFY_STORAGE_OR_COMPENSATE'};},
 async resume(){count.resume++;if(jobs)throw Error('OUTBOX');return {photoId:PHOTO,state:photoState,
  action:photoState==='ready'?'DO_NOT_REUPLOAD':'VERIFY_STORAGE_OR_COMPENSATE'};}};
 const readyPort={async markReady(){count.ready++;if(opts.markReadyDenied)throw Object.assign(Error('denied'),{code:'R93X_STAFF_DENIED'});
  photoState='ready';if(opts.commitAckLost)throw Object.assign(Error('ACK'),{code:'R93X_DB_UNAVAILABLE'});return true;},
 async proveReady(){count.prove++;if(photoState!=='ready'||jobs)throw Error('NOT_READY');return true;},
 async enqueueUncertain(){count.recover++;if(photoState!=='pending')throw Error('NOT_PENDING');photoState='deleted';jobs++;return true;}};
 const make=(options={})=>createR93XIsolatedVerifiedStorageLifecycle({environment:'isolated_qa',dbName:'car02_r93q_qa_ci',shopCode:SHOP,
  intents,readyPort,storage,reviewGate:async()=>options.gate!==false});
 return {make,storage,objects,count,intents,readyPort,get state(){return photoState},get jobs(){return jobs}};
}
for(const name of ['nominal','ack lost after storage write','ready COMMIT acknowledgement lost','already-ready retry','storage write definitely fails','storage readback corrupted','uncertain first read','private bucket wrong','gate closed','deterministic ready rejection']){
 test(`R93X isolated upload: ${name}`,async()=>{
  const options={
   'ack lost after storage write':{postAckLost:true},
   'ready COMMIT acknowledgement lost':{commitAckLost:true},
   'already-ready retry':{initialState:'ready'},
   'storage write definitely fails':{postFailsBeforeWrite:true},
   'storage readback corrupted':{corruptRead:true},
   'uncertain first read':{unknownMissing:true},
   'private bucket wrong':{publicBucket:true},
   'deterministic ready rejection':{markReadyDenied:true}
  }[name]||{};
  const v=rig(options), x=payload();
  if(name==='already-ready retry'){
   const env=(await import('./car02-r93w-durable-http-reservation-isolated.mjs')).buildR93WDurableEnvelope(x);
   v.objects.set(env.path,new Uint8Array(JPEG));
  }
  const bad=['storage write definitely fails','storage readback corrupted','uncertain first read','private bucket wrong','gate closed','deterministic ready rejection'];
  if(name==='gate closed')await assert.rejects(v.make({gate:false}).upload(x),{code:'R93X_GATE_CLOSED'});
  else if(bad.includes(name))await assert.rejects(v.make().upload(x));
  else {const a=await v.make().upload(x);assert.equal(a.state,'ready');assert.equal(a.photoId,PHOTO);assert.equal(a.productionReady,false);}
  if(name==='private bucket wrong'||name==='gate closed'){assert.equal(v.count.reserve,0);assert.equal(v.count.post,0);}
  if(name==='already-ready retry')assert.equal(v.count.post,0);
  if(name==='ack lost after storage write')assert.equal(v.count.post,1);
  if(name==='ready COMMIT acknowledgement lost')assert.equal(v.count.prove>=1,true);
  if(['storage write definitely fails','storage readback corrupted','uncertain first read'].includes(name)){assert.equal(v.jobs,1);assert.equal(v.state,'deleted');}
  if(name==='deterministic ready rejection')assert.equal(v.jobs,1);
 });
}
test('R93X retry does not post twice after successful first write',async()=>{
 const v=rig();const a=await v.make().upload(payload());const b=await v.make().upload(payload());
 assert.equal(a.photoId,b.photoId);assert.equal(v.count.post,1);assert.equal(v.count.prove,2);
});
test('R93X rejects mutated image under reused key before any persistent side effect',async()=>{
 const x=payload();x.bytes=new Uint8Array([1,2,3,4]);const v=rig();
 await assert.rejects(v.make().upload(x),{code:'R93W_UNVERIFIED_IMAGE'});assert.equal(v.count.reserve,0);
});
for(const option of [
 {dbName:'production'},{environment:'production'},{storage:{kind:'real_supabase',testOnly:true,verifyPrivateBucket(){},postObject(){},inspectObject(){}}},
 {readyPort:null},{intents:null},{shopCode:'wrong shop'}]){
 test('R93X constructor refuses non-isolated/invalid dependency '+JSON.stringify(option),()=>{
 const r=rig();assert.throws(()=>createR93XIsolatedVerifiedStorageLifecycle({environment:'isolated_qa',dbName:'car02_r93q_qa_ci',shopCode:SHOP,
  intents:r.intents,readyPort:r.readyPort,storage:r.storage,reviewGate:async()=>true,...option}),{code:'R93X_ISOLATED_DEPENDENCIES_REQUIRED'});
 });
}
test('R93X contract denies public release and live Storage',()=>{
 assert.equal(R93X_CONTRACT.productionReady,false);assert.equal(R93X_CONTRACT.liveSupabaseStorageConnected,false);
 assert.equal(R93X_CONTRACT.releaseDecision,'NO_GO');assert.equal(R93X_CONTRACT.migrationDecision,'HOLD');
});
