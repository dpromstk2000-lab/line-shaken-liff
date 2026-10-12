// DPRO CAR02 R96: disposable PG17 backup corruption/recovery drill ONLY.
// This module never connects to production, Supabase, or any persistent database.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {SOURCE,RESTORE,R95_ENV,snapshotR95,assertR95SnapshotMatch} from './car02-r95-restore-drift-qa.mjs';

export const FAILURE='car02_r96_failure_ci';
export const R96_MODES=Object.freeze(['baseline','empty','recovered']);
export const R96_DB_ALLOWLIST=Object.freeze([SOURCE,RESTORE,FAILURE]);

export function assertR96Environment(env,mode){
 assert.ok(R96_MODES.includes(mode),'R96_MODE_DENIED');
 for(const [key,value] of Object.entries(R95_ENV))
  assert.equal(env[key],value,`R96_ENV_DENIED_${key}`);
 assert.deepEqual(R96_DB_ALLOWLIST,['car02_r93q_qa_ci','car02_r94b_restore_ci','car02_r96_failure_ci']);
}
export function assertR96EmptyTarget(row){
 assert.equal(row?.db,FAILURE,'R96_FAILURE_TARGET_WRONG_DB');
 assert.ok(Number.isInteger(row.pg)&&row.pg>=170000&&row.pg<180000,'R96_PG17_ONLY');
 assert.equal(row.no_live,true,'R96_LIVE_TABLE_DETECTED');
 assert.equal(row.schema_absent,true,'R96_FAILED_RESTORE_LEFT_SCHEMA');
 assert.equal(row.table_absent,true,'R96_FAILED_RESTORE_LEFT_TABLE');
}
export function assertR96SnapshotsEqual(source,restored,third){
 assertR95SnapshotMatch(source,restored,'R96_SOURCE_RESTORE');
 if(third!==undefined) assertR95SnapshotMatch(source,third,'R96_SOURCE_RECOVERED');
 return createHash('sha256').update(JSON.stringify(source)).digest('hex');
}
async function assertIdentity(pool,name){
 const {rows}=await pool.query(`SELECT current_database() AS db,
   current_setting('server_version_num')::integer AS pg,
   to_regclass('public.ksh_car02_photos') IS NULL AS no_live`);
 assert.equal(rows.length,1,'R96_DB_IDENTITY_MISSING');
 assert.equal(rows[0].db,name,'R96_UNEXPECTED_DB');
 assert.ok(rows[0].pg>=170000&&rows[0].pg<180000,'R96_PG17_ONLY');
 assert.equal(rows[0].no_live,true,'R96_LIVE_TABLE_DETECTED');
}
export async function runR96(poolFor,mode){
 const source=poolFor(SOURCE),restored=poolFor(RESTORE);
 await assertIdentity(source,SOURCE);
 await assertIdentity(restored,RESTORE);
 const a=await snapshotR95(source),b=await snapshotR95(restored);
 const fingerprint=assertR96SnapshotsEqual(a,b);
 if(mode==='baseline'){
  console.log('R96_DISPOSABLE_BASELINE_PASS');
 }else if(mode==='empty'){
  const third=poolFor(FAILURE);
  await assertIdentity(third,FAILURE);
  const {rows}=await third.query(`SELECT current_database() AS db,
    current_setting('server_version_num')::integer AS pg,
    to_regclass('public.ksh_car02_photos') IS NULL AS no_live,
    to_regnamespace('car02_r93q_qa') IS NULL AS schema_absent,
    to_regclass('car02_r93q_qa.photos') IS NULL AS table_absent`);
  assert.equal(rows.length,1);
  assertR96EmptyTarget(rows[0]);
  console.log('R96_CORRUPT_RESTORE_ATOMIC_EMPTY_PASS');
 }else if(mode==='recovered'){
  const third=poolFor(FAILURE);
  await assertIdentity(third,FAILURE);
  const c=await snapshotR95(third);
  assertR96SnapshotsEqual(a,b,c);
  console.log('R96_RECOVERED_DB_MATCHES_SOURCE_PASS');
 }else{
  throw Error('R96_MODE_DENIED');
 }
 console.log('R96_SOURCE_RESTORE_SHA256='+fingerprint);
 return {mode,fingerprint};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const mode=process.argv[2];
 assertR96Environment(process.env,mode);
 const {default:pg}=await import('pg');
 const pools=[];
 const poolFor=name=>{
  assert.ok(R96_DB_ALLOWLIST.includes(name),'R96_POOL_DB_DENIED');
  const p=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',
   password:'disposable-r93s-ci-only',database:name,max:2,
   connectionTimeoutMillis:2500,idleTimeoutMillis:1000,
   application_name:'car02_r96_disposable_only'});
  pools.push(p);return p;
 };
 try{await runR96(poolFor,mode);}
 finally{await Promise.all(pools.map(p=>p.end()));}
}
