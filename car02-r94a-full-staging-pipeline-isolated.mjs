// CAR02 R94A: full R93U -> R93V/R82 -> R93X/R93S integration candidate.
// TEST ONLY. Never imported by R47/R50/R51/R52, no production network, no deploy.
import {createCar02R93UIsolatedStagingRouter} from './car02-r93u-staging-upload-route-isolated.mjs';
import {createCar02R93VIsolatedIdempotencyBridge} from './car02-r93v-idempotency-http-bridge-isolated.mjs';
import {createR93SDurableUploadIntentQA} from './car02-r93s-durable-upload-intent-isolated.mjs';
import {createR93XIsolatedPgReadyPort} from './car02-r93x-pg-ready-port-isolated.mjs';
import {createR93XIsolatedVerifiedStorageLifecycle} from './car02-r93x-verified-storage-lifecycle-isolated.mjs';

const DB='car02_r93q_qa_ci';
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const no=(status,code)=>new Response(JSON.stringify({ok:false,code}),{status,headers:{
 'content-type':'application/json; charset=utf-8','cache-control':'no-store',
 'x-content-type-options':'nosniff'}});

export function createCar02R94AFullStagingPipeline({environment,dbName,shopCode,
 pool,storage,reviewGate,authenticate,origins}={}){
 // Explicit test-only transport. A real Storage adapter may not satisfy this gate.
 if(environment!=='isolated_qa'||dbName!==DB||!SHOP.test(shopCode||'')||
  !pool||typeof pool.connect!=='function'||typeof pool.query!=='function'||
  storage?.kind!=='isolated_memory'||storage?.transport!=='in_process_http_fixture'||
  storage.testOnly!==true||typeof reviewGate!=='function'||
  typeof authenticate!=='function'||!Array.isArray(origins))
  throw Error('R94A_DISPOSABLE_STAGING_ONLY');
 const common={environment:'isolated_qa',dbName:DB,shopCode,pool,reviewGate};
 const intents=createR93SDurableUploadIntentQA(common);
 const readyPort=createR93XIsolatedPgReadyPort(common);
 const durableUpload=createR93XIsolatedVerifiedStorageLifecycle({environment:'isolated_qa',
  dbName:DB,shopCode,intents,readyPort,storage,reviewGate});
 const upload=createCar02R93VIsolatedIdempotencyBridge({environment:'isolated_qa',dbName:DB,
  shopCode,releaseEnabled:reviewGate,authenticate,durableUpload,origins});
 // No business handler is connected; never fall through to reservation or LINE.
 return createCar02R93UIsolatedStagingRouter({environment:'isolated_qa',dbName:DB,
  reviewGate,createUploadHandler:async()=>upload,
  createBusinessHandler:async()=>async()=>no(404,'CAR02_STAGING_BUSINESS_NOT_WIRED')});
}

export const R94A_CONTRACT=Object.freeze({mode:'isolated_qa',dbName:DB,
 productionReady:false,releaseDecision:'NO_GO',migrationDecision:'HOLD',
 storageTransport:'in_process_http_fixture',liveStorageConnected:false,
 directDeleteAllowed:false,legacyR47R50R51R52Unchanged:true,
 businessRuntimeConnected:false,notCloudflareWorkerReady:true,
 disposablePgRequired:true,productionCredentialsAllowed:false});
