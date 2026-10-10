import test from 'node:test';
import assert from 'node:assert/strict';
import { createCar02Service } from './car02-core.mjs';
import { createCar02PgAdapter } from './car02-pg-adapter.mjs';
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';
const shop='street_house_kitsuki';
const staff={verified:true,role:'staff',subject:'staff:1',shopCode:shop};
const customer={verified:true,role:'customer',subject:'LINE:verified:1',shopCode:shop,customerId:A};
const key=i=>`car02-r43-example-key-${i}`;
function fixture(){
 let counter=50,failOn='',released=0,calls=[];
 let s={orders:new Map(),reports:new Map(),photos:new Map(),quotes:new Map(),decisions:new Map(),events:[],operations:new Map(),outbox:[]};
 const uid=()=>`${String(counter++).padStart(8,'0')}-1111-4111-8111-111111111111`;
 const result=(rows=[])=>({rows,rowCount:rows.length});
 const one=x=>result(x?[structuredClone(x)]:[]);
 let saved=null;
 const pool={async connect(){return{release(){released++},async query(sql,p=[]){
  calls.push({sql:sql.trim().replace(/\s+/g,' '),p});
  if(failOn&&sql.includes(failOn))throw Error('FAULT_INJECTION');
  if(sql==='BEGIN'){saved=structuredClone(s);return result()}
  if(sql==='COMMIT'){saved=null;return result()}
  if(sql==='ROLLBACK'){s=saved;saved=null;return result()}
  if(sql.includes('pg_advisory_xact_lock'))return result([{pg_advisory_xact_lock:null}]);
  if(sql.includes('AS shop_ok'))return one({shop_ok:p[0]===shop,customer_ok:p[1]===A,vehicle_ok:p[2]===B,reservation_ok:p[3]===null});
  if(sql.includes('FROM public.ksh_car02_operations WHERE'))return one(s.operations.get(p.join('|')));
  if(sql.includes('INSERT INTO public.ksh_car02_operations')){s.operations.set(p.slice(0,3).join('|'),{request_digest:p[3],response_snapshot:JSON.parse(p[4]),completed_at:'2026-10-10'});return result()}
  if(sql.includes('INSERT INTO public.ksh_car02_work_orders')){
   const x={id:uid(),shop_code:p[0],customer_id:p[1],vehicle_id:p[2],reservation_id:p[3],status:'draft',state_version:1};
   s.orders.set(x.id,x);return one(x);
  }
  if(sql.includes('FROM public.ksh_car02_work_orders')&&sql.includes('SELECT *')){
   const x=[...s.orders.values()].find(x=>sql.includes('WHERE shop_code=$1')?x.shop_code===p[0]&&x.id===p[1]:x.id===p[0]&&x.shop_code===p[1]);return one(x);
  }
  if(sql.includes('INSERT INTO public.ksh_car02_reports')){
   const x={id:uid(),work_order_id:p[0],observation:p[1],report_version:1};s.reports.set(x.id,x);return result();
  }
  if(sql.includes('UPDATE public.ksh_car02_reports')){const x=s.reports.get(p[0]);x.observation=p[1];return result()}
  if(sql.includes('FROM public.ksh_car02_reports')&&sql.includes('ORDER BY report_version'))return one([...s.reports.values()].filter(x=>x.work_order_id===p[0]).sort((a,b)=>b.report_version-a.report_version)[0]);
  if(sql.includes('FROM public.ksh_car02_photos')){
   if(sql.includes('count(*)')) return one({n:[...s.photos.values()].filter(x=>x.report_id===p[0]&&x.upload_state==='pending').length});
   const a=[...s.photos.values()].filter(x=>x.report_id===p[0]&&x.upload_state==='ready'&&(!sql.includes('ANY(')||p[1].includes(x.id)));
   return result(a.map(x=>({id:x.id})));
  }
  if(sql.includes('INSERT INTO public.ksh_car02_quotes')){
   const x={id:uid(),work_order_id:p[0],report_id:p[1],revision:p[2],quote_state:'draft',items_snapshot:JSON.parse(p[3]),report_snapshot:p[4],photos_snapshot:JSON.parse(p[5]),subtotal_yen:p[6],tax_yen:p[7],total_yen:p[8],presented_at:null};
   s.quotes.set(x.id,x);return one(x);
  }
  if(sql.includes('FROM public.ksh_car02_quotes')&&sql.includes('ORDER BY revision'))return one([...s.quotes.values()].filter(x=>x.work_order_id===p[0]).sort((a,b)=>b.revision-a.revision)[0]);
  if(sql.includes('UPDATE public.ksh_car02_quotes SET')){
   const x=s.quotes.get(p[0]);if(sql.includes("quote_state='pending'")){assert.equal(x.quote_state,'draft');x.quote_state='pending';x.presented_at='2026-10-10T10:00:00.000Z'}
   else {assert.equal(x.quote_state,'pending');assert.ok(s.decisions.has(x.id),'decision before final quote');x.quote_state=p[1]}
   return result();
  }
  if(sql.includes('INSERT INTO public.ksh_car02_decisions')){
   const x=s.quotes.get(p[1]);assert.ok(x);assert.equal(x.quote_state,'pending');
   assert.equal(s.orders.get(p[0]).customer_id,p[2]);s.decisions.set(p[1],{decision:p[4],decline_reason:p[5],decided_at:p[6]});return result();
  }
  if(sql.includes('FROM public.ksh_car02_decisions'))return one(s.decisions.get(p[1]));
  if(sql.includes('UPDATE public.ksh_car02_work_orders')){
   const x=s.orders.get(p[0]);if(!x||x.shop_code!==p[1]||x.state_version!==p[2]||x.status!==p[5])return result();
   if(p[3]==='pending')assert.ok([...s.quotes.values()].some(z=>z.work_order_id===x.id&&z.quote_state==='pending'));
   if(['approved','declined'].includes(p[3]))assert.ok([...s.quotes.values()].some(z=>z.work_order_id===x.id&&z.quote_state===p[3]&&s.decisions.has(z.id)));
   if(p[3]==='completed')assert.ok([...s.quotes.values()].some(z=>z.work_order_id===x.id&&z.quote_state==='approved'&&s.decisions.has(z.id)));
   x.status=p[3];x.state_version=p[4];return one({id:x.id});
  }
  if(sql.includes('INSERT INTO public.ksh_car02_events')){s.events.push({work_order_id:p[0],actor_role:p[1],actor_fingerprint:p[2],event_type:p[3],created_at:new Date().toISOString()});return result()}
  if(sql.includes('FROM public.ksh_car02_events'))return result(s.events.filter(x=>x.work_order_id===p[0]));
  if(sql.includes('INSERT INTO public.ksh_car02_notification_outbox')){s.outbox.push({order:p[0],quote:p[1],key:p[2]});return result()}
  throw Error('UNMOCKED_SQL: '+sql.slice(0,160));
 }}}};
 const svc=createCar02Service(createCar02PgAdapter(pool));
 return {svc,get db(){return s},get calls(){return calls},get released(){return released},setFault(x){failOn=x},addReadyPhoto(order){const r=[...s.reports.values()].find(x=>x.work_order_id===order.id);const id=uid();s.photos.set(id,{id,report_id:r.id,upload_state:'ready'});return id},addPendingPhoto(order){const r=[...s.reports.values()].find(x=>x.work_order_id===order.id);const id=uid();s.photos.set(id,{id,report_id:r.id,upload_state:'pending'});return id}};
}
async function created(t){return t.svc.create({actor:staff,shop,customerId:A,vehicleId:B,key:key('create')})}
async function reported(t,o,photos=[]){return t.svc.report({actor:staff,shop,id:o.id,observation:'点検済・交換推奨',photos,expectedVersion:o.version,key:key('report'+o.version)})}
async function quoted(t,o){return t.svc.present({actor:staff,shop,id:o.id,items:[{name:'交換',price:101}],expectedVersion:o.version,key:key('present')})}
test('R13-backed flow: order → report → quote pending → customer approval → completion',async()=>{
 const t=fixture();let o=await created(t);assert.equal(o.status,'draft');
 o=await reported(t,o);assert.equal(o.observation,'点検済・交換推奨');assert.equal(o.version,2);
 o=await quoted(t,o);assert.equal(o.status,'pending');assert.equal(o.quote.total,111);assert.equal(t.db.outbox.length,1);
 o=await t.svc.decide({actor:customer,shop,id:o.id,decision:'approved',expectedVersion:o.version,key:key('approve')});
 assert.equal(o.status,'approved');assert.equal(o.decision.value,'approved');
 o=await t.svc.complete({actor:staff,shop,id:o.id,expectedVersion:o.version,key:key('complete')});
 assert.equal(o.status,'completed');assert.equal(o.events.length,5);
 assert.deepEqual((await t.svc.get({actor:customer,shop,id:o.id})).status,'completed');
 assert.ok(t.calls.some(c=>c.sql.includes('ksh_car02_decisions')));
 assert.ok(t.calls.some(c=>c.sql.includes("quote_state='pending'")));
 assert.equal(t.db.outbox.length,1);
});
test('idempotent replay and reused key with DIFFERENT payload rejected',async()=>{
 const t=fixture(),o=await created(t);const same=await created(t);assert.deepEqual(same,o);assert.equal(t.db.orders.size,1);
 await assert.rejects(t.svc.create({actor:staff,shop,customerId:A,vehicleId:B,reservationId:'44444444-4444-4444-8444-444444444444',key:key('create')}),{code:'CAR02_IDEMPOTENCY_KEY_REUSED'});
 assert.equal(t.db.orders.size,1);
});
test('bad actor, cross tenant, customer of another order refused',async()=>{
 const t=fixture(),o=await created(t);
 await assert.rejects(t.svc.get({actor:{...customer,customerId:B},shop,id:o.id}),{code:'CAR02_UNAUTHORIZED'});
 await assert.rejects(t.svc.create({actor:{...staff,shopCode:'wrong'},shop,customerId:A,vehicleId:B,key:key('other')}),{code:'CAR02_UNAUTHORIZED'});
});
test('fault after quote insert produces ROLLBACK, not pending state',async()=>{
 const t=fixture();let o=await reported(t,await created(t));t.setFault('INSERT INTO public.ksh_car02_notification_outbox');
 await assert.rejects(quoted(t,o),/FAULT_INJECTION/);
 assert.equal(t.db.quotes.size,0);assert.equal(t.db.orders.get(o.id).status,'draft');assert.equal(t.db.operations.size,2);
 assert.equal(t.calls.at(-1).sql,'ROLLBACK');
 t.setFault('');o=await quoted(t,o);assert.equal(o.status,'pending');
});
test('stale state version and illegal action are rejected without mutation',async()=>{
 const t=fixture();let o=await created(t);o=await reported(t,o);
 await assert.rejects(t.svc.report({actor:staff,shop,id:o.id,observation:'old',photos:[],expectedVersion:1,key:key('stale')}),{code:'CAR02_VERSION_CONFLICT'});
 await assert.rejects(t.svc.decide({actor:staff,shop,id:o.id,decision:'approved',expectedVersion:o.version,key:key('badactor')}),{code:'CAR02_UNAUTHORIZED'});
 assert.equal(t.db.orders.get(o.id).state_version,2);
});
test('photo IDs must be registered ready against current report (three max)',async()=>{
 const t=fixture();let o=await created(t);
 await assert.rejects(t.svc.report({actor:staff,shop,id:o.id,observation:'test',photos:[A],expectedVersion:1,key:key('premature')}),{code:'CAR02_REPORT_FIRST_REQUIRED'});
 o=await reported(t,o);
 const photo=t.addReadyPhoto(o);
 o=await reported(t,o,[photo]);assert.deepEqual(o.photos,[photo]);
 await assert.rejects(t.svc.report({actor:staff,shop,id:o.id,observation:'update',photos:[A],expectedVersion:o.version,key:key('alien')}),{code:'CAR02_PHOTO_NOT_READY_OR_SCOPE'});
 assert.equal(t.db.orders.get(o.id).state_version,3);
});
test('declined quote persists decision and blocks completion',async()=>{
 const t=fixture();let o=await quoted(t,await reported(t,await created(t)));
 o=await t.svc.decide({actor:customer,shop,id:o.id,decision:'declined',reason:'今回は見送ります',expectedVersion:o.version,key:key('decline')});
 assert.equal(o.decision.reason,'今回は見送ります');
 await assert.rejects(t.svc.complete({actor:staff,shop,id:o.id,expectedVersion:o.version,key:key('finish-denied')}),{code:'CAR02_STATE_CONFLICT'});
});

test('pending upload blocks quote presentation to protect report evidence',async()=>{
 const t=fixture();let o=await reported(t,await created(t));t.addPendingPhoto(o);
 await assert.rejects(quoted(t,o),{code:'CAR02_UPLOADS_PENDING'});
 assert.equal(t.db.quotes.size,0);assert.equal(t.db.orders.get(o.id).status,'draft');
});
