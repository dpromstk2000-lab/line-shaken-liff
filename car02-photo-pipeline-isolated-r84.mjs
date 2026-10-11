// DPRO CAR02 R84 — disposable QA-only R82 -> R47 -> R83 photo upload composition.
// NEVER import into R50 / R52, CAR02 production, Cloudflare Worker, or Supabase Edge.
// Hard-coded QA-only fake-storage host / fake key; no implicit network fallback. No live Storage URL or secrets.
// A database name matching the R83 disposable PostgreSQL naming convention is
// mandatory BEFORE any mock Storage request; R83 separately checks inside every tx.
import {createCar02PhotoUploadHttpR82} from './car02-private-photo-upload-http-r82.mjs';
import {createCar02PrivatePhotoR47} from './car02-private-photo-r47.mjs';
import {createCar02PgPhotoRepositoryR83} from './car02-pg-photo-repository-r83.mjs';

const FAKE_STORAGE='https://car02-r84-simulated.supabase.co';
const FAKE_KEY='CAR02_R84_FAKE_STORAGE_CREDENTIAL_ONLY';
const QA_DB=/^car02_r83_qa_[a-z0-9_]{1,48}$/;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const fail=()=>{throw Error('CAR02_R84_ISOLATED_DEPENDENCIES_REQUIRED')};

export function createCar02PhotoPipelineIsolatedR84({
  pool,shopCode,allowedOrigins,authenticate,reviewGate,storageFetch
}={}){
  if(!pool||typeof pool.connect!=='function'||typeof pool.query!=='function'||
     typeof shopCode!=='string'||!SHOP.test(shopCode)||
     typeof authenticate!=='function'||typeof reviewGate!=='function'||
     typeof storageFetch!=='function')fail();
  // This is strictly a QA signal. A live release gate is NOT accepted as an input.
  const isolatedEnabled=async()=>{
    try{
      if(await reviewGate()!==true)return false;
      const r=await pool.query('SELECT current_database() AS name');
      return r?.rows?.length===1&&typeof r.rows[0]?.name==='string'&&QA_DB.test(r.rows[0].name);
    }catch{return false}
  };
  const fakeFetch=async(url,options)=>{
    if(await isolatedEnabled()!==true)throw Error('CAR02_R84_ISOLATION_REQUIRED');
    let u;try{u=new URL(url)}catch{throw Error('CAR02_R84_FAKE_HOST_ONLY')}
    if(u.origin!==FAKE_STORAGE||!u.pathname.startsWith('/storage/v1/')||
       !['GET','POST','DELETE'].includes(options?.method||'GET'))
      throw Error('CAR02_R84_FAKE_HOST_ONLY');
    // Never fall through to global fetch. The caller MUST supply an in-process stub.
    return storageFetch(url,options);
  };
  const repository=createCar02PgPhotoRepositoryR83({
    pool,shopCode,releaseEnabled:isolatedEnabled,maxPhotos:3
  });
  const uploader=createCar02PrivatePhotoR47({
    repository,baseUrl:FAKE_STORAGE,serviceRoleKey:FAKE_KEY,
    releaseEnabled:isolatedEnabled,fetchImpl:fakeFetch
  });
  const route=createCar02PhotoUploadHttpR82({
    shopCode,allowedOrigins,authenticate,uploadService:uploader,
    releaseEnabled:isolatedEnabled
  });
  return Object.freeze({handle:route});
}
