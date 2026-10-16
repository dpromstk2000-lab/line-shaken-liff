/** DPRO CAR02 V2.6 — source-only release gap register, never a release authority.
 * No HTTP, DB, LINE, secrets, Worker invocation, deployment or writes.
 * All results are evidence of STATIC SOURCE STATE ONLY, NOT live verification.
 */
export const V26_MODE=Object.freeze({mode:'read_only_source_gate',productionReady:false,
  release:'NO_GO',migration:'HOLD',realAuthVerified:false,liveSystemChecked:false,
  realBookingToOrderConnected:false,sendable:false});
export const V26_SOURCE_FILES=Object.freeze([
 'dashboard.html','owner-ipad.html','index.html','member.html',
 'car02-edge-entry-r52.ts','car02-identity-r44.mjs','car02-runtime-r45.mjs',
 'car02-v25-concurrent-qa-claim-isolated.mjs',
 'BASELINE_QA_ONLY.sql','R13_MIGRATION_QA_ONLY.sql']);
const isPlain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const fail=x=>{throw Object.assign(new Error(x),{code:x});};
const closedStatus=Object.freeze(['RELEASE_LOCK_CLOSED','LIVE_STAFF_AUTH_NOT_PROVEN',
 'WANGAN_KSH_TO_R13_MAPPING_NOT_PROVEN','LIVE_RESERVATION_STATUS_VERSION_NOT_PROVEN',
 'REAL_ORDER_CREATION_ATOMICITY_NOT_PROVEN','R13_MIGRATION_NOT_VERIFIED',
 'STORAGE_AND_NOTIFICATIONS_NOT_VERIFIED','BACKUP_AND_CREDENTIAL_ROTATION_NOT_VERIFIED']);
export const V26_LIVE_GAPS=closedStatus;
const bookingTable=/CREATE\s+TABLE\s+public\.ksh_demo_reservations\s*\(([^;]*?)\);/i;
const branch=/\bconst\s+WORKER_API_BASE\s*=\s*CONTROL_ADAPTER_BASE\s*\+\s*["']\/(wangan|ksh)["']\s*;/g;
const CHECKS=Object.freeze([
 ['R52_SOURCE_LOCKED','car02-edge-entry-r52.ts',s=>/\bconst\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/.test(s)&&s.includes("throw Error('CAR02_NOT_RELEASED')")],
 ['R44_CALLBACKS_REQUIRED','car02-identity-r44.mjs',s=>s.includes('createCar02Authenticator')&&s.includes('verifyStaffJwt')&&s.includes('verifyLineIdToken')&&s.includes('resolveStaffAccess')&&s.includes('createCar02ReleaseGate')],
 ['R45_RUNTIME_DISPOSABLE_ONLY','car02-runtime-r45.mjs',s=>s.includes('QA ONLY')&&s.includes('Not a Cloudflare Worker bundle')&&s.includes('createCar02ReleaseGate')],
 ['V25_CLAIMS_ARE_SYNTHETIC_ONLY','car02-v25-concurrent-qa-claim-isolated.mjs',s=>s.includes('realOrderWrite:false')&&s.includes('car02_v25_qa_claims')&&s.includes('safeToCreateRealOrder:false')],
 ['R13_MIGRATION_REMAINS_HOLD','R13_MIGRATION_QA_ONLY.sql',s=>s.includes('HOLD / NOT EXECUTED')&&s.includes('DO NOT RUN WITHOUT VERIFIED RECOVERABLE BACKUP')],
 ['R13_QA_RESERVATION_STATUS_GAP','BASELINE_QA_ONLY.sql',s=>{const match=s.match(bookingTable);return match&&/\bid\s+uuid\b/i.test(match[1])&&/\bshop_code\s+text\b/i.test(match[1])&&!/\b(?:status|version|reservation_date|reservation_time)\s+/i.test(match[1])}],
]);
export function auditCar02V26ReleaseReadiness(sources){
 if(!isPlain(sources))fail('CAR02_V26_SOURCES_REQUIRED');
 const checked=[];
 for(const file of V26_SOURCE_FILES){if(typeof sources[file]!=='string'||sources[file].length<60)
   fail('CAR02_V26_SOURCE_MISSING_'+file.replace(/[^a-z0-9]/gi,'_').toUpperCase());}
 const expected=Object.freeze({'dashboard.html':'wangan','owner-ipad.html':'ksh','index.html':'ksh','member.html':'ksh'});
 for(const [file,required] of Object.entries(expected)){
   const found=[...sources[file].matchAll(branch)].map(x=>x[1]);
   if(found.length!==1||found[0]!==required)
     fail('CAR02_V26_LEGACY_BRANCH_DRIFT_'+file.replace(/[^a-z0-9]/gi,'_').toUpperCase());
   checked.push(Object.freeze({id:'LEGACY_BRANCH_'+file.replace('.html','').replace('-','_').toUpperCase(),status:'STATIC_PASS'}));
 }
 for(const [id,path,test] of CHECKS){if(!test(sources[path]))fail('CAR02_V26_STATIC_CONTRACT_DRIFT_'+id);
   checked.push(Object.freeze({id,status:'STATIC_PASS'}));}
 const blockers=closedStatus.map(id=>Object.freeze({id,status:'NOT_PROVEN_OR_HOLD'}));
 return Object.freeze({service:'CAR02_V26_RELEASE_READINESS',checks:Object.freeze(checked),
   staticChecksPassed:checked.length,staticChecksTotal:10,
   blockers:Object.freeze(blockers),blockerCount:blockers.length,
   sourceSafe:true,releaseReady:false,realServicesChecked:false,
   liveTenantIdentityMappingVerified:false,
   r13QaFixtureHasLifecycleColumns:false,
   production:'NO_GO',migration:'HOLD',sendable:false,
   statement:'Static evidence passes. Live integration, authorization, transaction and operator gates remain UNPROVEN.'});
}
