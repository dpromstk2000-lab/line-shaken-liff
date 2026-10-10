import test from 'node:test';import assert from 'node:assert/strict';
import {createCar02PgPhotoRepository} from './car02-pg-photo-repo.mjs';
const report='11111111-1111-4111-8111-111111111111',order='22222222-2222-4222-8222-222222222222',photo='33333333-3333-4333-8333-333333333333';
const shop='street_house_kitsuki';
function make(){let calls=[],released=0,state='draft',photoState='pending',failInsert=false;
 const pool={async connect(){return{release(){released++},async query(sql,p=[]){calls.push({sql,p});
 if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return{rows:[]};
 if(sql.includes('SELECT o.id,o.status'))return{rows:state==='missing'?[]:[{id:order,status:state}]};
 if(sql.includes('INSERT INTO public.ksh_car02_photos')){if(failInsert)throw Error('insert-failed');return{rows:[{id:photo}]}};
 if(sql.includes('SELECT p.id,p.storage_bucket'))return{rows:state==='missing'?[]:[{id:photo,storage_bucket:'ksh-car02-private-photos',storage_path:'private-path',mime_type:'image/jpeg',byte_size:12,sha256:'a'.repeat(64),upload_state:photoState,order_status:state}]};
 if(sql.includes("SET upload_state='ready'")){photoState='ready';return{rows:[{id:photo}]}}
 if(sql.includes("SET upload_state='deleted'")){photoState='deleted';return{rows:[]}}
 throw Error('unknown-SQL:'+sql.slice(0,50));
 }}}};
 return {repo:createCar02PgPhotoRepository(pool),calls,get released(){return released},setStatus(v){state=v},setPhoto(v){photoState=v},fail(){failInsert=true}};
}
const v={shop,orderId:order,reportId:report,mimeType:'image/jpeg',byteSize:12,sha256:'a'.repeat(64),bucket:'ksh-car02-private-photos',path:'private-path'};
test('draft report reservation creates pending row in same transaction',async()=>{const t=make(),r=await t.repo.reserve(v);assert.equal(r.id,photo);assert.ok(t.calls.some(x=>x.sql.includes('FOR UPDATE OF o,r')));assert.equal(t.calls.at(-1).sql,'COMMIT')});
test('report locked prevents reservation and rolls back',async()=>{const t=make();t.setStatus('pending');await assert.rejects(t.repo.reserve(v),{code:'CAR02_PHOTO_REPORT_NOT_DRAFT'});assert.equal(t.calls.at(-1).sql,'ROLLBACK')});
test('private photo ready only after scoped pending state',async()=>{const t=make();const r=await t.repo.getPending({shop,photoId:photo});assert.equal(r.upload_state,'pending');await t.repo.markReady({shop,photoId:photo});assert.ok(t.calls.some(x=>x.sql.includes("SET upload_state='ready'")))});
test('reject readiness change for pending-status order',async()=>{const t=make();t.setStatus('approved');await assert.rejects(t.repo.markReady({shop,photoId:photo}),{code:'CAR02_PHOTO_NOT_PENDING'})});
test('cancel pending after sign ticket failure',async()=>{const t=make();assert.equal(await t.repo.cancel({shop,photoId:photo}),true);assert.ok(t.calls.some(x=>x.sql.includes("SET upload_state='deleted'")))});
test('photo INSERT failure rolls back and connection releases',async()=>{const t=make();t.fail();await assert.rejects(t.repo.reserve(v),/insert-failed/);assert.equal(t.calls.at(-1).sql,'ROLLBACK');assert.equal(t.released,1)});
