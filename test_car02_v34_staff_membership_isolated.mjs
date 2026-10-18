/** Pure-memory staff membership contract tests; neither real JWT nor DB. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createV34QaStaffMembershipResolver,V34_MODE} from './car02-v34-staff-membership-isolated.mjs';
const NOW=1800000000,SHOP='qa_shop_a',SUB='signed-staff-qa';
const ONE='11111111-1111-4111-8111-111111111111';
const row={membershipId:ONE,shopCode:SHOP,userSub:SUB,role:'staff',active:true,
 suspended:false,revokedAt:null,authVersion:1,validFrom:NOW-60,validUntil:NOW+60};
const resolver=(records=[row],opts={})=>createV34QaStaffMembershipResolver({environment:'isolated_qa',
 allowIsolatedQa:true,readMembership:async()=>records,nowSeconds:()=>NOW,...opts});
const query={shopCode:SHOP,userSub:SUB};
const deny=async(r, q=query)=>assert.rejects(()=>r(q),e=>e.message==='CAR02_V34_STAFF_ACCESS_DENIED');
test('explicit QA-only mode never enables production',()=>{
 assert.equal(V34_MODE.productionReady,false);assert.equal(V34_MODE.dbConnection,false);
 assert.equal(V34_MODE.realStaffResolverBound,false);assert.equal(V34_MODE.release,'NO_GO');
});
test('one exact active membership accepted; output minimal frozen',async()=>{
 const x=await resolver()(query);assert.deepEqual(x,{active:true,userSub:SUB,shopCode:SHOP,role:'staff'});
 assert(Object.isFrozen(x));assert.equal('membershipId' in x,false);
});
test('owner is allowed only when stored row is owner',async()=>{
 assert.equal((await resolver([{...row,role:'owner'}])(query)).role,'owner');
});
for(const [name,props] of [
 ['unknown role',{role:'admin'}],['client role',{role:'customer'}],['empty role',{role:''}],
 ['inactive',{active:false}],['active not boolean',{active:'true'}],['suspended',{suspended:true}],
 ['suspended undefined',{suspended:undefined}],['revoked',{revokedAt:NOW-1}],
 ['revoked undefined',{revokedAt:undefined}],['wrong shop',{shopCode:'qa_shop_b'}],
 ['wrong subject',{userSub:'other'}],['bad membership ID',{membershipId:'not-a-uuid'}],
 ['empty membership ID',{membershipId:''}],['auth version 0',{authVersion:0}],
 ['auth version float',{authVersion:1.1}],['auth version missing',{authVersion:undefined}],
 ['future start',{validFrom:NOW+1}],['expired now',{validUntil:NOW}],
 ['inverted window',{validUntil:NOW-61}],['invalid start',{validFrom:'bad'}],
 ['invalid end',{validUntil:Infinity}]
])test(`fails closed: ${name}`,async()=>deny(resolver([{...row,...props}])));
for(const [name,records] of [
 ['no membership',[]],['duplicate memberships',[row,row]],['wrong result',null],
 ['object instead of array',row],['string instead of array','invalid'],
 ['null row',[null]],['non-plain class row',[new (class Membership {constructor(){Object.assign(this,row)}})()]],
 ['two shops returned',[row,{...row,shopCode:'qa_shop_b'}]]
])test(`fails closed: ${name}`,async()=>deny(resolver(records)));
for(const [name,override] of [
 ['missing environment',{environment:undefined}],['production environment',{environment:'production'}],
 ['QA flag off',{allowIsolatedQa:false}],['no read callback',{readMembership:null}],
 ['bad time callback',{nowSeconds:null}]
])test(`configuration refused: ${name}`,()=>assert.throws(()=>resolver([row],override),/CAR02_V34_STAFF_ACCESS_DENIED/));
for(const [name,q] of [
 ['empty subject',{shopCode:SHOP,userSub:''}],['subject whitespace',{shopCode:SHOP,userSub:' staff '}],
 ['blank shop',{shopCode:'',userSub:SUB}],['foreign shop',{shopCode:'qa_shop_b',userSub:SUB}],
 ['foreign subject',{shopCode:SHOP,userSub:'different'}]
])test(`request rejected: ${name}`,async()=>deny(resolver(),q));
test('read failure is hidden',async()=>deny(resolver([row],{readMembership:async()=>{throw Error('DB password secret')}})));
test('clock failure is hidden',async()=>deny(resolver([row],{nowSeconds:()=>{throw Error('clock secret')}})));
test('negative clock is rejected',async()=>deny(resolver([row],{nowSeconds:()=>-1})));
test('clock must be integral',async()=>deny(resolver([row],{nowSeconds:()=>NOW+.5})));
test('re-checks membership every request; revoke immediately denied',async()=>{
 let reads=0;let present={...row};
 const r=resolver([],{readMembership:async()=>{reads++;return [present]}});
 assert.equal((await r(query)).active,true);present={...present,revokedAt:NOW};await deny(r);
 assert.equal(reads,2);
});
test('role demotion re-resolved every request',async()=>{
 let present={...row,role:'owner'};
 const r=resolver([],{readMembership:async()=>[present]});
 assert.equal((await r(query)).role,'owner');present={...present,role:'staff'};
 assert.equal((await r(query)).role,'staff');
});
test('disabled account rechecked on subsequent request',async()=>{
 let present={...row};const r=resolver([],{readMembership:async()=>[present]});
 await r(query);present={...present,active:false};await deny(r);
});
test('server-derived reader arguments are frozen, not caller role or tenant hints',async()=>{
 let observed;const r=resolver([],{readMembership:async p=>{observed=p;return [row]}});
 await r({...query,role:'owner',active:true,shopCode:SHOP});
 assert.deepEqual(observed,query);assert(Object.isFrozen(observed));
});
test('reader output cannot claim a different tenant',async()=>{
 const r=resolver([],{readMembership:async()=>[{...row,shopCode:'qa_shop_b'}]});await deny(r);
});
test('no stale positive result after missing membership',async()=>{
 let records=[row];const r=resolver([],{readMembership:async()=>records});
 await r(query);records=[];await deny(r);
});

test('missing arguments denied',async()=>assert.rejects(()=>resolver()(),/CAR02_V34_STAFF_ACCESS_DENIED/));
