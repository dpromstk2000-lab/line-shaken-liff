import test from 'node:test';
import assert from 'node:assert/strict';
import {createR93MIsolatedPgPhotoLifecycle,R93M_CONTRACT} from './car02-r93m-pg-photo-lifecycle-isolated.mjs';
const S='street_house_kitsuki',O='22222222-2222-4222-8222-222222222222',R='33333333-3333-4333-8333-333333333333';
const P='44444444-4444-4444-8444-444444444444',J='55555555-5555-4555-8555-555555555555',STAFF='11111111-1111-4111-8111-111111111111';
const path=`${S}/${O}/${R}/77777777-7777-4777-8777-777777777777.jpg`;
const actor=()=>({verified:true,shopCode:S,role:'staff',subject:`staff:${STAFF}`});
const reserve=()=>({actor:actor(),shopCode:S,orderId:O,reportId:R,bucket:'ksh-car02-private-photos',path,mimeType:'image/jpeg',byteSize:200,sha256:'a'.repeat(64)});
const key=()=>({actor:actor(),shopCode:S,photoId:P,orderId:O,reportId:R,bucket:'ksh-car02-private-photos',path,expectedState:'pending'});
function fixture({database='car02_r93m_qa_ci',schema=true,liveTable=false,gate=true,staffActive=true,staffRole='staff',draft=true,preloaded=null,failOn='',commitAckLost=false}={}){
 const events=[];
 const state={photos:new Map(),jobs:new Map(),staffActive,staffRole,draft};
 if(preloaded)state.photos.set(preloaded.path||path,{id:P,shop_code:S,order_id:O,report_id:R,storage_bucket:'ksh-car02-private-photos',storage_path:path,mime_type:'image/jpeg',byte_size:200,sha256:'a'.repeat(64),upload_state:preloaded.state});
 const copy=s=>({photos:new Map([...s.photos].map(([k,v])=>[k,{...v}])),jobs:new Map([...s.jobs].map(([k,v])=>[k,{...v}])),staffActive:s.staffActive,staffRole:s.staffRole,draft:s.draft});
 let enabled=gate;
 const pool={async connect(){events.push('connect');let work=state,transaction=false;
  return {async query(q,params=[]){
   const text=q.trim();
   if(text==='BEGIN'){events.push('BEGIN');work=copy(state);transaction=true;return {rows:[]}}
   if(text==='COMMIT'){events.push('COMMIT');if(!transaction)throw Error('bad tx');Object.assign(state,copy(work));transaction=false;if(commitAckLost)throw Error('ack lost after COMMIT');return {rows:[]}}
   if(text==='ROLLBACK'){events.push('ROLLBACK');transaction=false;return {rows:[]}}
   if(text.startsWith('SET LOCAL'))return {rows:[]};
   if(!transaction)throw Error('QUERY_OUTSIDE_TX');
   if(text.includes('current_database() AS db'))return {rows:[{db:database,staff_table:schema,photo_table:schema,outbox_table:schema,no_live_photos:!liveTable}]};
   if(text.includes('FROM car02_r93m_qa.staff'))return {rows:work.staffActive&&params[1]===STAFF?[{role:work.staffRole,active:true}]:[{role:work.staffRole,active:false}]};
   if(text.includes('FROM car02_r93m_qa.work_orders o JOIN'))return {rows:params[0]===O&&params[1]===S&&params[2]===R?[{order_id:O,report_id:R,order_status:work.draft?'draft':'completed'}]:[]};
   if(text.includes('count(*)::integer'))return {rows:[{n:[...work.photos.values()].filter(x=>x.upload_state!=='deleted').length}]};
   if(text.startsWith('INSERT INTO car02_r93m_qa.photos')){events.push('insertPhoto');if(failOn==='insertPhoto')throw Error('SECRET_CONN_STR');if(work.photos.has(params[4]))throw Error('unique');work.photos.set(params[4],{id:P,shop_code:params[0],order_id:params[1],report_id:params[2],storage_bucket:params[3],storage_path:params[4],mime_type:params[5],byte_size:params[6],sha256:params[7],upload_state:'pending'});return {rows:[{id:P,upload_state:'pending'}]};}
   if(text.includes('FROM car02_r93m_qa.photos p')){events.push('findPhoto');const x=work.photos.get(path);return {rows:x&&params[0]===x.id&&params[1]===S&&params[2]===O&&params[3]===R?[{...x,order_status:work.draft?'draft':'completed'}]:[]};}
   if(text.startsWith('UPDATE car02_r93m_qa.photos')){events.push('update');if(failOn==='update')throw Error('SECRET_CONN_STR');const x=work.photos.get(path);if(!x||x.upload_state!=='pending'||x.id!==params[0]||params[4]!==path)return {rows:[]};x.upload_state=text.includes("upload_state='ready'")?'ready':'deleted';return {rows:[{id:P,upload_state:x.upload_state}]};}
   if(text.startsWith('INSERT INTO car02_r93m_qa.cleanup_jobs')){events.push('insertJob');if(failOn==='insertJob'||work.jobs.has(params[0]))throw Error('SECRET_DB_URL');work.jobs.set(params[0],{job_id:J,photo_id:params[0],shop_code:params[1],storage_path:params[2],state:'queued'});return {rows:[{job_id:J,state:'queued'}]};}
   throw Error('UNEXPECTED_SQL:'+text.slice(0,30));
  },release(){events.push('release')}};
 }};
 const create=(override={})=>createR93MIsolatedPgPhotoLifecycle({environment:'isolated_qa',dbName:database,shopCode:S,pool,reviewGate:async()=>enabled,...override});
 return {create,state,events,setGate:x=>enabled=x};
}
async function errorCode(f,code){await assert.rejects(f,e=>e?.code===code||e?.message===code)}
test('R93M hard lock contract is not production wiring',()=>{
 assert.deepEqual([R93M_CONTRACT.productionReady,R93M_CONTRACT.liveWiring,R93M_CONTRACT.productionMigrationApproved],[false,false,false]);
 assert.equal(R93M_CONTRACT.releaseDecision,'NO_GO');assert.equal(R93M_CONTRACT.migrationDecision,'HOLD');
});
for(const bad of ['production','staging','',null,undefined,'isolated_qa '])test('denies environment '+String(bad),()=>assert.throws(()=>fixture().create({environment:bad}),/R93M_ISOLATION_REQUIRED/));
for(const bad of ['postgres','car02_r93m_qa','car02_r93m_qa_../real','car02_r93l_qa_ci',null,'CAR02_R93M_QA_CI'])test('denies non QA db '+String(bad),()=>assert.throws(()=>fixture().create({dbName:bad}),/R93M_ISOLATION_REQUIRED/));
for(const bad of ['',null,'../../user'])test('denies wrong configured shop '+String(bad),()=>assert.throws(()=>fixture().create({shopCode:bad}),/R93M_ISOLATION_REQUIRED/));
for(const options of [{gate:false},{schema:false},{liveTable:true},{database:'car02_r93m_qa_other'}])test('fail closed on QA gate and DB identity '+JSON.stringify(options),async()=>{
 const f=fixture(options);const service=f.create({dbName:'car02_r93m_qa_ci'});
 await errorCode(()=>service.reserve(reserve()),options.gate===false?'R93M_GATE_CLOSED':'R93M_NOT_DISPOSABLE_DB');
 assert.equal(f.state.photos.size,0);assert.equal(f.events.includes('COMMIT'),false);
});
for(const mutation of [
 x=>x.actor.verified=false,x=>x.actor.role='admin',x=>x.actor.subject='line:123',x=>x.actor.shopCode='other',
 x=>x.shopCode='other',x=>x.orderId='../../x',x=>x.reportId='bad',x=>x.mimeType='image/svg+xml',
 x=>x.path=x.path.replace(S,'other_shop'),x=>x.path=x.path.replace('77777777','NOT-UUID1'),
 x=>x.byteSize=0,x=>x.byteSize=5242881,x=>x.sha256='a'.repeat(63),x=>x.bucket='public'
])test('rejects unsafe photo metadata before DB query '+mutation.toString().slice(0,40),async()=>{
 const f=fixture(),x=reserve();mutation(x);await assert.rejects(()=>f.create().reserve(x));assert.equal(f.events.includes('connect'),false);
});
for(const options of [{staffActive:false},{staffRole:'owner'},{draft:false}])test('cannot reserve with invalid current DB role or completed order '+JSON.stringify(options),async()=>{
 const f=fixture(options);await assert.rejects(()=>f.create().reserve(reserve()));assert.equal(f.state.photos.size,0);
 assert.equal(f.events.includes('ROLLBACK'),true);
});
test('valid reservation creates pending row, staff checked within locked DB transaction',async()=>{
 const f=fixture(),service=f.create(),r=await service.reserve(reserve());assert.deepEqual(r,{photoId:P,state:'pending'});
 assert.equal(f.state.photos.get(path).upload_state,'pending');assert.equal(f.events.includes('COMMIT'),true);
 assert.equal(f.events.indexOf('BEGIN')<f.events.indexOf('insertPhoto'),true);
});
for(let n of [3,4])test('enforces max three active photos '+n,async()=>{
 const f=fixture();for(let i=0;i<n;i++)f.state.photos.set(`${i}.jpg`,{upload_state:'ready'});
 await errorCode(()=>f.create().reserve(reserve()),'R93M_THREE_PHOTO_LIMIT');assert.equal(f.state.photos.size,n);
});
test('deleted photos do not count toward report limit',async()=>{
 const f=fixture();for(let i=0;i<3;i++)f.state.photos.set(`${i}.jpg`,{upload_state:'deleted'});
 assert.equal((await f.create().reserve(reserve())).state,'pending');
});
test('markReady is verified and idempotence is not assumed',async()=>{
 const f=fixture({preloaded:{state:'pending'}}),service=f.create();assert.equal(await service.markReady(key()),true);
 assert.equal(f.state.photos.get(path).upload_state,'ready');await errorCode(()=>service.markReady(key()),'R93M_NOT_PENDING');
});
test('tombstone and durable outbox committed together',async()=>{
 const f=fixture({preloaded:{state:'pending'}}),service=f.create();assert.equal(await service.tombstoneAndEnqueue({...key(),reason:'UPLOAD_UNCERTAIN'}),true);
 assert.equal(f.state.photos.get(path).upload_state,'deleted');assert.equal(f.state.jobs.get(P).storage_path,path);
 assert.equal(f.events.includes('COMMIT'),true);
});
for(const options of [{failOn:'update'},{failOn:'insertJob'}])test('tombstone and outbox rollback together on failure '+JSON.stringify(options),async()=>{
 const f=fixture({...options,preloaded:{state:'pending'}});await errorCode(()=>f.create().tombstoneAndEnqueue({...key(),reason:'UPLOAD_UNCERTAIN'}),'R93M_DATABASE_UNAVAILABLE');
 assert.equal(f.state.photos.get(path).upload_state,'pending');assert.equal(f.state.jobs.size,0);
 assert.equal(f.events.includes('ROLLBACK'),true);
});
for(const state of ['ready','deleted'])test('never compensates '+state+' evidence',async()=>{
 const f=fixture({preloaded:{state}}),service=f.create();await errorCode(()=>service.tombstoneAndEnqueue({...key(),reason:'UPLOAD_UNCERTAIN'}),'R93M_NOT_PENDING');
 assert.equal(f.state.photos.get(path).upload_state,state);assert.equal(f.state.jobs.size,0);
});
for(const mutation of [x=>x.path='other/path.jpg',x=>x.reportId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',x=>x.photoId=J,x=>x.bucket='public',x=>x.expectedState='ready',x=>x.actor.role='owner'])test('rejects wrong completion/cancellation scope '+mutation.toString().slice(0,35),async()=>{
 const f=fixture({preloaded:{state:'pending'}}),x=key();mutation(x);
 await assert.rejects(()=>f.create().tombstoneAndEnqueue({...x,reason:'UPLOAD_UNCERTAIN'}));assert.equal(f.state.jobs.size,0);assert.equal(f.state.photos.get(path).upload_state,'pending');
});
test('committed photo never compensates after ambiguous ACK',async()=>{
 const f=fixture({preloaded:{state:'pending'},commitAckLost:true});
 await errorCode(()=>f.create().markReady(key()),'R93M_DATABASE_UNAVAILABLE');
 assert.equal(f.state.photos.get(path).upload_state,'ready');
 await errorCode(()=>f.create().tombstoneAndEnqueue({...key(),reason:'UPLOAD_UNCERTAIN'}),'R93M_NOT_PENDING');
 assert.equal(f.state.jobs.size,0);
});
test('invalid legacy R83 cancellation is not exposed',()=>{
 const service=fixture().create();assert.equal('cancel' in service,false);assert.equal('deleteObject' in service,false);
 assert.deepEqual(Object.keys(service),['reserve','markReady','tombstoneAndEnqueue']);
});

test('valid but different tenant config cannot accept requested shop',async()=>{const f=fixture();await assert.rejects(()=>f.create({shopCode:'other_shop'}).reserve(reserve()));assert.equal(f.events.includes('connect'),false)});
