/**
 * DPRO CAR02 R257 — Edge-shaped basic business gateway, DISPOSABLE QA ONLY.
 * Intended to exercise existing R51 routing + R45 HTTP/PG runtime in a
 * GitHub Actions ephemeral PostgreSQL 17 service. No production wiring.
 * Deliberately excludes private-photo upload and all real external services.
 * Does not import or change locked R52. May NEVER be a deployed backend.
 */
import {createCar02EdgeBoundaryR51} from './car02-edge-boundary-r51.mjs';
const HOST='car02_qa',SHOP='street_house_kitsuki';
const PHOTO= /^\/(?:functions\/v1\/)?dpro-car02-stage\/api\/car02\/photos(?:\/|$)/i;
const json=(status,code)=>new Response(JSON.stringify({ok:false,code}),{status,headers:{
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function assertIsolation(environment,dbName,shopCode){
 if(environment!=='isolated_qa'||dbName!==HOST||shopCode!==SHOP||
    process.env.CAR02_RELEASE_LOCK!=='true'||process.env.CAR02_R257_ISOLATED!=='yes'||
    process.env.NODE_ENV==='production'||process.env.GITHUB_ACTIONS==='false')
   throw Error('R257_DISPOSABLE_QA_ONLY');
}
export function createCar02R257BasicStagingGateway({environment,dbName,shopCode,reviewGate,buildBasicRuntime}={}){
 assertIsolation(environment,dbName,shopCode);
 if(typeof reviewGate!=='function'||typeof buildBasicRuntime!=='function')
  throw Error('R257_TRUSTED_GATE_AND_RUNTIME_REQUIRED');
 const boundary=createCar02EdgeBoundaryR51({
  isServerReleased:async()=>{
   assertIsolation(environment,dbName,shopCode);
   try{return await reviewGate()===true}catch{return false}
  },
  createRuntime:async()=>{
   assertIsolation(environment,dbName,shopCode);
   const value=await buildBasicRuntime({shopCode,dbName});
   if(typeof value!=='function')throw Error('R257_RUNTIME_UNAVAILABLE');
   return value;
  }
 });
 return async function stageOnly(request){
  assertIsolation(environment,dbName,shopCode);
  let url;try{url=new URL(request?.url)}catch{return json(400,'CAR02_BAD_REQUEST')}
  // Refuse all photo traffic before R51 can invoke its original photo route.
  if(PHOTO.test(url.pathname))return json(404,'CAR02_PHOTO_NOT_WIRED');
  return boundary(request);
 };
}
export const R257_CONTRACT=Object.freeze({mode:'isolated_qa',dbName:HOST,shopCode:SHOP,
 source:'R51_ROUTING_AND_R45_PG_RUNTIME',customerOrdersEnabled:false,
 photoUploadEnabled:false,realAuthentication:false,deployable:false,
 releaseDecision:'NO_GO',migrationDecision:'HOLD',realWorldGatesOpen:12});
