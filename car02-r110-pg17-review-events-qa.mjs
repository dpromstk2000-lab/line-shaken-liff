// CAR02 R110 GitHub PG17 ONLY; no external Storage, notifications, or live database access.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createR109Ledger, R109_CONTRACT} from './car02-r109-durable-ledger-isolated.mjs';
import {createR110ReviewLedger,R110_REVIEW_USERS,R110_CONTRACT,assertR110Environment} from './car02-r110-review-events-isolated.mjs';
const DB='car02_r109_qa_ci',T='car02_r109_qa.quarantine_review_events';
const JOB_A='33333333-3333-4333-8333-333333333109',JOB_B='44444444-4444-4444-8444-444444444109';
const PHOTO_A='11111111-1111-4111-8111-111111111109',PHOTO_B='22222222-2222-4222-8222-222222222109';
const PATH_A='street_house_kitsuki/77777777-7777-4777-8777-777777777109/88888888-8888-4888-8888-888888888109/99999999-9999-4999-8999-999999999109.jpg';
const PATH_B='other_shop/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa109/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb109/cccccccc-cccc-4ccc-8ccc-cccccccccc09.png';
const E_A='11111111-1111-4111-8111-111111111110',E_B='22222222-2222-4222-8222-222222222110';
const A={eventId:E_A,shop:'street_house_kitsuki',jobId:JOB_A,eventKind:'EVIDENCE_HASH_RECORDED',proofSha256:'a'.repeat(64)};
const B={eventId:E_B,shop:'other_shop',jobId:JOB_B,eventKind:'ESCALATED_FOR_REVIEW',proofSha256:'b'.repeat(64)};
async function sqlFails(fn,codes,label){let e;try{await fn()}catch(x){e=x;}assert.ok(e,`R110_UNEXPECTED_ALLOW_${label}`);assert.ok(codes.includes(e.code),`R110_SQLSTATE_${label}_${e.code}`);}
export async function runR110Integration(pg){
 const pools=[];
 const pool=(user)=>{
  assert.ok(['postgres','car02_r109_a_ci','car02_r109_b_ci',...Object.keys(R110_REVIEW_USERS)].includes(user));
  const password=user==='postgres'?'disposable-r93s-ci-only':user.startsWith('car02_r109_')?'r109-ci-tenant-local-only':'r110-ci-review-only';
  const p=new pg.Pool({host:'127.0.0.1',port:5432,database:DB,user,password,max:3,
   connectionTimeoutMillis:3000,idleTimeoutMillis:1500,application_name:'car02_r110_disposable_pg17'});
  pools.push(p);return p;
 };
 try{
  const admin=pool('postgres'),pA=pool('car02_r110_a_ci'),pB=pool('car02_r110_b_ci');
  const ledgerA=createR109Ledger({environment:'isolated_qa',dbName:DB,pgPool:pool('car02_r109_a_ci'),expectedUser:'car02_r109_a_ci'});
  const ledgerB=createR109Ledger({environment:'isolated_qa',dbName:DB,pgPool:pool('car02_r109_b_ci'),expectedUser:'car02_r109_b_ci'});
  assert.deepEqual(await ledgerA.enqueue({shop:A.shop,jobId:JOB_A,photoId:PHOTO_A,path:PATH_A,sha256:'a'.repeat(64),reason:'UPLOAD_UNCERTAIN'}),{status:'QUARANTINED',duplicate:false});
  assert.deepEqual(await ledgerB.enqueue({shop:B.shop,jobId:JOB_B,photoId:PHOTO_B,path:PATH_B,sha256:'b'.repeat(64),reason:'ACK_LOST'}),{status:'QUARANTINED',duplicate:false});
  const meta=await admin.query(`SELECT c.relrowsecurity AS enabled,c.relforcerowsecurity AS forced,
   (SELECT count(*)::int FROM pg_policy WHERE polrelid=c.oid) AS policies,
   (SELECT count(*)::int FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal) AS triggers
   FROM pg_class c WHERE c.oid='${T}'::regclass`);
  assert.deepEqual(meta.rows,[{enabled:true,forced:true,policies:2,triggers:2}]);
  for(const user of Object.keys(R110_REVIEW_USERS)){
   const priv=await admin.query(`SELECT has_table_privilege($1,$2,'SELECT') AS can_select,
    has_table_privilege($1,$2,'INSERT') AS can_insert,
    has_table_privilege($1,$2,'UPDATE') AS can_update,
    has_table_privilege($1,$2,'DELETE') AS can_delete,
    has_table_privilege($1,$2,'TRUNCATE') AS can_truncate`,[user,T]);
   assert.deepEqual(priv.rows,[{can_select:true,can_insert:true,can_update:false,can_delete:false,can_truncate:false}]);
  }
  console.log('R110_APPEND_ONLY_RLS_SCHEMA_VERIFIED_PASS');
  const a=createR110ReviewLedger({environment:'isolated_qa',dbName:DB,pgPool:pA,expectedUser:'car02_r110_a_ci'});
  const b=createR110ReviewLedger({environment:'isolated_qa',dbName:DB,pgPool:pB,expectedUser:'car02_r110_b_ci'});
  const first=await Promise.all([a.record(A),a.record(A)]);
  assert.equal(first.filter(x=>!x.duplicate).length,1);assert.equal(first.filter(x=>x.duplicate).length,1);
  assert.deepEqual(await b.record(B),{status:'RECORDED_NOT_AUTHORIZED',duplicate:false});
  assert.equal(await a.count(),1);assert.equal(await b.count(),1);
  assert.deepEqual((await pA.query(`SELECT event_id::text FROM ${T}`)).rows,[{event_id:E_A}]);
  assert.deepEqual((await pB.query(`SELECT event_id::text FROM ${T}`)).rows,[{event_id:E_B}]);
  await sqlFails(()=>pA.query('SET ROLE car02_r110_b_ci'),['42501'],'role_switch');
  await sqlFails(()=>pA.query(`INSERT INTO ${T}(event_id,shop_code,job_id,event_kind,proof_sha256)
   VALUES($1,$2,$3,$4,$5)`,['55555555-5555-4555-8555-555555555110','other_shop',JOB_B,'ESCALATED_FOR_REVIEW','a'.repeat(64)]),['42501'],'cross_shop_insert');
  await sqlFails(()=>pA.query(`INSERT INTO ${T}(event_id,shop_code,job_id,event_kind,proof_sha256)
   VALUES($1,$2,$3,$4,$5)`,['55555555-5555-4555-8555-555555555111',A.shop,JOB_B,'ESCALATED_FOR_REVIEW','a'.repeat(64)]),['23503'],'cross_job_fk');
  await assert.rejects(a.record({...A,eventId:E_B}),/R110_EVENT_REBIND_DENIED/);
  await assert.rejects(a.record({...A,eventKind:'ESCALATED_FOR_REVIEW'}),/R110_EVENT_REBIND_DENIED/);
  assert.equal(await a.count(),1);assert.equal(await b.count(),1);
  console.log('R110_TENANT_FK_IDEMPOTENCY_DENIAL_PASS');
  // A fresh connection represents process restart; review events are durable.
  await pA.end();pools.splice(pools.indexOf(pA),1);
  const freshPool=pool('car02_r110_a_ci');
  const fresh=createR110ReviewLedger({environment:'isolated_qa',dbName:DB,pgPool:freshPool,expectedUser:'car02_r110_a_ci'});
  assert.deepEqual(await fresh.record(A),{status:'RECORDED_NOT_AUTHORIZED',duplicate:true});
  assert.equal(await fresh.count(),1);
  console.log('R110_RESTART_DURABILITY_PASS');
  for(const statement of [`UPDATE ${T} SET event_kind='ESCALATED_FOR_REVIEW' WHERE event_id='${E_A}'`,
   `DELETE FROM ${T} WHERE event_id='${E_A}'`,`TRUNCATE ${T}`])
   await sqlFails(()=>admin.query(statement),['42501'],'immutable_admin');
  for(const statement of [`UPDATE ${T} SET event_kind='ESCALATED_FOR_REVIEW' WHERE event_id='${E_A}'`,
   `DELETE FROM ${T} WHERE event_id='${E_A}'`])
   await sqlFails(()=>freshPool.query(statement),['42501'],'immutable_reviewer');
  const final=await admin.query(`SELECT shop_code,job_id::text,event_kind FROM ${T} ORDER BY shop_code`);
  assert.equal(final.rowCount,2);
  assert.ok(final.rows.every(x=>['EVIDENCE_HASH_RECORDED','ESCALATED_FOR_REVIEW'].includes(x.event_kind)));
  assert.deepEqual((await admin.query(`SELECT state FROM car02_r109_qa.quarantine_ledger ORDER BY shop_code`)).rows,
   [{state:'QUARANTINED'},{state:'QUARANTINED'}]);
  assert.equal(R109_CONTRACT.realStorageDeletion,false);assert.equal(R110_CONTRACT.liveStorageDelete,false);
  console.log('R110_IMMUTABLE_AND_NO_DELETE_AUTHORIZATION_PASS');
  console.log('R110_DISPOSABLE_REVIEW_EVENTS_QA_PASS');
 }finally{await Promise.all(pools.map(p=>p.end().catch(()=>{})));}
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 assertR110Environment(process.env);
 const {default:pg}=await import('pg');await runR110Integration(pg);
}
