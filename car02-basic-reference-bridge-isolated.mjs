/** DPRO CAR02: reference → work-order API request builder. ISOLATED QA ONLY.
 * No network calls, no real identity verifier, no release-gate bypass.
 */
import {createCar02ReferenceResolver} from './car02-basic-reference-resolver-isolated.mjs';
import {prepareWorkOrderCreate} from './car02-basic-api-contract-isolated.mjs';
export const BRIDGE_MODE=Object.freeze({disposable:true,productionReady:false,release:'NO_GO',migration:'HOLD'});
const fail=code=>{throw Object.assign(new Error(code),{code})};
export function createCar02ReferenceBridge({pool,environment,allowReadOnlyQa=false}={}){
 if(environment!=='disposable_qa'||allowReadOnlyQa!==true)fail('CAR02_BRIDGE_ISOLATION_REQUIRED');
 const resolver=createCar02ReferenceResolver({pool,environment,allowReadOnlyQa});
 return Object.freeze({
  async prepare({actor,customerId,vehicleId,reservationId=null,idempotencyKey}={}){
   // Identity MUST come from an isolated test fixture. No request body can authenticate itself.
   const resolved=await resolver.resolve({actor,customerId,vehicleId,reservationId});
   const request=prepareWorkOrderCreate({customerId:resolved.customerId,vehicleId:resolved.vehicleId,reservationId:resolved.reservationId,idempotencyKey});
   return Object.freeze({...request,body:Object.freeze({...request.body}),authorization:'SERVER_VERIFICATION_REQUIRED',sendable:false});
  }
 });
}
