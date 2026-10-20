/**
 * DPRO CAR02 V4.37 -- REVIEW-ONLY, SINGLE-USE TENANT CAS QA CANDIDATE.
 * DO NOT DEPLOY. This is NOT wired to R44/R46/R50/R52 or a live database.
 * The only permitted write is a synthetic work-order VERSION TOUCH to prove
 * tenant + ID + expectedVersion compare-and-swap; business workflows are NOT
 * implemented or authorized by this module.
 *
 * This addresses a review gap: V4.36 admits server-configured UPDATE strings
 * containing extra WHERE expressions. V4.37 never accepts SQL, operation names
 * or parameter factories from its caller -- even its server-side factory.
 *
 * NOT addressed: trusted Supabase provider session attestation, post-COMMIT
 * generation fence, production schema migration, transactional outbox and
 * COMMIT-outcome ambiguity. Release remains NO_GO/HOLD.
 */
export const CAR02_V437_RELEASE_LOCK = true;
export const CAR02_V437_TOUCH_SQL = 'UPDATE public.ksh_car02_work_orders SET state_version=state_version+1,updated_at=clock_timestamp() WHERE shop_code=$1 AND id=$2 AND state_version=$3 RETURNING id';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const deny=()=>{const e=new Error('CAR02_UNAUTHORIZED');e.code='CAR02_UNAUTHORIZED';e.status=401;throw e;};
const validShop=v=>typeof v==='string'&&v.length>0&&v.length<=256&&v.trim()===v;
const validId=v=>typeof v==='string'&&UUID.test(v);
const validVersion=v=>Number.isSafeInteger(v)&&v>=1&&v<2147483647;
function inputParts(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.getPrototypeOf(input)!==Object.prototype)deny();
  const names=Object.keys(input).sort();
  if(names.length!==2||names[0]!=='expectedVersion'||names[1]!=='id')deny();
  const id=input.id,version=input.expectedVersion;
  if(!validId(id)||!validVersion(version))deny();
  return {id,version};
}

/**
 * Only accepts an authority issued in the same server process (V4.35 contract),
 * and a pg-compatible pool. Caller never chooses SQL or business operation.
 * The row lock and CAS must execute on the SAME connection and transaction.
 */
export function createCar02TenantCasGateR437({authority,pool,nowMs=()=>Date.now(),maxAgeMs=15000}={}){
  if(CAR02_V437_RELEASE_LOCK!==true||!authority||typeof authority.authenticate!=='function'||
     typeof authority.assertMutation!=='function'||!pool||typeof pool.connect!=='function'||
     typeof nowMs!=='function'||!Number.isSafeInteger(maxAgeMs)||maxAgeMs<1||maxAgeMs>60000)
     throw Error('CAR02_V437_CONFIG_REQUIRED');
  const issuance=new WeakMap(),spent=new WeakSet();
  const fresh=a=>{const t=issuance.get(a),now=nowMs();return Number.isSafeInteger(t)&&Number.isSafeInteger(now)&&now>=t&&now-t<maxAgeMs;};
  async function authenticate(req){
    try{
      const actor=await authority.authenticate(req);
      const now=nowMs();
      if(!actor||typeof actor!=='object'||!Object.isFrozen(actor)||actor.verified!==true||
         !validShop(actor.shopCode)||!Number.isSafeInteger(now)||now<=0)deny();
      issuance.set(actor,now);
      return actor;
    }catch{deny()}
  }
  async function touch({actor,shopCode,input}={}){
    if(!actor||typeof actor!=='object'||!issuance.has(actor)||spent.has(actor)||
       !validShop(shopCode)||actor.shopCode!==shopCode||!fresh(actor))deny();
    const {id,version}=inputParts(input);
    spent.add(actor); // before first await: replay and concurrent reuse rejected
    let client,started=false;
    try{
      client=await pool.connect();
      if(!client||typeof client.query!=='function'||typeof client.release!=='function')deny();
      await client.query('BEGIN');started=true;
      await client.query("SET LOCAL lock_timeout = '2s'");
      await client.query("SET LOCAL statement_timeout = '15s'");
      await authority.assertMutation({transactionClient:client,actor,shopCode});
      if(!fresh(actor))deny();
      const r=await client.query(CAR02_V437_TOUCH_SQL,[shopCode,id,version]);
      if(r?.rowCount!==1||r?.rows?.length!==1||r.rows[0]?.id!==id||!fresh(actor))deny();
      await client.query('COMMIT');started=false;
      return Object.freeze({ok:true,kind:'REVIEW_ONLY_CAS_TOUCH',id});
    }catch{
      if(started&&client?.query){try{await client.query('ROLLBACK')}catch{/* fail closed */}}
      deny();
    }finally{if(client?.release){try{client.release()}catch{/* cleanup best effort */}}}
  }
  return Object.freeze({authenticate,touch});
}
