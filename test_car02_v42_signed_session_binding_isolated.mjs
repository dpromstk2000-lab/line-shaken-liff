import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createV42OfflineSessionLab,V42_MODE} from './car02-v42-signed-session-binding-isolated.mjs';
const keys=generateKeyPairSync('ed25519');
const now0=1770000000;
let time=now0;
const lab=()=>createV42OfflineSessionLab({privateKey:keys.privateKey,publicKey:keys.publicKey,
 kid:'offline-v42',issuer:'car02-qa-local',audience:'car02-qa',nowSeconds:()=>time});
const sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const base={sub,shopCode:'SHOP-A',role:'staff',authVersion:7,ttlSeconds:300};
const row={shop_code:'SHOP-A',user_sub:sub,staff_role:'staff',active:true,auth_version:7};
const deny=fn=>assert.throws(fn,{code:'CAR02_V42_QA_DENIED'});
const tamper=(token,idx,callback)=>{const a=token.split('.');a[idx]=callback(a[idx]);return a.join('.')};
const payload=(token)=>JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
const reencode=(obj)=>Buffer.from(JSON.stringify(obj)).toString('base64url');
test('isolated mode blocks deployment and does not claim real JWT/PG',()=>{
 assert.equal(V42_MODE.deployable,false);assert.equal(V42_MODE.liveJwtProvider,false);
 assert.equal(V42_MODE.realDb,false);assert.equal(V42_MODE.realRowLock,false);assert.equal(V42_MODE.release,'NO_GO');
});
test('valid Ed25519 token verifies and matches membership version',()=>{
 const l=lab(),id=l.verify(l.issue(base)),gr=l.authorize({verifiedIdentity:id,lockedMembership:row,shopCode:'SHOP-A'});
 assert.equal(gr.authVersion,7);assert.equal(gr.reviewOnly,true);assert.equal(gr.role,'staff');
});
test('each issued token has EdDSA header and no secret material',()=>{
 const t=lab().issue(base),h=JSON.parse(Buffer.from(t.split('.')[0],'base64url').toString());
 assert.deepEqual(h,{alg:'EdDSA',typ:'JWT',kid:'offline-v42'});assert.equal(t.split('.').length,3);
});
for(const bad of [null,undefined,42,{},[],true,''])test('issue refuses malformed sub '+String(bad),()=>deny(()=>lab().issue({...base,sub:bad})));
for(const bad of ['',' other','other ','shop space',null,undefined,42])test('issue refuses invalid shop '+String(bad),()=>deny(()=>lab().issue({...base,shopCode:bad})));
for(const bad of [null,undefined,'superadmin','customer','STAFF',0])test('issue refuses invalid role '+String(bad),()=>deny(()=>lab().issue({...base,role:bad})));
for(const bad of [0,-1,1.1,2**31,NaN,Infinity,'7',null])test('issue refuses invalid authVersion '+String(bad),()=>deny(()=>lab().issue({...base,authVersion:bad})));
for(const bad of [0,-1,901,'300',null,NaN,Infinity])test('issue refuses invalid TTL '+String(bad),()=>deny(()=>lab().issue({...base,ttlSeconds:bad})));
for(const x of [null,{},'',42,'a.b','a.b.c.d','a.b.c','eyJhbGciOiJub25lIn0.eyJzdWIiOiJhIn0.','.'.repeat(5001)])test('verify refuses malformed token '+String(x).slice(0,15),()=>deny(()=>lab().verify(x)));
test('rejects expired token',()=>{time=now0;const t=lab().issue(base);time=now0+300;deny(()=>lab().verify(t));time=now0});
test('rejects future token',()=>{time=now0+20;const t=lab().issue(base);time=now0;deny(()=>lab().verify(t));time=now0});
test('rejects token with altered subject',()=>{const l=lab(),t=l.issue(base);deny(()=>l.verify(tamper(t,1,s=>{let x=JSON.parse(Buffer.from(s,'base64url').toString());x.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';return reencode(x)})))});
test('rejects token with changed authVersion',()=>{const l=lab(),t=l.issue(base);deny(()=>l.verify(tamper(t,1,s=>{let x=JSON.parse(Buffer.from(s,'base64url').toString());x.authVersion=8;return reencode(x)})))});
test('rejects alg none header',()=>{const l=lab(),t=l.issue(base);deny(()=>l.verify(tamper(t,0,s=>reencode({...JSON.parse(Buffer.from(s,'base64url').toString()),alg:'none'}))))});
test('rejects another kid',()=>{const l=lab(),t=l.issue(base);deny(()=>l.verify(tamper(t,0,s=>reencode({...JSON.parse(Buffer.from(s,'base64url').toString()),kid:'other'}))))});
test('rejects invalid signature',()=>{const l=lab(),t=l.issue(base);deny(()=>l.verify(tamper(t,2,s=>s[0]==='A'?'B'+s.slice(1):'A'+s.slice(1))))});
test('rejects a token signed by other private key',()=>{const other=generateKeyPairSync('ed25519');const rogue=createV42OfflineSessionLab({privateKey:other.privateKey,publicKey:other.publicKey,kid:'offline-v42',issuer:'car02-qa-local',audience:'car02-qa',nowSeconds:()=>time});deny(()=>lab().verify(rogue.issue(base)))});
test('rejects wrong issuer',()=>{const other=createV42OfflineSessionLab({privateKey:keys.privateKey,publicKey:keys.publicKey,kid:'offline-v42',issuer:'another',audience:'car02-qa',nowSeconds:()=>time});deny(()=>lab().verify(other.issue(base)))});
test('rejects wrong audience',()=>{const other=createV42OfflineSessionLab({privateKey:keys.privateKey,publicKey:keys.publicKey,kid:'offline-v42',issuer:'car02-qa-local',audience:'another',nowSeconds:()=>time});deny(()=>lab().verify(other.issue(base)))});
test('rejects signer key rotation using different public key',()=>{const other=generateKeyPairSync('ed25519');const l=lab(),t=l.issue(base);const rotated=createV42OfflineSessionLab({privateKey:other.privateKey,publicKey:other.publicKey,kid:'offline-v42',issuer:'car02-qa-local',audience:'car02-qa',nowSeconds:()=>time});deny(()=>rotated.verify(t))});
test('rejects unbranded verifiedIdentity object',()=>deny(()=>lab().authorize({verifiedIdentity:{subject:sub,shopCode:'SHOP-A',role:'staff',authVersion:7},lockedMembership:row,shopCode:'SHOP-A'})));
test('rejects verifiedIdentity from a different lab instance',()=>{const l=lab(),r=lab(),id=l.verify(l.issue(base));deny(()=>r.authorize({verifiedIdentity:id,lockedMembership:row,shopCode:'SHOP-A'}))});
const badRows=[['revoked',{active:false}],['stale',{auth_version:8}],['missing version',{auth_version:undefined}],['different shop',{shop_code:'SHOP-B'}],['different user',{user_sub:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}],['different role',{staff_role:'owner'}],['no row',null],['malformed row',{}]];
for(const [name,bad] of badRows)test('membership rejects '+name,()=>{const l=lab(),id=l.verify(l.issue(base));deny(()=>l.authorize({verifiedIdentity:id,lockedMembership:bad===null?null:(name==='malformed row'?bad:{...row,...bad}),shopCode:'SHOP-A'}))});
test('rejects correct row from wrong requested shop',()=>{const l=lab(),id=l.verify(l.issue(base));deny(()=>l.authorize({verifiedIdentity:id,lockedMembership:row,shopCode:'SHOP-B'}))});
test('accepts matching owner membership, rejects attempted downgrade',()=>{const l=lab(),id=l.verify(l.issue({...base,role:'owner'}));assert.equal(l.authorize({verifiedIdentity:id,lockedMembership:{...row,staff_role:'owner'},shopCode:'SHOP-A'}).role,'owner');deny(()=>l.authorize({verifiedIdentity:id,lockedMembership:row,shopCode:'SHOP-A'}))});
test('revocation followed by re-grant with bumped version rejects old signed claim',()=>{const l=lab(),id=l.verify(l.issue(base));deny(()=>l.authorize({verifiedIdentity:id,lockedMembership:{...row,auth_version:9},shopCode:'SHOP-A'}))});

test('token that expires after verify but before authorization is refused',()=>{time=now0;const l=lab(),id=l.verify(l.issue({...base,ttlSeconds:1}));time=now0+1;deny(()=>l.authorize({verifiedIdentity:id,lockedMembership:row,shopCode:'SHOP-A'}));time=now0});
