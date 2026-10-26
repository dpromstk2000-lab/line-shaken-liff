// DPRO CAR02 V5.04 / R45 stage assembly CANDIDATE. REVIEW ONLY; NOT DEPLOYED.
// Existing dpro-car02-stage index.ts hardcodes CAR02_RELEASE_LOCK=true.
// Do not deploy or enable until audited R13+UNIQUE, staff auth and approval.
import {createCar02Api} from './car02-api.mjs';
import {createCar02Service,Car02Error} from './car02-core.mjs';
import {createCar02Authenticator,createCar02ReleaseGate} from './car02-identity-r44.mjs';
import {createCar02PgAdapter} from './car02-pg-adapter.mjs';
import {bindCar02StageReservationToPgR504} from './car02-stage-reservation-pg-bridge-v504-isolated.mjs';

export function createCar02RuntimeR45({
  pool,shopCode,lineClientId,verifyLineIdToken,verifyStaffJwt,
  resolveLineCustomer,resolveStaffAccess,releaseState,allowedOrigins=[],nowSeconds
}={}){
  if(!pool||typeof pool.connect!=='function'||typeof pool.query!=='function')
    throw Error('CAR02_POOL_REQUIRED');
  if(!Array.isArray(allowedOrigins)||allowedOrigins.some(x=>typeof x!=='string'||!/^https:\/\//.test(x)))
    throw Error('CAR02_ORIGIN_ALLOWLIST_INVALID');
  const authenticate=createCar02Authenticator({shopCode,lineClientId,
    verifyLineIdToken,verifyStaffJwt,resolveLineCustomer,resolveStaffAccess,
    ...(nowSeconds?{nowSeconds}:{})});
  if(releaseState===undefined)throw Error('CAR02_RELEASE_GATE_REQUIRED');
  const releaseEnabled=createCar02ReleaseGate(releaseState);
  const domainService=createCar02Service(createCar02PgAdapter(pool));
  const service=bindCar02StageReservationToPgR504({pool,service:domainService,
    releaseEnabled,Car02ErrorClass:Car02Error});
  return createCar02Api({service,authenticate,releaseEnabled,allowedOrigins});
}
