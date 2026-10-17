/** CAR02 V3.0 — fail-closed pre-migration decision and disposable-only DDL rehearsal.
 * Never authorizes or runs any operation on a real database. No production SQL,
 * Worker, LINE, storage, secrets, or customer data used.
 */
import {assessV28Catalog,assessV28Aggregate} from './car02-v28-premigration-readonly-isolated.mjs';
import {assessV29IndexCatalog} from './car02-v29-strict-index-audit-isolated.mjs';
export const V30_MODE=Object.freeze({environment:'disposable_qa',productionReady:false,
  productionMutationAuthorized:false,liveDbInspected:false,migration:'HOLD',release:'NO_GO',sendable:false});
export const V30_QA_TABLE='public.car02_v30_qa_migration_probe';
export const V30_QA_INDEX='car02_v30_qa_one_order_per_reservation';
export const V30_QA_INDEX_DDL=`CREATE UNIQUE INDEX ${V30_QA_INDEX} ON ${V30_QA_TABLE}(shop_code,reservation_id) WHERE reservation_id IS NOT NULL`;
const fail=code=>{throw Object.assign(new Error(code),{code})};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const nonnegative=x=>Number.isSafeInteger(x)&&x>=0;
export const V30_AGGREGATE_KEYS=Object.freeze(['total_orders','orders_without_reservation',
 'duplicate_booking_groups','orders_in_duplicate_groups','largest_group','review_gate']);
export function summarizeV30Aggregate(a){
 if(!plain(a)||V30_AGGREGATE_KEYS.some(k=>!Object.hasOwn(a,k)))fail('CAR02_V30_AGGREGATES_REQUIRED');
 return Object.fromEntries(V30_AGGREGATE_KEYS.map(k=>[k,a[k]]));
}
export function decideV30MigrationRehearsal({catalogRow,aggregateRow,indexRow}={}){
 // Use preceding validated source-of-truth parsers; do not accept caller-friendly booleans.
 const catalog=assessV28Catalog(catalogRow);
 if(!catalog.schemaReadyForAggregate){
   if(aggregateRow!==null||indexRow!==null)fail('CAR02_V30_SCHEMA_QUERY_GUARD');
   return Object.freeze({lane:'STOP_SCHEMA_UNVERIFIED',duplicateGroups:null,indexEffective:null,
     cloneRehearsalAllowed:false,manualReconciliationRequired:false,
     realDataProven:false,productionReady:false,release:'NO_GO',migration:'HOLD'});
 }
 const aggregates=assessV28Aggregate(aggregateRow);
 const indexes=assessV29IndexCatalog(indexRow,{table:'ksh_car02_work_orders'});
 let lane;
 if(aggregates.duplicate_booking_groups>0)lane='STOP_DUPLICATES_MANUAL_REVIEW';
 else if(indexes.structurallyEffectiveIndexCount>0)lane='HOLD_EXISTING_UNIQUE_INDEX_NEEDS_REVIEW';
 else lane='QA_CLONE_REHEARSAL_ONLY';
 const cloneRehearsalAllowed=lane==='QA_CLONE_REHEARSAL_ONLY';
 return Object.freeze({lane,duplicateGroups:aggregates.duplicate_booking_groups,
   unlinkedOrders:aggregates.orders_without_reservation,
   indexEffective:indexes.structurallyEffectiveIndexCount>0,
   cloneRehearsalAllowed,manualReconciliationRequired:aggregates.duplicate_booking_groups>0,
   realDataProven:false,productionReady:false,release:'NO_GO',migration:'HOLD'});
}
export function guardV30DisposableIndexExperiment({environment,dbName,table,duplicateGroups,
 releaseLock,allowDisposableQa}={}){
 if(environment!=='disposable_qa'||dbName!=='car02_qa'||table!==V30_QA_TABLE||
   releaseLock!==true||allowDisposableQa!==true)fail('CAR02_V30_DISPOSABLE_ONLY');
 if(!nonnegative(duplicateGroups))fail('CAR02_V30_DUPLICATE_COUNT_INVALID');
 return Object.freeze({allowed:duplicateGroups===0,reason:duplicateGroups>0?
   'STOP_SYNTHETIC_DUPLICATES':'QA_CLONE_ONLY',ddl:duplicateGroups===0?V30_QA_INDEX_DDL:null,
   productionAuthorized:false,release:'NO_GO',migration:'HOLD'});
}
