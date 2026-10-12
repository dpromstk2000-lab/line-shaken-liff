// DPRO CAR02 R106: version-bound delete candidate, disposable PG17 + in-process store only.
// No real Supabase Storage support is presumed. DO NOT deploy or apply SQL to production.
import assert from 'node:assert/strict';
import {createR105GenerationLease} from './car02-r105-generation-lease-isolated.mjs';
const DB='car02_r93q_qa_ci';
const S='car02_r93q_qa';
const BUCKET='ksh-car02-private-photos';
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const PATH=/^[a-z0-9][a-z0-9_-]{1,63}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(jpg|png|webp)$/i;
const VERSION=/^v[0-9]{3,9}$/;
const HASH=/^[0-9a-f]{64}$/;
const deny=c=>{throw Object.assign(new Error(c),{code:c})};
export const R106_CONTRACT=Object.freeze({mode:'isolated_qa',db:DB,storage:'in_process_only',
 conditionalDeleteCandidate:true,realStorageCapabilityVerified:false,productionReady:false,
 releaseDecision:'NO_GO',migrationDecision:'HOLD',productionDeployAllowed:false});
export function assertR106Env(env){
 const required={R106_DISPOSABLE_VERSION_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',
  PGUSER:'postgres',PGPASSWORD:'disposable-r93s-ci-only',PGDATABASE:DB};
 for(const [key,value] of Object.entries(required))assert.equal(env?.[key],value,'R106_ENV_'+key);
}
export function assertR106Pin(row,shop){
 assert.ok(row&&SHOP.test(shop),'R106_BAD_SHOP');
 assert.equal(row.shop_code,shop,'R106_FOREIGN_SHOP');
 assert.equal(row.photo_shop,shop,'R106_FOREIGN_PHOTO');
 assert.equal(row.intent_shop,shop,'R106_FOREIGN_INTENT');
 assert.equal(row.job_shop,shop,'R106_FOREIGN_JOB');
 assert.equal(row.upload_state,'deleted','R106_READY_DELETE_DENIED');
 assert.equal(row.job_state,'queued','R106_JOB_NOT_QUEUED');
 assert.ok(UUID.test(row.job_id||'')&&UUID.test(row.photo_id||''),'R106_BAD_IDS');
 assert.ok(PATH.test(row.storage_path||'')&&row.storage_path.startsWith(shop+'/'),'R106_BAD_PATH');
 assert.equal(row.storage_path,row.photo_path,'R106_PHOTO_PATH_MISMATCH');
 assert.equal(row.storage_path,row.intent_path,'R106_INTENT_PATH_MISMATCH');
 assert.equal(row.storage_path,row.job_path,'R106_JOB_PATH_MISMATCH');
 assert.equal(row.sha256,row.photo_sha,'R106_SHA_DB_MISMATCH');
 assert.ok(HASH.test(row.sha256||''),'R106_BAD_SHA');
 assert.ok(VERSION.test(row.object_version||''),'R106_BAD_OBJECT_VERSION');
 assert.equal(row.bucket,BUCKET,'R106_NONPRIVATE_BUCKET');
 assert.equal(row.photo_bucket,BUCKET,'R106_PHOTO_BUCKET_MISMATCH');
 return true;
}
export function createR106MockVersionedPrivateStore({objects=[],ackLostPaths=[],beforeConditionalDelete}={}){
 if(!Array.isArray(objects)||!Array.isArray(ackLostPaths)||
   typeof beforeConditionalDelete!=='undefined'&&typeof beforeConditionalDelete!=='function')deny('R106_BAD_FIXTURE');
 const map=new Map(),lost=new Set(ackLostPaths),calls=[];
 for(const obj of objects){
  if(!obj||!PATH.test(obj.path||'')||!VERSION.test(obj.version||'')||!HASH.test(obj.sha256||'')||map.has(obj.path))deny('R106_BAD_FIXTURE_OBJECT');
  map.set(obj.path,{version:obj.version,sha256:obj.sha256});
 }
 if(ackLostPaths.some(p=>!PATH.test(p)))deny('R106_BAD_LOST_PATH');
 const check=(bucket,path)=>{if(bucket!==BUCKET||!PATH.test(path||''))deny('R106_DELETE_SCOPE_DENIED')};
 const replace=(path,version,sha256)=>{if(!PATH.test(path)||!VERSION.test(version)||!HASH.test(sha256))deny('R106_BAD_REPLACEMENT');map.set(path,{version,sha256})};
 return Object.freeze({kind:'r106_in_process_conditional_private',testOnly:true,transport:'no_network',
  get deleteCalls(){return calls.length},get calls(){return calls.slice()},replace,
  async verifyPrivateBucket({bucket}){if(bucket!==BUCKET)deny('R106_BUCKET_DENIED');return {id:BUCKET,public:false}},
  async head({bucket,path}){check(bucket,path);const x=map.get(path);return x?{exists:true,...x}:{exists:false,definitivelyMissing:true}},
  async deleteIfMatch({bucket,path,version,sha256}){
   check(bucket,path);
   if(!VERSION.test(version||'')||!HASH.test(sha256||''))deny('R106_INVALID_DELETE_CONDITION');
   calls.push({path,version,sha256});
   if(beforeConditionalDelete)await beforeConditionalDelete({path,replace});
   const x=map.get(path);
   if(!x)return {deleted:false,definitivelyMissing:true};
   if(x.version!==version||x.sha256!==sha256)return {deleted:false,preconditionFailed:true};
   map.delete(path);
   if(lost.delete(path))deny('R106_SIMULATED_ACK_LOST');
   return {deleted:true,definitivelyMissing:false};
  }
 });
}
export function createR106VersionBoundCleanup({environment,dbName,pool,shopCode,storage,reviewGate}={}){
 if(environment!=='isolated_qa'||dbName!==DB||!SHOP.test(shopCode||'')||
  typeof pool?.connect!=='function'||typeof pool?.query!=='function'||typeof reviewGate!=='function'||
  storage?.kind!=='r106_in_process_conditional_private'||storage.testOnly!==true||
  storage.transport!=='no_network'||typeof storage.head!=='function'||
  typeof storage.deleteIfMatch!=='function'||typeof storage.verifyPrivateBucket!=='function')
  deny('R106_DISPOSABLE_DEPS_REQUIRED');
 const leases=createR105GenerationLease({environment,dbName,pool,shopCode,reviewGate});
 async function pinned(jobId){
  const {rows}=await pool.query(`SELECT x.job_id,x.shop_code,x.photo_id,x.storage_path,x.sha256,x.object_version,x.bucket,
   p.shop_code AS photo_shop,p.storage_path AS photo_path,p.sha256 AS photo_sha,p.storage_bucket AS photo_bucket,p.upload_state,
   j.shop_code AS job_shop,j.storage_path AS job_path,j.state AS job_state,
   i.shop_code AS intent_shop,i.storage_path AS intent_path
   FROM ${S}.r106_object_pins x JOIN ${S}.cleanup_jobs j ON j.job_id=x.job_id AND j.photo_id=x.photo_id
   JOIN ${S}.photos p ON p.id=x.photo_id AND p.shop_code=x.shop_code
   JOIN ${S}.upload_intents i ON i.photo_id=p.id AND i.shop_code=p.shop_code
   WHERE x.job_id=$1 AND x.shop_code=$2`,[jobId,shopCode]);
  assert.equal(rows.length,1,'R106_PIN_MISSING');assertR106Pin(rows[0],shopCode);
  return rows[0];
 }
 async function run(jobId){
  if(!UUID.test(jobId||''))deny('R106_BAD_JOB');
  // Gate must fail before any database or Storage operation, including pin reads.
  let granted=false;try{granted=(await reviewGate())===true}catch{}
  if(!granted)deny('R106_GATE_LOCKED');
  const info=await pinned(jobId); // no Storage calls before scoped database proof
  const bucket=await storage.verifyPrivateBucket({bucket:BUCKET});
  if(bucket?.id!==BUCKET||bucket.public!==false)deny('R106_BUCKET_NOT_PRIVATE');
  const claim=await leases.claim(jobId);
  if(claim.status!=='claimed')return Object.freeze({status:claim.status});
  if(claim.storagePath!==info.storage_path)deny('R106_CLAIM_PATH_DRIFT');
  let attemptedDelete=false, evidence;
  try{
   const before=await storage.head({bucket:BUCKET,path:info.storage_path});
   if(before.definitivelyMissing===true&&before.exists===false){
    evidence={deleted:false,definitivelyMissing:true};
   }else{
    if(before.exists!==true||before.version!==info.object_version||before.sha256!==info.sha256)deny('R106_OBJECT_REPLACED_OR_UNVERIFIED');
    attemptedDelete=true;
    evidence=await storage.deleteIfMatch({bucket:BUCKET,path:info.storage_path,
     version:info.object_version,sha256:info.sha256});
    if(evidence.preconditionFailed===true)deny('R106_ATOMIC_PRECONDITION_FAILED');
    if(!((evidence.deleted===true&&evidence.definitivelyMissing===false)||
      (evidence.deleted===false&&evidence.definitivelyMissing===true)))deny('R106_AMBIGUOUS_DELETE');
   }
  }catch(e){
   await leases.settle(claim,'retry');
   throw e;
  }
  // Completion requires fresh R105 generation/lease proof; no stale worker can mark done.
  await leases.settle(claim,'done',{kind:'r105_in_process_private_storage',testOnly:true,
   storagePath:info.storage_path,privateBucket:true,
   deleted:evidence.deleted===true,definitivelyMissing:evidence.definitivelyMissing===true});
  return Object.freeze({status:'done',deleted:attemptedDelete&&evidence.deleted===true,
   alreadyMissing:evidence.definitivelyMissing===true,generation:claim.generation});
 }
 return Object.freeze({run});
}
