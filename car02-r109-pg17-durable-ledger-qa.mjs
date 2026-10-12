// R109: real PostgreSQL 17 testing on a newly-created GitHub Actions service DB ONLY.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {R109_CONTRACT,R109_TEST_USERS,assertR109Env,createR109Ledger} from './car02-r109-durable-ledger-isolated.mjs';
const DB='car02_r109_qa_ci';
const A='car02_r109_a_ci',B='car02_r109_b_ci';
const PHOTO_A='11111111-1111-4111-8111-111111111109';
const JOB_A='33333333-3333-4333-8333-333333333109';
const OBJ_A='99999999-9999-4999-8999-999999999109';
const PATH_A=`street_house_kitsuki/77777777-7777-4777-8777-777777777109/88888888-8888-4888-8888-888888888109/${OBJ_A}.jpg`;
const PHOTO_B='22222222-2222-4222-8222-222222222109';
const JOB_B='44444444-4444-4444-8444-444444444109';
const PATH_B='other_shop/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa109/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb109/cccccccc-cccc-4ccc-8ccc-cccccccccc09.png';
const inputA={shop:'street_house_kitsuki',jobId:JOB_A,photoId:PHOTO_A,path:PATH_A,sha256:'a'.repeat(64),reason:'UPLOAD_UNCERTAIN'};
const inputB={shop:'other_shop',jobId:JOB_B,photoId:PHOTO_B,path:PATH_B,sha256:'b'.repeat(64),reason:'ACK_LOST'};
const t='car02_r109_qa.quarantine_ledger';
async function expectsSqlFailure(action,codes,label){
 let caught;try{await action()}catch(e){caught=e;}
 assert.ok(caught,'R109_UNEXPECTED_ALLOW_'+label);
 assert.ok(codes.includes(caught.code),'R109_UNEXPECTED_SQLSTATE_'+label+'_'+caught.code);
}
export async function runR109Integration(pg){
 const pools=[];
 const pool=(user)=>{assert.ok(user==='postgres'||Object.hasOwn(R109_TEST_USERS,user));
  const p=new pg.Pool({host:'127.0.0.1',port:5432,user,
   password:user==='postgres'?'disposable-r93s-ci-only':'r109-ci-tenant-local-only',
   database:DB,max:3,connectionTimeoutMillis:3000,idleTimeoutMillis:1500,
   application_name:'car02_r109_disposable_pg17_only'});
  pools.push(p);return p;};
 try{
  const admin=pool('postgres'),pA=pool(A),pB=pool(B);
  const a=createR109Ledger({environment:'isolated_qa',dbName:DB,pgPool:pA,expectedUser:A});
  const b=createR109Ledger({environment:'isolated_qa',dbName:DB,pgPool:pB,expectedUser:B});
  const meta=await admin.query(`SELECT c.relrowsecurity AS enabled,c.relforcerowsecurity AS forced,
    (SELECT count(*)::int FROM pg_policy WHERE polrelid=c.oid) AS policies,
    (SELECT count(*)::int FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal) AS triggers
   FROM pg_class c WHERE c.oid='${t}'::regclass`);
  assert.deepEqual(meta.rows,[{enabled:true,forced:true,policies:2,triggers:2}]);
  for(const user of [A,B]){
   const priv=await admin.query(`SELECT has_table_privilege($1,$2,'SELECT') AS can_select,
    has_table_privilege($1,$2,'INSERT') AS can_insert,
    has_table_privilege($1,$2,'UPDATE') AS can_update,
    has_table_privilege($1,$2,'DELETE') AS can_delete,
    has_table_privilege($1,$2,'TRUNCATE') AS can_truncate`,[user,t]);
   assert.deepEqual(priv.rows,[{can_select:true,can_insert:true,can_update:false,can_delete:false,can_truncate:false}]);
  }
  console.log('R109_PG17_RLS_AND_IMMUTABLE_TRIGGERS_PASS');
  const first=await Promise.all([a.enqueue(inputA),a.enqueue(inputA)]);
  assert.equal(first.filter(x=>!x.duplicate).length,1);
  assert.equal(first.filter(x=>x.duplicate).length,1);
  assert.deepEqual(await b.enqueue(inputB),{status:'QUARANTINED',duplicate:false});
  assert.equal(await a.count(),1);assert.equal(await b.count(),1);
  const rowsA=await pA.query(`SELECT job_id::text FROM ${t}`);
  assert.deepEqual(rowsA.rows,[{job_id:JOB_A}]);
  const rowsB=await pB.query(`SELECT job_id::text FROM ${t}`);
  assert.deepEqual(rowsB.rows,[{job_id:JOB_B}]);
  await expectsSqlFailure(()=>pA.query(`SET ROLE ${B}`),['42501'],'role_switch');
  // Raw bypass attempts are tested even though the application API already rejects them.
  await expectsSqlFailure(()=>pA.query(`INSERT INTO ${t}
    (job_id,shop_code,photo_id,storage_path,sha256,reason)
    VALUES($1,$2,$3,$4,$5,$6)`,[
      '55555555-5555-4555-8555-555555555109','other_shop',PHOTO_B,
      'other_shop/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa109/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb109/dddddddd-dddd-4ddd-8ddd-ddddddddd109.png','d'.repeat(64),'ACK_LOST'
    ]),['42501'],'cross_tenant_direct_write');
  await expectsSqlFailure(()=>pA.query(`INSERT INTO ${t}
    (job_id,shop_code,photo_id,storage_path,sha256,reason)
    VALUES($1,$2,$3,$4,$5,$6)`,[
      '55555555-5555-4555-8555-555555555110','street_house_kitsuki',PHOTO_B,
      'street_house_kitsuki/77777777-7777-4777-8777-777777777109/88888888-8888-4888-8888-888888888109/eeeeeeee-eeee-4eee-8eee-eeeeeeee0110.jpg','e'.repeat(64),'ACK_LOST'
    ]),['23503'],'cross_tenant_photo_fk');
  await assert.rejects(a.enqueue({...inputA,photoId:'11111111-1111-4111-8111-111111111110'}),/R109_REBIND_OR_SCOPE_DENIED/);
  await assert.rejects(a.enqueue({...inputA,reason:'ACK_LOST'}),/R109_REBIND_OR_SCOPE_DENIED/);
  // The public enqueue API maps conflicts on *either* unique key to an exact-read
  // identity check: different job + reused path is denied, never treated as retry.
  await assert.rejects(a.enqueue({...inputA,jobId:'55555555-5555-4555-8555-555555555111'}),
   /R109_REBIND_OR_SCOPE_DENIED/);
  // The database's immutable path constraint is still enforced for raw SQL callers.
  await expectsSqlFailure(()=>pA.query(`INSERT INTO ${t}
    (job_id,shop_code,photo_id,storage_path,sha256,reason)
    VALUES($1,$2,$3,$4,$5,$6)`,[
    '55555555-5555-4555-8555-555555555112',inputA.shop,inputA.photoId,inputA.path,inputA.sha256,inputA.reason
   ]),['23505'],'raw_path_unique_constraint');
  assert.equal(await a.count(),1);assert.equal(await b.count(),1);
  console.log('R109_TENANT_AND_IDEMPOTENCY_HARD_DENIAL_PASS');
  // Pretend app process restarted by closing one pool and creating a wholly new pool.
  await pA.end();pools.splice(pools.indexOf(pA),1);
  const fresh=pool(A),restarted=createR109Ledger({environment:'isolated_qa',dbName:DB,pgPool:fresh,expectedUser:A});
  assert.deepEqual(await restarted.enqueue(inputA),{status:'QUARANTINED',duplicate:true});
  assert.equal(await restarted.count(),1);
  console.log('R109_DURABLE_RESTART_RETRY_PASS');
  for(const sql of [
   `UPDATE ${t} SET state='DONE' WHERE job_id='${JOB_A}'`,
   `DELETE FROM ${t} WHERE job_id='${JOB_A}'`,
   `TRUNCATE ${t}`
  ])await expectsSqlFailure(()=>admin.query(sql),['42501'],'immutable_admin_mutation');
  for(const sql of [`UPDATE ${t} SET reason='ACK_LOST' WHERE job_id='${JOB_A}'`,
   `DELETE FROM ${t} WHERE job_id='${JOB_A}'`])
   await expectsSqlFailure(()=>fresh.query(sql),['42501'],'immutable_tenant_mutation');
  const check=await admin.query(`SELECT shop_code,storage_path,state FROM ${t} ORDER BY shop_code`);
  assert.equal(check.rowCount,2);
  assert.ok(check.rows.every(x=>x.state==='QUARANTINED'));
  console.log('R109_IMMUTABLE_TOMBSTONE_NO_STORAGE_DELETE_PASS');
  assert.equal(R109_CONTRACT.productionReady,false);
  console.log('R109_DISPOSABLE_DURABLE_QUARANTINE_QA_PASS');
 }finally{await Promise.all(pools.map(x=>x.end().catch(()=>{})));}
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 assertR109Env(process.env);
 const {default:pg}=await import('pg');await runR109Integration(pg);
}
