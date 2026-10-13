// R120 PG17 disposable CI only; no Supabase, Worker, real customers or production operations.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const USERS={a:'car02_r120_a_ci',b:'car02_r120_b_ci',admin:'postgres'};
const SHOPS={a:'street_house_demo',b:'other_demo'};
const SCHEMA='car02_r120_qa';
export function assertDisposableEnv(env){
 assert.equal(env.R120_DISPOSABLE_QA,'yes');assert.equal(env.CAR02_RELEASE_LOCK,'true');
 assert.equal(env.PGHOST,'127.0.0.1');assert.equal(String(env.PGPORT),'5432');
 assert.ok(['car02_r120_qa_ci','car02_r120_restore_ci'].includes(env.PGDATABASE));
 for(const k of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','DATABASE_URL','CLOUDFLARE_API_TOKEN','PGSERVICE'])assert.ok(!env[k],`PROHIBITED_ENV_${k}`);
 return true;
}
export function classifyRace(results,n=6){assert.equal(results.length,n);assert.equal(results.filter(s=>s==='CREATED').length,1);assert.equal(results.filter(s=>s==='SLOT_TAKEN').length,n-1);return true;}
export function safeEvidence(x){const allowed=['mode','version','decision','migration','productionReady','productionDataUsed','pg','checks','sourceRows','auditRows','database','status'];assert.deepEqual(Object.keys(x).sort(),allowed.sort());assert.equal(x.decision,'NO_GO');assert.equal(x.migration,'HOLD');assert.equal(x.productionReady,false);assert.equal(x.productionDataUsed,false);return true;}
async function main(){
 assertDisposableEnv(process.env);
 const restore=process.argv.includes('--restore');assert.equal(process.env.PGDATABASE,restore?'car02_r120_restore_ci':'car02_r120_qa_ci');
 const {default:pg}=await import('pg');let pools=[];
 const pool=(who,max=8)=>{const user=USERS[who];const p=new pg.Pool({host:'127.0.0.1',port:5432,database:process.env.PGDATABASE,user,max,connectionTimeoutMillis:5000,password:who==='admin'?'r120-disposable-db-only':'r120-only-in-disposable-container',application_name:'car02_r120_disposable_ci'});pools.push(p);return p;};
 const admin=pool('admin',2),a=pool('a'),b=pool('b');let checks=0;
 async function call(p,fn,args){const params=args.map((_,i)=>'$'+(i+1)).join(',');const casts=fn==='claim_slot'?'$1::text,$2::date,$3::time,$4::text':'$1::text';const out=await p.query(`SELECT ${SCHEMA}.${fn}(${casts}) AS state`,args);return out.rows[0].state;}
 const claim=(p,key,day,time='09:30',service='INSPECTION')=>call(p,'claim_slot',[key,day,time,service]);
 const cancel=(p,key)=>call(p,'cancel_slot',[key]);
 const rejects=async(fn,codes,label)=>{let e;try{await fn();}catch(err){e=err;}assert.ok(e,`UNEXPECTED_ALLOWED_${label}`);assert.ok(codes.includes(e.code),`BAD_ERROR_${label}:${e.code}`);checks++;};
 try{
  const info=await admin.query(`SELECT current_database() AS db,current_setting('server_version_num')::int AS pg, (SELECT count(*)::int FROM pg_policies WHERE schemaname=$1) AS policies`,[SCHEMA]);
  assert.equal(info.rows[0].db,process.env.PGDATABASE);assert.ok(info.rows[0].pg>=170000&&info.rows[0].pg<180000);assert.equal(info.rows[0].policies,2);checks++;
  const day=(await admin.query(`SELECT ((now() AT TIME ZONE 'Asia/Tokyo')::date+n)::text AS day FROM generate_series(2,8) n WHERE extract(isodow from ((now() AT TIME ZONE 'Asia/Tokyo')::date+n))<>7 ORDER BY n LIMIT 1`)).rows[0].day;
  const raceKeys=Array.from({length:6},(_,i)=>`r120-race-key-${i+1}-unique`);
  if(!restore){
   const race=await Promise.all(raceKeys.map(key=>claim(a,key,day)));classifyRace(race);checks++;
   const winningKey=raceKeys[race.indexOf('CREATED')];assert.equal(await claim(a,winningKey,day),'IDEMPOTENT');checks++;
   await rejects(()=>claim(a,winningKey,day,'10:00'),['22023'],'payload_mismatch');
   assert.equal(await cancel(b,winningKey),'NOT_FOUND');checks++;
   assert.equal(await claim(b,'r120-b-foreign-shop-same-slot',day),'CREATED');checks++;
   assert.equal(await cancel(a,winningKey),'CANCELLED');checks++;
   assert.equal(await cancel(a,winningKey),'IDEMPOTENT_CANCEL');checks++;
   assert.equal(await claim(a,winningKey,day),'CANCELLED_REQUEST');checks++;
   assert.equal(await claim(a,'r120-a-rebook-after-cancel',day),'CREATED');checks++;
   const cancelRace=await Promise.all(Array.from({length:6},()=>cancel(a,'r120-a-rebook-after-cancel')));
   assert.equal(cancelRace.filter(x=>x==='CANCELLED').length,1);assert.equal(cancelRace.filter(x=>x==='IDEMPOTENT_CANCEL').length,5);checks++;
   assert.equal(await claim(a,'r120-a-final-slot-state',day),'CREATED');checks++;
   assert.equal(await claim(a,'r120-a-final-slot-state',day),'IDEMPOTENT');checks++;
  }else{
   const rows=(await admin.query(`SELECT shop_code,state,request_key,booking_day::text AS d,begins_at::text AS t FROM ${SCHEMA}.bookings`)).rows;
   assert.equal(rows.length,4);checks++;
   assert.equal(rows.filter(x=>x.state==='ACTIVE').length,2);checks++;
   for(const row of rows){const p=row.shop_code===SHOPS.a?a:b;assert.equal(await claim(p,row.request_key,row.d,row.t),row.state==='ACTIVE'?'IDEMPOTENT':'CANCELLED_REQUEST');checks++;}
   assert.equal(await claim(a,'r120-a-another-after-restore',day),'SLOT_TAKEN');checks++;
  }
  for(const [role,p] of [['a',a],['b',b]]){
   const identity=(await p.query(`SELECT current_user AS c,session_user AS s,rolbypassrls AS bypass,rolsuper AS superuser FROM pg_roles WHERE rolname=current_user`)).rows[0];
   assert.equal(identity.c,USERS[role]);assert.equal(identity.s,USERS[role]);assert.equal(identity.bypass,false);assert.equal(identity.superuser,false);checks++;
   const own=(await p.query(`SELECT shop_code FROM ${SCHEMA}.bookings`)).rows;
   assert.ok(own.length>0&&own.every(x=>x.shop_code===SHOPS[role]));checks++;
   const audit=(await p.query(`SELECT shop_code,action FROM ${SCHEMA}.audit_events`)).rows;
   assert.ok(audit.length>0&&audit.every(x=>x.shop_code===SHOPS[role]));checks++;
   await rejects(()=>p.query(`SET ROLE ${USERS[role==='a'?'b':'a']}`),['42501'],'switch_role');
   await rejects(()=>p.query(`SET SESSION AUTHORIZATION postgres`),['42501'],'superuser');
   await rejects(()=>p.query(`INSERT INTO ${SCHEMA}.bookings(shop_code,request_key,booking_day,begins_at,service_code) VALUES($1,'r120-bypass-direct-insert', $2::date,'13:00','INSPECTION')`,[SHOPS[role],day]),['42501'],'direct_insert');
   await rejects(()=>p.query(`UPDATE ${SCHEMA}.bookings SET state='CANCELLED'`),['42501'],'direct_update');
   await rejects(()=>p.query(`DELETE FROM ${SCHEMA}.bookings`),['42501'],'direct_delete');
   await rejects(()=>p.query(`INSERT INTO ${SCHEMA}.audit_events(shop_code,booking_id,action) VALUES($1,1,'CREATED')`,[SHOPS[role]]),['42501'],'forge_audit');
   await rejects(()=>p.query(`UPDATE ${SCHEMA}.audit_events SET action='CREATED'`),['42501'],'audit_mutate');
   const foreign=await p.query(`SELECT id FROM ${SCHEMA}.bookings WHERE shop_code=$1`,[SHOPS[role==='a'?'b':'a']]);assert.equal(foreign.rowCount,0);checks++;
  }
  const counts=(await admin.query(`SELECT (SELECT count(*)::int FROM ${SCHEMA}.bookings) AS b,(SELECT count(*)::int FROM ${SCHEMA}.audit_events) AS a`)).rows[0];
  assert.equal(counts.b,4);assert.equal(counts.a,6);checks++;
  const ev={mode:restore?'restore':'source',version:'R120',decision:'NO_GO',migration:'HOLD',productionReady:false,productionDataUsed:false,pg:info.rows[0].pg,checks,sourceRows:counts.b,auditRows:counts.a,database:process.env.PGDATABASE,status:'PASS'};safeEvidence(ev);
  if(process.env.R120_EVIDENCE_FILE)fs.writeFileSync(process.env.R120_EVIDENCE_FILE,JSON.stringify(ev,null,2)+'\n',{mode:0o600});
  console.log(restore?'R120_PG17_RESTORE_LIFECYCLE_RLS_PASS':'R120_PG17_CANCELLATION_REBOOK_AUDIT_RLS_PASS');
  console.log('R120_RELEASE_NO_GO_MIGRATION_HOLD');
 }finally{await Promise.all(pools.map(p=>p.end()));}
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)main().catch(e=>{console.error('R120_FAILED',e.message,e.code||'');process.exitCode=1;});
