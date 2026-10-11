// DPRO CAR02 R93T: READ-ONLY gate audit, staging integration PRECI only.
// This file NEVER imports or invokes a production runtime, DB, Worker, LINE, or Storage.
// It detects missing upload wiring without pretending the isolated photo modules are live.
const FILES = Object.freeze({
 r47:'car02-private-photo-r47.mjs', r50:'car02-unified-runtime-r50.mjs',
 r51:'car02-edge-boundary-r51.mjs', r52:'car02-edge-entry-r52.ts',
 r82:'car02-private-photo-upload-http-r82.mjs',
 r93q:'car02-r93q-single-schema-lifecycle-isolated.mjs',
 r93s:'car02-r93s-durable-upload-intent-isolated.mjs'
});
const obj = (id,state,reason,fix) => Object.freeze({id,state,reason,fix});
export const R93T_APPROVED_BASELINE = Object.freeze({
 [FILES.r47]:'e0f3abec6bcf57830d9f3b72fe2eee099b1dff1d',
 [FILES.r50]:'76e4e8cae27599f27e3d887118148718c32ebb80',
 [FILES.r51]:'6614f2ed1933aa787576cb8074cb7d4bc704efa0',
 [FILES.r52]:'f0e31fb9f9d98524519d01dffd3489893d3d3302',
 [FILES.r82]:'78f8b0f80fcc1f89d15fd25e4593c660cd197ea3',
 [FILES.r93q]:'be1cd3feb78e26fb4759d9a86ecbd835d7ada144',
 [FILES.r93s]:'64e907008448264512594573cdcdcd8773c4c29d'
});
function mustFile(sources,key){
 const src=sources?.[FILES[key]];
 if(typeof src!=='string'||src.length<60)throw Error('R93T_MISSING_OR_SHORT_SOURCE_'+key);
 return src;
}
export function auditCar02R93TSourceContracts(sources){
 const r47=mustFile(sources,'r47'),r50=mustFile(sources,'r50'),r51=mustFile(sources,'r51'),
       r52=mustFile(sources,'r52'),r82=mustFile(sources,'r82'),
       r93q=mustFile(sources,'r93q'),r93s=mustFile(sources,'r93s');
 // Release-lock inspection is NOT the same as an authorization check.
 const lock=/\bconst\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/.test(r52)
   && /isServerReleased\s*:\s*\(\)\s*=>\s*!CAR02_RELEASE_LOCK/.test(r52);
 const checks=[
 obj('R52_HARD_RELEASE_LOCK',lock?'LOCKED':'UNSAFE','R52 release gate must remain hardcoded closed','Do not unlock without separate production acceptance'),
 obj('R50_UPLOAD_COMPOSITION', /createCar02PhotoUploadHttpR82|\/api\/car02\/uploads\//.test(r50)?'REVIEW_REQUIRED':'OPEN',
  'R50 routes the photo viewer but does not compose an upload handler','Add an explicitly scoped staging upload composition behind independent approval'),
 obj('R51_UPLOAD_ROUTE', /\/uploads|upload[_-]?path|UPLOAD_PATH/i.test(r51)?'REVIEW_REQUIRED':'OPEN',
  'R51 permits GET photo path but not the R82 uploads path','Define a distinct upload route with strict origin and verified staff identity'),
 obj('R51_BODY_CAP_CONFLICT', /\bMAX_BODY\s*=\s*32768\b/.test(r51)&&/\bMAX_BYTES\s*=\s*5\s*\*\s*1024\s*\*\s*1024/.test(r82)?'OPEN':'REVIEW_REQUIRED',
  'R51 limits POST to 32768 bytes while R82 accepts images up to 5MiB','Use route-specific streaming limits; keep business requests at 32KiB'),
 obj('R82_DURABLE_INTENT_KEY', /\bintentKey\b|\bIdempotency-Key\b/i.test(r82)?'REVIEW_REQUIRED':'OPEN',
  'R82 does not forward a stable idempotency key to R93S','Define authenticated request-key propagation, validation and retry policy'),
 obj('R47_DIRECT_STORAGE_DELETE', /\bawait\s+deleteObject\s*\(path\)/.test(r47)?'OPEN':'REVIEW_REQUIRED',
  'R47 still attempts direct DELETE and best-effort metadata cancel','Replace only after durable outbox and private Storage verification are integrated'),
 obj('R93Q_PROCESS_LOCAL_RECEIPTS', /\bconst\s+receipts\s*=\s*new Map\(/.test(r93q)?'OPEN':'REVIEW_REQUIRED',
  'R93Q ready/tombstone relies on a process-local receipt map','Use persistently bound intent/receipt lookup and re-auth on each transaction'),
 obj('R93S_ONLY_DISPOSABLE_QA',/\bconst\s+QA_DB\s*=\s*'car02_r93q_qa_ci'/.test(r93s)&&
  /environment\s*!==\s*'isolated_qa'/.test(r93s)?'ISOLATED_PASS':'REVIEW_REQUIRED',
  'R93S durable intent implementation is intentionally restricted to a disposable QA database',
  'Design a separately reviewed real-schema adapter only after backup and restore verification')
 ];
 const open=checks.filter(x=>x.state==='OPEN').map(x=>x.id);
 const unsafe=checks.filter(x=>x.state==='UNSAFE').map(x=>x.id);
 return Object.freeze({system:'DPRO_CAR02',step:'R93T_RELEASE_INTEGRATION_GAPS',
  sourceAuditOnly:true,mode:'read_only',integrationReady:false,releaseDecision:'NO_GO',migrationDecision:'HOLD',
  productionMutations:false,openCount:open.length,unsafeCount:unsafe.length,
  openGates:open,unsafeGates:unsafe,checks});
}
export const R93T_CONTRACT=Object.freeze({sourceAuditOnly:true,productionReady:false,
  deployAuthorized:false,databaseWriteAuthorized:false,releaseDecision:'NO_GO',migrationDecision:'HOLD'});
