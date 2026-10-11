import test from 'node:test';
import assert from 'node:assert/strict';
import {createCar02StaffAccessHttpR85} from './car02-staff-access-http-r85.mjs';
const SHOP='street_house_kitsuki';
const OWNER='11111111-1111-4111-8111-111111111111';
const TARGET='22222222-2222-4222-8222-222222222222';
const ORIGIN='https://staff.example.com';
const URL=`https://api.example.com/api/car02/staff/${TARGET}/access`;
const ACTOR=Object.freeze({verified:true,role:'owner',shopCode:SHOP,subject:'staff:'+OWNER});
const DATA={expectedRole:'staff',expectedActive:true,nextRole:'staff',nextActive:false,reason:'退職に伴うスタッフ権限の停止'};
function make(patch={}){
 const ev={gate:0,auth:0,change:0,calls:[]};
 const opt={shopCode:SHOP,allowedOrigins:[ORIGIN],
   releaseEnabled:async()=>{ev.gate++;return true},
   authenticate:async()=>{ev.auth++;return ACTOR},
   changeExistingStaffPermission:async input=>{
    ev.change++;ev.calls.push(input);return{changed:true,shopCode:SHOP,targetUserSub:TARGET,role:input.nextRole,active:input.nextActive}
   },...patch};
 return {route:createCar02StaffAccessHttpR85(opt),ev};
}
function req({url=URL,method='POST',headerPatch={},body=JSON.stringify(DATA)}={}){
 const h=new Headers({origin:ORIGIN,authorization:'Bearer '+('A'.repeat(32)),'content-type':'application/json'});
 for(const [k,v] of Object.entries(headerPatch)){if(v===null)h.delete(k);else h.set(k,v)}
 return new Request(url,{method,headers:h,...((method==='GET'||method==='HEAD'||body===null)?{}:{body}),
  ...(body instanceof ReadableStream?{duplex:'half'}:{})});
}
async function denies(route,r,status,code){
 const result=await route(r);assert.equal(result.status,status);
 assert.deepEqual(await result.json(),{ok:false,code});
 assert.equal(result.headers.get('cache-control'),'no-store');
 assert.equal(result.headers.get('x-content-type-options'),'nosniff');
 assert.equal(result.headers.get('content-security-policy'),"default-src 'none'");
 return result;
}
const badArgs=[
 ['missing shop',{shopCode:undefined}],['bad shop',{shopCode:'../escape'}],
 ['missing gate',{releaseEnabled:undefined}],['missing auth',{authenticate:null}],
 ['missing R70 adapter',{changeExistingStaffPermission:null}]
];
for(const [label,patch] of badArgs)test('R85 secure constructor blocks '+label,()=>assert.throws(()=>make(patch),/CAR02_R85_SECURE_DEPENDENCIES_REQUIRED/));
for(const [i,value] of [[],['http://staff.example.com'],['https://staff.example.com/'],
 ['https://staff.example.com/path'],[ORIGIN,ORIGIN],[ORIGIN,9],new Array(9).fill(ORIGIN),
 ['https://example.com?foo=bar'],['https://user:pass@example.com']].entries()){
 test('R85 rejects insecure origin configuration '+i,()=>assert.throws(()=>make({allowedOrigins:value}),/CAR02_R85_ORIGIN_INVALID/));
}
test('R85 approved owner changes existing permission with only trusted actor and URL target',async()=>{
 const {route,ev}=make();const res=await route(req());
 assert.equal(res.status,200);assert.deepEqual(await res.json(),{ok:true,changed:true,role:'staff',active:false});
 assert.equal(res.headers.get('access-control-allow-origin'),ORIGIN);
 assert.deepEqual({gate:ev.gate,auth:ev.auth,change:ev.change},{gate:1,auth:1,change:1});
 assert.equal(ev.calls[0].actor,ACTOR);assert.equal(ev.calls[0].targetUserSub,TARGET);
 assert.deepEqual(Object.keys(ev.calls[0]).sort(),['actor',...Object.keys(DATA),'targetUserSub'].sort());
});
test('R85 accepts no-change idempotent R70 receipt without emitting identity',async()=>{
 const {route}=make({changeExistingStaffPermission:async()=>({changed:false,shopCode:SHOP,targetUserSub:TARGET,role:'staff',active:false})});
 assert.deepEqual(await (await route(req())).json(),{ok:true,changed:false,role:'staff',active:false});
});
for(const bad of [
 URL+'/',URL+'?shop=another',URL+'?role=owner',URL+'#fragment',
 URL.replace('/api/car02/','/api/car02-legacy/'),
 URL.replace('/access','/grant'),URL.replace(TARGET,'not-uuid'),
 URL.replace('/api/car02/staff/', '/functions/v1/dpro-car02-stage/api/car02/staff/'),
 `https://api.example.com/api/car02/${TARGET}/report`
])test('R85 rejects unapproved path '+bad.slice(-35),async()=>{
 const {route,ev}=make();await denies(route,req({url:bad}),404,'CAR02_NOT_FOUND');assert.equal(ev.gate,0);assert.equal(ev.change,0)
});
for(const method of ['GET','PUT','DELETE','PATCH','HEAD'])test('R85 denies method '+method,async()=>{
 const {route,ev}=make();let r=await route(req({method}));assert.equal(r.status,405);assert.equal(ev.change,0)
});
test('R85 blocks unknown and missing Origin before release gate and DB',async()=>{
 for(const origin of [null,'https://evil.example','http://staff.example.com','null']){
  const {route,ev}=make();const r=await denies(route,req({headerPatch:{origin}}),403,'CAR02_ORIGIN_DENIED');
  assert.equal(ev.gate,0);assert.equal(ev.auth,0);assert.equal(ev.change,0);
  assert.equal(r.headers.get('access-control-allow-origin'),null);
 }
});
for(const [label,release] of [['false',async()=>false],['throw',async()=>{throw Error('secret') }],['truthy not Boolean',async()=>1]]){
 test('R85 fail-closed release gate '+label,async()=>{
  const {route,ev}=make({releaseEnabled:release});await denies(route,req(),503,'CAR02_NOT_RELEASED');
  assert.equal(ev.auth,0);assert.equal(ev.change,0);
 });
}
for(const headerPatch of [{authorization:null},{authorization:'Basic xxxxxx'},
 {authorization:'Bearer short'},{authorization:'Bearer a b'},{authorization:'Bearer '+'x'.repeat(8193)},
 {'x-line-id-token':'x'.repeat(32)},{cookie:'session=token'}])test('R85 rejects forged/incompatible credentials '+JSON.stringify(headerPatch).slice(0,80),async()=>{
 const {route,ev}=make();await denies(route,req({headerPatch}),401,'CAR02_UNAUTHORIZED');
 assert.equal(ev.auth,0);assert.equal(ev.change,0);
});
for(const [name,actor] of [
 ['staff',{...ACTOR,role:'staff'}],['customer',{...ACTOR,role:'customer'}],
 ['unverified',{...ACTOR,verified:false}],['other shop',{...ACTOR,shopCode:'other_shop'}],
 ['LINE subject',{...ACTOR,subject:'line:'+OWNER}],['bad subject',{...ACTOR,subject:'staff:abc'}],
 ['missing actor',null],['spoofed owner string',{...ACTOR,verified:'true'}]
])test('R85 refuses nonowner authenticated actor '+name,async()=>{
 const {route,ev}=make({authenticate:async()=>actor});
 await denies(route,req(),403,'CAR02_OWNER_REQUIRED');assert.equal(ev.change,0);
});
test('R85 verifier error does not leak identity or secret',async()=>{
 const {route,ev}=make({authenticate:async()=>{throw Error('postgresql://secret-password')}});
 const r=await denies(route,req(),401,'CAR02_UNAUTHORIZED');assert.equal(ev.change,0);
 assert.equal(r.headers.get('cache-control'),'no-store');
});
for(const type of ['text/plain','application/json; charset=utf-8','APPLICATION/JSON','multipart/form-data'])test('R85 refuses content type '+type,async()=>{
 const {route,ev}=make();await denies(route,req({headerPatch:{'content-type':type}}),415,'CAR02_CONTENT_TYPE_DENIED');assert.equal(ev.change,0)
});
test('R85 refuses compressed JSON',async()=>{
 const {route,ev}=make();await denies(route,req({headerPatch:{'content-encoding':'gzip'}}),415,'CAR02_CONTENT_TYPE_DENIED');assert.equal(ev.change,0)
});
for(const len of ['-1','01','banana','2.5','99999999999999999999'])test('R85 refuses malformed length '+len,async()=>{
 const {route,ev}=make();await denies(route,req({headerPatch:{'content-length':len}}),400,'CAR02_BAD_LENGTH');assert.equal(ev.change,0)
});
test('R85 rejects declared oversize without reading body',async()=>{
 const {route,ev}=make();await denies(route,req({headerPatch:{'content-length':'2049'}}),413,'CAR02_BODY_TOO_LARGE');assert.equal(ev.change,0)
});
test('R85 rejects streamed oversize and no permission mutation',async()=>{
 const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(JSON.stringify(DATA)));c.enqueue(new Uint8Array(3000));c.close()}});
 const {route,ev}=make();await denies(route,req({body:stream}),413,'CAR02_BODY_TOO_LARGE');assert.equal(ev.change,0);
});
test('R85 detects incorrect declared length',async()=>{
 const {route,ev}=make();await denies(route,req({headerPatch:{'content-length':'5'}}),400,'CAR02_BAD_LENGTH');assert.equal(ev.change,0)
});
test('R85 refuses missing body',async()=>{
 const {route,ev}=make();await denies(route,req({body:null}),400,'CAR02_BAD_BODY');assert.equal(ev.change,0)
});
test('R85 rejects invalid UTF-8 bytes',async()=>{
 const {route,ev}=make();await denies(route,req({body:new Uint8Array([0xff,0xfe,0xfa])}),400,'CAR02_BAD_BODY');assert.equal(ev.change,0)
});
for(const [label,obj] of [
 ['unknown field',{...DATA,shopCode:'another_shop'}],['client forged role',{...DATA,actor:{role:'owner'}}],
 ['wrong role',{...DATA,nextRole:'superadmin'}],['string active',{...DATA,nextActive:'false'}],
 ['trimmed reason',{...DATA,reason:'  justification   '}],['short reason',{...DATA,reason:'abc'}],
 ['missing reason',{expectedRole:'staff',expectedActive:true,nextRole:'staff',nextActive:false}],
 ['object value',{...DATA,reason:{secret:'x'}}],['number value',{...DATA,nextActive:1}],
 ['null value',{...DATA,nextActive:null}],['newline reason',{...DATA,reason:'allow\nprivileges'}]
])test('R85 rejects forbidden body '+label,async()=>{
 const {route,ev}=make();await denies(route,req({body:JSON.stringify(obj)}),400,'CAR02_PERMISSION_INPUT_INVALID');assert.equal(ev.change,0)
});
for(const body of [
 `{"expectedRole":"staff","expectedActive":true,"nextRole":"owner","nextActive":true,"reason":"approved route","reason":"another reason"}`,
 '[1,2,3]', '{}', '{"__proto__":true}',
 JSON.stringify(DATA).replace('"expectedRole"','"expe\\u0063tedRole"').replace(/$/,',"expectedRole":"staff"}'),
 '{"expectedRole":"staff"} extra',
 JSON.stringify(DATA).replace('"expectedActive":true','"expectedActive":true,')
])test('R85 rejects duplicate/nonflat/malformed JSON '+body.slice(0,34),async()=>{
 const {route,ev}=make();await denies(route,req({body}),400,'CAR02_PERMISSION_INPUT_INVALID');assert.equal(ev.change,0)
});
test('R85 denies self change BEFORE invoking R70',async()=>{
 const {route,ev}=make();await denies(route,req({url:URL.replace(TARGET,OWNER)}),403,'CAR02_SELF_CHANGE_DENIED');assert.equal(ev.change,0)
});
test('R85 never uses x-shop-code or x-role to choose target identity',async()=>{
 const {route,ev}=make();assert.equal((await route(req({headerPatch:{'x-shop-code':'evil_shop','x-role':'owner','x-staff-sub':OWNER}}))).status,200);
 assert.equal(ev.calls[0].actor,ACTOR);assert.equal(ev.calls[0].targetUserSub,TARGET);
});
for(const [label,error,status,code] of [
 ['stale version','CAR02_GRANT_STALE_VERSION',409,'CAR02_PERMISSION_CONFLICT'],
 ['last owner','CAR02_OWNER_LAST_ACTIVE_REQUIRED',409,'CAR02_LAST_OWNER_PROTECTED'],
 ['self change','CAR02_OWNER_SELF_CHANGE_DENIED',403,'CAR02_SELF_CHANGE_DENIED'],
 ['not owner','CAR02_OWNER_REQUIRED',403,'CAR02_OWNER_REQUIRED'],
 ['invalid identity','CAR02_IDENTITY_REJECTED',403,'CAR02_IDENTITY_REJECTED'],
 ['not found','CAR02_STAFF_NOT_FOUND',404,'CAR02_STAFF_NOT_FOUND'],
 ['unexpected SQL','DATABASE_PASSWORD=secret',503,'CAR02_PERMISSION_CHANGE_UNAVAILABLE'],
 ['prototype pollution error','constructor',503,'CAR02_PERMISSION_CHANGE_UNAVAILABLE']
])test('R85 maps R70 failure safely '+label,async()=>{
 const {route}=make({changeExistingStaffPermission:async()=>{throw Error(error)}});
 await denies(route,req(),status,code);
});
for(const [label,result] of [
 ['missing',null],['wrong shop',{changed:true,shopCode:'evil',targetUserSub:TARGET,role:'staff',active:false}],
 ['wrong user',{changed:true,shopCode:SHOP,targetUserSub:OWNER,role:'staff',active:false}],
 ['wrong role',{changed:true,shopCode:SHOP,targetUserSub:TARGET,role:'owner',active:false}],
 ['wrong active',{changed:true,shopCode:SHOP,targetUserSub:TARGET,role:'staff',active:true}],
 ['unknown status',{changed:'true',shopCode:SHOP,targetUserSub:TARGET,role:'staff',active:false}]
])test('R85 rejects inconsistent R70 receipt '+label,async()=>{
 const {route}=make({changeExistingStaffPermission:async()=>result});await denies(route,req(),503,'CAR02_PERMISSION_CHANGE_UNAVAILABLE');
});
for(const [label,headerPatch] of [
 ['wrong HTTP method',{'access-control-request-method':'GET','access-control-request-headers':'authorization,content-type'}],
 ['extra header',{'access-control-request-method':'POST','access-control-request-headers':'authorization,content-type,x-role'}],
 ['missing auth',{'access-control-request-method':'POST','access-control-request-headers':'content-type'}],
 ['dup header',{'access-control-request-method':'POST','access-control-request-headers':'authorization,content-type,authorization'}]
])test('R85 CORS preflight denies '+label,async()=>{
 const {route,ev}=make();await denies(route,req({method:'OPTIONS',headerPatch}),403,'CAR02_CORS_PREFLIGHT_DENIED');
 assert.equal(ev.auth,0);assert.equal(ev.change,0);
});
test('R85 valid preflight is bounded and side-effect free',async()=>{
 const {route,ev}=make();const r=await route(req({method:'OPTIONS',headerPatch:{'access-control-request-method':'POST','access-control-request-headers':'Content-Type,Authorization'}}));
 assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-methods'),'POST');
 assert.equal(r.headers.get('access-control-allow-origin'),ORIGIN);assert.equal(ev.auth,0);assert.equal(ev.change,0)
});
test('R85 release lock denies preflight',async()=>{
 const {route,ev}=make({releaseEnabled:async()=>false});
 await denies(route,req({method:'OPTIONS',headerPatch:{'access-control-request-method':'POST','access-control-request-headers':'authorization,content-type'}}),503,'CAR02_NOT_RELEASED');assert.equal(ev.change,0);
});
