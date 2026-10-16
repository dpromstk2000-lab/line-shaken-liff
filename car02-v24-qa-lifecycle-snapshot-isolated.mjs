/** CAR02 V2.4: synthetic booking lifecycle consistency reader.
 * QA-ONLY, never an authorization/production API. This reader does not mutate data.
 * The sidecar table car02_v24_qa_lifecycle exists ONLY in disposable PG17 CI.
 * Snapshot consistency IS NOT atomic order creation: another process can change
 * a booking or create a work order immediately after this read. Always NO_GO/HOLD.
 */
export const V24_MODE=Object.freeze({environment:'disposable_qa',readOnly:true,
  schema:'synthetic_qa_sidecar_only',realLegacyApiConnected:false,realAuth:false,
  raceFreeOrderCreationProven:false,productionReady:false,sendable:false,
  release:'NO_GO',migration:'HOLD'});
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const ACTIVE=new Set(['入庫予定','入庫済み']);
const BRANCH=new Set(['ksh','wangan']);
const REQUIRED_ENV=Object.freeze({GITHUB_ACTIONS:'true',NODE_ENV:'test',CAR02_RELEASE_LOCK:'true',
  CAR02_BASIC_PG17_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',
  PGPASSWORD:'qa_only_local',PGDATABASE:'car02_qa'});
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const fail=x=>{throw Object.assign(new Error(x),{code:x});};
function dateOK(x){if(typeof x!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(x))return false;
 const d=new Date(x+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===x;}
function timeOK(x){return typeof x==='string'&&/^([01][0-9]|2[0-3]):(00|30)(?::00)?$/.test(x);}
export function reviewCar02V24QaSnapshot(row,{reservationId,shopCode,expectedVersion}={}){
  // A positive result means ONLY an internally consistent synthetic read.
  const reasons=[];
  if(!plain(row)||row.reservation_id!==reservationId||row.shop_code!==shopCode)
    reasons.push('QA_R13_RESERVATION_NOT_FOUND');
  else{
    if(!UUID.test(row.customer_id||'')||!UUID.test(row.vehicle_id||''))reasons.push('QA_REFERENCES_MISSING');
    if(!Number.isSafeInteger(row.lifecycle_version)||row.lifecycle_version<1||
      row.lifecycle_version!==expectedVersion)reasons.push('QA_STALE_OR_INVALID_VERSION');
    if(!ACTIVE.has(row.lifecycle_status))reasons.push('QA_STATUS_NOT_ELIGIBLE');
    if(!dateOK(row.reservation_date)||!timeOK(row.reservation_time))reasons.push('QA_SLOT_INVALID');
    if(row.work_order_exists!==false)reasons.push('QA_ORDER_ALREADY_EXISTS_OR_UNPROVEN');
  }
  return Object.freeze({result:reasons.length===0?'CONSISTENT_QA_SNAPSHOT':'HOLD',
    reservationId,checks:Object.freeze(reasons),snapshotConsistent:reasons.length===0,
    safeToCreateOrder:false,sendable:false,atomicWriteProven:false,
    realAuthVerified:false,readOnly:true,release:'NO_GO',migration:'HOLD'});
}
export const V24_SQL=`SELECT r.id::text AS reservation_id, r.shop_code,
 r.customer_id::text AS customer_id, r.vehicle_id::text AS vehicle_id,
 s.status AS lifecycle_status,s.version AS lifecycle_version,
 s.reservation_date::text AS reservation_date,s.reservation_time::text AS reservation_time,
 EXISTS(SELECT 1 FROM public.ksh_car02_work_orders o
        WHERE o.shop_code=r.shop_code AND o.reservation_id=r.id) AS work_order_exists
 FROM public.ksh_demo_reservations r
 JOIN public.car02_v24_qa_lifecycle s
   ON s.reservation_id=r.id AND s.shop_code=r.shop_code
 WHERE r.id=$1::uuid AND r.shop_code=$2 LIMIT 1`;
export function createCar02V24QaLifecycleReader({pool,env,environment,allowDisposableQa=false,
  branchBindings}={}){
 if(environment!=='disposable_qa'||allowDisposableQa!==true||!plain(env)||!pool||
    typeof pool.connect!=='function'||!plain(pool.options)||!plain(branchBindings))
      fail('CAR02_V24_DISPOSABLE_ONLY');
 for(const [k,v] of Object.entries(REQUIRED_ENV))if(env[k]!==v)fail('CAR02_V24_DISPOSABLE_ONLY');
 for(const [k,v] of Object.entries({host:'127.0.0.1',user:'postgres',database:'car02_qa',password:'qa_only_local'}))
   if(pool.options[k]!==v)fail('CAR02_V24_DISPOSABLE_ONLY');
 if(String(pool.options.port)!=='5432'||Object.keys(branchBindings).sort().join('|')!=='ksh|wangan'||
   !Object.values(branchBindings).every(x=>typeof x==='string'&&/^[a-z0-9_]{3,64}$/.test(x)))
   fail('CAR02_V24_DISPOSABLE_ONLY');
 return Object.freeze({
  async inspect(input){
   if(!plain(input)||Object.keys(input).sort().join('|')!=='actor|branch|expectedVersion|reservationId')
     fail('CAR02_V24_INPUT_DENIED');
   const {actor,branch,reservationId,expectedVersion}=input;
   if(!plain(actor)||actor.verified!==true||!['staff','owner'].includes(actor.role)||
      typeof actor.subject!=='string'||!actor.subject.trim()||
      typeof actor.shopCode!=='string'||!actor.shopCode.trim())fail('CAR02_V24_QA_ACTOR_REQUIRED');
   if(!BRANCH.has(branch)||branchBindings[branch]!==actor.shopCode)
     fail('CAR02_V24_BRANCH_BINDING_DENIED');
   if(typeof reservationId!=='string'||!UUID.test(reservationId))fail('CAR02_V24_UUID_REQUIRED');
   if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1||expectedVersion>2147483647)
     fail('CAR02_V24_VERSION_REQUIRED');
   const client=await pool.connect();
   let row;
   try{
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const x=await client.query(V24_SQL,[reservationId.toLowerCase(),actor.shopCode]);
    row=x?.rows?.length===1?x.rows[0]:null;
    await client.query('COMMIT');
   }catch{
    try{await client.query('ROLLBACK')}catch{}
    fail('CAR02_V24_QA_SNAPSHOT_UNAVAILABLE');
   }finally{client.release();}
   return reviewCar02V24QaSnapshot(row,{reservationId:reservationId.toLowerCase(),
     shopCode:actor.shopCode,expectedVersion});
  }
 });
}
