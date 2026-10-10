import test from 'node:test';import assert from 'node:assert/strict';
import {createCar02PhotoFlow} from './car02-photo-flow.mjs';
const id='11111111-1111-4111-8111-111111111111',photo='22222222-2222-4222-8222-222222222222';
const actor={verified:true,role:'staff',shopCode:'street_house_kitsuki',subject:'staff-1'};
const data={actor,shop:actor.shopCode,orderId:id,reportId:id,mimeType:'image/jpeg',byteSize:123,sha256:'a'.repeat(64)};
function setup(){let reserved=null,ready=0,cancelled=0,objectOK=true,failSign=false;
 const repository={async reserve(x){reserved={id:photo,storage_bucket:x.bucket,storage_path:x.path,upload_state:'pending',mime_type:x.mimeType,byte_size:x.byteSize,sha256:x.sha256};return {id:photo}},async getPending(){return reserved},async markReady(){ready++;reserved.upload_state='ready'},async cancel(){cancelled++}};
 const storage={async signUpload(){if(failSign)throw Error('SIGNING_FAILED');return{url:'https://example.invalid/private-ticket'}},async inspect(){return objectOK?{private:true,byteSize:123,mimeType:'image/jpeg',sha256:'a'.repeat(64)}:{private:false,byteSize:123,mimeType:'image/jpeg',sha256:'a'.repeat(64)}}};
 return {flow:createCar02PhotoFlow({repository,storage}),get ready(){return ready},get cancelled(){return cancelled},get reserved(){return reserved},badObject(){objectOK=false},badSigner(){failSign=true}};
}
test('private upload ticket issued only after authorized reservation',async()=>{let t=setup();let p=await t.flow.begin(data);assert.equal(p.photoId,photo);assert.equal(p.expiresInSeconds,300);assert.ok(t.reserved.storage_path.startsWith('street_house_kitsuki/'+id));});
test('reject unverified actor, cross shop, and customer role',async()=>{let t=setup();for(const a of [{...actor,verified:false},{...actor,shopCode:'other'},{...actor,role:'customer'}])await assert.rejects(t.flow.begin({...data,actor:a}),{code:'CAR02_PHOTO_UNAUTHORIZED'});assert.equal(t.reserved,null)});
test('reject oversized, unsafe media types and malformed checksums',async()=>{let t=setup();for(const x of [{byteSize:5242881},{mimeType:'image/svg+xml'},{sha256:'0'},{byteSize:0}])await assert.rejects(t.flow.begin({...data,...x}),{code:'CAR02_PHOTO_METADATA_INVALID'});assert.equal(t.reserved,null)});
test('finalize checks actual private object digest before marking ready',async()=>{let t=setup();await t.flow.begin(data);await t.flow.finalize({actor,shop:data.shop,photoId:photo});assert.equal(t.ready,1)});
test('public or tampered object never becomes ready',async()=>{let t=setup();await t.flow.begin(data);t.badObject();await assert.rejects(t.flow.finalize({actor,shop:data.shop,photoId:photo}),{code:'CAR02_PHOTO_OBJECT_INTEGRITY_FAILED'});assert.equal(t.ready,0)});
test('failed signing uses compensating cancellation for reserved record',async()=>{let t=setup();t.badSigner();await assert.rejects(t.flow.begin(data),/SIGNING_FAILED/);assert.equal(t.cancelled,1)});
