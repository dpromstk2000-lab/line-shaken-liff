// DPRO CAR02 R48 private photo read: REAL PostgreSQL 17, DISPOSABLE GitHub CI ONLY.
// Run after R43/R45/R46 tests. Does not use live database or live Storage.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {createCar02PgPhotoViewR48} from './car02-pg-photo-view-r48.mjs';
import {createCar02PrivatePhotoViewR48,createCar02PhotoHttpR48} from './car02-private-photo-view-r48.mjs';
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const C='33333333-3333-4333-8333-333333333333';
const SHOP='street_house_kitsuki';
const actor={verified:true,role:'staff',shopCode:SHOP,subject:'ci:staff'};
const customer={verified:true,role:'customer',shopCode:SHOP,customerId:A,subject:'ci:line'};
const otherCustomer={...customer,customerId:C,subject:'ci:other'};
const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0,1,2,3,4,5]);
const sha256=createHash('sha256').update(png).digest('hex');
let tests=0;
const pass=label=>{console.log(`PASS R48 PG ${++tests}: ${label}`)};
const pool=new pg.Pool({host:process.env.PGHOST,port:Number(process.env.PGPORT||5432),user:process.env.PGUSER,password:process.env.PGPASSWORD,database:process.env.PGDATABASE,max:2});
const deny=async p=>assert.rejects(p,/CAR02_PHOTO_ACCESS_DENIED/);
try{
 if(process.env.GITHUB_ACTIONS!=='true'||!['localhost','127.0.0.1'].includes(process.env.PGHOST)||
    process.env.PGDATABASE!=='car02_qa'||process.env.PGPASSWORD!=='qa_only_local')throw Error('CAR02_R48_EPHEMERAL_CI_ONLY');
 const v=await pool.query('SHOW server_version_num');if(Number(v.rows[0].server_version_num)<170000)throw Error('POSTGRES_17_REQUIRED');
 const find=createCar02PgPhotoViewR48({pool});
 const o=(await pool.query(`INSERT INTO public.ksh_car02_work_orders(shop_code,customer_id,vehicle_id)
     VALUES($1,$2,$3) RETURNING id`,[SHOP,A,B])).rows[0];
 const report=(await pool.query(`INSERT INTO public.ksh_car02_reports(work_order_id,observation,revised_by)
     VALUES($1,'Brake inspection','staff') RETURNING id`,[o.id])).rows[0];
 const path=`${SHOP}/${o.id}/${report.id}/44444444-4444-4444-8444-444444444444.png`;
 const p=(await pool.query(`INSERT INTO public.ksh_car02_photos(report_id,storage_path,mime_type,byte_size,sha256,upload_state)
     VALUES($1,$2,'image/png',$3,$4,'ready') RETURNING id`,[report.id,path,png.length,sha256])).rows[0];
 assert.equal((await find.findReady({actor,shop:SHOP,photoId:p.id})).id,p.id);pass('staff reads READY photo on own shop');
 await deny(find.findReady({actor:customer,shop:SHOP,photoId:p.id}));pass('customer denied while quote remains draft/unpresented');
 await deny(find.findReady({actor:{...actor,shopCode:'other_shop'},shop:'other_shop',photoId:p.id}));pass('other-shop staff denied');
 const q=(await pool.query(`INSERT INTO public.ksh_car02_quotes(
    work_order_id,report_id,revision,quote_state,items_snapshot,report_snapshot,photos_snapshot,
    subtotal_yen,tax_yen,total_yen,tax_basis_points)
    VALUES($1,$2,1,'draft','[]'::jsonb,'Brake inspection',$3::jsonb,1000,100,1100,1000) RETURNING id`,
    [o.id,report.id,JSON.stringify([p.id])])).rows[0];
 await deny(find.findReady({actor:customer,shop:SHOP,photoId:p.id}));pass('customer cannot view photos from draft quote');
 await pool.query("UPDATE public.ksh_car02_quotes SET quote_state='pending',presented_at=now() WHERE id=$1",[q.id]);
 const ready=await find.findReady({actor:customer,shop:SHOP,photoId:p.id});assert.equal(ready.id,p.id);pass('customer may view own photo in presented quote');
 await deny(find.findReady({actor:otherCustomer,shop:SHOP,photoId:p.id}));pass('another customer blocked even with photo UUID');
 const calls=[];
 const viewer=createCar02PrivatePhotoViewR48({repository:find,releaseEnabled:async()=>true,
  baseUrl:'https://example-ref.supabase.co',serviceRoleKey:'test-ci-only-never-production-12345',
  fetchImpl:async(url,opts)=>{calls.push({url,opts});return new Response(png,{headers:{'Content-Type':'image/png'}})}});
 const http=createCar02PhotoHttpR48({viewer,authenticate:async()=>customer,releaseEnabled:async()=>true,
  allowedOrigins:['https://dpromstk2000-lab.github.io']});
 const resp=await http(new Request(`https://api.invalid/api/car02/photos/${p.id}`,{
   headers:{Origin:'https://dpromstk2000-lab.github.io','X-Line-ID-Token':'ci-token-only'}}));
 assert.equal(resp.status,200);assert.deepEqual(new Uint8Array(await resp.arrayBuffer()),png);
 assert.equal(calls.length,1);assert.ok(calls[0].url.includes('/authenticated/'));pass('HTTP + verified customer + real PG + private mock Storage');
 const deniedHttp=createCar02PhotoHttpR48({viewer,authenticate:async()=>otherCustomer,releaseEnabled:async()=>true});
 const blocked=await deniedHttp(new Request(`https://api.invalid/api/car02/photos/${p.id}`));
 assert.equal(blocked.status,404);assert.equal(calls.length,1);pass('HTTP foreign customer blocked before Storage GET');
 const locked=createCar02PhotoHttpR48({viewer,authenticate:async()=>{throw Error('AUTH_CALLED');},releaseEnabled:async()=>false});
 const lockedResp=await locked(new Request(`https://api.invalid/api/car02/photos/${p.id}`));
 assert.equal(lockedResp.status,503);assert.equal(calls.length,1);pass('release gate blocks before identity and storage');
 console.log(`R48 PHOTO VIEW PG17: ${tests} PASS; NO production DB, Storage or tokens accessed`);
}catch(e){console.error('R48 PHOTO VIEW PG17 FAILED:',e.message||e.code);process.exitCode=1}finally{await pool.end()}
