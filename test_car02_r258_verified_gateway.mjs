import test from 'node:test';
import assert from 'node:assert/strict';
import {createCar02R258VerifiedStagingGateway,R258_CONTRACT} from './car02-r258-verified-staging-gateway-isolated.mjs';

const env={...process.env};
const SET={CAR02_RELEASE_LOCK:'true',CAR02_R257_ISOLATED:'yes',CAR02_R258_ISOLATED:'yes',PGHOST:'127.0.0.1',PGDATABASE:'car02_qa',NODE_ENV:'test'};
Object.assign(process.env,SET);
const opts=()=>({environment:'isolated_qa',dbName:'car02_qa',shopCode:'street_house_kitsuki',
 lineChannelId:'r258-synthetic-channel',supabaseUrl:'https://r258-auth-fixture.invalid',
 supabaseAnonKey:'r258-only-synthetic-publishable-key',
 allowedOrigins:['https://dpromstk2000-lab.github.io'],pool:{connect:async()=>{throw Error('NO_DB')},query:async()=>{throw Error('NO_DB')}},
 reviewGate:async()=>false,fetchImpl:async()=>{throw Error('NO_NETWORK')},nowSeconds:()=>1790000000});
const make=(x)=>new Request('https://r258-fixture.invalid'+x,{headers:{origin:'https://dpromstk2000-lab.github.io'}});

test('R258 production and real-identity claims remain false',()=>{
 assert.equal(R258_CONTRACT.release,'NO_GO');assert.equal(R258_CONTRACT.migration,'HOLD');
 assert.equal(R258_CONTRACT.productionReady,false);assert.equal(R258_CONTRACT.realAuthVerified,false);
});
test('R258 does not accept real project URL',()=>assert.throws(()=>createCar02R258VerifiedStagingGateway({...opts(),supabaseUrl:'https://real.supabase.co'}),/DISPOSABLE/));
test('R258 does not accept a different database',()=>assert.throws(()=>createCar02R258VerifiedStagingGateway({...opts(),dbName:'postgres'}),/DISPOSABLE/));
test('R258 does not accept a different shop',()=>assert.throws(()=>createCar02R258VerifiedStagingGateway({...opts(),shopCode:'other_shop'}),/DISPOSABLE/));
test('R258 requires injected non-network fixture fetcher',()=>assert.throws(()=>createCar02R258VerifiedStagingGateway({...opts(),fetchImpl:null}),/DISPOSABLE/));
test('R258 requires DB adapter and reviewer',()=>{
 assert.throws(()=>createCar02R258VerifiedStagingGateway({...opts(),pool:null}),/DISPOSABLE/);
 assert.throws(()=>createCar02R258VerifiedStagingGateway({...opts(),reviewGate:null}),/DISPOSABLE/);
});
test('R258 blocks before backend setup',async()=>{
 const api=createCar02R258VerifiedStagingGateway(opts());
 const res=await api(make('/functions/v1/dpro-car02-stage/api/car02'));
 assert.equal(res.status,503);assert.equal((await res.json()).code,'CAR02_NOT_RELEASED');
});
test('R258 denies unprefixed routing',async()=>{
 const api=createCar02R258VerifiedStagingGateway(opts());
 assert.equal((await api(make('/api/car02'))).status,404);
});
test('R258 excludes private-photo endpoint',async()=>{
 const api=createCar02R258VerifiedStagingGateway(opts());
 assert.equal((await api(make('/functions/v1/dpro-car02-stage/api/car02/photos/11111111-1111-4111-8111-111111111111'))).status,404);
});
test('R258 refuses startup when release lock absent',()=>{
 const old=process.env.CAR02_RELEASE_LOCK;
 try{delete process.env.CAR02_RELEASE_LOCK;
  assert.throws(()=>createCar02R258VerifiedStagingGateway(opts()),/DISPOSABLE/)}
 finally{process.env.CAR02_RELEASE_LOCK=old;}
});
test('R258 refuses production runtime',()=>{
 const old=process.env.NODE_ENV;
 try{process.env.NODE_ENV='production';
  assert.throws(()=>createCar02R258VerifiedStagingGateway(opts()),/DISPOSABLE/)}
 finally{process.env.NODE_ENV=old;}
});
test('R258 fail-closed if gate throws',async()=>{
 const api=createCar02R258VerifiedStagingGateway({...opts(),reviewGate:async()=>{throw Error('DOWN')}});
 assert.equal((await api(make('/functions/v1/dpro-car02-stage/api/car02'))).status,503);
});
