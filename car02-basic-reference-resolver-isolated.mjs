/** DPRO CAR02 basic integration: READ-ONLY reference resolution candidate.
 * Explicit isolation gate. Synthetic/ephemeral DB QA ONLY. Never deploy directly.
 * Does not create customers/vehicles/reservations or grant access.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validUuid=v=>typeof v==='string'&&UUID.test(v);
const fail=code=>{const e=new Error(code);e.code=code;throw e};
export const REFERENCE_MODE=Object.freeze({isolation:'disposable_qa',readOnly:true,realAuth:false,deployable:false,release:'NO_GO',migration:'HOLD'});
export function createCar02ReferenceResolver({pool,environment,allowReadOnlyQa=false}={}){
 if(environment!=='disposable_qa'||allowReadOnlyQa!==true||!pool||typeof pool.query!=='function')fail('CAR02_REFERENCE_ISOLATION_REQUIRED');
 return Object.freeze({
  async resolve({actor,customerId,vehicleId,reservationId}={}){
   if(!actor||actor.verified!==true||!['owner','staff'].includes(actor.role)||typeof actor.shopCode!=='string'||!actor.shopCode.trim()||!actor.subject)fail('CAR02_REFERENCE_IDENTITY_REQUIRED');
   if(!validUuid(customerId)||!validUuid(vehicleId)||reservationId!=null&&!validUuid(reservationId))fail('CAR02_REFERENCE_UUID_REQUIRED');
   // Separate existing R13 preconditions; no tenant names or role claims from caller-supplied body.
   const sql=`SELECT
    EXISTS(SELECT 1 FROM public.ksh_demo_shop_settings s WHERE s.shop_code=$1) AS shop_ok,
    EXISTS(SELECT 1 FROM public.ksh_demo_customers c WHERE c.id=$2::uuid AND c.shop_code=$1) AS customer_ok,
    EXISTS(SELECT 1 FROM public.ksh_demo_vehicles v WHERE v.id=$3::uuid AND v.shop_code=$1 AND v.customer_id=$2::uuid) AS vehicle_ok,
    ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM public.ksh_demo_reservations r WHERE r.id=$4::uuid AND r.shop_code=$1 AND r.customer_id=$2::uuid AND r.vehicle_id=$3::uuid)) AS reservation_ok`;
   const r=await pool.query(sql,[actor.shopCode,customerId,vehicleId,reservationId??null]);
   const row=r?.rows?.[0];
   if(!row||row.shop_ok!==true||row.customer_ok!==true||row.vehicle_ok!==true||row.reservation_ok!==true)fail('CAR02_REFERENCE_SCOPE_MISMATCH');
   return Object.freeze({customerId,vehicleId,reservationId:reservationId??null,shopCode:actor.shopCode,verifiedBy:'disposable_qa_reference_check'});
  }
 });
}
