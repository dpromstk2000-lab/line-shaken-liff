// CAR02 R50 QA: REAL isolated PostgreSQL17 + unified server routing + MOCK Supabase Auth/Storage.
// NEVER run on a real Supabase project. No live tokens, storage credentials or customer data.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {createCar02UnifiedRuntimeR50} from './car02-unified-runtime-r50.mjs';
const SHOP='street_house_kitsuki';
const ORIGIN='https://dpromstk2000-lab.github.io';
const BASE='https://qa-test-only.supabase.co';
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const S='77777777-7777-4777-8777-777777777777';
const PNG=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0,1,2,3,4,5]);
const sha=createHash('sha256').update(PNG).digest('hex');
let enabled=false,dbReads=0,storageReads=0,identityChecks=0,n=0;
const pool=new pg.Pool({host:process.env.PGHOST,port:Number(process.env.PGPORT||5432),
 user:process.env.PGUSER,password:process.env.PGPASSWORD,database:process.env.PGDATABASE,max:4});
const staffToken=['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify({
 sub:S,iss:BASE+'/auth/v1',aud:'authenticated',role:'authenticated',exp:4102444800
})).toString('base64url'),'ci-signature-is-not-real'].join('.');
const auth={Authorization:'Bearer '+staffToken,Origin:ORIGIN};
const fakeNetwork=async(url,opts={})=>{
 if(url===BASE+'/auth/v1/user'){
  identityChecks++;
  if(opts.headers?.Authorization!=='Bearer '+staffToken)throw Error('BAD_CI_STAFF');
  return Response.json({id:S,aud:'authenticated'});
 }
 if(url.startsWith(BASE+'/storage/v1/object/authenticated/ksh-car02-private-photos/')){
  storageReads++;
  if(opts.headers?.Authorization!=='Bearer qa-test-only-service-role-key-123456')throw Error('BAD_CI_STORAGE');
  return new Response(PNG,{headers:{'Content-Type':'image/png'}});
 }
 throw Error('UNEXPECTED_FAKE_PROVIDER_ENDPOINT');
};
const release=()=>({systemCode:'CAR02',contracted:enabled,goLiveApproved:enabled,
 migrationVerified:true,verifiedIdentityBound:true,workerBackendReady:true,externalNotificationsReviewed:true});
const handler=createCar02UnifiedRuntimeR50({pool,shopCode:SHOP,lineChannelId:'2010239091',
 supabaseUrl:BASE,supabaseAnonKey:'test-only-supabase-anon-key-123456',
 storageServiceRoleKey:'qa-test-only-service-role-key-123456',
 releaseState:release,allowedOrigins:[ORIGIN],fetchImpl:fakeNetwork,nowSeconds:()=>1000});
const step=x=>console.log(`PASS R50 UNIFIED ${++n}: ${x}`);
async function call(path,{method='GET',body,key,headers={}}={}){
 const h={...auth,...headers};if(body!==undefined)h['Content-Type']='application/json';
 if(key)h['Idempotency-Key']=key;
 const resp=await handler(new Request('https://r50-ci.invalid'+path,{method,headers:h,
  ...(body===undefined?{}:{body:JSON.stringify(body)})}));
 return{status:resp.status,resp,data:resp.headers.get('content-type')?.includes('application/json')?await resp.json():null};
}
try{
 if(process.env.GITHUB_ACTIONS!=='true'||!['127.0.0.1','localhost'].includes(process.env.PGHOST)||
    process.env.PGDATABASE!=='car02_qa'||process.env.PGPASSWORD!=='qa_only_local')throw Error('R50_ISOLATED_CI_ONLY');
 const v=await pool.query('SHOW server_version_num');if(Number(v.rows[0].server_version_num)<170000)throw Error('R50_PG17_REQUIRED');
 const dbCount=(await pool.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'ksh_car02_%'")).rows[0].n;
 assert.ok(dbCount>=9);step('R13 and R46 tables available in disposable PostgreSQL');
 await pool.query(`INSERT INTO public.ksh_car02_staff_access(shop_code,user_sub,staff_role,active)
  VALUES ($1,$2,'staff',true) ON CONFLICT (shop_code,user_sub) DO UPDATE SET active=true,staff_role='staff'`,[SHOP,S]);
 step('synthetic Supabase staff identity bound to shop');
 const locked=await call('/api/car02',{method:'POST',body:{customerId:A,vehicleId:B},key:'r50-locked-123456'});
 assert.equal(locked.status,503);assert.equal(identityChecks,0);step('unreleased API cannot contact Auth or database records');
 enabled=true;
 const unauth=await call('/api/car02',{headers:{Authorization:'',Origin:ORIGIN}});
 assert.equal(unauth.status,401);step('missing staff credential denied');
 const foreign=await call('/api/car02',{method:'POST',body:{customerId:A,vehicleId:B},key:'r50-forbidden-123456',headers:{Origin:'https://untrusted.invalid'}});
 assert.equal(foreign.status,403);step('foreign origin denied before Auth');
 const created=await call('/api/car02',{method:'POST',body:{customerId:A,vehicleId:B},key:'r50-create-123456'});
 assert.equal(created.status,200,JSON.stringify(created.data));const order=created.data.data;
 assert.equal(order.status,'draft');assert.ok(order.id);step('verified Supabase Auth + staff membership + HTTP creates PostgreSQL order');
 const report=await call(`/api/car02/${order.id}/report`,{method:'POST',body:{observation:'R50 synthetic vehicle report',photos:[],expectedVersion:order.version},key:'r50-report-123456'});
 assert.equal(report.status,200,JSON.stringify(report.data));step('unified HTTP persists authenticated report');
 const r=(await pool.query('SELECT id FROM public.ksh_car02_reports WHERE work_order_id=$1 LIMIT 1',[order.id])).rows[0];
 assert.ok(r?.id);
 const path=`${SHOP}/${order.id}/${r.id}/88888888-8888-4888-8888-888888888888.png`;
 const p=(await pool.query(`INSERT INTO public.ksh_car02_photos(report_id,storage_path,mime_type,byte_size,sha256,upload_state)
 VALUES($1,$2,'image/png',$3,$4,'ready') RETURNING id`,[r.id,path,PNG.length,sha])).rows[0];
 assert.ok(p?.id);step('non-public synthetic photograph metadata saved in disposable PostgreSQL');
 const photo=await call('/api/car02/photos/'+p.id);
 assert.equal(photo.status,200);assert.equal(photo.resp.headers.get('cache-control'),'private, no-store, max-age=0');
 assert.deepEqual(new Uint8Array(await photo.resp.arrayBuffer()),PNG);
 assert.equal(storageReads,1);step('same verified staff credential reads private photo with checksum through unified route');
 const badPhoto=await call('/api/car02/photos/'+p.id,{headers:{Authorization:''}});
 assert.equal(badPhoto.status,401);assert.equal(storageReads,1);step('missing photo identity cannot reach storage');
 enabled=false;
 const disabledPhoto=await call('/api/car02/photos/'+p.id);
 assert.equal(disabledPhoto.status,503);assert.equal(storageReads,1);step('server re-lock immediately blocks photo reads');
 const oldBusiness=await call('/api/reservations');assert.equal(oldBusiness.status,404);
 step('legacy API remains outside CAR02 router');
 console.log(`R50 UNIFIED PG17 INTEGRATION: ${n} PASS, isolated DB + synthetic third-party responses; NO live systems modified`);
}catch(e){console.error('R50 UNIFIED PG17 FAILED:',e.stack||e);process.exitCode=1}
finally{await pool.end()}
