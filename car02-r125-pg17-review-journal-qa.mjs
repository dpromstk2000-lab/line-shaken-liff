// DPRO CAR02 R125: disposable PG17 CI tests. No network except isolated localhost test DB.
// This is not a production authorization, Supabase migration, or photo release mechanism.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';
const restore=process.argv.includes('--restore');
const db=restore?'car02_r125_restore_ci':'car02_r125_qa_ci';
assert.equal(process.env.R125_DISPOSABLE_QA,'yes');
assert.equal(process.env.CAR02_RELEASE_LOCK,'true');
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGDATABASE,db);
const cases=JSON.parse(execFileSync('node',['car02-r124-r123-fixtures.mjs'],{encoding:'utf8'}));
assert.equal(cases.length,3);
const roles=['car02_r125_a_ci','car02_r125_b_ci'];
const cfg=user=>({host:'127.0.0.1',port:5432,database:db,user,password:user==='postgres'?'r125-disposable-only':'r125-disposable-only',max:9,
 application_name:'car02_r125_disposable_qa'});
const a=new pg.Pool(cfg(roles[0])),b=new pg.Pool(cfg(roles[1])),admin=new pg.Pool(cfg('postgres'));
const note={version:'R125',db:restore?'disposable_restore':'disposable_source',release:'NO_GO',migration:'HOLD',
 productionReady:false,realStorageTested:false,realAuthenticationTested:false,reviewPermitsMutation:false,
 suites:[],tenants:2,simultaneousClients:6};
const insert=(p,x)=>p.query('SELECT car02_r125_qa.record_review($1) AS result',[JSON.stringify(x)]).then(r=>r.rows[0].result);
async function denies(task,expected=['42501']){
 let rejected=false;
 try{await task()}catch(e){rejected=expected.includes(e.code)}
 assert.equal(rejected,true,`operation must fail with ${expected.join(',')}`);
}
const sha=s=>createHash('sha256').update(s).digest('hex');
async function checkAudit(expected){
 const q=await admin.query(`SELECT seq,shop_code,intent_key::text AS intent_key,revision,record_hash,payload,previous_hash,event_hash FROM car02_r125_qa.review_journal ORDER BY seq`);
 assert.equal(q.rowCount,expected);
 let prev='0'.repeat(64);
 for(const row of q.rows){
  const rec=JSON.parse(row.payload);
  assert.equal(row.previous_hash,prev);
  assert.equal(row.record_hash,rec.recordHash);
  assert.equal(sha(JSON.stringify(Object.fromEntries(Object.entries(rec).filter(([k])=>k!=='recordHash')))),row.record_hash);
  const target=sha(`${prev}:${row.record_hash}:${row.shop_code}:${row.intent_key}:${row.revision}`);
  assert.equal(target,row.event_hash);
  prev=row.event_hash;
 }
 const x=await admin.query('SELECT count(*)::int AS c FROM car02_r125_qa.reviewer_index');
 const z=await admin.query('SELECT count(*)::int AS c FROM car02_r125_qa.audit_events');
 assert.equal(x.rows[0].c,expected*2);assert.equal(z.rows[0].c,expected);
 return prev;
}
try{
 const w=await admin.query(`SELECT current_setting('server_version_num')::int AS ver,current_database() AS db,to_regclass('public.ksh_car02_photos') IS NULL AS nolive`);
 assert.ok(w.rows[0].ver>=170000&&w.rows[0].ver<180000);
 assert.equal(w.rows[0].db,db);assert.equal(w.rows[0].nolive,true);
 if(!restore){
  const first=Array.from({length:6},()=>insert(a,cases[0]));
  const results=await Promise.all(first);
  assert.equal(results.filter(x=>x==='NEW').length,1);
  assert.equal(results.filter(x=>x==='EXISTING').length,5);
  note.suites.push('6_CONNECTIONS_ONE_INSERT_FIVE_REPLAYS');
  assert.equal(await insert(a,cases[1]),'NEW');
  assert.equal(await insert(b,cases[2]),'NEW');
  assert.equal(await insert(a,cases[0]),'EXISTING');
  note.suites.push('SYNTHETIC_R123_TO_R124_TO_PG17_BRIDGE');
  await denies(()=>insert(a,cases[2]));
  await denies(()=>insert(b,cases[1]));
  const tampered=JSON.stringify(cases[0]).replace('"decision":"MANUAL_STAGING_VALIDATION_PENDING"','"decision":"READY"');
  await denies(()=>a.query('SELECT car02_r125_qa.record_review($1)',[tampered]));
  await denies(()=>a.query('DELETE FROM car02_r125_qa.review_journal'));
  await denies(()=>b.query('UPDATE car02_r125_qa.audit_events SET action=$1',['DELETED']));
  await denies(()=>a.query('INSERT INTO car02_r125_qa.audit_events(shop_code,journal_seq,action) VALUES($1,1,$2)',['shop_a','MANUAL_STAGING_VALIDATION_PENDING']));
  note.suites.push('CROSS_TENANT_SCOPE_HASH_TAMPER_DENIED');
  note.suites.push('AUDIT_DML_DENIED');
 }else{
  // Backups must not be replayed into same DB. Expected 2 records for shop_a, 1 for shop_b.
  assert.equal(await insert(a,cases[0]),'EXISTING');
  await denies(()=>insert(b,cases[0]));
  note.suites.push('RESTORE_PRESERVES_IDEMPOTENCY_AND_SCOPE');
 }
 for(const [p,n] of [[a,2],[b,1]]){
  const j=await p.query('SELECT count(*)::int AS n FROM car02_r125_qa.review_journal');
  const audits=await p.query('SELECT count(*)::int AS n FROM car02_r125_qa.audit_events');
  const rev=await p.query('SELECT count(*)::int AS n FROM car02_r125_qa.reviewer_index');
  assert.equal(j.rows[0].n,n);assert.equal(audits.rows[0].n,n);assert.equal(rev.rows[0].n,2*n);
  const who=await p.query('SELECT session_user AS u,current_user AS c');
  assert.equal(who.rows[0].u,who.rows[0].c);
 }
 note.suites.push('TWO_TENANT_FORCED_RLS');
 note.chainHead=await checkAudit(3);note.suites.push('APPEND_ONLY_CHAIN_AND_REVIEWER_LINKS');
 const path=process.env.R125_EVIDENCE_FILE;
 if(path)fs.writeFileSync(path,JSON.stringify(note,null,2)+'\n');
 console.log(restore?'R125_PG17_RESTORED_REVIEW_RLS_CHAIN_PASS':'R125_PG17_CONCURRENT_REPLAY_TENANT_AUDIT_PASS');
 console.log('R125_NO_GO_HOLD_NO_REAL_STORAGE_AND_NO_RELEASE');
}finally{await Promise.all([a.end(),b.end(),admin.end()]);}
