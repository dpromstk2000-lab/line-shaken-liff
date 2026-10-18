import test from 'node:test';
import assert from 'node:assert/strict';
import {V41_MODE,V41_VERSION_MAX,v41QaAuthorize,v41QaUpdateMembership,v41QaDeleteMembership,v41ReviewSource} from './car02-v41-staff-auth-version-policy-isolated.mjs';
const user='00000000-0000-4000-8000-000000000081',other='00000000-0000-4000-8000-000000000082';
const membership=()=>({shop_code:'FUK',user_sub:user,staff_role:'staff',active:true,grant_source:'manual-reviewed',auth_version:5});
const identity=()=>({signatureVerified:true,serverIssued:true,sub:user,authVersion:5});
const opts=row=>({environment:'isolated_qa',allowIsolatedQa:true,lockedMembership:row||membership(),verifiedIdentity:identity(),shopCode:'FUK',requiredRole:'staff'});
const upd=(changes,previous=membership())=>v41QaUpdateMembership({environment:'isolated_qa',allowIsolatedQa:true,previous,changes});
test('explicitly nondeployable',()=>{assert.equal(V41_MODE.deployable,false);assert.equal(V41_MODE.realDatabase,false);assert.equal(V41_MODE.sqlApplied,false);assert.equal(V41_MODE.release,'NO_GO')});
test('correctly authorizes matching verified, server-issued version',()=>assert.equal(v41QaAuthorize(opts()).authVersion,5));
test('each membership UPDATE increments version and rejects previously issued version',()=>{
 for(const change of [{active:false},{staff_role:'owner'},{grant_source:'reviewed-again'},{updated_at:'2026-10-18'}]){
  const newer=upd(change);assert.equal(newer.auth_version,6);assert.throws(()=>v41QaAuthorize(opts(newer)),/DENIED/);
 }
});
test('revoke/reactivate does not re-enable old version',()=>{
 const revoked=upd({active:false});const reactivated=upd({active:true},revoked);
 assert.equal(reactivated.auth_version,7);assert.throws(()=>v41QaAuthorize(opts(reactivated)),/DENIED/);
 assert.equal(v41QaAuthorize({...opts(reactivated),verifiedIdentity:{...identity(),authVersion:7}}).authVersion,7);
});
test('membership cannot be deleted/recreated to reset version',()=>assert.throws(()=>v41QaDeleteMembership(),/DENIED/));
test('auth version overflow is rejected',()=>assert.throws(()=>upd({active:false},{...membership(),auth_version:V41_VERSION_MAX}),/DENIED/));
test('row principal key cannot be reassigned or version manually overwritten',()=>{
 for(const changes of [{user_sub:other},{shop_code:'OTHER'},{auth_version:1},{evil:true}])assert.throws(()=>upd(changes),/DENIED/);
});
test('no client-provided or unsigned identity accepted',()=>{
 for(const changes of [{signatureVerified:false},{serverIssued:false},{authVersion:6},{sub:other},{authVersion:'5'},{authVersion:null},{signatureVerified:null},{serverIssued:null}]){
  assert.throws(()=>v41QaAuthorize({...opts(),verifiedIdentity:{...identity(),...changes}}),/DENIED/);
 }
});
test('tenant, role, inactive and invalid row are rejected',()=>{
 for(const changes of [{shop_code:'TOK'},{user_sub:other},{staff_role:'owner'},{active:false},{auth_version:0},{auth_version:-1},{grant_source:''},{staff_role:'admin'}]){
 assert.throws(()=>v41QaAuthorize(opts({...membership(),...changes})),/DENIED/);
 }
});
test('review recognizes original R46 source lacks required auth_version',()=>{
 const a=v41ReviewSource('CREATE TABLE public.ksh_car02_staff_access (\n staff_role text);','SELECT shop_code,user_sub,staff_role,active FROM public.ksh_car02_staff_access');
 assert.equal(a.schemaTable,true);assert.equal(a.schemaVersion,false);assert.equal(a.readerVersion,false);assert.equal(a.requiresMigration,true);
});
test('review recognizes column and updated resolver as prerequisites',()=>{
 const a=v41ReviewSource('CREATE TABLE public.ksh_car02_staff_access (\n auth_version integer NOT NULL DEFAULT 1);','SELECT shop_code,user_sub,staff_role,active,auth_version FROM public.ksh_car02_staff_access');
 assert.equal(a.schemaVersion,true);assert.equal(a.readerVersion,true);assert.equal(a.requiresMigration,false);
});
for(const mode of [undefined,null,'production','preview','isolated_qA',false]){
 test(`QA mode rejects ${String(mode)}`,()=>assert.throws(()=>v41QaAuthorize({...opts(),environment:mode}),/DENIED/));
}
for(const value of [false,undefined,null,0,'true']){
 test(`explicit QA authorization rejects ${String(value)}`,()=>assert.throws(()=>v41QaAuthorize({...opts(),allowIsolatedQa:value}),/DENIED/));
}
for(const value of [0,-1,1.5,'6',null,undefined,2147483648,NaN,Infinity]){
 test(`invalid version ${String(value)} is rejected by update`,()=>assert.throws(()=>upd({active:false},{...membership(),auth_version:value}),/DENIED/));
}
for(const key of ['shop_code','user_sub','staff_role','active','grant_source','auth_version']){
 test(`missing membership property ${key} is rejected`,()=>{let r=membership();delete r[key];assert.throws(()=>v41QaAuthorize(opts(r)),/DENIED/)});
}
for(const key of ['signatureVerified','serverIssued','sub','authVersion']){
 test(`missing verified identity property ${key} is rejected`,()=>{let r=identity();delete r[key];assert.throws(()=>v41QaAuthorize({...opts(),verifiedIdentity:r}),/DENIED/)});
}
for(const value of ['',' TOK','TOK ','\n',null,undefined]){
 test(`shop scoping invalid ${String(value)}`,()=>assert.throws(()=>v41QaAuthorize({...opts(),shopCode:value}),/DENIED/));
}
