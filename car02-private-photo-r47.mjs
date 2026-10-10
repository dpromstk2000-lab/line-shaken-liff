// DPRO CAR02 R47: private server-side photo upload, review/QA implementation.
// No public client API, no signed upload tickets, no browser-exposed service key.
// Requires upstream verified staff identity and R13 authorized reservation repository.
import { createHash, randomUUID } from 'node:crypto';

const MAX_BYTES = 5 * 1024 * 1024;
const BUCKET = 'ksh-car02-private-photos';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHOP = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const MIME_EXT = Object.freeze({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'});
const fail = (reason) => {throw new Error('CAR02_R47_'+reason)};
const isImage = (v, mime) => {
  if (mime === 'image/png') return v.length >= 8 && [137,80,78,71,13,10,26,10].every((b,i)=>v[i]===b);
  if (mime === 'image/webp') return v.length >= 12 && [82,73,70,70].every((b,i)=>v[i]===b) && [87,69,66,80].every((b,i)=>v[i+8]===b);
  if (mime === 'image/jpeg') return v.length>=4 && v[0]===255 && v[1]===216 && v[2]===255;
  return false;
};
const blobSha = (data) => createHash('sha256').update(data).digest('hex');
const capRead = async(response, cap) => {
  const reader = response.body?.getReader?.();
  if(!reader) fail('STORAGE_EMPTY_RESPONSE');
  const chunks=[]; let size=0;
  try {
    for(;;) {
      const {done,value} = await reader.read();
      if(done) break;
      size+=value?.byteLength||0;
      if(size>cap) fail('STORAGE_OVERSIZE');
      chunks.push(value);
    }
  } finally {reader.releaseLock()}
  const full = new Uint8Array(size);let n=0;
  for(const c of chunks){full.set(c,n);n+=c.length}
  return full;
};

export function createCar02PrivatePhotoR47({repository,baseUrl,serviceRoleKey,releaseEnabled,fetchImpl=fetch}={}) {
  if(typeof releaseEnabled!=='function') fail('RELEASE_GATE_REQUIRED');
  if(!repository||['reserve','markReady','cancel'].some(x=>typeof repository[x]!=='function')) fail('REPOSITORY_REQUIRED');
  if(typeof fetchImpl!=='function') fail('FETCH_REQUIRED');
  let origin;
  try {const u=new URL(baseUrl);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/'||!/^[-a-z0-9]+\.supabase\.co$/.test(u.hostname)) fail('BASE_URL_INVALID');origin=u.origin;}catch{fail('BASE_URL_INVALID')}
  if(typeof serviceRoleKey!=='string'||serviceRoleKey.trim()!==serviceRoleKey||serviceRoleKey.length<20||/[\r\n]/.test(serviceRoleKey))fail('SERVER_KEY_INVALID');
  const headers = {'apikey':serviceRoleKey,'Authorization':'Bearer '+serviceRoleKey};
  const objectBase=origin+'/storage/v1/object';
  const objUrl=(path)=>objectBase+'/'+BUCKET+'/'+path.split('/').map(encodeURIComponent).join('/');
  const safeRequest=async(url,options)=>{
    let r;
    try {r=await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(10000)})}catch{fail('STORAGE_UNAVAILABLE')}
    if(!r?.ok)fail('STORAGE_REJECTED');
    return r;
  };
  const checkBucket=async()=>{
    const r=await safeRequest(origin+'/storage/v1/bucket/'+BUCKET,{headers});
    let meta;try{meta=await r.json()}catch{fail('BUCKET_UNVERIFIED')}
    if(meta?.id!==BUCKET||meta.public!==false) fail('BUCKET_MUST_BE_PRIVATE');
  };
  const deleteObject=async(path)=>{
    try{await fetchImpl(objUrl(path),{method:'DELETE',headers,redirect:'error',signal:AbortSignal.timeout(10000)})}catch{}
  };
  return {
    async upload({actor,shop,orderId,reportId,mimeType,bytes}={}) {
      let released=false; try {released=await releaseEnabled()===true;}catch{}
      if(!released) fail('NOT_RELEASED');
      if(!actor||actor.verified!==true||actor.shopCode!==shop||!actor.subject||!['staff','owner'].includes(actor.role))fail('STAFF_REQUIRED');
      if(!SHOP.test(shop)||!UUID.test(orderId)||!UUID.test(reportId))fail('SCOPE_INVALID');
      if(!Object.hasOwn(MIME_EXT,mimeType))fail('MIME_REJECTED');
      if(!(bytes instanceof Uint8Array)||bytes.length<4||bytes.length>MAX_BYTES||!isImage(bytes,mimeType))fail('IMAGE_INVALID');
      const sha256=blobSha(bytes); const byteSize=bytes.length;
      // Storage bucket must be server-side and definitively private BEFORE reserving.
      await checkBucket();
      const path=`${shop}/${orderId}/${reportId}/${randomUUID()}.${MIME_EXT[mimeType]}`;
      const reserved=await repository.reserve({actor,shop,orderId,reportId,mimeType,byteSize,sha256,bucket:BUCKET,path});
      if(!reserved?.id||!UUID.test(reserved.id))fail('RESERVATION_FAILED');
      let uploadWasAccepted=false;
      try {
        await safeRequest(objUrl(path),{method:'POST',headers:{...headers,'Content-Type':mimeType,'x-upsert':'false','Cache-Control':'no-store'},body:bytes});
        uploadWasAccepted=true;
        const r=await safeRequest(objectBase+'/authenticated/'+BUCKET+'/'+path.split('/').map(encodeURIComponent).join('/'),{headers});
        const confirmed=await capRead(r,MAX_BYTES+1);
        if(confirmed.length!==byteSize||blobSha(confirmed)!==sha256||!isImage(confirmed,mimeType))fail('INTEGRITY_FAILED');
        await repository.markReady({actor,shop,photoId:reserved.id,expectedState:'pending'});
        return {photoId:reserved.id,state:'ready',mimeType,byteSize,sha256};
      }catch(error){
        if(uploadWasAccepted)await deleteObject(path);
        await repository.cancel({actor,shop,photoId:reserved.id}).catch(()=>{});
        throw error;
      }
    }
  };
}
