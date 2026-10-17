/** DPRO CAR02 V2.7 -- review ONLY. No business DB writes or production authorization.
 * The existing R13 schema has an ordinary reservation index and the R45 adapter
 * uses a scoped idempotency key. Neither proves one order per reservation.
 */
export const V27_MODE=Object.freeze({environment:'disposable_qa',release:'NO_GO',migration:'HOLD',
  liveSchemaChecked:false,productionReady:false,sendable:false,readOnlySourceAudit:true});
export const V27_QA_UNIQUE_INDEX_SQL=`CREATE UNIQUE INDEX car02_v27_qa_one_order_per_reservation
  ON public.ksh_car02_work_orders(shop_code,reservation_id)
  WHERE reservation_id IS NOT NULL`;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const def=sql=>typeof sql==='string' ? sql.replace(/--[^\n]*(?:\n|$)/g,'\n').replace(/\s+/g,' ').trim() : '';
/** Fail closed if R13 is unavailable or changed beyond the expected QA evidence. */
export function auditCar02V27R13UniquenessSource({r13,adapter}={}){
 if(!plain({r13,adapter})||typeof r13!=='string'||typeof adapter!=='string'||
    r13.length<2000||adapter.length<2000)fail('CAR02_V27_SOURCE_REQUIRED');
 const sql=def(r13);
 const table=sql.match(/CREATE\s+TABLE\s+public\.ksh_car02_work_orders\s*\(([\s\S]*?)\)\s*;/i)?.[1];
 if(!table||!/(?:^|,)\s*reservation_id\s+uuid\b/i.test(table))fail('CAR02_V27_ORDER_SCHEMA_UNRECOGNIZED');
 const ordinary=/CREATE\s+INDEX\s+ksh_car02_work_orders_reservation_idx\s+ON\s+public\.ksh_car02_work_orders\s*\(reservation_id\)/i.test(sql);
 if(!ordinary)fail('CAR02_V27_EXPECTED_R13_INDEX_DRIFT');
 const existingUniqueness=/CREATE\s+UNIQUE\s+INDEX\s+\w+\s+ON\s+public\.ksh_car02_work_orders\s*\((?:shop_code\s*,\s*reservation_id|reservation_id)\s*\)/i.test(sql)||
  /UNIQUE\s*\(\s*shop_code\s*,\s*reservation_id\s*\)/i.test(table);
 if(existingUniqueness)fail('CAR02_V27_R13_ALREADY_HAS_BOOKING_UNIQUENESS_REVIEW');
 const adapterDoesInsert=/INSERT\s+INTO\s+public\.ksh_car02_work_orders\b/i.test(adapter);
 const adapterChecksLinks=adapter.includes('async assertLinks(');
 const scopedOperation=adapter.includes('ksh_car02_operations')&&adapter.includes('idempotency_key');
 if(!adapterDoesInsert||!adapterChecksLinks||!scopedOperation)
  fail('CAR02_V27_R45_CONTRACT_DRIFT');
 return Object.freeze({sourceConsistent:true,r13HasOnlyNonuniqueBookingIndex:true,
    r45HasScopedIdempotency:true,uniqueBookingConstraintVerified:false,
    realTransactionVerified:false,release:'NO_GO',migration:'HOLD',productionReady:false,
    gaps:Object.freeze(['R13_BOOKING_UNIQUENESS_NOT_ENFORCED',
      'REAL_BOOKING_LIFECYCLE_ATOMIC_CHECK_NOT_PROVEN','LIVE_AUTH_AND_RELEASE_NOT_PROVEN'])});
}
export function verifyCar02V27QaIndexDefinition(sql){
 if(typeof sql!=='string')fail('CAR02_V27_DDL_INVALID');
 const v=sql.trim().replace(/\s+/g,' ');
 if(!/^CREATE UNIQUE INDEX car02_v27_qa_one_order_per_reservation ON public\.ksh_car02_work_orders\(shop_code,reservation_id\) WHERE reservation_id IS NOT NULL$/i.test(v))
  fail('CAR02_V27_DDL_INVALID');
 return Object.freeze({qaOnly:true,readyForProduction:false,release:'NO_GO',migration:'HOLD'});
}
