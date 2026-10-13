// Disposable R122 PG17 backup-restore validation. NEVER connects to production.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const DB='car02_r122_restore_ci';
export async function inspectR122Restore(pg){
 assert.equal(process.env.R122_DISPOSABLE_QA,'yes');
 assert.equal(process.env.R122_RESTORE_QA,'yes');
 assert.equal(process.env.CAR02_RELEASE_LOCK,'true');
 assert.equal(process.env.PGDATABASE,DB);
 assert.equal(process.env.PGHOST,'127.0.0.1');
 const roles=['car02_r122_a_ci','car02_r122_b_ci'];
 const pools=roles.map(user=>new pg.Pool({host:'127.0.0.1',port:5432,database:DB,user,
    password:'r122-ci-disposable-only',max:2,application_name:'car02_r122_restore_readonly'}));
 try{
  for(let i=0;i<2;i++){
   const p=pools[i];const who=await p.query(`SELECT current_database() AS db, session_user AS sess,
      current_user AS cur, current_setting('server_version_num')::integer AS pg,
      to_regclass('public.ksh_car02_photos') IS NULL AS no_live`);
   assert.deepEqual([who.rows[0].db,who.rows[0].sess,who.rows[0].cur,who.rows[0].no_live],
      [DB,roles[i],roles[i],true]);
   assert.ok(who.rows[0].pg>=170000&&who.rows[0].pg<180000);
   const rows=await p.query(`SELECT state FROM car02_r122_qa.photo_intents`);
   assert.equal(rows.rowCount,i===0?3:1);
   const logs=await p.query('SELECT count(*)::integer AS n FROM car02_r122_qa.audit_events');
   assert.equal(logs.rows[0].n,i===0?6:1);
   let rejected=false;
   try{await p.query("DELETE FROM car02_r122_qa.audit_events")}catch(e){rejected=e.code==='42501';}
   assert.equal(rejected,true,'audit history must remain immutable for tenant');
  }
  const proof={version:'R122',db:'separate_disposable_restore',tenantsTested:2,
   tenantARows:3,tenantBRows:1,tenantAAuditRows:6,tenantBAuditRows:1,
   directAuditDeleteDenied:true,productionReady:false,release:'NO_GO',migration:'HOLD'};
  if(process.env.R122_RESTORE_PROOF)fs.writeFileSync(process.env.R122_RESTORE_PROOF,JSON.stringify(proof,null,2)+'\n');
  console.log('R122_RESTORED_DB_TENANT_RLS_AND_AUDIT_PASS');
 }finally{await Promise.all(pools.map(p=>p.end().catch(()=>{})))}
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const {default:pg}=await import('pg');await inspectR122Restore(pg);
}
