// CAR02 R111 integration QA: disposable PG17 only, tenant-bound read-only inbox.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createR109Ledger} from './car02-r109-durable-ledger-isolated.mjs';
import {createR110ReviewLedger} from './car02-r110-review-events-isolated.mjs';
import {R111_CONTRACT,R111_PUBLIC_KEYS,R111_USERS,createR111ReadonlyInbox,assertR111Env} from './car02-r111-readonly-inbox-isolated.mjs';
const DB='car02_r109_qa_ci',SCHEMA='car02_r109_qa';
const A='street_house_kitsuki',B='other_shop';
const JA='33333333-3333-4333-8333-333333333109',JB='44444444-4444-4444-8444-444444444109';
const PA='11111111-1111-4111-8111-111111111109',PB='22222222-2222-4222-8222-222222222109';
const pathA='street_house_kitsuki/77777777-7777-4777-8777-777777777109/88888888-8888-4888-8888-888888888109/99999999-9999-4999-8999-999999999109.jpg';
const pathB='other_shop/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa109/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb109/cccccccc-cccc-4ccc-8ccc-cccccccccc09.png';
const ea='11111111-1111-4111-8111-111111111110';
async function fails(fn,codes,label){let err;try{await fn()}catch(e){err=e};assert.ok(err,'R111_NOT_REJECTED_'+label);assert.ok(codes.includes(err.code),'R111_BAD_SQLSTATE_'+label+'_'+err.code)}
export async function runR111Integration(pg){
 const pools=[];
 const makePool=user=>{
  assert.ok(['postgres','car02_r109_a_ci','car02_r109_b_ci','car02_r110_a_ci','car02_r110_b_ci',...Object.keys(R111_USERS)].includes(user));
  const password=user==='postgres'?'disposable-r93s-ci-only':user.startsWith('car02_r109_')?'r109-ci-tenant-local-only':user.startsWith('car02_r110_')?'r110-ci-review-only':'r111-ci-inbox-only';
  const p=new pg.Pool({host:'127.0.0.1',port:5432,database:DB,user,password,
   max:2,connectionTimeoutMillis:3000,idleTimeoutMillis:1500,application_name:'car02_r111_disposable_pg17'});
  pools.push(p);return p;
 };
 try{
  const admin=makePool('postgres'),reviewA=makePool('car02_r110_a_ci'),reviewB=makePool('car02_r110_b_ci');
  const ledgerA=createR109Ledger({environment:'isolated_qa',dbName:DB,pgPool:makePool('car02_r109_a_ci'),expectedUser:'car02_r109_a_ci'});
  const ledgerB=createR109Ledger({environment:'isolated_qa',dbName:DB,pgPool:makePool('car02_r109_b_ci'),expectedUser:'car02_r109_b_ci'});
  const baseA={shop:A,jobId:JA,photoId:PA,path:pathA,sha256:'a'.repeat(64),reason:'UPLOAD_UNCERTAIN'};
  const baseB={shop:B,jobId:JB,photoId:PB,path:pathB,sha256:'b'.repeat(64),reason:'ACK_LOST'};
  assert.equal((await ledgerA.enqueue(baseA)).status,'QUARANTINED');
  assert.equal((await ledgerB.enqueue(baseB)).status,'QUARANTINED');
  // Another A-only item verifies pagination and untouched review state.
  const extraA={shop:A,jobId:'55555555-5555-4555-8555-555555555111',photoId:'11111111-1111-4111-8111-111111111110',
   path:'street_house_kitsuki/77777777-7777-4777-8777-777777777109/88888888-8888-4888-8888-888888888109/eeeeeeee-eeee-4eee-8eee-eeeeeeee0111.jpg',
   sha256:'c'.repeat(64),reason:'STORAGE_DELETE_UNVERIFIED'};
  await ledgerA.enqueue(extraA);
  const a=createR110ReviewLedger({environment:'isolated_qa',dbName:DB,pgPool:reviewA,expectedUser:'car02_r110_a_ci'});
  const b=createR110ReviewLedger({environment:'isolated_qa',dbName:DB,pgPool:reviewB,expectedUser:'car02_r110_b_ci'});
  await a.record({eventId:ea,shop:A,jobId:JA,eventKind:'EVIDENCE_HASH_RECORDED',proofSha256:'a'.repeat(64)});
  await a.record({eventId:'66666666-6666-4666-8666-666666666111',shop:A,jobId:JA,eventKind:'ESCALATED_FOR_REVIEW',proofSha256:'b'.repeat(64)});
  await b.record({eventId:'22222222-2222-4222-8222-222222222110',shop:B,jobId:JB,eventKind:'EVIDENCE_HASH_RECORDED',proofSha256:'b'.repeat(64)});
  const meta=await admin.query(`SELECT (SELECT c.reloptions FROM pg_class c WHERE c.oid='${SCHEMA}.r111_review_inbox'::regclass) AS options,
   (SELECT count(*)::int FROM pg_policy WHERE polname IN ('r111_ledger_viewer','r111_events_viewer')) AS policies`);
  assert.equal(meta.rows[0].policies,2);
  assert.ok(meta.rows[0].options.includes('security_invoker=true'));
  assert.ok(meta.rows[0].options.includes('security_barrier=true'));
  for(const [user,other] of [['car02_r111_a_ci','car02_r111_b_ci'],['car02_r111_b_ci','car02_r111_a_ci']]){
   const p=makePool(user);
   const q=await admin.query(`SELECT has_table_privilege($1,$2,'SELECT') AS read,
    has_table_privilege($1,$2,'INSERT') AS ins,has_table_privilege($1,$2,'UPDATE') AS upd,
    has_table_privilege($1,$2,'DELETE') AS del`,[user,`${SCHEMA}.r111_review_inbox`]);
   assert.deepEqual(q.rows,[{read:true,ins:false,upd:false,del:false}]);
   await fails(()=>p.query(`SET ROLE ${other}`),['42501'],'role_switch');
   await fails(()=>p.query(`SELECT storage_path,sha256 FROM ${SCHEMA}.quarantine_ledger`),['42501'],'sensitive_ledger_columns');
   await fails(()=>p.query(`SELECT proof_sha256 FROM ${SCHEMA}.quarantine_review_events`),['42501'],'sensitive_review_hash');
   await fails(()=>p.query(`INSERT INTO ${SCHEMA}.quarantine_review_events(event_id,shop_code,job_id,event_kind,proof_sha256)
     VALUES('77777777-7777-4777-8777-777777777111','${A}','${JA}','ESCALATED_FOR_REVIEW','${'c'.repeat(64)}')`),['42501'],'viewer_write');
  }
  const pA=makePool('car02_r111_a_ci'),pB=makePool('car02_r111_b_ci');
  const inboxA=createR111ReadonlyInbox({environment:'isolated_qa',dbName:DB,pgPool:pA,expectedUser:'car02_r111_a_ci'});
  const inboxB=createR111ReadonlyInbox({environment:'isolated_qa',dbName:DB,pgPool:pB,expectedUser:'car02_r111_b_ci'});
  const listA=await inboxA.list({limit:20}),listB=await inboxB.list({limit:20});
  assert.equal(listA.items.length,2);assert.equal(listB.items.length,1);
  assert.ok(listA.items.every(x=>Object.keys(x).sort().join('|')===R111_PUBLIC_KEYS.slice().sort().join('|')));
  assert.ok(listA.items.every(x=>x.jobId!==JB));assert.ok(listB.items.every(x=>x.jobId===JB));
  assert.equal(listA.items.find(x=>x.jobId===JA).reviewCount,2);
  assert.equal(listA.items.find(x=>x.jobId===JA).escalated,true);
  assert.equal(listA.items.find(x=>x.jobId===extraA.jobId).reviewCount,0);
  assert.equal(listA.items.find(x=>x.jobId===extraA.jobId).escalated,false);
  assert.deepEqual((await inboxA.list({escalatedOnly:true})).items.map(x=>x.jobId),[JA]);
  assert.equal((await inboxB.list({escalatedOnly:true})).items.length,0);
  const first=await inboxA.list({limit:1});assert.equal(first.items.length,1);assert.equal(first.hasMore,true);
  const second=await inboxA.list({limit:1,cursor:first.nextCursor});
  assert.equal(second.items.length,1);assert.equal(second.hasMore,false);
  assert.equal(new Set([first.items[0].jobId,second.items[0].jobId]).size,2);
  console.log('R111_TENANT_SCOPED_READONLY_INBOX_PASS');
  console.log('R111_KEYSET_PAGE_AND_ESCALATION_FILTER_PASS');
  // The view must be safe even when somebody bypasses the application object and queries it raw.
  assert.equal((await pA.query(`SELECT count(*)::int AS n FROM ${SCHEMA}.r111_review_inbox`)).rows[0].n,2);
  assert.equal((await pB.query(`SELECT count(*)::int AS n FROM ${SCHEMA}.r111_review_inbox`)).rows[0].n,1);
  await fails(()=>pA.query(`UPDATE ${SCHEMA}.quarantine_ledger SET reason='ACK_LOST'`),['42501'],'ledger_mutation');
  await fails(()=>pB.query(`DELETE FROM ${SCHEMA}.quarantine_review_events`),['42501'],'review_mutation');
  // Recreate the app client; source rows persist in DB and no path/hash is included.
  await pA.end();pools.splice(pools.indexOf(pA),1);
  const restarted=createR111ReadonlyInbox({environment:'isolated_qa',dbName:DB,pgPool:makePool('car02_r111_a_ci'),expectedUser:'car02_r111_a_ci'});
  assert.deepEqual((await restarted.list({limit:20})).items,listA.items);
  assert.equal(R111_CONTRACT.storageDeleteAuthorized,false);
  console.log('R111_RESTART_PERSISTENCE_AND_NO_MUTATION_PASS');
  console.log('R111_DISPOSABLE_READONLY_INBOX_QA_PASS');
 }finally{await Promise.all(pools.map(p=>p.end().catch(()=>{})));}
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 assertR111Env(process.env);
 const {default:pg}=await import('pg');await runR111Integration(pg);
}
