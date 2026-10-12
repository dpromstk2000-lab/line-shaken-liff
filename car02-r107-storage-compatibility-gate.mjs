// DPRO CAR02 R107 - READ-ONLY storage provider compatibility and immutable-key design gate.
// OFFLINE QA ONLY. No credentials, network, production storage, SQL migration or deployment.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const BUCKET='ksh-car02-private-photos';
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const EXT=Object.freeze({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'});
const SHA=/^[0-9a-f]{64}$/;
const OBJECT_PATH=/^[a-z0-9][a-z0-9_-]{1,63}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(jpg|png|webp)$/;
export const R107_REFERENCES=Object.freeze([
 'https://supabase.com/docs/guides/storage/management/delete-objects',
 'https://supabase.com/docs/guides/storage/uploads/standard-uploads',
 'https://supabase.com/docs/guides/storage/security/access-control'
]);
export const R107_BLOCKERS=Object.freeze([
 'ATOMIC_VERSION_CONDITIONAL_DELETE_NOT_PROVEN_ON_REAL_SUPABASE',
 'IMMUTABLE_PATH_ENFORCEMENT_ACROSS_ALL_WRITERS_NOT_PROVEN',
 'EXCLUSIVE_DELETE_AUTHORITY_AND_RLS_NOT_PROVEN',
 'DURABLE_PATH_TOMBSTONE_AND_NO_REUSE_NOT_PROVEN',
 'R47_IMMEDIATE_DELETE_ON_AMBIGUOUS_FAILURE_REMAINS',
 'STAGING_SUPABASE_WRITE_READ_DELETE_AND_RECOVERY_QA_MISSING'
]);
export const R107_RELEASE=Object.freeze({mode:'SOURCE_ONLY_OFFLINE',productionReady:false,
 productionDeployAllowed:false,storageDeleteAuthorized:false,sqlMigrationAllowed:false,
 releaseDecision:'NO_GO',migrationDecision:'HOLD'});
const no=(code)=>{throw Object.assign(new Error(code),{code});};
export function immutablePath({shop,orderId,reportId,objectId,mime}={}){
 if(!SHOP.test(shop||'')||![orderId,reportId,objectId].every(x=>typeof x==='string'&&UUID.test(x))||
    !Object.hasOwn(EXT,mime))no('R107_PATH_INVALID');
 return `${shop}/${orderId}/${reportId}/${objectId}.${EXT[mime]}`;
}
export function verifyR107PathOwnership({path,shop,orderId,reportId,objectId,mime,sha256,bucket}={}){
 if(bucket!==BUCKET||!SHA.test(sha256||'')||path!==immutablePath({shop,orderId,reportId,objectId,mime}))
  no('R107_PATH_OWNERSHIP_DENIED');
 return true;
}
// Pure in-memory demonstration of a non-reusable object namespace, NOT a durable or real Storage adapter.
export function createR107DisposableNamespace(){
 const ever=new Set(),live=new Map();
 return Object.freeze({testOnly:true,transport:'in_process_only',
  createOnly(path,sha256){
   if(typeof path!=='string'||path.length>250||!OBJECT_PATH.test(path)||!SHA.test(sha256||''))no('R107_BAD_OBJECT');
   if(ever.has(path))no('R107_PATH_REUSE_DENIED');
   ever.add(path);live.set(path,sha256);return true;
  },
  remove(path){if(!ever.has(path))no('R107_UNKNOWN_PATH');live.delete(path);return true;},
  read(path){return live.has(path)?live.get(path):null;},
  hasEverExisted(path){return ever.has(path)}
 });
}
// Demonstrates why HEAD followed by unconditional path-DELETE is NOT version-atomic.
export function modelR107HeadDeleteRace(){
 const path='one/old.jpg',store=new Map([[path,'sha-old']]);
 const readBefore=store.get(path);
 store.set(path,'sha-new'); // untrusted writer replaces the object between HEAD and DELETE
 store.delete(path); // path-only DELETE removes the new object
 return Object.freeze({readBefore,replacementRemoved:!store.has(path),unsafe:true});
}
const KEYS=['privateBucketVerified','serverAssignedUnpredictableObjectKey','createOnlyNoUpsert',
 'noOverwriteForEveryWriter','restrictedDeleteIdentity','tenantBoundDeletion',
 'durableNonreuseTombstone','stagingRecoveryTestPassed'];
export function assessR107Candidate(input={}){
 if(input===null||typeof input!=='object'||Array.isArray(input)||
   Object.keys(input).sort().join('|')!==KEYS.slice().sort().join('|')||
   KEYS.some(key=>typeof input[key]!=='boolean'))no('R107_ATTESTATION_SCHEMA_INVALID');
 const pending=KEYS.filter(key=>input[key]!==true);
 // The caller's boolean claims are NOT accepted as evidence of a real provider's atomic delete capability.
 return Object.freeze({requestedDesign:'IMMUTABLE_KEY_WITH_CONTROLLED_WRITERS',
  claimsComplete:pending.length===0,pending:Object.freeze(pending),
  verification:'UNTRUSTED_OFFLINE_CLAIMS_NOT_REAL_PROVIDER_PROOF',
  candidateStatus:pending.length?'BLOCKED':'REQUIRES_INDEPENDENT_STAGING_PROOF',
  approvedForProduction:false,storageDeleteAuthorized:false,
  releaseDecision:'NO_GO',migrationDecision:'HOLD'});
}
export function auditR107Sources({r47,r52,r106,decisionText}={}){
 if([r47,r52,r106,decisionText].some(x=>typeof x!=='string'||x.length<150))no('R107_SOURCE_MISSING');
 if(!r47.includes('const deleteObject=async(path)=>')||!r47.includes('await deleteObject(path);'))no('R107_R47_ISSUE_CHANGED_REVIEW_REQUIRED');
 if(!r47.includes("'x-upsert':'false'"))no('R107_R47_UPLOAD_CONTRACT_CHANGED');
 if(!r52.includes('const CAR02_RELEASE_LOCK=true;'))no('R107_RELEASE_UNLOCKED');
 if(!r106.includes('realStorageCapabilityVerified:false')||!r106.includes("conditionalDeleteCandidate:true"))
  no('R107_R106_SCOPE_CHANGED');
 if(!R107_REFERENCES.every(s=>decisionText.includes(s))||!R107_BLOCKERS.every(s=>decisionText.includes(s)))
  no('R107_DECISION_INCOMPLETE');
 if(!decisionText.includes('NO_GO')||!decisionText.includes('HOLD'))no('R107_RELEASE_GUARD_MISSING');
 const hashes=Object.fromEntries([['R47',r47],['R52',r52],['R106',r106]].map(([k,v])=>[k,createHash('sha256').update(v).digest('hex')]));
 return Object.freeze({schema:'DPRO_CAR02_R107_STORAGE_COMPATIBILITY_AUDIT',sourceBaselineVerified:true,
  knownStorageBehavior:'PATH_ONLY_DELETE_DOCUMENTED;VERSION_ATOMICITY_NOT_ATTESTED',
  immutablePathCandidate:'OFFLINE_ONLY',openGates:R107_BLOCKERS,hashes,...R107_RELEASE});
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const read=p=>readFileSync(p,'utf8');
 const result=auditR107Sources({r47:read('car02-private-photo-r47.mjs'),r52:read('car02-edge-entry-r52.ts'),
  r106:read('car02-r106-versioned-object-delete-isolated.mjs'),
  decisionText:read('CAR02_R107_STORAGE_COMPATIBILITY_DECISION.txt')});
 console.log(JSON.stringify(result,null,2));
 console.log('R107_STORAGE_COMPATIBILITY_SOURCE_GATE_NO_GO_HOLD_PASS');
}
