// DPRO CAR02 R108 — storage deletion transition candidate / OFFLINE REVIEW ONLY.
// NO network, Supabase SDK, secret, live Storage DELETE, production SQL or deployment.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {R107_BLOCKERS} from './car02-r107-storage-compatibility-gate.mjs';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const SHA=/^[a-f0-9]{64}$/;
const PATH=/^([a-z0-9][a-z0-9_-]{1,63})\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.(jpg|png|webp)$/i;
const REQUIRED=Object.freeze([
 'providerOperationEvidence','separateStagingProject','privateBucketAndNoPublicRead',
 'allWriterIdentitiesAudited','overwriteDeniedEvenForPrivilegedWriters',
 'durableNeverReuseReservation','tenantBoundRecoveryAndDelete','concurrencyAndAckLossTest',
 'independentSecurityApproval']);
const ALLOWED=new Set(['UNVERIFIED','PASS_WITH_EVIDENCE','FAILED']);
const denied=(reason)=>{throw Object.assign(new Error(reason),{code:reason});};
export const R108_CONTRACT=Object.freeze({system:'CAR02',mode:'isolated_source_only',
  liveProviderVerified:false,productionReady:false,productionDeleteAuthorized:false,
  migrationAuthorized:false,releaseDecision:'NO_GO',migrationDecision:'HOLD',
  candidateDeleteMode:'QUARANTINE_ONLY',noNetwork:true,productionSourcesUnchanged:true});
const plain=(v)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
function keysExactly(v,keys){return plain(v)&&Object.keys(v).sort().join('|')===keys.slice().sort().join('|');}
export function assessR108StagingEvidence(evidence){
 if(!keysExactly(evidence,['schema','version','checks'])||evidence.schema!=='DPRO_CAR02_R108_STAGING_PROOF'||
    evidence.version!==1||!keysExactly(evidence.checks,REQUIRED)||
    REQUIRED.some(k=>!ALLOWED.has(evidence.checks[k])))denied('R108_PROOF_SCHEMA_DENIED');
 // Only status labels are accepted. Credentials, private IDs, links and copied
 // customer data cannot be serialized as evidence inside GitHub Actions.
 const pending=REQUIRED.filter(k=>evidence.checks[k]!=='PASS_WITH_EVIDENCE');
 const rejected=REQUIRED.filter(k=>evidence.checks[k]==='FAILED');
 return Object.freeze({schema:'DPRO_CAR02_R108_STAGING_GATE_REPORT',
  checkCount:REQUIRED.length,claimsComplete:pending.length===0,
  pending:Object.freeze(pending),rejected:Object.freeze(rejected),
  next:pending.length?'ISOLATED_STAGING_PROOF_REQUIRED':'INDEPENDENT_REVIEW_OF_PRIVATE_EVIDENCE_REQUIRED',
  evidenceOrigin:'UNVERIFIED_USER_SUPPLIED_LABELS',...R108_CONTRACT});
}
export function createR108OfflineQuarantine({environment,dbName,storage,releaseState}={}){
 if(environment!=='isolated_qa'||dbName!=='car02_r93q_qa_ci'||storage!==undefined||
    releaseState!=='HARD_LOCKED')denied('R108_DISPOSABLE_ONLY');
 const pending=new Map();const pathOwner=new Map();
 function validate(v){
  if(!keysExactly(v,['shop','jobId','photoId','path','sha256'])||!SHOP.test(v.shop)||
     !UUID.test(v.jobId)||!UUID.test(v.photoId)||!SHA.test(v.sha256)||
     typeof v.path!=='string'||!PATH.test(v.path)||v.path.split('/')[0]!==v.shop||
     !v.path.split('/').slice(1,4).every(s=>UUID.test(s.replace(/\.(jpg|png|webp)$/i,''))))
   denied('R108_QUARANTINE_SCOPE_DENIED');
 }
 return Object.freeze({kind:'r108_in_process_quarantine',testOnly:true,network:false,
  // No deletion operation is exported, including under a forged release flag.
  enqueue(v){
   validate(v);
   const old=pending.get(v.jobId),priorOwner=pathOwner.get(v.path);
   if(old){if(JSON.stringify(old)!==JSON.stringify(v))denied('R108_JOB_REBIND_DENIED');return {status:'QUARANTINED',duplicate:true};}
   if(priorOwner)denied('R108_PATH_REUSE_DENIED');
   const data=Object.freeze({...v});pending.set(v.jobId,data);pathOwner.set(v.path,v.jobId);
   return {status:'QUARANTINED',duplicate:false};
  },
  inspect(jobId){if(!UUID.test(jobId||''))denied('R108_BAD_JOB');return pending.has(jobId)?Object.freeze({status:'QUARANTINED'}):Object.freeze({status:'NOT_FOUND'});},
  get pendingCount(){return pending.size;},
  // Secure-by-default: cannot promote quarantine to a Storage DELETE locally.
  authorizeDeletion(){denied('R108_LIVE_DELETE_NOT_AUTHORIZED');}
 });
}
export function auditR108Baseline({r47,r52,r107,plan}={}){
 if([r47,r52,r107,plan].some(x=>typeof x!=='string'||x.length<300))denied('R108_MISSING_SOURCE');
 if(!r47.includes('const deleteObject=async(path)=>')||!r47.includes('await deleteObject(path);'))
  denied('R108_R47_DIRECT_DELETE_BASELINE_CHANGED');
 if(!r47.includes("'x-upsert':'false'" )||!r47.includes('randomUUID()'))denied('R108_R47_CREATE_ONLY_BASELINE_CHANGED');
 if(!r52.includes('const CAR02_RELEASE_LOCK=true;')||!r52.includes('isServerReleased:()=>!CAR02_RELEASE_LOCK'))
  denied('R108_RELEASE_LOCK_DRIFT');
 if(!r107.includes('ATOMIC_VERSION_CONDITIONAL_DELETE_NOT_PROVEN_ON_REAL_SUPABASE')||
    !r107.includes('R107_PROVIDER_STORAGE_CAPABILITY_NOT_YET_VERIFIED')&&!r107.includes('real provider'))
  denied('R108_R107_BASELINE_DRIFT');
 for(const x of R107_BLOCKERS)if(!plan.includes(x))denied('R108_MISSING_BLOCKER_'+x);
 for(const ref of [
  'https://supabase.com/docs/guides/storage/management/delete-objects',
  'https://supabase.com/docs/guides/storage/uploads/standard-uploads',
  'https://supabase.com/docs/guides/getting-started/api-keys'
 ])if(!plan.includes(ref))denied('R108_MISSING_PROVIDER_REFERENCE');
 if(!plan.includes('QUARANTINE_ONLY')||!plan.includes('NO_GO')||!plan.includes('HOLD'))denied('R108_PLAN_UNSAFE');
 return Object.freeze({baselineVerified:true,protectedSourcesUnchanged:true,
  knownRisk:'R47_DIRECT_DELETE_ON_AMBIGUOUS_FAILURE',
  openGates:Object.freeze([...R107_BLOCKERS]),
  sha256:Object.freeze(Object.fromEntries([['R47',r47],['R52',r52],['R107',r107]].map(([n,s])=>[n,createHash('sha256').update(s).digest('hex')]))),
  ...R108_CONTRACT});
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const read=p=>readFileSync(p,'utf8');
 const baseline=auditR108Baseline({r47:read('car02-private-photo-r47.mjs'),r52:read('car02-edge-entry-r52.ts'),
  r107:read('car02-r107-storage-compatibility-gate.mjs'),plan:read('CAR02_R108_STORAGE_TRANSITION_PLAN.txt')});
 const proof=assessR108StagingEvidence(JSON.parse(read('CAR02_R108_STAGING_PROOF_TEMPLATE.json')));
 console.log(JSON.stringify({baseline,proof},null,2));
 console.log('R108_QUARANTINE_ONLY_SOURCE_GATE_NO_GO_HOLD_PASS');
}
