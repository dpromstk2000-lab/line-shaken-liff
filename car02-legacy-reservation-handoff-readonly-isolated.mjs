/** DPRO CAR02 V2.0: disposable R13 reservation -> R45 create request preview.
 * READ-ONLY; existing live /wangan and /ksh APIs are NOT connected to this module.
 * The actor must be supplied by a trusted disposable synthetic QA harness only.
 * Browser labels, client-supplied shop/customer/vehicle IDs, and legacy display numbers
 * cannot become authority. This module NEVER makes HTTP calls or writes to the DB.
 */
import {createCar02ReferenceBridge} from './car02-basic-reference-bridge-isolated.mjs';

export const CAR02_LEGACY_HANDOFF_MODE=Object.freeze({
  environment:'disposable_qa',readOnly:true,productionReady:false,sendable:false,
  realLegacyApiConnected:false,realAuthVerified:false,release:'NO_GO',migration:'HOLD'
});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMP=/^[A-Za-z0-9_-]{12,150}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(o,keys)=>plain(o)&&Object.keys(o).sort().join('|')===keys.slice().sort().join('|');
const QA_ENV=Object.freeze({
 GITHUB_ACTIONS:'true',NODE_ENV:'test',CAR02_RELEASE_LOCK:'true',CAR02_BASIC_PG17_QA:'yes',
 PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGPASSWORD:'qa_only_local',PGDATABASE:'car02_qa'
});
const LOOKUP=`SELECT r.id::text AS reservation_id, r.customer_id::text AS customer_id,
 r.vehicle_id::text AS vehicle_id, r.shop_code AS shop_code
 FROM public.ksh_demo_reservations r
 WHERE r.id=$1::uuid AND r.shop_code=$2 LIMIT 1`;
export function createCar02LegacyReservationHandoffReadOnly({
 pool,env=process.env,environment,allowDisposableQa=false
}={}){
 if(environment!=='disposable_qa'||allowDisposableQa!==true||!pool||
    typeof pool.query!=='function'||typeof pool.connect!=='function'||
    (!env||typeof env!=='object'||Array.isArray(env))||!plain(pool.options))fail('CAR02_LEGACY_HANDOFF_DISPOSABLE_ONLY');
 for(const [k,v] of Object.entries(QA_ENV))if(env[k]!==v)fail('CAR02_LEGACY_HANDOFF_DISPOSABLE_ONLY');
 if(pool.options.host!=='127.0.0.1'||String(pool.options.port)!=='5432'||
    pool.options.user!=='postgres'||pool.options.database!=='car02_qa')
    fail('CAR02_LEGACY_HANDOFF_DISPOSABLE_ONLY');
 const bridge=createCar02ReferenceBridge({pool,environment:'disposable_qa',allowReadOnlyQa:true});
 return Object.freeze({
  async prepare(input){
   if(!exact(input,['actor','reservationId','idempotencyKey']))fail('CAR02_LEGACY_HANDOFF_FIELDS_DENIED');
   const {actor,reservationId,idempotencyKey}=input;
   if(!plain(actor)||actor.verified!==true||!['owner','staff'].includes(actor.role)||
      typeof actor.subject!=='string'||!actor.subject.trim()||
      typeof actor.shopCode!=='string'||!actor.shopCode.trim())
      fail('CAR02_LEGACY_HANDOFF_TRUSTED_STAFF_REQUIRED');
   if(typeof reservationId!=='string'||!UUID.test(reservationId))fail('CAR02_LEGACY_HANDOFF_UUID_REQUIRED');
   if(typeof idempotencyKey!=='string'||!IDEMP.test(idempotencyKey))
     fail('CAR02_LEGACY_HANDOFF_IDEMPOTENCY_REQUIRED');
   let res;
   try{res=await pool.query(LOOKUP,[reservationId,actor.shopCode])}
   catch{fail('CAR02_LEGACY_HANDOFF_REFERENCE_UNAVAILABLE')}
   const row=res?.rows?.length===1?res.rows[0]:null;
   if(!row||row.reservation_id!==reservationId||row.shop_code!==actor.shopCode||
     !UUID.test(row.customer_id||'')||!UUID.test(row.vehicle_id||''))
     fail('CAR02_LEGACY_HANDOFF_REFERENCE_NOT_FOUND');
   // Resolve again against tenant-scoped shop/customer/vehicle/reservation relations.
   // This second query is intentionally independent of browser/body claims.
   let prepared;
   try{prepared=await bridge.prepare({actor,customerId:row.customer_id,vehicleId:row.vehicle_id,
      reservationId:row.reservation_id,idempotencyKey});}
   catch{fail('CAR02_LEGACY_HANDOFF_SCOPE_DENIED')}
   if(prepared.sendable!==false||prepared.authorization!=='SERVER_VERIFICATION_REQUIRED'||
      prepared.method!=='POST'||prepared.path!=='/api/car02'||prepared.body?.reservationId!==reservationId)
      fail('CAR02_LEGACY_HANDOFF_PREPARE_INVALID');
   return Object.freeze({
      path:prepared.path,method:prepared.method,body:prepared.body,
      idempotencyKey:prepared.idempotencyKey,
      source:'R13_DISPOSABLE_RESERVATION',authorization:'SERVER_VERIFICATION_REQUIRED',
      sendable:false,readOnly:true,release:'NO_GO',migration:'HOLD'
   });
  }
 });
}
