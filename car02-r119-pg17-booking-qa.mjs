// R119: real PostgreSQL 17 concurrency and tenant RLS; disposable GitHub CI ONLY.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import fs from 'node:fs';

const DATABASES=new Set(['car02_r119_qa_ci','car02_r119_restore_ci']);
const USERS={a:'car02_r119_a_ci',b:'car02_r119_b_ci',admin:'postgres'};
const SHOPS={a:'street_house_demo',b:'other_demo'};
const SCHEMA='car02_r119_qa';
const RESULT={releaseDecision:'NO_GO',migrationDecision:'HOLD',productionReady:false,realSupabaseTested:false,realProductionBackup:false,mode:'disposable_postgresql17_only'};
export function assertDisposableEnv(env){
 assert.equal(env.R119_DISPOSABLE_QA,'yes');
 assert.equal(env.CAR02_RELEASE_LOCK,'true');
 assert.equal(env.PGHOST,'127.0.0.1');
 assert.equal(String(env.PGPORT),'5432');
 assert.ok(DATABASES.has(env.PGDATABASE),'UNAPPROVED_DB_NAME');
 assert.ok(!env.DATABASE_URL && !env.SUPABASE_URL && !env.SUPABASE_SERVICE_ROLE_KEY,'PRODUCTION_ENV_PRESENT');
 return true;
}
export function classifyResults(results){
 assert.equal(results.length,6,'UNEXPECTED_CONTENDERS');
 assert.equal(results.filter(x=>x==='CREATED').length,1,'DOUBLE_BOOKING');
 assert.equal(results.filter(x=>x==='SLOT_TAKEN').length,5,'SLOT_NOT_BLOCKED');
 return true;
}
export function safeEvidence(record){
 const keys=['releaseDecision','migrationDecision','productionReady','realSupabaseTested','realProductionBackup','mode','pg','checks','rowCount','db'];
 assert.deepEqual(Object.keys(record).sort(),keys.sort());
 assert.equal(record.releaseDecision,'NO_GO');
 assert.equal(record.migrationDecision,'HOLD');
 assert.equal(record.productionReady,false);
 assert.equal(record.realSupabaseTested,false);
 assert.equal(record.realProductionBackup,false);
 assert.ok(DATABASES.has(record.db));
 return true;
}
async function expectCode(call,codes,label){let got;try{await call()}catch(e){got=e;}
 assert.ok(got,`UNEXPECTED_ALLOWED_${label}`);
 assert.ok(codes.includes(got.code),`WRONG_REJECT_${label}_${got.code}`);}
async function main(){
 assertDisposableEnv(process.env);
 const mode=process.argv.includes('--restore')?'restore':'source';
 if(mode==='restore')assert.equal(process.env.PGDATABASE,'car02_r119_restore_ci');
 else assert.equal(process.env.PGDATABASE,'car02_r119_qa_ci');
 const pg=(await import('pg')).default;
 const pools=[];
 function pool(role,max=9){
  const user=USERS[role];assert.ok(user);
  const p=new pg.Pool({host:'127.0.0.1',port:5432,database:process.env.PGDATABASE,user,
   password:role==='admin'?'r119-disposable-superuser-ci-only':'r119-disposable-tenant-only',
   max,connectionTimeoutMillis:5000,application_name:'car02_r119_disposable_ci'});pools.push(p);return p;
 }
 const admin=pool('admin',2),a=pool('a',9),b=pool('b',3);
 let checks=0;
 try{
  const {rows:meta}=await admin.query(`SELECT current_database() AS db,current_setting('server_version_num')::integer AS ver,
    (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='${SCHEMA}.bookings'::regclass) AS rls,
    (SELECT count(*)::integer FROM pg_policies WHERE schemaname='${SCHEMA}' AND tablename='bookings') AS policies`);
  assert.equal(meta[0].db,process.env.PGDATABASE);assert.ok(meta[0].ver>=170000&&meta[0].ver<180000);
  assert.equal(meta[0].rls,true);assert.equal(meta[0].policies,2);checks++;
  const {rows:target}=await admin.query(`SELECT (x::date)::text AS d FROM
    (SELECT ((now() AT TIME ZONE 'Asia/Tokyo')::date + n) AS x FROM generate_series(2,8) AS n) q
    WHERE extract(isodow from x)<7 ORDER BY x LIMIT 1`);
  const day=target[0].d;
  async function claim(p,key,t='09:30',service='INSPECTION',d=day){const x=await p.query(
   `SELECT ${SCHEMA}.claim_slot($1,$2::date,$3::time,$4) AS state`,[key,d,t,service]);return x.rows[0].state;}
  const rootkey='r119same-slot-race-00001';
  if(mode==='source'){
   const attempts=await Promise.all(Array.from({length:6},(_,i)=>claim(a,`r119-race-request-${i+1}-fixture`)));
   classifyResults(attempts);checks++;
   assert.equal(await claim(a,'r119-race-request-1-fixture'),attempts[0]==='CREATED'?'IDEMPOTENT':'SLOT_TAKEN');checks++;
   const created=attempts.indexOf('CREATED')+1;
   assert.equal(await claim(a,`r119-race-request-${created}-fixture`),'IDEMPOTENT');checks++;
   await expectCode(()=>claim(a,`r119-race-request-${created}-fixture`,'10:00'),['22023'],'changed_idempotency_payload');checks++;
   assert.equal(await claim(b,rootkey),'CREATED','TENANT_B_SAME_SLOT_DENIED');checks++;
   assert.equal(await claim(b,rootkey),'IDEMPOTENT');checks++;
  }else{
   const rows=await admin.query(`SELECT shop_code,request_key,booking_day::text AS d,begins_at::text AS t FROM ${SCHEMA}.bookings`);
   assert.equal(rows.rows.length,2,'RESTORE_ROW_COUNT');checks++;
   const sourceRow=rows.rows.find(x=>x.shop_code===SHOPS.a);const foreignRow=rows.rows.find(x=>x.shop_code===SHOPS.b);
   assert.ok(sourceRow&&foreignRow);checks++;
   assert.equal(await claim(a,sourceRow.request_key,sourceRow.t,'INSPECTION',sourceRow.d),'IDEMPOTENT');checks++;
   assert.equal(await claim(b,foreignRow.request_key,foreignRow.t,'INSPECTION',foreignRow.d),'IDEMPOTENT');checks++;
   assert.equal(await claim(a,'r119-restore-extra-fixture',sourceRow.t,'INSPECTION',sourceRow.d),'SLOT_TAKEN');checks++;
  }
  for(const [role,p] of [['a',a],['b',b]]){
   const r=await p.query(`SELECT current_user AS u,session_user AS s,
    (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS bypass,
    (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser`);
   assert.equal(r.rows[0].u,USERS[role]);assert.equal(r.rows[0].s,USERS[role]);
   assert.equal(r.rows[0].bypass,false);assert.equal(r.rows[0].superuser,false);checks++;
   const rows=await p.query(`SELECT shop_code FROM ${SCHEMA}.bookings`);
   assert.equal(rows.rowCount,1);assert.ok(rows.rows.every(x=>x.shop_code===SHOPS[role]));checks++;
   const other=role==='a'?'b':'a';
   await expectCode(()=>p.query(`SET ROLE ${USERS[other]}`),['42501'],'role_escalation');checks++;
   await expectCode(()=>p.query(`SET SESSION AUTHORIZATION postgres`),['42501'],'session_escalation');checks++;
   const foreign=await p.query(`SELECT id FROM ${SCHEMA}.bookings WHERE shop_code=$1`,[SHOPS[other]]);
   assert.equal(foreign.rowCount,0);checks++;
   await expectCode(()=>p.query(`INSERT INTO ${SCHEMA}.bookings(shop_code,request_key,booking_day,begins_at,service_code)
    VALUES($1,$2,$3::date,'11:00','INSPECTION')`,[SHOPS[other],`r119-forged-${role}-fixture`,day]),['42501'],'foreign_write');checks++;
   await expectCode(()=>p.query(`DELETE FROM ${SCHEMA}.bookings WHERE shop_code=$1`,[SHOPS[role]]),['42501'],'delete_denied');checks++;
   await expectCode(()=>p.query(`UPDATE ${SCHEMA}.bookings SET service_code='MAINTENANCE' WHERE shop_code=$1`,[SHOPS[role]]),['42501'],'update_denied');checks++;
   await expectCode(()=>p.query(`TRUNCATE ${SCHEMA}.bookings`),['42501'],'truncate_denied');checks++;
   const client=await p.connect();
   try{await client.query('BEGIN');try{
     await client.query(`SELECT set_config('car02.tenant',$1,true)`,[SHOPS[other]]);
     const rr=await client.query(`SELECT shop_code FROM ${SCHEMA}.bookings`);
     assert.equal(rr.rowCount,1);assert.equal(rr.rows[0].shop_code,SHOPS[role]);checks++;
    }finally{await client.query('ROLLBACK')}}finally{client.release()}
  }
  if(mode==='source'){
   for(const [t,d,expectLabel] of [['09:15',day,'INVALID_INTERVAL'],['09:30:15',day,'SECONDS'],['08:30',day,'EARLY'],['18:00',day,'LATE'],['09:30','2000-01-01','PAST']]){
    await expectCode(()=>claim(a,`r119-invalid-${expectLabel}-fixture`,t,'INSPECTION',d),['22023'],expectLabel);checks++;
   }
   const future=await admin.query(`SELECT ((now() AT TIME ZONE 'Asia/Tokyo')::date+61)::text AS d`);
   await expectCode(()=>claim(a,'r119-invalid-future-fixture','09:30','INSPECTION',future.rows[0].d),['22023'],'BEYOND_60_DAYS');checks++;
   const sun=await admin.query(`SELECT (x::date)::text AS d FROM (SELECT ((now() AT TIME ZONE 'Asia/Tokyo')::date+n) x FROM generate_series(1,7) n) q WHERE extract(isodow from x)=7 LIMIT 1`);
   await expectCode(()=>claim(a,'r119-invalid-sunday-fixture','09:30','INSPECTION',sun.rows[0].d),['22023'],'SUNDAY');checks++;
   await expectCode(()=>claim(a,'r119-invalid-service-fixture','09:30','WRONG'),['22023'],'SERVICE');checks++;
  }
  const count=await admin.query(`SELECT count(*)::integer AS n FROM ${SCHEMA}.bookings`);
  assert.equal(count.rows[0].n,2);checks++;
  const evidence={...RESULT,pg:meta[0].ver,checks,rowCount:count.rows[0].n,db:process.env.PGDATABASE};safeEvidence(evidence);
  const out=process.env.R119_EVIDENCE_FILE;
  if(out)fs.writeFileSync(out,JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
  console.log(mode==='restore'?'R119_PG17_RESTORE_RLS_AND_IDEMPOTENCY_PASS':'R119_PG17_CONCURRENCY_TENANT_RLS_PASS');
  console.log('R119_PRODUCTION_NO_GO_DATABASE_MIGRATION_HOLD');
 }finally{await Promise.all(pools.map(p=>p.end()));}
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)main().catch(e=>{console.error('R119_QA_FAIL',e.message,e.code||'');process.exitCode=1});
