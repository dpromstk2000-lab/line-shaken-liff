/**
 * CAR02 R258: R257 Edge-prefix gateway + existing R46 verified-auth assembly.
 * CI-only integration candidate, never a public server or production Worker.
 * All tokens, URL and database identities are synthetic and fixed here.
 * No production credentials, network, storage, LINE delivery or deploy.
 */
import {createCar02R257BasicStagingGateway} from './car02-r257-basic-staging-gateway-isolated.mjs';
import {createCar02VerifiedRuntimeR46} from './car02-runtime-verified-r46.mjs';

const SHOP='street_house_kitsuki';
const ORIGIN='https://dpromstk2000-lab.github.io';
const AUTH='https://r258-auth-fixture.invalid';
const CHANNEL='r258-synthetic-channel';
const ANON='r258-only-synthetic-publishable-key';
export const R258_CONTRACT=Object.freeze({
  mode:'isolated_qa', dbName:'car02_qa', syntheticIdentity:true,
  realAuthVerified:false, realWorkerConnected:false, publicEndpoint:false,
  realStorageConnected:false, realLineDispatched:false,
  release:'NO_GO',migration:'HOLD',productionReady:false,
  realWorldGatesOpen:12,
});

function isolate(o){
 if(o?.environment!=='isolated_qa'||o.dbName!=='car02_qa'||o.shopCode!==SHOP||
    o.lineChannelId!==CHANNEL||o.supabaseUrl!==AUTH||o.supabaseAnonKey!==ANON||
    !Array.isArray(o.allowedOrigins)||o.allowedOrigins.length!==1||o.allowedOrigins[0]!==ORIGIN||
    typeof o.fetchImpl!=='function'||typeof o.reviewGate!=='function'||
    typeof o.pool?.connect!=='function'||typeof o.pool?.query!=='function'||
    process.env.CAR02_RELEASE_LOCK!=='true'||
    process.env.CAR02_R257_ISOLATED!=='yes'||
    process.env.CAR02_R258_ISOLATED!=='yes'||
    process.env.PGHOST!=='127.0.0.1'||process.env.PGDATABASE!=='car02_qa'||
    process.env.NODE_ENV==='production') throw Error('R258_DISPOSABLE_QA_ONLY');
}
export function createCar02R258VerifiedStagingGateway(o={}){
  isolate(o);
  const reviewed=async()=>{
    isolate(o);
    try{return (await o.reviewGate())===true}catch{return false}
  };
  return createCar02R257BasicStagingGateway({
    environment:o.environment,dbName:o.dbName,shopCode:o.shopCode,
    reviewGate:reviewed,
    buildBasicRuntime:async()=>createCar02VerifiedRuntimeR46({
      pool:o.pool,shopCode:o.shopCode,lineChannelId:o.lineChannelId,
      supabaseUrl:o.supabaseUrl,supabaseAnonKey:o.supabaseAnonKey,
      allowedOrigins:o.allowedOrigins,fetchImpl:o.fetchImpl,
      nowSeconds:o.nowSeconds||(()=>1790000000),
      releaseState:async()=>{
        const open=await reviewed();
        return {systemCode:'CAR02',contracted:open,goLiveApproved:open,
          migrationVerified:open,verifiedIdentityBound:open,
          workerBackendReady:open,externalNotificationsReviewed:open};
      }
    })
  });
}
