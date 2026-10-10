// DPRO CAR02 R68: LINE linked-customer allowlist regression QA.
// Completely local synthetic identities. No Supabase or LINE traffic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createLineCustomerResolverR46} from './car02-auth-providers-r46.mjs';
import {createCar02Authenticator} from './car02-identity-r44.mjs';

const SHOP='street_house_kitsuki';
const ID='33333333-3333-4333-8333-333333333333';
const LINE='U-synthetic-linked-customer';
const linked=(status)=>({id:ID,shop_code:SHOP,line_user_id:LINE,status});
const reject=promise=>assert.rejects(promise,/^Error: CAR02_IDENTITY_REJECTED$/);
function fakePool(rows){
 const calls=[];
 return {calls,query:async(sql,params)=>{calls.push({sql,params});return {rows};}};
}

test('R68 linked customer: exact shop and LINE subject resolve successfully',async()=>{
 const pool=fakePool([linked('LINE連携済み')]);
 const got=await createLineCustomerResolverR46({pool})({shopCode:SHOP,lineSub:LINE});
 assert.deepEqual(got,{active:true,customerId:ID,shopCode:SHOP,lineSub:LINE});
 assert.deepEqual(pool.calls[0].params,[SHOP,LINE]);
});

test('R68 SQL positively allows only LINE連携済み and detects ambiguity',async()=>{
 const pool=fakePool([linked('LINE連携済み')]);
 await createLineCustomerResolverR46({pool})({shopCode:SHOP,lineSub:LINE});
 const sql=pool.calls[0].sql;
 assert.match(sql,/WHERE\s+shop_code=\$1\s+AND\s+line_user_id=\$2\s+AND\s+status='LINE連携済み'\s+LIMIT 2/);
 assert.doesNotMatch(sql,/status IS NOT NULL|status NOT IN/i);
});

test('R68 unlinked customer with stale LINE id fails closed even on unexpected row',async()=>{
 await reject(createLineCustomerResolverR46({pool:fakePool([linked('LINE未連携')])})({shopCode:SHOP,lineSub:LINE}));
});

test('R68 unknown, disabled, deleted and missing statuses never authorize',async()=>{
 for(const status of ['inactive','deleted','削除済み','停止','退会','要確認','LINE連携待ち','',null,undefined]){
  await reject(createLineCustomerResolverR46({pool:fakePool([linked(status)])})({shopCode:SHOP,lineSub:LINE}));
 }
});

test('R68 multiple rows remain ambiguous and denied',async()=>{
 await reject(createLineCustomerResolverR46({pool:fakePool([linked('LINE連携済み'),linked('LINE連携済み')])})({shopCode:SHOP,lineSub:LINE}));
 await reject(createLineCustomerResolverR46({pool:fakePool([])})({shopCode:SHOP,lineSub:LINE}));
});

test('R68 mismatched tenant, LINE id, and malformed UUID all denied',async()=>{
 for(const row of [{...linked('LINE連携済み'),shop_code:'other_shop'}, {...linked('LINE連携済み'),line_user_id:'U-other'}, {...linked('LINE連携済み'),id:'not-a-uuid'}]){
  await reject(createLineCustomerResolverR46({pool:fakePool([row])})({shopCode:SHOP,lineSub:LINE}));
 }
});

test('R68 malformed shop and LINE subject are rejected before DB query',async()=>{
 const pool=fakePool([linked('LINE連携済み')]); const r=createLineCustomerResolverR46({pool});
 for(const [shopCode,lineSub] of [['',LINE],[SHOP,''],[null,LINE],[SHOP,25],[SHOP,' X']])
   await reject(r({shopCode,lineSub}));
 assert.equal(pool.calls.length,0);
});

test('R68 R44 identity boundary refuses unlinked customer after valid mocked LINE verification',async()=>{
 const auth=createCar02Authenticator({
  shopCode:SHOP,lineClientId:'100200300',nowSeconds:()=>1000,
  verifyLineIdToken:async()=>({sub:LINE,aud:'100200300',iss:'https://access.line.me',exp:3000}),
  resolveLineCustomer:createLineCustomerResolverR46({pool:fakePool([linked('LINE未連携')])}),
  verifyStaffJwt:async()=>{throw Error('not used')},
  resolveStaffAccess:async()=>{throw Error('not used')}
 });
 await assert.rejects(auth(new Request('https://mock.test/api/car02',{
  headers:{'X-Line-ID-Token':'synthetic-token'}
 })),/CAR02_UNAUTHORIZED/);
});

test('R68 response errors never include LINE subject or customer id',async()=>{
 const r=createLineCustomerResolverR46({pool:fakePool([linked('LINE未連携')])});
 try{await r({shopCode:SHOP,lineSub:LINE});assert.fail('expected denial');}
 catch(e){assert.equal(e.message,'CAR02_IDENTITY_REJECTED');assert.doesNotMatch(e.message,/U-synthetic|33333333/);}
});
