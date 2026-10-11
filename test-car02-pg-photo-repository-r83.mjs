import test from 'node:test';
import assert from 'node:assert/strict';
import {createCar02PgPhotoRepositoryR83} from './car02-pg-photo-repository-r83.mjs';

const ID=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555'];
const [orderId,reportId,staffId,photoId,blobId]=ID;
const SHOP='street_house_kitsuki';
const bucket='ksh-car02-private-photos';
const ACTOR=Object.freeze({verified:true,role:'staff',shopCode:SHOP,subject:'staff:'+staffId});
const PATH=`${SHOP}/${orderId}/${reportId}/${blobId}.png`;
const INPUT={actor:ACTOR,shop:SHOP,orderId,reportId,mimeType:'image/png',byteSize:120,sha256:'a'.repeat(64),bucket,path:PATH};
const uuidNum=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
const makePhoto=(id=photoId,state='pending',shop=SHOP)=>({id,report_id:reportId,storage_bucket:bucket,storage_path:PATH,mime_type:'image/png',byte_size:120,sha256:'a'.repeat(64),upload_state:state,order_id:orderId,shop_code:shop,order_status:'draft'});

function make(opts={}){
 const settings={db:'car02_r83_qa_ci',state:'draft',shop:SHOP,member:'staff',memberActive:true,photos:[],failSql:'',badCapacity:false,badInsert:false,badState:false,gate:true,...opts};
 let connected=0,closed=0,commits=0,rollbacks=0,next=10;
 const trace=[];
 const photos=settings.photos.map(p=>({...p}));
 // Model exclusive FOR UPDATE locks in PostgreSQL across concurrent requests.
 let lockOwner=null,waiters=[];
 async function lock(client){
   if(lockOwner===client)return;
   while(lockOwner!==null)await new Promise(resolve=>waiters.push(resolve));
   lockOwner=client;
 }
 function unlock(client){if(lockOwner===client){lockOwner=null;const w=waiters.shift();w?.();}}
 const pool={async connect(){connected++;
   const client={release(){closed++;unlock(client)},async query(sql,params=[]){
    trace.push({sql,params});
    if(settings.failSql && sql.includes(settings.failSql))throw Error('DB_SECRET_DO_NOT_LEAK '+settings.failSql);
    if(sql==='BEGIN'||sql.startsWith('SET LOCAL'))return{rows:[]};
    if(sql==='COMMIT'){commits++;unlock(client);return{rows:[]}};
    if(sql==='ROLLBACK'){rollbacks++;unlock(client);return{rows:[]}};
    if(sql.startsWith('SELECT current_database()'))return{rows:[{name:settings.db}]};
    if(sql.includes('FROM public.ksh_car02_staff_access'))return{rows:settings.member===null?[]:[{staff_role:settings.member,active:settings.memberActive}]};
    if(sql.includes('WHERE o.id=$1 AND o.shop_code=$2 AND r.id=$3')){
      await lock(client);
      return {rows:settings.shop!==params[1]?[]:[{order_id:orderId,report_id:reportId,order_status:settings.state}]};
    }
    if(sql.includes('SELECT count(*)::integer AS n FROM public.ksh_car02_photos')){
      return {rows:settings.badCapacity?[{n:'broken'}]:[{n:photos.filter(p=>p.report_id===params[0]&&['pending','ready'].includes(p.upload_state)).length}]};
    }
    if(sql.startsWith('INSERT INTO public.ksh_car02_photos')){
      if(settings.badInsert)return {rows:[{id:'invalid',upload_state:'ready'}]};
      if(photos.some(p=>p.storage_path===params[2]))throw Error('UNIQUE_PATH_DB_SECRET');
      let id=uuidNum(next++);
      photos.push({...makePhoto(id),storage_path:params[2],mime_type:params[3],byte_size:params[4],sha256:params[5]});
      return {rows:[{id,upload_state:'pending'}]};
    }
    if(sql.includes('FROM public.ksh_car02_work_orders o')&&sql.includes('JOIN public.ksh_car02_photos p')){
      await lock(client);
      const p=photos.find(p=>p.id===params[0]&&p.shop_code===params[1]);
      return {rows:p?[{...p,order_status:settings.state}]:[]};
    }
    if(sql.includes("SET upload_state='ready'")){
      const p=photos.find(p=>p.id===params[0]&&p.upload_state==='pending');
      if(!p)return{rows:[]};
      if(!settings.badState)p.upload_state='ready';
      return{rows:[{id:p.id,upload_state:p.upload_state}]};
    }
    if(sql.includes("SET upload_state='deleted'")){
      const p=photos.find(p=>p.id===params[0]&&p.upload_state==='pending');
      if(!p)return{rows:[]};
      if(!settings.badState)p.upload_state='deleted';
      return{rows:[{id:p.id,upload_state:p.upload_state}]};
    }
    throw Error('UNKNOWN_SQL '+sql.slice(0,80));
   }};
   return client;
 }};
 return {repo:createCar02PgPhotoRepositoryR83({pool,shopCode:SHOP,releaseEnabled:async()=>settings.gate}),
   photos,trace,settings,get stats(){return{connected,closed,commits,rollbacks}}};
}
const denies=async(fn,code)=>assert.rejects(fn,e=>e?.message==='CAR02_R83_'+code);
const inputReady=(photo=photoId)=>({actor:ACTOR,shop:SHOP,photoId:photo,expectedState:'pending'});

test('R83 valid reserve performs membership, locked tenant/report, cap and atomic insert',async()=>{
 const m=make();const out=await m.repo.reserve(INPUT);
 assert.match(out.id,/^[0-9a-f-]{36}$/);assert.equal(m.photos.length,1);
 assert.deepEqual(m.stats,{connected:1,closed:1,commits:1,rollbacks:0});
 assert.ok(m.trace.some(q=>q.sql.includes('FOR UPDATE OF o,r')));
 assert.ok(m.trace.some(q=>q.sql.includes("upload_state IN ('pending','ready')")));
 assert.ok(m.trace.some(q=>q.sql.includes('FOR UPDATE')&&q.sql.includes('staff_access')));
 assert.deepEqual(Object.keys(out),['id']);
});
test('R83 ready transition is scoped, atomic and typed',async()=>{
 const m=make({photos:[makePhoto()]});const out=await m.repo.markReady(inputReady());
 assert.deepEqual({...out},{id:photoId,state:'ready'});
 assert.equal(m.photos[0].upload_state,'ready');assert.equal(m.stats.commits,1);
});
test('R83 cancel rolls back pending metadata without deleting completed evidence',async()=>{
 const m=make({photos:[makePhoto()]});assert.equal(await m.repo.cancel({actor:ACTOR,shop:SHOP,photoId}),true);
 assert.equal(m.photos[0].upload_state,'deleted');assert.equal(m.stats.commits,1);
});
test('R83 cleanup can cancel pending even after work order no longer draft',async()=>{
 const m=make({photos:[makePhoto()],state:'pending'});assert.equal(await m.repo.cancel({actor:ACTOR,shop:SHOP,photoId}),true);
});
test('R83 getPending returns only server-side metadata (no signed URL)',async()=>{
 const m=make({photos:[makePhoto()]});const x=await m.repo.getPending({actor:ACTOR,shop:SHOP,photoId});
 assert.equal(x.upload_state,'pending');assert.equal(x.storage_path,PATH);
 assert.equal(Object.keys(x).includes('url'),false);
});
test('R83 never marks ready if order no longer draft',async()=>{
 const m=make({photos:[makePhoto()],state:'pending'});await denies(m.repo.markReady(inputReady()),'PHOTO_NOT_PENDING');
 assert.equal(m.photos[0].upload_state,'pending');assert.equal(m.stats.rollbacks,1);
});
test('R83 ready evidence can never be cancelled',async()=>{
 const m=make({photos:[makePhoto(photoId,'ready')]});assert.equal(await m.repo.cancel({actor:ACTOR,shop:SHOP,photoId}),false);
 assert.equal(m.photos[0].upload_state,'ready');
});
test('R83 ready evidence cannot be made ready a second time',async()=>{
 const m=make({photos:[makePhoto(photoId,'ready')]});await denies(m.repo.markReady(inputReady()),'PHOTO_NOT_PENDING');
});
for(const [name,actor] of [
 ['missing',null],['unverified',{...ACTOR,verified:false}],['customer',{...ACTOR,role:'customer'}],
 ['wrong-shop',{...ACTOR,shopCode:'other_shop'}],['role-from-browser',{...ACTOR,role:'admin'}],
 ['LINE-subject',{...ACTOR,subject:'line:'+staffId}],['nonUUID-subject',{...ACTOR,subject:'staff:malformed'}],
 ['empty-subject',{...ACTOR,subject:''}]]){
 test('R83 denies invalid staff actor '+name+' before connecting',async()=>{
  const m=make();await denies(m.repo.reserve({...INPUT,actor}),'STAFF_REQUIRED');assert.equal(m.stats.connected,0);
 });
}
for(const [label,patch] of [
 ['cross-tenant-shop',{shop:'other_shop'}],['orderID',{orderId:'not-uuid'}],
 ['reportID',{reportId:'not-uuid'}],['unsafe-mime',{mimeType:'image/svg+xml'}],
 ['wrong-bucket',{bucket:'public'}],['short-size',{byteSize:3}],['too-large',{byteSize:5242881}],
 ['fractional-size',{byteSize:2.5}],['bad-digest',{sha256:'f'.repeat(63)}],
 ['wrong-path',{path:'different/path'}],['traversal-path',{path:PATH.replace(blobId,'../'+blobId)}],
 ['wrong-extension',{path:PATH.replace('.png','.jpg')}],['oversized-path',{path:PATH+'x'.repeat(300)}]]){
 test('R83 denies invalid metadata '+label+' without any DB call',async()=>{
  const m=make();await denies(m.repo.reserve({...INPUT,...patch}),patch.shop?'STAFF_REQUIRED':'METADATA_INVALID');
  assert.equal(m.stats.connected,0);
 });
}
for(const db of ['postgres','liff-salon-reserve','car02_r81_qa_ci','car02_r83_qa','car02_r83_qa_ci-inject']){
 test('R83 rejects non-R83 disposable database '+db+' and rolls back',async()=>{
  const m=make({db});await denies(m.repo.reserve(INPUT),'ISOLATION_REQUIRED');
  assert.deepEqual(m.stats,{connected:1,closed:1,commits:0,rollbacks:1});
  assert.equal(m.trace.some(x=>x.sql.startsWith('INSERT')),false);
 });
}
for(const op of ['reserve','markReady','cancel','getPending']){
 test('R83 release gate denies '+op+' before DB or Storage',async()=>{
  const m=make({gate:false,photos:[makePhoto()]});let call;
  if(op==='reserve')call=m.repo.reserve(INPUT);
  else if(op==='markReady')call=m.repo.markReady(inputReady());
  else call=m.repo[op]({actor:ACTOR,shop:SHOP,photoId});
  await denies(call,'NOT_RELEASED');assert.equal(m.stats.connected,0);
 });
}
for(const [label,opts] of [
 ['no membership',{member:null}],['inactive membership',{memberActive:false}],
 ['role mismatch',{member:'owner'}]]){
 test('R83 server DB membership '+label+' rejects forged/stale identity',async()=>{
  const m=make(opts);await denies(m.repo.reserve(INPUT),'STAFF_REQUIRED');
  assert.equal(m.stats.commits,0);assert.equal(m.stats.rollbacks,1);
 });
}
test('R83 legitimate owner membership and verified role can reserve',async()=>{
 const m=make({member:'owner'});await m.repo.reserve({...INPUT,actor:{...ACTOR,role:'owner'}});
 assert.equal(m.photos.length,1);
});
for(const status of ['pending','approved','declined','completed']){
 test('R83 report cannot accept photos when order is '+status,async()=>{
  const m=make({state:status});await denies(m.repo.reserve(INPUT),'DRAFT_SCOPE_REQUIRED');
  assert.equal(m.photos.length,0);
 });
}
test('R83 tenant mismatch in joined SQL denies cross-shop insertion',async()=>{
 const m=make({shop:'other_shop'});await denies(m.repo.reserve(INPUT),'DRAFT_SCOPE_REQUIRED');
 assert.equal(m.photos.length,0);
});
for(const n of [3,4]){
 test('R83 blocks capacity '+n+' including pending and ready in same report',async()=>{
  const photos=Array.from({length:n},(_,i)=>makePhoto(uuidNum(i+101),i%2===0?'ready':'pending'));
  const m=make({photos});await denies(m.repo.reserve(INPUT),'PHOTO_LIMIT_REACHED');
  assert.equal(m.photos.length,n);assert.equal(m.stats.rollbacks,1);
 });
}
test('R83 deleted photos do not exhaust three-photo capacity',async()=>{
 const photos=Array.from({length:3},(_,i)=>({...makePhoto(uuidNum(i+101),'deleted'),storage_path:PATH.replace(blobId,uuidNum(i+101))}));
 const m=make({photos});await m.repo.reserve(INPUT);
 assert.equal(m.photos.filter(p=>p.upload_state==='pending').length,1);
});
test('R83 capacity query malformed result fails closed',async()=>{
 const m=make({badCapacity:true});await denies(m.repo.reserve(INPUT),'CAPACITY_UNVERIFIED');
 assert.equal(m.stats.commits,0);
});
test('R83 malformed INSERT receipt causes rollback',async()=>{
 const m=make({badInsert:true});await denies(m.repo.reserve(INPUT),'INSERT_UNVERIFIED');
 assert.equal(m.stats.rollbacks,1);
});
test('R83 concurrent fourth request cannot bypass row-locked 3-photo quota',async()=>{
 const m=make();const results=await Promise.allSettled(Array.from({length:4},(_,i)=>
   m.repo.reserve({...INPUT,path:PATH.replace(blobId,uuidNum(i+100))})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,3);
 assert.equal(results.filter(r=>r.status==='rejected').length,1);
 assert.equal(results.find(r=>r.status==='rejected').reason.message,'CAR02_R83_PHOTO_LIMIT_REACHED');
 assert.equal(m.photos.length,3);assert.equal(m.stats.commits,3);
});
test('R83 cross-tenant photo ID not found; does not update another shop',async()=>{
 const m=make({photos:[makePhoto(photoId,'pending','other_shop')]});
 await denies(m.repo.markReady(inputReady()),'PHOTO_NOT_FOUND');
 assert.equal(m.photos[0].upload_state,'pending');
});
test('R83 DB exceptions reveal neither SQL nor credentials to caller',async()=>{
 const m=make({failSql:'INSERT INTO public.ksh_car02_photos'});
 await denies(m.repo.reserve(INPUT),'REPOSITORY_UNAVAILABLE');
 assert.equal(m.stats.rollbacks,1);assert.equal(m.stats.closed,1);
});
test('R83 stale state transition refuses unexpected DB UPDATE return',async()=>{
 const m=make({photos:[makePhoto()],badState:true});await denies(m.repo.markReady(inputReady()),'STATE_CONFLICT');
 assert.equal(m.stats.rollbacks,1);
});
test('R83 no unverified photo id exposed after update failure',async()=>{
 const m=make({photos:[makePhoto()],badState:true});await denies(m.repo.cancel({actor:ACTOR,shop:SHOP,photoId}),'STATE_CONFLICT');
 assert.equal(m.stats.commits,0);
});
for(const [label,options] of [
 ['no pool',{pool:null,shopCode:SHOP,releaseEnabled:async()=>true}],
 ['invalid server shop',{pool:{connect(){}},shopCode:'../bad',releaseEnabled:async()=>true}],
 ['no release gate',{pool:{connect(){}},shopCode:SHOP}],
 ['wrong quota',{pool:{connect(){}},shopCode:SHOP,releaseEnabled:async()=>true,maxPhotos:5}]]){
 test('R83 configuration refuses '+label,()=>assert.throws(()=>createCar02PgPhotoRepositoryR83(options),/CAR02_R83_CONFIG_INVALID/));
}
test('R83 synthetic QA intentionally does not import R47/R50/R52 integration wiring',async()=>{
 const {readFileSync}=await import('node:fs');
 const code=readFileSync(new URL('./car02-pg-photo-repository-r83.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(code,/\bimport\s/);
 assert.match(code,/ISOLATED, DISPOSABLE POSTGRESQL QA ONLY/);
});
