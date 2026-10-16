/**
 * DPRO CAR02 V2.5 — synthetic-only atomic CLAIM simulation in disposable PG17.
 * NEVER a work-order writer, booking writer, authentication endpoint or deployment.
 * Writes exclusively to public.car02_v25_qa_claims, a table created by the
 * disposable GitHub Actions fixture. This is NOT production race-proofing.
 * A lease, version, and identity guard would still be needed in the actual
 * business transaction before any real work order could be created.
 */
export const V25_MODE=Object.freeze({mode:'disposable_qa_atomic_claim',productionReady:false,
  release:'NO_GO',migration:'HOLD',realAuthorization:false,realLegacyApiConnected:false,
  writesOnly:'car02_v25_qa_claims',realOrderWrite:false,sendable:false});
const QA=Object.freeze({GITHUB_ACTIONS:'true',NODE_ENV:'test',CAR02_RELEASE_LOCK:'true',
 CAR02_BASIC_PG17_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',
 PGPASSWORD:'qa_only_local',PGDATABASE:'car02_qa'});
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const KEY=/^[A-Za-z0-9_-]{12,150}$/;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const frozen=(result,reason)=>Object.freeze({result,reason,sendable:false,safeToCreateRealOrder:false,
  businessMutation:false,release:'NO_GO',migration:'HOLD'});
export const V25_LOCK_SQL=`SELECT r.id::text AS reservation_id, r.shop_code,
  r.customer_id::text AS customer_id,r.vehicle_id::text AS vehicle_id,
  s.status AS lifecycle_status,s.version AS lifecycle_version,
  s.reservation_date::text AS reservation_date,s.reservation_time::text AS reservation_time,
  EXISTS(SELECT 1 FROM public.ksh_car02_work_orders o
         WHERE o.reservation_id=r.id AND o.shop_code=r.shop_code) AS real_order_exists
  FROM public.ksh_demo_reservations r
  JOIN public.car02_v24_qa_lifecycle s
    ON s.reservation_id=r.id AND s.shop_code=r.shop_code
  WHERE r.id=$1::uuid AND r.shop_code=$2 FOR UPDATE OF s`;
const EXISTING=`SELECT idempotency_key FROM public.car02_v25_qa_claims WHERE reservation_id=$1::uuid AND shop_code=$2 LIMIT 1`;
const INSERT=`INSERT INTO public.car02_v25_qa_claims
  (shop_code,reservation_id,idempotency_key,version_at_claim)
  VALUES ($1,$2::uuid,$3,$4) ON CONFLICT DO NOTHING RETURNING reservation_id`;
export function createCar02V25QaClaim({pool,env,environment,allowDisposableQa=false,branchBindings}={}){
 if(environment!=='disposable_qa'||allowDisposableQa!==true||!plain(env)||!pool||
    typeof pool.connect!=='function'||!plain(pool.options)||!plain(branchBindings))fail('CAR02_V25_DISPOSABLE_ONLY');
 for(const [k,v] of Object.entries(QA))if(env[k]!==v)fail('CAR02_V25_DISPOSABLE_ONLY');
 for(const [k,v] of Object.entries({host:'127.0.0.1',user:'postgres',password:'qa_only_local',database:'car02_qa'}))
  if(pool.options[k]!==v)fail('CAR02_V25_DISPOSABLE_ONLY');
 if(String(pool.options.port)!=='5432'||Object.keys(branchBindings).sort().join('|')!=='ksh|wangan'||
    !Object.values(branchBindings).every(v=>typeof v==='string'&&/^[a-z0-9_]{3,64}$/.test(v))||
    branchBindings.ksh===branchBindings.wangan)fail('CAR02_V25_DISPOSABLE_ONLY');
 return Object.freeze({
  async claim(input){
   if(!plain(input)||Object.keys(input).sort().join('|')!=='actor|branch|expectedVersion|idempotencyKey|reservationId')
    fail('CAR02_V25_FIELDS_DENIED');
   const {actor,branch,reservationId,expectedVersion,idempotencyKey}=input;
   if(!plain(actor)||actor.verified!==true||!['owner','staff'].includes(actor.role)||
     typeof actor.subject!=='string'||!actor.subject.trim()||
     typeof actor.shopCode!=='string'||!actor.shopCode.trim())fail('CAR02_V25_QA_ACTOR_REQUIRED');
   if(!['ksh','wangan'].includes(branch)||branchBindings[branch]!==actor.shopCode)
    fail('CAR02_V25_BRANCH_SCOPE_DENIED');
   if(typeof reservationId!=='string'||!UUID.test(reservationId))fail('CAR02_V25_UUID_REQUIRED');
   if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1||expectedVersion>2147483647)
    fail('CAR02_V25_VERSION_REQUIRED');
   if(typeof idempotencyKey!=='string'||!KEY.test(idempotencyKey))fail('CAR02_V25_KEY_REQUIRED');
   const id=reservationId.toLowerCase();
   let client,opened=false;
   try{
    client=await pool.connect();
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED');opened=true;
    const row=(await client.query(V25_LOCK_SQL,[id,actor.shopCode]))?.rows;
    if(!Array.isArray(row)||row.length!==1){await client.query('COMMIT');opened=false;return frozen('HOLD','RESERVATION_NOT_FOUND');}
    const x=row[0];
    if(x.reservation_id!==id||x.shop_code!==actor.shopCode||
       !UUID.test(x.customer_id||'')||!UUID.test(x.vehicle_id||'')){
      await client.query('COMMIT');opened=false;return frozen('HOLD','SCOPE_NOT_PROVEN');
    }
    if(x.real_order_exists!==false){await client.query('COMMIT');opened=false;return frozen('HOLD','REAL_ORDER_ALREADY_EXISTS');}
    if(!Number.isSafeInteger(x.lifecycle_version)||x.lifecycle_version!==expectedVersion){
      await client.query('COMMIT');opened=false;return frozen('HOLD','STALE_BOOKING_VERSION');}
    if(!['入庫予定','入庫済み'].includes(x.lifecycle_status)){
      await client.query('COMMIT');opened=false;return frozen('HOLD','BOOKING_NOT_ELIGIBLE');}
    if(typeof x.reservation_time!=='string'||!/^([01][0-9]|2[0-3]):(00|30)(?::00)?$/.test(x.reservation_time)||
       typeof x.reservation_date!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(x.reservation_date)||
       !Number.isFinite(Date.parse(x.reservation_date+'T00:00:00Z'))||
       new Date(x.reservation_date+'T00:00:00Z').toISOString().slice(0,10)!==x.reservation_date){
      await client.query('COMMIT');opened=false;return frozen('HOLD','SLOT_INVALID');
    }
    // All contenders take the same lifecycle-row lock before inspecting claims.
    const claims=(await client.query(EXISTING,[id,actor.shopCode]))?.rows;
    if(!Array.isArray(claims))throw Error('CAR02_V25_CLAIM_QUERY_UNAVAILABLE');
    if(claims.length){await client.query('COMMIT');opened=false;
      return frozen(claims[0].idempotency_key===idempotencyKey?'REPLAY_QA':'HOLD',
        claims[0].idempotency_key===idempotencyKey?'SAME_SYNTHETIC_CLAIM':'BOOKING_ALREADY_CLAIMED');
    }
    const inserted=(await client.query(INSERT,[actor.shopCode,id,idempotencyKey,expectedVersion]))?.rows;
    await client.query('COMMIT');opened=false;
    return frozen(Array.isArray(inserted)&&inserted.length===1?'CLAIMED_QA':'HOLD',
      Array.isArray(inserted)&&inserted.length===1?'DISPOSABLE_ONLY':'CLAIM_CONFLICT');
   }catch(e){if(client&&opened){try{await client.query('ROLLBACK')}catch{}}
     fail('CAR02_V25_QA_TRANSACTION_UNAVAILABLE');
   }finally{if(client)client.release();}
  }
 });
}
