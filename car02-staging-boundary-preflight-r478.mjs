/**
 * CAR02 V4.78 - OFFLINE, non-authorizing staging boundary preflight.
 * This inventories isolated fixture *metadata*, not real Supabase projects.
 * It NEVER proves that an actual staging project is isolated or owner-approved.
 * No external calls, customer rows, tokens, SQL, write, provider or deployment.
 * Existing R52 release lock remains intact. Even perfect fixture input -> NO_GO.
 */
import {CAR02_V477_PROOF_KEYS} from './car02-commercial-gap-audit-r477.mjs';
export const CAR02_V478_RELEASE_LOCK=true;
export const CAR02_V478_REVIEW_BRANCH='car02-v434-review-only';
export const CAR02_V478_PROOF_KEYS=Object.freeze([...CAR02_V477_PROOF_KEYS]);
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
// Real Supabase project refs are 20 lowercase alphanumerics; fixtures only.
const REF=/^[a-z0-9]{20}$/;
const FIELDS=['source','reviewBranch','stagingProjectRef','protectedProjectRefs',
 'environment','isolated','testOnly','customerRows','providerCredentialsPresent','providerCallsEnabled'];
const CLAIM=['key','state','evidenceClass'];
const OWNER=['source','projectRef','approved','verifiedIdentity','authorizationToCreate'];
const plain=(o,fields)=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&
 Object.getPrototypeOf(o)===Object.prototype&&
 Object.keys(o).sort().join('|')===fields.slice().sort().join('|');
const KEYS=Object.freeze([...CAR02_V478_PROOF_KEYS]);
const out=(reason,inventoryChecked=false,proofsChecked=false)=>Object.freeze({
 status:'no_go',reason,classification:'staging_fixture_review_not_real_service_evidence',
 releasePermitted:false,businessWritesAuthorized:false,lineDispatchAuthorized:false,
 providerSessionVerified:false,realStagingIsolationVerified:false,
 realOwnerAuthorizationVerified:false,realProviderEvidenceVerified:false,
 inventoryChecked,proofsChecked,missingRealProofs:KEYS,realProofsVerified:0,
 nextAction:'owner_approved_independent_staging_required'
});
function validInventory(x){
 if(!plain(x,FIELDS)||x.source!=='offline_fixture_inventory'||
 x.reviewBranch!==CAR02_V478_REVIEW_BRANCH||x.environment!=='offline_mock_only'||
 x.isolated!==true||x.testOnly!==true||x.customerRows!==0||
 x.providerCredentialsPresent!==false||x.providerCallsEnabled!==false||
 !REF.test(x.stagingProjectRef)||!Array.isArray(x.protectedProjectRefs)||
 x.protectedProjectRefs.length<1||x.protectedProjectRefs.length>32)return false;
 const seen=new Set();
 for(const p of x.protectedProjectRefs){if(typeof p!=='string'||!REF.test(p)||seen.has(p))return false;seen.add(p);}
 return true;
}
function validClaims(x){
 if(!Array.isArray(x)||x.length!==KEYS.length)return false;
 const seen=new Set();
 for(const y of x){if(!plain(y,CLAIM)||!KEYS.includes(y.key)||seen.has(y.key)||
  !['unverified','missing','mock_claim_only'].includes(y.state)||
  !['none','offline_fixture'].includes(y.evidenceClass))return false;seen.add(y.key);}
 return seen.size===KEYS.length;
}
function validOwner(x,p){return plain(x,OWNER)&&x.source==='offline_owner_fixture'&&
 x.projectRef===p&&x.approved===false&&x.verifiedIdentity===false&&
 x.authorizationToCreate===false;}
/** Returns only denial/reporting values. Never produce an authorization token. */
export function createCar02OfflineStagingBoundaryPreflightR478({expectedShopCode,
 authorizeAuditor,inspectIsolation,readProjectInventory,readProofClaims,readOwnerGate}={}){
 if(!SHOP.test(expectedShopCode??'')||!
 [authorizeAuditor,inspectIsolation,readProjectInventory,readProofClaims,readOwnerGate]
 .every(x=>typeof x==='function'))throw Error('CAR02_V478_OFFLINE_ADAPTERS_REQUIRED');
 async function inspect({request}={}){
  let a,isolation,inventory,proofs,owner;
  try{[a,isolation]=await Promise.all([authorizeAuditor({request}),inspectIsolation()]);}
  catch{return out('offline_audit_unavailable');}
  if(a?.verified!==true||a?.role!=='staging_boundary_auditor'||
    a?.mode!=='isolated_qa'||a?.shopCode!==expectedShopCode||
    isolation?.verified!==true||isolation?.environment!=='offline_mock_only'||
    isolation?.testOnly!==true||isolation?.providerCallsEnabled!==false)
   return out('offline_isolation_or_auditor_untrusted');
  try{inventory=await readProjectInventory({shopCode:expectedShopCode});}
  catch{return out('project_inventory_unavailable');}
  if(!validInventory(inventory))return out('project_inventory_untrusted');
  if(inventory.protectedProjectRefs.includes(inventory.stagingProjectRef))
   return out('protected_project_collision',true);
  try{proofs=await readProofClaims({shopCode:expectedShopCode});}
  catch{return out('proof_manifest_unavailable',true);}
  if(!validClaims(proofs))return out('proof_manifest_untrusted',true);
  try{owner=await readOwnerGate({shopCode:expectedShopCode,stagingProjectRef:inventory.stagingProjectRef});}
  catch{return out('owner_gate_unavailable',true,true);}
  if(!validOwner(owner,inventory.stagingProjectRef))return out('owner_gate_untrusted',true,true);
  return out('isolated_fixture_preflight_only_owner_approval_and_seven_real_proofs_missing',true,true);
 }
 return Object.freeze({inspect,scopedShopCode:expectedShopCode});
}
