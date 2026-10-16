/** CAR02 V2.3: fail-closed booking lifecycle preview for legacy /wangan and /ksh.
 * SYNTHETIC QA ONLY. Do not send HTTP, mutate DB, authenticate people or deploy.
 * Browser rows and memo progress markers are never an authorization source.
 * DB schema audit can find absent status/version fields but cannot prove release readiness.
 */
export const LIFECYCLE_MODE=Object.freeze({environment:'isolated_qa',readOnly:true,realAuth:false,
  sendable:false,productionReady:false,release:'NO_GO',migration:'HOLD'});
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const ALLOWED_BRANCHES=new Set(['wangan','ksh']);
const TERMINAL=new Set(['作業完了','キャンセル','キャンセル済み','削除済み','引渡し完了','cancelled','canceled','deleted']);
const ACTIVE=new Set(['仮入庫','入庫予定','確定入庫','確認待ち','入庫済み','受付・入庫済み','作業中',
  '点検中','見積作成中','お客様確認待ち','最終確認','引渡し可能']);
const MEMO_STAGES=new Set(['仮入庫','入庫予定','受付・入庫済み','点検中','見積作成中','お客様確認待ち',
  '作業中','最終確認','引渡し可能','引渡し完了','キャンセル']);
const plain=o=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&Object.getPrototypeOf(o)===Object.prototype;
const fail=code=>{throw Object.assign(new Error(code),{code})};
const isoDate=s=>{if(typeof s!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s))return false;
  let d=new Date(s+'T00:00:00.000Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s};
const timeOk=s=>typeof s==='string'&&/^([01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9])?$/.test(s);
/** Capture only the presence of a status marker, not memo content. A forged or
 * conflicting marker must fail closed. The entire memo is never returned. */
function memoStage(memo){
 if(memo==null||memo==='')return {stage:null,invalid:false};
 if(typeof memo!=='string'||memo.length>5000)return {stage:null,invalid:true};
 const hits=[...memo.matchAll(/^【進捗：([^】\r\n]{1,50})】/gm)].map(m=>m[1]);
 if(!hits.length)return {stage:null,invalid:false};
 if(hits.length!==1||!MEMO_STAGES.has(hits[0]))return {stage:null,invalid:true};
 return {stage:hits[0],invalid:false};
}
/** UI hint only. No network and no trusted identity. Must NEVER be used to permit
 * an order creation. Even a positive candidate needs server verification in a
 * transaction that checks current booking lifecycle and case uniqueness. */
export function reviewLegacyBookingLifecyclePreview({branch,row}={}){
 if(!ALLOWED_BRANCHES.has(branch)||!plain(row))fail('CAR02_LIFECYCLE_PREVIEW_INPUT_DENIED');
 const blockers=[];
 const id=typeof row.id==='string'&&UUID.test(row.id)?row.id.toLowerCase():null;
 if(!id)blockers.push('UUID_NOT_VERIFIED');
 if(!isoDate(row.reservation_date)||!timeOk(row.reservation_time))blockers.push('LEGACY_BOOKING_TIME_UNVERIFIED');
 const status=typeof row.status==='string'&&row.status.length<=50?row.status.trim():'';
 if(TERMINAL.has(status))blockers.push('LEGACY_BOOKING_TERMINAL');
 else if(!ACTIVE.has(status))blockers.push('LEGACY_BOOKING_STATUS_UNRECOGNIZED');
 const marker=memoStage(row.memo);
 if(marker.invalid)blockers.push('LEGACY_PROGRESS_MARKER_AMBIGUOUS');
 if(marker.stage==='キャンセル'||marker.stage==='引渡し完了')blockers.push('LEGACY_PROGRESS_MARKER_TERMINAL');
 // Discrepant legacy base state and derived progress must be adjudicated by the server.
 // No browser-display status can grant booking/case permissions.
 return Object.freeze({branch,reservationId:id,status:ACTIVE.has(status)||TERMINAL.has(status)?status:'要確認',
  progressHint:marker.stage,candidate:!blockers.length,blockers:Object.freeze(blockers),
  requiresServerLifecycleCheck:true,requiresAtomicUniquenessCheck:true,
  verified:false,sendable:false,readOnly:true,release:'NO_GO',migration:'HOLD'});
}
const REQUIRED=Object.freeze(['status','version','reservation_date','reservation_time']);
/** Audit only column names from disposable R13; no SQL here, no schema mutation.
 * A green column audit is NOT a proof of protected server lifecycle transactions. */
export function auditCar02R13BookingLifecycleSchema(columns){
 if(!Array.isArray(columns)||columns.length>100||columns.some(x=>typeof x!=='string'||!/^[_a-z][_a-z0-9]{0,62}$/.test(x)))
   fail('CAR02_LIFECYCLE_SCHEMA_COLUMNS_INVALID');
 const available=new Set(columns);
 const absent=REQUIRED.filter(x=>!available.has(x));
 return Object.freeze({required:REQUIRED,missing:Object.freeze(absent),
  schemaSupportsLifecycle:absent.length===0,ready:false,sendable:false,
  blockers:Object.freeze([...absent.map(s=>'DB_COLUMN_MISSING_'+s.toUpperCase()),
   'ATOMIC_SERVER_BOOKING_LIFECYCLE_CHECK_NOT_PROVEN',
   'CASE_UNIQUENESS_AND_REAL_AUTH_NOT_PROVEN',
   'R52_PRODUCTION_RELEASE_LOCK_CLOSED']),release:'NO_GO',migration:'HOLD'});
}
