/** CAR02 UI-to-existing-API contract gate. Pure functions, synthetic inputs only.
 * Does not perform network, DB operations, token issuance or deployment.
 */
export const MODE = Object.freeze({kind:'isolated_contract_review',productionReady:false,release:'NO_GO',migration:'HOLD'});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid=x=>typeof x==='string'&&UUID.test(x);
const fail=(code)=>{throw Object.assign(new Error(code),{code});};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(data,names)=>plain(data)&&Object.keys(data).every(k=>names.includes(k));
const ident=x=>typeof x==='string'&&x.length>=12&&x.length<=150&&x.trim()===x;
/** Convert a pre-provisioned, server-resolved reference set to R45 create payload.
 * Names, role, shop and customer claims MUST NOT be promoted to identity.
 */
export function prepareWorkOrderCreate(input){
 if(!exact(input,['customerId','vehicleId','reservationId','idempotencyKey']))fail('CAR02_CONTRACT_FIELDS_INVALID');
 if(!isUuid(input.customerId)||!isUuid(input.vehicleId)||input.reservationId!=null&&!isUuid(input.reservationId))fail('CAR02_CONTRACT_REFERENCE_REQUIRED');
 if(!ident(input.idempotencyKey))fail('CAR02_CONTRACT_IDEMPOTENCY_REQUIRED');
 return Object.freeze({path:'/api/car02',method:'POST',body:Object.freeze({customerId:input.customerId,vehicleId:input.vehicleId,...(input.reservationId?{reservationId:input.reservationId}:{})}),idempotencyKey:input.idempotencyKey});
}
export function auditDemoRecord(record){
 if(!plain(record))fail('CAR02_CONTRACT_RECORD_INVALID');
 const gaps=[];
 if(!isUuid(record.customerId))gaps.push('CUSTOMER_UUID_NOT_RESOLVED');
 if(!isUuid(record.vehicleId))gaps.push('VEHICLE_UUID_NOT_RESOLVED');
 if(!isUuid(record.reservationId))gaps.push('RESERVATION_UUID_NOT_RESOLVED');
 if(!ident(record.idempotencyKey))gaps.push('IDEMPOTENCY_KEY_NOT_PROVIDED');
 gaps.push('SERVER_VERIFIED_IDENTITY_NOT_PROVEN','RELEASE_GATE_CLOSED','BOOKING_WRITE_ENDPOINT_NOT_PROVEN');
 return Object.freeze({ready:false,gaps:Object.freeze(gaps),note:'Client-supplied shop/role/customer labels never constitute authorization.'});
}
