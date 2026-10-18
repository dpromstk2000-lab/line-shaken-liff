import {test} from 'node:test';
import assert from 'node:assert/strict';
import {V40_MODE,V40_LOCK_SQL,v40ReviewR46Schema,v40QaLockStaffAccess,v40QaAuthorizedReplay}
 from './car02-v40-r46-locked-membership-contract-isolated.mjs';
const sub='df3703dd-865c-40e1-a143-e06f3446ff28';
const goodRow=()=>({shop_code:'FUKUOKA',user_sub:sub,staff_role:'staff',active:true,auth_version:3});
const claim=()=>({cryptographicallyVerified:true,sub,authVersion:3,exp:1700000100});
const actor=()=>({verified:true,shopCode:'FUKUOKA',subject:`staff:${sub}`,role:'staff'});
const base=()=>({environment:'isolated_qa',allowIsolatedQa:true,tx:{id:'qa-tx-1',state:'open'},client:{async query(){return{rows:[goodRow()]};}},actor:actor(),claims:claim(),shopCode:'FUKUOKA',now:1700000000});
const denied=async f=>assert.rejects(f,/CAR02_V40_QA_DENIED/);
const intent='a'.repeat(64);
const replayOptions=()=>({...base(),operation:'report',idempotencyKey:'qa-strong-key-123',intentDigest:intent,
 readReplay:async()=>null,mutate:async()=>({ok:true})});
const baseSql=`-- QA/REVIEW ONLY\nCREATE TABLE public.ksh_car02_staff_access (\nshop_code text NOT NULL,\nuser_sub uuid NOT NULL,\nstaff_role text NOT NULL,\nactive boolean NOT NULL,\nPRIMARY KEY (shop_code,user_sub)\n);`;
test('V4.0 always NO_GO not a deployable module',()=>assert.equal(V40_MODE.deployable,false));
test('V4.0 confirms real db unproven',()=>assert.equal(V40_MODE.realRowLockProven,false));
test('V4.0 SQL targets R46 actual name',()=>assert.match(V40_LOCK_SQL,/public\.ksh_car02_staff_access/));
test('V4.0 SQL uses transaction row lock',()=>assert.match(V40_LOCK_SQL,/FOR UPDATE/));
test('V4.0 SQL requests new auth_version column',()=>assert.match(V40_LOCK_SQL,/auth_version/));
test('V4.0 current R46 model missing auth_version',()=>assert.equal(v40ReviewR46Schema(baseSql).versionAvailable,false));
test('V4.0 current R46 model requires schema review',()=>assert.equal(v40ReviewR46Schema(baseSql).requiresMigration,true));
test('V4.0 proposed versioned R46 model detected',()=>assert.equal(v40ReviewR46Schema(baseSql.replace('active boolean NOT NULL,','active boolean NOT NULL,\nauth_version bigint NOT NULL,')).versionAvailable,true));
test('V4.0 rejects nonnumeric version column',()=>assert.equal(v40ReviewR46Schema(baseSql.replace('active boolean NOT NULL,','active boolean NOT NULL,\nauth_version text NOT NULL,')).versionAvailable,false));
test('V4.0 ignores commented version column',()=>assert.equal(v40ReviewR46Schema(baseSql.replace('active boolean NOT NULL,','active boolean NOT NULL, -- auth_version bigint NOT NULL')).versionAvailable,false));
test('V4.0 schema not found is blocker',()=>assert.equal(v40ReviewR46Schema('-- nothing').tableFound,false));
test('V4.0 invalid schema is blocker',()=>assert.equal(v40ReviewR46Schema({}).requiresMigration,true));
test('V4.0 mock client sees correct SQL and tenant bind',async()=>{let seen;
 const a=base();a.client={async query(sql,params){seen={sql,params};return{rows:[goodRow()]};}};
 const lease=await v40QaLockStaffAccess(a);assert.deepEqual(seen.params,['FUKUOKA',sub]);assert.match(seen.sql,/FOR UPDATE/);assert.equal(lease.authVersion,3);});
for(const [name,modify] of [
 ['missing QA opt-in',p=>{p.allowIsolatedQa=false;}],
 ['production environment',p=>{p.environment='production';}],
 ['closed transaction',p=>{p.tx.state='committed';}],
 ['null transaction',p=>{p.tx=null;}],
 ['missing query method',p=>{p.client={};}],
 ['unverified actor',p=>{p.actor.verified=false;}],
 ['other shop',p=>{p.actor.shopCode='OTHER';}],
 ['role customer',p=>{p.actor.role='customer';}],
 ['actor wrong identity',p=>{p.actor.subject='staff:wrong';}],
 ['unverified claims',p=>{p.claims.cryptographicallyVerified=false;}],
 ['no subject',p=>{p.claims.sub='';}],
 ['zero version',p=>{p.claims.authVersion=0;}],
 ['negative version',p=>{p.claims.authVersion=-1;}],
 ['fractional version',p=>{p.claims.authVersion=1.2;}],
 ['stale token',p=>{p.claims.exp=1700000000;}],
 ['future now',p=>{p.now=1700000110;}],
 ['bad now',p=>{p.now=NaN;}],
 ['bad transaction id',p=>{p.tx.id='';}],
 ['no claim',p=>{p.claims=null;}],
 ['no actor',p=>{p.actor=null;}],
 ])test(`V4.0 fail closed: ${name}`,async()=>{let calls=0;const p=base();p.client={async query(){calls++;return{rows:[goodRow()]};}};modify(p);
 await denied(()=>v40QaLockStaffAccess(p));assert.equal(calls,0);});
for(const [name,patch] of [
 ['empty rows',r=>[]],['duplicate membership rows',r=>[r,r]],
 ['inactive membership',r=>[{...r,active:false}]],
 ['role downgrade',r=>[{...r,staff_role:'owner'}]],
 ['unknown role',r=>[{...r,staff_role:'customer'}]],
 ['shop mismatch',r=>[{...r,shop_code:'OTHER'}]],
 ['subject mismatch',r=>[{...r,user_sub:'another'}]],
 ['missing version',r=>[{...r,auth_version:undefined}]],
 ['null version',r=>[{...r,auth_version:null}]],
 ['old version',r=>[{...r,auth_version:2}]],
 ['future version',r=>[{...r,auth_version:4}]],
 ['string version',r=>[{...r,auth_version:'3'}]],
 ['negative version',r=>[{...r,auth_version:-1}]],
 ['version zero',r=>[{...r,auth_version:0}]],
 ['fractional version',r=>[{...r,auth_version:3.5}]],
 ])test(`V4.0 row check denied: ${name}`,async()=>{let p=base(),row=goodRow();p.client={async query(){return{rows:patch(row)};}};
 await denied(()=>v40QaLockStaffAccess(p));});
test('V4.0 unknown DB column error denies access',async()=>{let p=base();p.client={async query(){throw Error('column auth_version does not exist');}};
 await denied(()=>v40QaLockStaffAccess(p));});
test('V4.0 query fails without rows',async()=>{let p=base();p.client={async query(){return {};}};await denied(()=>v40QaLockStaffAccess(p));});
test('V4.0 loss of tx while querying denied',async()=>{let p=base();p.client={async query(){p.tx.state='closed';return {rows:[goodRow()]};}};
 await denied(()=>v40QaLockStaffAccess(p));});
test('V4.0 fresh mutate succeeds after query',async()=>{let order=[];let p=replayOptions();p.client={async query(){order.push('lock');return {rows:[goodRow()]};}};
 p.readReplay=async()=>{order.push('readReplay');return null;};p.mutate=async()=>{order.push('mutate');return{ok:true}};
 assert.deepEqual(await v40QaAuthorizedReplay(p),{ok:true});assert.deepEqual(order,['lock','readReplay','mutate']);});
test('V4.0 fails before replay on old schema row',async()=>{let n=0,p=replayOptions();p.client={async query(){let r=goodRow();delete r.auth_version;return{rows:[r]};}};
 p.readReplay=async()=>{n++;return null;};p.mutate=async()=>{n++;return true;};await denied(()=>v40QaAuthorizedReplay(p));assert.equal(n,0);});
test('V4.0 fails before replay on inactive row',async()=>{let n=0,p=replayOptions();p.client={async query(){return{rows:[{...goodRow(),active:false}]};}};
 p.readReplay=async()=>{n++;return null;};await denied(()=>v40QaAuthorizedReplay(p));assert.equal(n,0);});
test('V4.0 fails before replay on revoked version',async()=>{let n=0,p=replayOptions();p.client={async query(){return{rows:[{...goodRow(),auth_version:4}]};}};
 p.readReplay=async()=>{n++;return null;};await denied(()=>v40QaAuthorizedReplay(p));assert.equal(n,0);});
test('V4.0 replay handler error rejects',async()=>{let p=replayOptions();p.readReplay=async()=>{throw Error('db failure')};await denied(()=>v40QaAuthorizedReplay(p));});
test('V4.0 invalid stored replay rejects',async()=>{let p=replayOptions();p.readReplay=async()=>({completed:true,snapshot:{private:true}});await denied(()=>v40QaAuthorizedReplay(p));});
test('V4.0 missing stored snapshot rejects',async()=>{let p=replayOptions();p.readReplay=async()=>({completed:true,scopeDigest:'x',authVersion:3,userSub:sub,shopCode:'FUKUOKA'});await denied(()=>v40QaAuthorizedReplay(p));});
test('V4.0 bad intent digest rejects before query',async()=>{let count=0,p=replayOptions();p.intentDigest='x';p.client={async query(){count++;return{rows:[goodRow()]};}};await denied(()=>v40QaAuthorizedReplay(p));assert.equal(count,0);});
test('V4.0 mutation throw fails closed',async()=>{let p=replayOptions();p.mutate=async()=>{throw Error('db down');};await denied(()=>v40QaAuthorizedReplay(p));});
test('V4.0 closing tx during replay fails closed',async()=>{let p=replayOptions();p.readReplay=async()=>{p.tx.state='closed';return null;};await denied(()=>v40QaAuthorizedReplay(p));});
test('V4.0 closing tx during mutate fails closed',async()=>{let p=replayOptions();p.mutate=async()=>{p.tx.state='closed';return true;};await denied(()=>v40QaAuthorizedReplay(p));});
test('V4.0 successful returned value cloned',async()=>{let p=replayOptions(),src={ok:true};p.mutate=async()=>src;
 const returned=await v40QaAuthorizedReplay(p);assert.deepEqual(returned,src);assert.notEqual(returned,src);});
