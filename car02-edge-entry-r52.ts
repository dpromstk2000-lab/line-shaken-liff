// DPRO CAR02 R52 Deno/Supabase Edge STAGING REVIEW - HARDCODED RELEASE LOCK.
// Keep isolated from existing reservations and LINE API. NEVER deploy as a live backend.
// No production SQL, Storage, or Auth traffic is initiated while the lock remains true.
import pg from 'npm:pg@8.16.3';
import {createCar02EdgeBoundaryR51} from './car02-edge-boundary-r51.mjs';
import {createCar02UnifiedRuntimeR50} from './car02-unified-runtime-r50.mjs';

const CAR02_RELEASE_LOCK=true; // NOT controlled by environment, request or query flags.
const getenv=(name:string)=>Deno.env.get(name)||'';
const required=(name:string)=>{
  const value=getenv(name);
  if(!value || value!==value.trim())throw Error('CAR02_ENV_REQUIRED');
  return value;
};
let pool:InstanceType<typeof pg.Pool>|null=null;
async function createRuntime(){
  if(CAR02_RELEASE_LOCK)throw Error('CAR02_NOT_RELEASED');
  const dsn=required('CAR02_DATABASE_URL');
  const target=new URL(dsn);
  if(!['postgres:','postgresql:'].includes(target.protocol))throw Error('CAR02_INVALID_DATABASE_CONFIG');
  if(!pool)pool=new pg.Pool({connectionString:dsn,max:1,connectionTimeoutMillis:5000,
    idleTimeoutMillis:5000,ssl:{rejectUnauthorized:true},application_name:'dpro_car02_edge_r52'});
  // Review build is deliberately locked even if an engineer accidentally reaches here.
  const releaseState={systemCode:'CAR02',contracted:false,goLiveApproved:false,
    migrationVerified:false,verifiedIdentityBound:false,workerBackendReady:false,
    externalNotificationsReviewed:false};
  return createCar02UnifiedRuntimeR50({
    pool,shopCode:required('CAR02_SHOP_CODE'),lineChannelId:required('CAR02_LINE_CHANNEL_ID'),
    supabaseUrl:required('SUPABASE_URL'),supabaseAnonKey:required('SUPABASE_ANON_KEY'),
    storageServiceRoleKey:required('SUPABASE_SERVICE_ROLE_KEY'),
    releaseState,allowedOrigins:required('CAR02_ALLOWED_ORIGINS').split(',')
  });
}
const route=createCar02EdgeBoundaryR51({isServerReleased:()=>!CAR02_RELEASE_LOCK,createRuntime});
export default {fetch(request:Request){return route(request)}};
