import test from 'node:test';
import assert from 'node:assert/strict';
import {createCar02PhotoPipelineIsolatedR84} from './car02-photo-pipeline-isolated-r84.mjs';

const SHOP='street_house_kitsuki';
const OTHER='different_shop';
const ORDER='11111111-1111-4111-8111-111111111111';
const REPORT='22222222-2222-4222-8222-222222222222';
const STAFF='33333333-3333-4333-8333-333333333333';
const ORIGIN='https://review.example';
const REQUEST_URL=`https://api.example/api/car02/uploads/${ORDER}/${REPORT}`;
const PNG=new Uint8Array([137,80,78,71,13,10,26,10,0,2,3,4,5]);
const JPEG=new Uint8Array([255,216,255,224,0,1,2,3,4]);
const WEBP=new Uint8Array([82,73,70,70,1,2,3,4,87,69,66,80,1,2,3]);
const actor=Object.freeze({verified:true,role:'staff',shopCode:SHOP,subject:'staff:'+STAFF});
const uuid=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
function harness(opts={}){
 const state={db:'car02_r83_qa_ci',review:true,memberActive:true,memberRole:'staff',
  status:'draft',tenant:SHOP,privateBucket:true,failUpload:false,failRead:false,corrupt:false,
  failReady:false,authActor:actor,failDbLookup:false,failRelease:false,...opts};
 const trace={gate:0,auth:0,dbCheck:0,tx:0,commit:0,rollback:0,connectionRelease:0,
  bucketRead:0,storagePost:0,storageGet:0,storageDelete:0,queries:[],urls:[]};
 const photos=[],storage=new Map();let serial=20,lockOwner=null,waiters=[];
 async function lock(c){if(lockOwner===c)return;while(lockOwner!==null)await new Promise(resolve=>waiters.push(resolve));lockOwner=c;}
 function unlock(c){if(lockOwner===c){lockOwner=null;waiters.shift()?.();}}
 const pool={
  async query(sql){trace.dbCheck++;assert.equal(sql,'SELECT current_database() AS name');
   if(state.failDbLookup)throw Error('DB_HOST_SECRET');return {rows:[{name:state.db}]};},
  async connect(){trace.tx++;
   const c={snapshot:null,release(){trace.connectionRelease++;unlock(c)},async query(sql,params=[]){
    trace.queries.push({sql,params});
    if(sql==='BEGIN'){c.undo=[];return{rows:[]}};
    if(sql.startsWith('SET LOCAL'))return{rows:[]};
    if(sql==='COMMIT'){trace.commit++;unlock(c);return{rows:[]}};
    if(sql==='ROLLBACK'){trace.rollback++;for(const undo of c.undo.reverse())undo();unlock(c);return{rows:[]}};
    if(sql==='SELECT current_database() AS name')return{rows:[{name:state.db}]};
    if(sql.includes('FROM public.ksh_car02_staff_access'))return{rows:[{staff_role:state.memberRole,active:state.memberActive}]};
    if(sql.includes('WHERE o.id=$1 AND o.shop_code=$2 AND r.id=$3')){
     await lock(c);return{rows:state.tenant===params[1]?[{order_id:ORDER,report_id:REPORT,order_status:state.status}]:[]};
    }
    if(sql.includes('SELECT count(*)::integer AS n FROM public.ksh_car02_photos')){
     return{rows:[{n:photos.filter(p=>p.report_id===params[0]&&['pending','ready'].includes(p.upload_state)).length}]};
    }
    if(sql.startsWith('INSERT INTO public.ksh_car02_photos')){
     const [report_id,storage_bucket,storage_path,mime_type,byte_size,sha256]=params;
     const id=uuid(serial++);const row={id,report_id,storage_bucket,storage_path,mime_type,byte_size,sha256,
      upload_state:'pending',order_id:ORDER,shop_code:SHOP,order_status:state.status};photos.push(row);
     c.undo.push(()=>{const i=photos.indexOf(row);if(i>=0)photos.splice(i,1)});
     return{rows:[{id,upload_state:'pending'}]};
    }
    if(sql.includes('JOIN public.ksh_car02_photos p')){
     await lock(c);const p=photos.find(x=>x.id===params[0]&&x.shop_code===params[1]);
     return{rows:p?[{...p,order_status:state.status}]:[]};
    }
    if(sql.includes("SET upload_state='ready'")){
     if(state.failReady)throw Error('DB_READY_SECRET');
     const p=photos.find(x=>x.id===params[0]&&x.upload_state==='pending');if(!p)return{rows:[]};
     const prior=p.upload_state;c.undo.push(()=>{p.upload_state=prior});p.upload_state='ready';return{rows:[{id:p.id,upload_state:'ready'}]};
    }
    if(sql.includes("SET upload_state='deleted'")){
     const p=photos.find(x=>x.id===params[0]&&x.upload_state==='pending');if(!p)return{rows:[]};
     const prior=p.upload_state;c.undo.push(()=>{p.upload_state=prior});p.upload_state='deleted';return{rows:[{id:p.id,upload_state:'deleted'}]};
    }
    throw Error('UNKNOWN_SQL '+sql.slice(0,90));
   }};return c;
  }
 };
 const storageFetch=async(url,settings={})=>{
  trace.urls.push(String(url));
  assert.ok(String(url).startsWith('https://car02-r84-simulated.supabase.co/storage/v1/'));
  assert.equal(settings.headers?.apikey,'CAR02_R84_FAKE_STORAGE_CREDENTIAL_ONLY');
  const path=new URL(url).pathname;
  const method=settings.method||'GET';
  if(path==='/storage/v1/bucket/ksh-car02-private-photos'){
   trace.bucketRead++;return Response.json({id:'ksh-car02-private-photos',public:!state.privateBucket});
  }
  const prefix='/storage/v1/object/ksh-car02-private-photos/';
  const authPrefix='/storage/v1/object/authenticated/ksh-car02-private-photos/';
  if(method==='POST'&&path.startsWith(prefix)){
   trace.storagePost++;if(state.failUpload)return new Response('fail',{status:503});
   if(storage.has(path.slice(prefix.length)))return new Response('duplicate',{status:409});
   storage.set(path.slice(prefix.length),new Uint8Array(settings.body));return new Response('',{status:201});
  }
  if(method==='GET'&&path.startsWith(authPrefix)){
   trace.storageGet++;if(state.failRead)return new Response('',{status:404});
   const b=storage.get(path.slice(authPrefix.length));if(!b)return new Response('',{status:404});
   const out=new Uint8Array(b);if(state.corrupt)out[out.length-1]^=1;
   return new Response(out,{status:200,headers:{'Content-Type':'application/octet-stream'}});
  }
  if(method==='DELETE'&&path.startsWith(prefix)){
   trace.storageDelete++;storage.delete(path.slice(prefix.length));return new Response(null,{status:204});
  }
  throw Error('FAKE_STORAGE_BAD_ROUTE');
 };
 const pipeline=createCar02PhotoPipelineIsolatedR84({pool,shopCode:SHOP,allowedOrigins:[ORIGIN],
  authenticate:async()=>{trace.auth++;return state.authActor},reviewGate:async()=>{trace.gate++;if(state.failRelease)throw Error('SECRET');return state.review},storageFetch});
 const send=({url=REQUEST_URL,origin=ORIGIN,mime='image/png',body=PNG,method='POST',extra={}}={})=>{
  const headers={origin,authorization:'Bearer '+'x'.repeat(32),'content-type':mime,...extra};
  return pipeline.handle(new Request(url,{method,headers,
   ...(!['GET','HEAD'].includes(method)&&body!==null?{body}:{}),
   ...(body instanceof ReadableStream?{duplex:'half'}:{})}));
 };
 return{state,trace,photos,storage,pipeline,send};
}
async function denial(p,status,code){const r=await p;assert.equal(r.status,status);
 assert.deepEqual(await r.json(),{ok:false,code});assert.equal(r.headers.get('cache-control'),'no-store');
 return r;
}

test('R84 full HTTP -> R47 -> R83 -> fake Storage happy path returns only receipt',async()=>{
 const m=harness();const r=await m.send();assert.equal(r.status,201);
 const b=await r.json();assert.deepEqual(b,{ok:true,photoId:uuid(20),state:'ready',mimeType:'image/png',byteSize:PNG.length});
 assert.equal(m.photos.length,1);assert.equal(m.photos[0].upload_state,'ready');
 assert.equal(m.storage.size,1);assert.equal(m.trace.storagePost,1);assert.equal(m.trace.storageGet,1);
 assert.ok(m.trace.queries.some(q=>q.sql.includes('FOR UPDATE OF o,r')));
 assert.ok(m.trace.queries.some(q=>q.sql.includes('ksh_car02_staff_access')));
 assert.equal(m.trace.rollback,0);assert.equal(m.trace.connectionRelease,2);
 assert.equal(JSON.stringify(b).includes('sha256'),false);
 assert.equal(JSON.stringify(b).includes('storage_path'),false);
});
for(const [name,mime,body] of [['PNG','image/png',PNG],['JPEG','image/jpeg',JPEG],['WEBP','image/webp',WEBP]]){
 test(`R84 ${name} valid magic bytes survive isolated pipeline`,async()=>{
  const m=harness();const r=await m.send({mime,body});assert.equal(r.status,201);
  assert.equal(m.photos[0].mime_type,mime);assert.equal(m.photos[0].byte_size,body.length);
 });
}
test('R84 4th upload fails 3-image cap, leaves exactly 3 ready photos',async()=>{
 const m=harness();for(let i=0;i<3;i++)assert.equal((await m.send()).status,201);
 await denial(m.send(),503,'CAR02_PHOTO_UPLOAD_UNAVAILABLE');
 assert.equal(m.photos.filter(x=>x.upload_state==='ready').length,3);
 assert.equal(m.photos.filter(x=>x.upload_state==='pending').length,0);
 assert.equal(m.storage.size,3);assert.equal(m.trace.storagePost,3);
});
test('R84 concurrent 4 uploads serialize metadata and reject fourth',async()=>{
 const m=harness();const r=await Promise.all(Array.from({length:4},()=>m.send()));
 assert.deepEqual(r.map(x=>x.status).sort(),[201,201,201,503]);
 assert.equal(m.photos.filter(x=>x.upload_state==='ready').length,3);assert.equal(m.storage.size,3);
});
test('R84 upload returned object differs on readback: cancels DB and removes Storage object',async()=>{
 const m=harness({corrupt:true});await denial(m.send(),503,'CAR02_PHOTO_UPLOAD_UNAVAILABLE');
 assert.equal(m.photos.length,1);assert.equal(m.photos[0].upload_state,'deleted');
 assert.equal(m.storage.size,0);assert.equal(m.trace.storageDelete,1);
});
test('R84 failed Storage POST cancels pending DB row without ready state',async()=>{
 const m=harness({failUpload:true});await denial(m.send(),503,'CAR02_PHOTO_UPLOAD_UNAVAILABLE');
 assert.equal(m.photos.length,1);assert.equal(m.photos[0].upload_state,'deleted');assert.equal(m.storage.size,0);
});
test('R84 failed Storage GET cancels row and deletes accepted object',async()=>{
 const m=harness({failRead:true});await denial(m.send(),503,'CAR02_PHOTO_UPLOAD_UNAVAILABLE');
 assert.equal(m.photos[0].upload_state,'deleted');assert.equal(m.storage.size,0);assert.equal(m.trace.storageDelete,1);
});
test('R84 PostgreSQL ready failure cancels row and deletes stored object',async()=>{
 const m=harness({failReady:true});await denial(m.send(),503,'CAR02_PHOTO_UPLOAD_UNAVAILABLE');
 assert.equal(m.photos[0].upload_state,'deleted');assert.equal(m.storage.size,0);assert.ok(m.trace.rollback>=1);
});
test('R84 storage bucket must be private: never makes any photo metadata row',async()=>{
 const m=harness({privateBucket:false});await denial(m.send(),503,'CAR02_PHOTO_UPLOAD_UNAVAILABLE');
 assert.equal(m.photos.length,0);assert.equal(m.trace.storagePost,0);
});
for(const db of ['postgres','liff-salon-reserve','car02_r81_qa_ci','car02_r84_qa_ci','car02_r83_qa_']){
 test('R84 rejects non-disposable DB '+db+' BEFORE auth/storage',async()=>{
  const m=harness({db});await denial(m.send(),503,'CAR02_NOT_RELEASED');
  assert.equal(m.trace.auth,0);assert.equal(m.trace.bucketRead,0);assert.equal(m.trace.tx,0);
 });
}
for(const settings of [{review:false},{failRelease:true},{failDbLookup:true}]){
 test('R84 disabled/uncertain QA gate stops before auth and Storage '+JSON.stringify(settings),async()=>{
  const m=harness(settings);await denial(m.send(),503,'CAR02_NOT_RELEASED');
  assert.equal(m.trace.auth,0);assert.equal(m.trace.bucketRead,0);assert.equal(m.trace.tx,0);
 });
}
for(const [name,props] of [
 ['inactive',{memberActive:false}],['wrong membership role',{memberRole:'owner'}],
 ['other shop record',{tenant:OTHER}],['not draft',{status:'pending'}],
 ['approved',{status:'approved'}]]){
 test('R84 '+name+' cannot reserve private photo',async()=>{
  const m=harness(props);await denial(m.send(),503,'CAR02_PHOTO_UPLOAD_UNAVAILABLE');
  assert.equal(m.storage.size,0);assert.equal(m.trace.storagePost,0);assert.equal(m.photos.length,0);
 });
}
for(const [name,a] of [['LINE',{...actor,subject:'line:'+STAFF}],['customer',{...actor,role:'customer'}],
 ['cross-tenant',{...actor,shopCode:OTHER}],['unverified',{...actor,verified:false}],
 ['missing-subject',{...actor,subject:''}]]){
 test('R84 actor cannot upload: '+name,async()=>{
  const m=harness({authActor:a});await denial(m.send(),403,'CAR02_STAFF_REQUIRED');
  assert.equal(m.trace.bucketRead,0);assert.equal(m.trace.tx,0);
 });
}
test('R84 untrusted headers cannot set shop/role/bucket/URL',async()=>{
 const m=harness();const response=await m.send({extra:{'x-shop-code':OTHER,'x-role':'owner',
  'x-storage-bucket':'public','x-photo-url':'https://evil.example/steal'}});
 assert.equal(response.status,201);assert.equal(m.photos[0].shop_code,SHOP);
 assert.equal(m.photos[0].storage_bucket,'ksh-car02-private-photos');
});
test('R84 exact CORS preflight does not call auth, DB tx, Storage',async()=>{
 const m=harness();const response=await m.send({method:'OPTIONS',body:null,
  extra:{'access-control-request-method':'POST','access-control-request-headers':'Authorization, Content-Type'}});
 assert.equal(response.status,204);assert.equal(response.headers.get('Access-Control-Allow-Origin'),ORIGIN);
 assert.equal(m.trace.auth,0);assert.equal(m.trace.bucketRead,0);assert.equal(m.trace.tx,0);
});
test('R84 cross-origin request denied before release DB lookup',async()=>{
 const m=harness();await denial(m.send({origin:'https://evil.example'}),403,'CAR02_ORIGIN_DENIED');
 assert.equal(m.trace.dbCheck,0);assert.equal(m.trace.auth,0);
});
for(const [name,mime,body] of [['GIF','image/gif',PNG],['PDF bytes','image/png',new Uint8Array([37,80,68,70,1,2,3,4])],
 ['too small','image/png',new Uint8Array([1,2,3])]]){
 test('R84 denies invalid image: '+name,async()=>{
  const m=harness();await denial(m.send({mime,body}),mime==='image/gif'?415:body.length<4?400:503,
   mime==='image/gif'?'CAR02_IMAGE_TYPE_DENIED':body.length<4?'CAR02_IMAGE_INVALID':'CAR02_PHOTO_UPLOAD_UNAVAILABLE');
  assert.equal(m.trace.storagePost,0);assert.equal(m.photos.length,0);
 });
}
test('R84 signed upload/storage URL never appears in the HTTP result',async()=>{
 const m=harness();const r=await m.send();const txt=await r.text();
 assert.doesNotMatch(txt,/storage|url|sha256|key|Bearer|supabase/i);
});
test('R84 rejects credentials and endpoint injected through arguments',()=>{
 const m=harness();
 assert.throws(()=>createCar02PhotoPipelineIsolatedR84({shopCode:SHOP,allowedOrigins:[ORIGIN],
  authenticate:async()=>actor,reviewGate:async()=>true,storageFetch:async()=>Response.json({})}),
  /CAR02_R84_ISOLATED_DEPENDENCIES_REQUIRED/);
 assert.deepEqual(Object.keys(m.pipeline),['handle']);
});
