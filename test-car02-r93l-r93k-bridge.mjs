import test from 'node:test';
import assert from 'node:assert/strict';
import {createR93LAtomicPgCompensationIsolated} from './car02-r93l-pg-compensation-isolated.mjs';
import {createR93KIsolatedR83RepositoryBridge} from './car02-r93k-r83-repository-bridge-isolated.mjs';
const SHOP='street_house_kitsuki',PHOTO='44444444-4444-4444-8444-444444444444';
const O='22222222-2222-4222-8222-222222222222',R='33333333-3333-4333-8333-333333333333';
const USER='11111111-1111-4111-8111-111111111111';
const PATH=`${SHOP}/${O}/${R}/77777777-7777-4777-8777-777777777777.jpg`;
const ACTOR={verified:true,role:'staff',shopCode:SHOP,subject:'staff:'+USER};
function setup({tamper=false,collision=false}={}){
 let state='pending',outbox=0;const log=[];
 const pool={connect:async()=>({
  async query(q){log.push(q);if(q==='BEGIN'||q==='COMMIT'||q==='ROLLBACK'||q.startsWith('SET LOCAL'))return {rows:[]};
   if(q.startsWith('SELECT current_database'))return {rows:[{db:'car02_r93l_qa_ci',photo_table:true,outbox_table:true,no_live_photos:true}]};
   if(q.includes('FROM car02_r93l_qa.staff'))return {rows:[{role:'staff',active:true}]};
   if(q.includes('FROM car02_r93l_qa.photos p'))return {rows:[{id:PHOTO,upload_state:state,storage_bucket:'ksh-car02-private-photos',storage_path:PATH}]};
   if(q.startsWith('UPDATE car02_r93l_qa.photos')){state='deleted';return {rows:[{id:PHOTO,upload_state:state}]}}
   if(q.startsWith('INSERT INTO car02_r93l_qa.cleanup_jobs')){if(collision)throw new Error('duplicate');outbox++;return{rows:[{job_id:'55555555-5555-4555-8555-555555555555',state:'queued'}]}}
   return {rows:[]};},release(){} })};
 const port=createR93LAtomicPgCompensationIsolated({environment:'isolated_qa',dbName:'car02_r93l_qa_ci',shopCode:SHOP,pool,reviewGate:async()=>true});
 const r83={async reserve(){return{id:PHOTO}},async markReady(){return{id:PHOTO,state:'ready'}},
 async getPending(){return{id:PHOTO,upload_state:'pending',storage_bucket:'ksh-car02-private-photos',storage_path:tamper?PATH.replace('77777777','99999999'):PATH,mime_type:'image/jpeg',byte_size:10,sha256:'a'.repeat(64)}}};
 const bridge=createR93KIsolatedR83RepositoryBridge({environment:'isolated_qa',dbName:'car02_r93k_qa_fake',r83Port:r83,atomicCompensationPort:port});
 return {bridge,log,record:()=>({state,outbox})};
}
const params={actor:ACTOR,shopCode:SHOP,photoId:PHOTO,orderId:O,reportId:R,path:PATH,bucket:'ksh-car02-private-photos',expectedState:'pending',reason:'UPLOAD_UNCERTAIN'};
test('R93K invokes R93L transactional compensation and verifies committed receipt',async()=>{
 const a=setup();const ok=await a.bridge.tombstoneAndEnqueue(params);
 assert.equal(ok,true);assert.deepEqual(a.record(),{state:'deleted',outbox:1});
 assert(a.log.includes('COMMIT'));assert(!a.log.includes('ROLLBACK'));
});
test('R93K rejects tampered R83 pending read before R93L ever queries DB',async()=>{
 const a=setup({tamper:true});await assert.rejects(()=>a.bridge.tombstoneAndEnqueue(params),/R93K_PENDING_IDENTITY_MISMATCH/);
 assert.deepEqual(a.log,[]);
});
test('R93L refuses failed outbox with rollback, R93K refuses success',async()=>{
 const a=setup({collision:true});await assert.rejects(()=>a.bridge.tombstoneAndEnqueue(params),/R93L_COMPENSATION_UNAVAILABLE/);
 assert(a.log.includes('ROLLBACK'));
});
