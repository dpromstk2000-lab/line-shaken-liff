/**
 * DPRO CAR02: atomic booking UUID provisioner for DISPOSABLE PostgreSQL 17 QA ONLY.
 * Produces a synthetic reservation UUID compatible with R13/R45 work orders.
 * This is NOT an existing production booking API, deployment, migration or real authentication.
 * Uses a separate QA-only slot ledger because the R13 synthetic baseline has no schedule fields.
 */
import { randomUUID } from 'node:crypto';
export const ATOMIC_BOOKING_MODE=Object.freeze({environment:'disposable_qa',release:'NO_GO',migration:'HOLD',productionReady:false,realAuth:false,bookingProductionApi:false,nonDeployable:true});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST=/^[A-Za-z0-9_-]{12,100}$/;
const fail=code=>{throw Object.assign(new Error(code),{code})};
const dateText=d=>`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
function tokyoNow(now){
 const x=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
 return {date:`${x.year}-${String(x.month).padStart(2,'0')}-${String(x.day).padStart(2,'0')}`,minutes:x.hour*60+x.minute};
}
/** Validate only calendar/payload values. Account identity is never derived here. */
export function validateAtomicBookingInput(input,{now=new Date()}={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!=='customerId,day,requestKey,time,vehicleId')fail('CAR02_BOOKING_FIELDS_INVALID');
 const {customerId,vehicleId,day,time,requestKey}=input;
 if(!UUID.test(customerId||'')||!UUID.test(vehicleId||''))fail('CAR02_BOOKING_UUID_REQUIRED');
 if(!REQUEST.test(requestKey||''))fail('CAR02_BOOKING_REQUEST_KEY_INVALID');
 if(typeof day!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(day))fail('CAR02_BOOKING_DATE_INVALID');
 const check=new Date(day+'T00:00:00.000Z');
 if(!Number.isFinite(check.getTime())||dateText(check)!==day)fail('CAR02_BOOKING_DATE_INVALID');
 if(check.getUTCDay()===0)fail('CAR02_BOOKING_CLOSED_DAY');
 if(typeof time!=='string'||!/^([0-1][0-9]|2[0-3]):(00|30)$/.test(time))fail('CAR02_BOOKING_TIME_INVALID');
 const [h,m]=time.split(':').map(Number),minutes=h*60+m;
 if(minutes<540||minutes>1050)fail('CAR02_BOOKING_BUSINESS_HOURS');
 const today=tokyoNow(now);
 const distance=(check.getTime()-new Date(today.date+'T00:00:00.000Z').getTime())/86400000;
 if(distance<0||distance>60||(distance===0&&minutes<=today.minutes))fail('CAR02_BOOKING_WINDOW_INVALID');
 return Object.freeze({customerId,vehicleId,day,time,requestKey});
}
function qaEnvironment(pool,env){
 if(env.GITHUB_ACTIONS!=='true'||env.NODE_ENV!=='test'||env.CAR02_RELEASE_LOCK!=='true'||env.CAR02_BASIC_PG17_QA!=='yes'||env.PGHOST!=='127.0.0.1'||env.PGPORT!=='5432'||env.PGUSER!=='postgres'||env.PGPASSWORD!=='qa_only_local'||env.PGDATABASE!=='car02_qa'||
  pool?.options?.host!=='127.0.0.1'||pool.options.database!=='car02_qa'||pool.options.user!=='postgres'||Number(pool.options.port)!==5432)
  fail('CAR02_BOOKING_DISPOSABLE_ONLY');
}
export function createAtomicBookingQa({pool,environment,allowDisposableQa=false,env=process.env,now=()=>new Date()}={}){
 if(environment!=='disposable_qa'||allowDisposableQa!==true||typeof pool?.connect!=='function')fail('CAR02_BOOKING_ISOLATION_REQUIRED');
 qaEnvironment(pool,env);
 const isoDay=v=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
 const rowToResult=r=>Object.freeze({id:r.id,shopCode:r.shop_code,customerId:r.customer_id,vehicleId:r.vehicle_id,day:isoDay(r.day),time:String(r.begins_at).slice(0,5),requestKey:r.request_key,syntheticOnly:true});
 return Object.freeze({
  async create({actor,input}={}){
   if(!actor||actor.verified!==true||!['owner','staff'].includes(actor.role)||!['street_house_kitsuki','other_shop'].includes(actor.shopCode)||typeof actor.subject!=='string'||!actor.subject.startsWith('qa-'))fail('CAR02_BOOKING_SYNTHETIC_STAFF_REQUIRED');
   const p=validateAtomicBookingInput(input,{now:now()});
   const c=await pool.connect();let open=false;
   try{
    const db=(await c.query("SELECT current_database() AS db,current_setting('server_version_num')::integer AS version")).rows[0];
    if(db?.db!=='car02_qa'||db.version<170000||db.version>=180000)fail('CAR02_BOOKING_DISPOSABLE_ONLY');
    await c.query('BEGIN');open=true;
    await c.query("SET LOCAL lock_timeout='5s'");
    await c.query("SET LOCAL statement_timeout='12s'");
    const refs=(await c.query(`SELECT EXISTS(SELECT 1 FROM public.ksh_demo_shop_settings WHERE shop_code=$1) AS shop_ok,
      EXISTS(SELECT 1 FROM public.ksh_demo_customers WHERE id=$2::uuid AND shop_code=$1) AS customer_ok,
      EXISTS(SELECT 1 FROM public.ksh_demo_vehicles WHERE id=$3::uuid AND shop_code=$1 AND customer_id=$2::uuid) AS vehicle_ok`,
      [actor.shopCode,p.customerId,p.vehicleId])).rows[0];
    if(!refs?.shop_ok||!refs.customer_ok||!refs.vehicle_ok)fail('CAR02_BOOKING_REFERENCE_SCOPE_MISMATCH');
    const id=randomUUID();
    await c.query(`INSERT INTO public.ksh_demo_reservations(id,shop_code,customer_id,vehicle_id) VALUES ($1,$2,$3,$4)`,[id,actor.shopCode,p.customerId,p.vehicleId]);
    const inserted=(await c.query(`INSERT INTO car02_basic_qa.bookings(id,shop_code,customer_id,vehicle_id,day,begins_at,request_key)
      VALUES($1,$2,$3,$4,$5::date,$6::time,$7) ON CONFLICT DO NOTHING RETURNING id,shop_code,customer_id,vehicle_id,day,begins_at,request_key`,
      [id,actor.shopCode,p.customerId,p.vehicleId,p.day,p.time,p.requestKey])).rows[0];
    if(inserted){await c.query('COMMIT');open=false;return rowToResult(inserted)}
    // Losing a uniqueness race must not leave an orphan in ksh_demo_reservations.
    await c.query('ROLLBACK');open=false;
    const prior=(await c.query(`SELECT id,shop_code,customer_id,vehicle_id,day,begins_at,request_key FROM car02_basic_qa.bookings
      WHERE shop_code=$1 AND request_key=$2`,[actor.shopCode,p.requestKey])).rows[0];
    if(!prior)fail('CAR02_BOOKING_SLOT_OCCUPIED');
    if(prior.customer_id!==p.customerId||prior.vehicle_id!==p.vehicleId||
       isoDay(prior.day)!==p.day||String(prior.begins_at).slice(0,5)!==p.time)fail('CAR02_BOOKING_IDEMPOTENCY_CONFLICT');
    return rowToResult(prior);
   }catch(e){if(open)await c.query('ROLLBACK').catch(()=>{});throw e}
   finally{c.release()}
  }
 });
}
