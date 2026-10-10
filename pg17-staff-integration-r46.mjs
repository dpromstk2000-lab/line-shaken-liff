// R46 QA disposable PG17 extension. Never target production database.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {createDbStaffMembershipLookupR46,createStaffAccessResolverR46} from './car02-auth-providers-r46.mjs';
const id='55555555-5555-4555-8555-555555555555',shop='street_house_kitsuki';
const pool=new pg.Pool({host:process.env.PGHOST,port:Number(process.env.PGPORT||5432),user:process.env.PGUSER,password:process.env.PGPASSWORD,database:process.env.PGDATABASE,max:2});
let tests=0;
const pass=m=>{console.log(`PASS R46 STAFF ${++tests}: ${m}`)};
const reject=async p=>assert.rejects(p,/CAR02_IDENTITY_REJECTED/);
try{
 if(!process.env.GITHUB_ACTIONS || process.env.PGDATABASE!=='car02_qa')throw Error('CAR02_EPHEMERAL_CI_ONLY');
 const sql=readFileSync(new URL('./R46_STAFF_GRANTS_QA_ONLY.sql',import.meta.url),'utf8');
 await pool.query(sql);pass('R46 staff table additive migration');
 const r=await pool.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.ksh_car02_staff_access'::regclass");assert.equal(r.rows[0].relrowsecurity,true);pass('RLS enabled');
 const p=await pool.query("SELECT has_table_privilege('anon','public.ksh_car02_staff_access','SELECT') anon,has_table_privilege('authenticated','public.ksh_car02_staff_access','SELECT') auth");assert.deepEqual(p.rows[0],{anon:false,auth:false});pass('anon/authenticated direct SELECT forbidden');
 await pool.query('INSERT INTO public.ksh_car02_staff_access(shop_code,user_sub,staff_role,active) VALUES($1,$2,$3,$4)',[shop,id,'owner',true]);pass('synthetic staff permission inserted');
 const resolve=createStaffAccessResolverR46({lookupMembership:createDbStaffMembershipLookupR46({pool})});
 assert.equal((await resolve({shopCode:shop,userSub:id})).role,'owner');pass('verified member binds exactly to shop');
 await reject(resolve({shopCode:'other_shop',userSub:id}));pass('cross-shop lookup denied');
 await pool.query('UPDATE public.ksh_car02_staff_access SET active=false WHERE shop_code=$1 AND user_sub=$2',[shop,id]);
 await reject(resolve({shopCode:shop,userSub:id}));pass('inactive grant denied');
 await assert.rejects(pool.query('INSERT INTO public.ksh_car02_staff_access(shop_code,user_sub,staff_role,active) VALUES($1,$2,$3,$4)',[shop,'66666666-6666-4666-8666-666666666666','admin',true]),e=>e.code==='23514');pass('unauthorized role rejected by DB check');
 console.log(`R46 STAFF PG17: ${tests} PASS; production unchanged`);
}catch(e){console.error('R46 STAFF PG17 FAILED:',e.code||e.message);process.exitCode=1}finally{await pool.end()}
