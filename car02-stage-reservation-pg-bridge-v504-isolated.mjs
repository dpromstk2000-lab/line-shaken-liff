/**
 * DPRO CAR02 V5.04 — existing R45/R50 Deno/pg stage reservation bridge.
 * REVIEW ONLY. No queries run on import, no migration, no deployment.
 *
 * Use only with an authenticated R44/R46 actor and the existing trusted R44
 * release gate. The deployed dpro-car02-stage retains CAR02_RELEASE_LOCK=true.
 * The target KSH DB currently has NO CAR02 case table, staff membership table,
 * or proven reservation unique index, therefore real create remains blocked.
 */
import {bindExistingReservationCaseService} from './car02-existing-reservation-case-service-v501-isolated.mjs';

export const CAR02_V504_MODE = Object.freeze({reviewOnly:true,deployed:false,
  releaseLock:true,release:'NO_GO',dbMigration:'HOLD'});

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const RESERVATION_SQL = `SELECT id,shop_code,customer_id,vehicle_id,
  reservation_date::text AS reservation_date,
  reservation_time::text AS reservation_time,status
  FROM public.ksh_demo_reservations WHERE shop_code=$1 AND id=$2::uuid LIMIT 2`;
const CASE_SQL = `SELECT id FROM public.ksh_car02_work_orders
  WHERE shop_code=$1 AND reservation_id=$2::uuid LIMIT 2`;

// A simple reservation_id index (as in the held R13 draft) is insufficient.
// This proves a VALID, READY, non-partial UNIQUE index on exactly the two
// tenant/reservation columns. Default Postgres NULLS DISTINCT permits multiple
// legitimate cases without a linked reservation.
const UNIQUE_SQL = `SELECT EXISTS (
 SELECT 1 FROM pg_catalog.pg_index i
 JOIN pg_catalog.pg_class t ON t.oid=i.indrelid
 JOIN pg_catalog.pg_namespace ns ON ns.oid=t.relnamespace
 JOIN pg_catalog.pg_attribute sc ON sc.attrelid=t.oid AND sc.attname='shop_code'
 JOIN pg_catalog.pg_attribute rc ON rc.attrelid=t.oid AND rc.attname='reservation_id'
 WHERE ns.nspname='public' AND t.relname='ksh_car02_work_orders'
 AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive
 AND i.indnkeyatts=2 AND i.indnatts=2 AND i.indpred IS NULL
 AND i.indexprs IS NULL
 AND ((i.indkey[0]=sc.attnum AND i.indkey[1]=rc.attnum)
   OR (i.indkey[0]=rc.attnum AND i.indkey[1]=sc.attnum))
 ) AS enforced`;

function scopeOk(scope){return scope && typeof scope.shopCode==='string' &&
  SHOP.test(scope.shopCode) && typeof scope.reservationId==='string' &&
  UUID.test(scope.reservationId);}

async function rowsFromPool(pool,sql,params=[]){
  const client=await pool.connect();
  try{
    const result=await client.query(sql,params);
    if(!Array.isArray(result?.rows))throw Error('CAR02_V504_PG_RESPONSE_INVALID');
    return result.rows;
  }finally{client.release();}
}

/** Attach only to the R45 server runtime, never browser or KSH public Worker. */
export function bindCar02StageReservationToPgR504({pool,service,releaseEnabled,Car02ErrorClass}={}){
  if(!pool || typeof pool.connect!=='function' || typeof pool.query!=='function' ||
    typeof service?.create!=='function' || typeof releaseEnabled!=='function' ||
    typeof Car02ErrorClass!=='function')throw Error('CAR02_V504_SERVER_DEPENDENCIES_REQUIRED');

  const check=scope=>{
    if(!scopeOk(scope))throw Error('CAR02_V504_SCOPE_INVALID');
    return [scope.shopCode,scope.reservationId];
  };
  const assertAtomicUniqueLink=async scope=>{
    check(scope);
    const rows=await rowsFromPool(pool,UNIQUE_SQL);
    return rows.length===1 && rows[0].enforced===true;
  };
  const resolveReservationForShop=async scope=>{
    const rows=await rowsFromPool(pool,RESERVATION_SQL,check(scope));
    if(rows.length>1)throw Error('CAR02_V504_RESERVATION_AMBIGUOUS');
    const row=rows[0]??null;
    if(row && (row.id!==scope.reservationId || row.shop_code!==scope.shopCode))
      throw Error('CAR02_V504_RESERVATION_SCOPE_MISMATCH');
    return row;
  };
  const findCaseByReservation=async scope=>{
    const rows=await rowsFromPool(pool,CASE_SQL,check(scope));
    if(rows.length>1)throw Error('CAR02_V504_LINK_AMBIGUOUS');
    return rows[0]??null;
  };
  return bindExistingReservationCaseService({service,resolveReservationForShop,
    findCaseByReservation,assertAtomicUniqueLink,releaseEnabled,Car02ErrorClass});
}
