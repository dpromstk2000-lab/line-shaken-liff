import test from 'node:test';
import assert from 'node:assert/strict';
import {createR93LAtomicPgCompensationIsolated as make,R93L_CONTRACT} from './car02-r93l-pg-compensation-isolated.mjs';
const SHOP='street_house_kitsuki',DB='car02_r93l_qa_ci';
const PHOTO='44444444-4444-4444-8444-444444444444';
const ORDER='22222222-2222-4222-8222-222222222222';
const REPORT='33333333-3333-4333-8333-333333333333';
const USER='11111111-1111-4111-8111-111111111111';
const JOB='55555555-5555-4555-8555-555555555555';
const PATH=`${SHOP}/${ORDER}/${REPORT}/77777777-7777-4777-8777-777777777777.jpg`;
const input=()=>({actor:{verified:true,role:'staff',shopCode:SHOP,subject:'staff:'+USER},shop:SHOP,
 photoId:PHOTO,orderId:ORDER,reportId:REPORT,bucket:'ksh-car02-private-photos',path:PATH,
 expectedState:'pending',reason:'UPLOAD_UNCERTAIN'});
function mock({db=DB,photoTable=true,outboxTable=true,noLivePhotos=true,identity=true,
 row=true,state='pending',path=PATH,failAt='',badResult='',gate=true,throwGate=false}={}){
 const log=[];let released=0;
 const pool={async connect(){log.push(['connect']);if(failAt==='connect')throw Error('SECRET_POSTGRES_URL');return {
   async query(sql,args){log.push([sql,args]);
     if(sql.includes('BEGIN')&&failAt==='BEGIN')throw Error('SECRET');
     if(failAt && sql.includes(failAt))throw Error('SECRET');
     if(sql.startsWith('SELECT current_database'))return {rows:[{db,photo_table:photoTable,outbox_table:outboxTable,no_live_photos:noLivePhotos}]};
     if(sql.includes('FROM car02_r93l_qa.staff'))return {rows:identity?[{role:'staff',active:true}]:[]};
     if(sql.includes('FROM car02_r93l_qa.photos p'))return {rows:row?[{id:PHOTO,upload_state:state,shop_code:SHOP,order_id:ORDER,report_id:REPORT,storage_bucket:'ksh-car02-private-photos',storage_path:path}]:[]};
     if(sql.startsWith('UPDATE car02_r93l_qa.photos'))return {rows:badResult==='update'?[]:[{id:PHOTO,upload_state:'deleted'}]};
     if(sql.startsWith('INSERT INTO car02_r93l_qa.cleanup_jobs'))return {rows:badResult==='insert'?[]:[{job_id:JOB,state:'queued'}]};
     return {rows:[]};
   },release(){released++;log.push(['release'])}
 }}};
 const makeService=()=>make({environment:'isolated_qa',dbName:DB,shopCode:SHOP,pool,reviewGate:async()=>{log.push(['gate']);if(throwGate)throw Error('SECRET');return gate}});
 return {pool,log,makeService,released:()=>released};
}
const failAs=async(fn,code)=>assert.rejects(fn,e=>e.message===code);
test('R93L is never live, imports no credentials and requires separate migration',()=>{
 assert.equal(R93L_CONTRACT.liveWiring,false);assert.equal(R93L_CONTRACT.productionReady,false);
 assert.equal(R93L_CONTRACT.releaseDecision,'NO_GO');assert.equal(R93L_CONTRACT.migrationDecision,'HOLD');
 assert.equal(R93L_CONTRACT.fullR83R93HLiveIntegrationComplete,false);
});
for(const [name,v] of [['environment','production'],['environment',undefined],['dbName','postgres'],
 ['dbName','car02_r93l_qa_'],['shopCode','../other'],['pool',{}],['reviewGate',null]])
 test('R93L rejects invalid constructor '+name+String(v),()=>{
  const f=mock();assert.throws(()=>make({environment:'isolated_qa',dbName:DB,shopCode:SHOP,pool:f.pool,reviewGate:async()=>true,[name]:v}),/R93L_ISOLATION_REQUIRED/);
 });
test('R93L atomically returns receipt only AFTER COMMIT',async()=>{
 const f=mock();const out=await f.makeService().tombstoneAndEnqueue(input());
 assert.deepEqual(out,{photoId:PHOTO,state:'deleted',cleanupState:'queued',shopCode:SHOP,storagePath:PATH,jobId:JOB,atomicCommit:true});
 assert(Object.isFrozen(out));
 const q=f.log.map(x=>x[0]);assert(q.indexOf('COMMIT')>q.findIndex(x=>x.startsWith('INSERT INTO')));
 assert(!q.includes('ROLLBACK'));assert.equal(f.released(),1);
 assert.deepEqual(f.log.find(x=>x[0].startsWith('UPDATE '))[1],[PHOTO,SHOP,ORDER,REPORT,'ksh-car02-private-photos',PATH]);
});
const updates=[['wrong tenant',q=>q.shop='other_shop'],['actor tenant',q=>q.actor.shopCode='other_shop'],
 ['wrong actor role',q=>q.actor.role='admin'],['no verification',q=>q.actor.verified=false],
 ['LINE subject',q=>q.actor.subject='line:'+USER],['no role',q=>q.actor.role=''],
 ['wrong photo',q=>q.photoId='bad'],['wrong order',q=>q.orderId='bad'],['wrong report',q=>q.reportId='bad'],
 ['wrong bucket',q=>q.bucket='public'],['wrong path',q=>q.path='else/photo.jpg'],
 ['wrong path UUID',q=>q.path=PATH.replace('77777777','XXXXXXXX')],['expected ready',q=>q.expectedState='ready'],
 ['wrong reason',q=>q.reason='CUSTOM']];
for(const [name,patch] of updates)test('rejects '+name+' BEFORE connecting',async()=>{
 const f=mock(),q=input();patch(q);await failAs(()=>f.makeService().tombstoneAndEnqueue(q),/wrong actor role|LINE subject|no role|no verification/i.test(name)?'R93L_IDENTITY_INVALID':'R93L_SCOPE_INVALID');
 assert.equal(f.log.filter(x=>x[0]==='connect').length,0);
});
for(const cfg of [{gate:false},{throwGate:true}])test('review gate fails closed '+JSON.stringify(cfg),async()=>{
 const f=mock(cfg);await failAs(()=>f.makeService().tombstoneAndEnqueue(input()),'R93L_REVIEW_GATE_CLOSED');
 assert(!f.log.some(x=>x[0]==='connect'));
});
for(const [name,cfg,code] of [
 ['wrong database',{db:'production'},'R93L_NOT_DISPOSABLE_DB'],
 ['missing tables',{outboxTable:false},'R93L_NOT_DISPOSABLE_DB'],
 ['production tables',{noLivePhotos:false},'R93L_NOT_DISPOSABLE_DB'],
 ['inactive identity',{identity:false},'R93L_STAFF_DENIED'],
 ['photo missing',{row:false},'R93L_PHOTO_NOT_PENDING_OR_SCOPE_MISMATCH'],
 ['photo already ready',{state:'ready'},'R93L_PHOTO_NOT_PENDING_OR_SCOPE_MISMATCH'],
 ['photo already deleted',{state:'deleted'},'R93L_PHOTO_NOT_PENDING_OR_SCOPE_MISMATCH'],
 ['path swapped',{path:PATH.replace('77777777','99999999')},'R93L_PHOTO_NOT_PENDING_OR_SCOPE_MISMATCH'],
 ['update race',{badResult:'update'},'R93L_UPDATE_CONFLICT'],
 ['job missing',{badResult:'insert'},'R93L_OUTBOX_UNVERIFIED'],
 ['insert collision',{failAt:'INSERT INTO car02_r93l_qa.cleanup_jobs'},'R93L_COMPENSATION_UNAVAILABLE'],
 ['commit lost',{failAt:'COMMIT'},'R93L_COMPENSATION_UNAVAILABLE'],
 ])test(name+' rolls back and releases',async()=>{
 const f=mock(cfg);await failAs(()=>f.makeService().tombstoneAndEnqueue(input()),code);
 assert(f.log.some(x=>x[0]==='ROLLBACK'));assert.equal(f.released(),1);
});
test('no SQL interpolation of actor ID, shop or blob path',async()=>{
 const f=mock();await f.makeService().tombstoneAndEnqueue(input());
 const q=f.log.filter(x=>x[1]);
 assert(q.every(x=>!x[0].includes(PATH)&&!x[0].includes(USER)&&!x[0].includes(SHOP)));
 assert(q.some(x=>x[1].includes(SHOP)));
});
test('exception never leaks DB URL or SQL adapter private details',async()=>{
 const f=mock({failAt:'UPDATE'});await failAs(()=>f.makeService().tombstoneAndEnqueue(input()),'R93L_COMPENSATION_UNAVAILABLE');
});
