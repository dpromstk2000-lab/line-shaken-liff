/**
 * DPRO CAR02 V4.38 — ISOLATED idempotent synthetic CAS + uncertain-COMMIT receipt candidate.
 * REVIEW ONLY / NEVER DEPLOY. No existing R44/R46/R50/R52 wiring or production schema.
 * The SQL below calls a QA-only function that is NOT authorized for public execution.
 * Its only mutation is a synthetic version increment, not an actual business operation.
 *
 * Safety properties under test:
 * - one-use trusted same-process staff actor, role/generation checked by V4.35;
 * - transaction-scoped staff membership lock before atomic idempotent write;
 * - tenant, object, expected version, and key all bound parameters;
 * - COMMIT transport failure never means rolled back; reconcile from fresh connection;
 * - missing/ambiguous receipt => indeterminate; NEVER silently retry with a new key.
 *
 * NOT solved: real Supabase session attestation and trusted post-COMMIT generation fence,
 * R13 production schema migration, durable session idempotency for unrelated operations,
 * external messaging/outbox integration, unknown real-world side-effect outcomes.
 */
export const CAR02_V438_RELEASE_LOCK = true;
export const CAR02_V438_MUTATE_SQL =
  'SELECT public.v438_qa_apply_touch($1::text,$2::uuid,$3::uuid,$4::uuid,$5::integer) AS receipt';
export const CAR02_V438_RECEIPT_SQL =
  'SELECT shop_code,actor_sub,request_key,order_id,expected_version,new_version FROM public.v438_qa_receipts WHERE shop_code=$1 AND actor_sub=$2 AND request_key=$3';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid=x=>typeof x==='string'&&UUID.test(x);
const shopOK=x=>typeof x==='string'&&x.length>0&&x.length<=256&&x.trim()===x;
const validVersion=x=>Number.isSafeInteger(x)&&x>0&&x<2147483647;
const deny=()=>{const e=new Error('CAR02_UNAUTHORIZED');e.code='CAR02_UNAUTHORIZED';e.status=401;throw e;};
function exactInput(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.getPrototypeOf(input)!==Object.prototype)deny();
 const names=Object.keys(input).sort();
 if(names.join(',')!=='expectedVersion,id,requestKey')deny();
 if(!isUuid(input.id)||!isUuid(input.requestKey)||!validVersion(input.expectedVersion))deny();
 return {id:input.id,requestKey:input.requestKey,expectedVersion:input.expectedVersion};
}
function matchesReceipt(receipt,{shopCode,actor,id,requestKey,expectedVersion},replayed){
 return receipt&&typeof receipt==='object'&&receipt.shopCode===shopCode&&
   receipt.actorSub===actor.userSub&&receipt.requestKey===requestKey&&receipt.id===id&&
   receipt.expectedVersion===expectedVersion&&receipt.newVersion===expectedVersion+1&&
   (replayed===undefined||receipt.replayed===replayed);
}
function matchesDurableReceipt(row,{shopCode,actor,id,requestKey,expectedVersion}){
 return row&&row.shop_code===shopCode&&row.actor_sub===actor.userSub&&
   row.request_key===requestKey&&row.order_id===id&&
   Number(row.expected_version)===expectedVersion&&Number(row.new_version)===expectedVersion+1;
}
/** `authority` is the isolated V4.35 authority factory; `pool` must be server-owned. */
export function createCar02IdempotentTouchR438({authority,pool,nowMs=()=>Date.now(),maxAgeMs=15000}={}){
 if(CAR02_V438_RELEASE_LOCK!==true||!authority||typeof authority.authenticate!=='function'||
    typeof authority.assertMutation!=='function'||!pool||typeof pool.connect!=='function'||
    typeof nowMs!=='function'||!Number.isSafeInteger(maxAgeMs)||maxAgeMs<1||maxAgeMs>60000)
   throw Error('CAR02_V438_CONFIG_REQUIRED');
 const issued=new WeakMap(),consumed=new WeakSet();
 const fresh=actor=>{const t=issued.get(actor),now=nowMs();return Number.isSafeInteger(t)&&Number.isSafeInteger(now)&&now>=t&&now-t<maxAgeMs;};
 async function authenticate(req){
   try{
     const actor=await authority.authenticate(req),now=nowMs();
     if(!actor||typeof actor!=='object'||!Object.isFrozen(actor)||actor.verified!==true||
        !isUuid(actor.userSub)||!shopOK(actor.shopCode)||!Number.isSafeInteger(now)||now<=0)deny();
     issued.set(actor,now);return actor;
   }catch{deny();}
 }
 async function reconcile(scope){
   let verifyClient;
   try{
     verifyClient=await pool.connect();
     if(!verifyClient||typeof verifyClient.query!=='function'||typeof verifyClient.release!=='function')return false;
     const found=await verifyClient.query(CAR02_V438_RECEIPT_SQL,[scope.shopCode,scope.actor.userSub,scope.requestKey]);
     if(found?.rows?.length!==1)return false;
     return matchesDurableReceipt(found.rows[0],scope);
   }catch{return false}
   finally{if(verifyClient?.release)try{verifyClient.release()}catch{ /* discard unavailable */ }}
 }
 async function touch({actor,shopCode,input}={}){
   if(!actor||typeof actor!=='object'||!issued.has(actor)||consumed.has(actor)||
      !shopOK(shopCode)||actor.shopCode!==shopCode||!fresh(actor))deny();
   const values=exactInput(input);consumed.add(actor); // before first await, no replay of this actor
   const scope={...values,actor,shopCode};
   let client,started=false,commitAttempted=false,commitUncertain=false,receipt;
   try{
     client=await pool.connect();
     if(!client||typeof client.query!=='function'||typeof client.release!=='function')deny();
     await client.query('BEGIN');started=true;
     await client.query("SET LOCAL lock_timeout = '2s'");
     await client.query("SET LOCAL statement_timeout = '15s'");
     await authority.assertMutation({transactionClient:client,actor,shopCode});
     if(!fresh(actor))deny();
     const out=await client.query(CAR02_V438_MUTATE_SQL,[shopCode,actor.userSub,values.requestKey,values.id,values.expectedVersion]);
     receipt=out?.rows?.length===1?out.rows[0].receipt:null;
     if(!matchesReceipt(receipt,scope)||typeof receipt.replayed!=='boolean'||!fresh(actor))deny();
     commitAttempted=true;
     try{await client.query('COMMIT');started=false;}
     catch{commitUncertain=true;started=false;}
   }catch{
     if(started&&!commitAttempted&&client?.query)try{await client.query('ROLLBACK')}catch{ /* no success assumed */ }
     deny();
   }finally{
     if(client?.release)try{client.release(commitUncertain?new Error('CAR02_DISCARD_UNCERTAIN_TX'):undefined)}catch{ /* best effort */ }
   }
   if(!commitUncertain)return Object.freeze({status:'committed',reconciled:false,replayed:receipt.replayed,requestKey:values.requestKey});
   // Never mistake a COMMIT transport exception for an actual database rollback.
   // A missing receipt is NOT evidence that the transaction did not commit.
   const confirmed=await reconcile(scope);
   return Object.freeze(confirmed?
     {status:'committed',reconciled:true,replayed:receipt.replayed,requestKey:values.requestKey}:
     {status:'indeterminate',reconciled:false,requestKey:values.requestKey});
 }
 return Object.freeze({authenticate,touch});
}
