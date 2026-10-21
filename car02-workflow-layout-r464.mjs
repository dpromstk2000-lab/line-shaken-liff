/**
 * CAR02 V4.64 — review-only GitHub workflow placement and source-boundary auditor.
 * This module is an OFFLINE fixture fed by read-only trusted adapters. It never
 * calls GitHub or a provider, does not grant release, and MUST NOT be deployed.
 * It verifies workflows truly live at .github/workflows rather than the repo root.
 * GitHub Actions PASS != Supabase session proof, LINE delivery or commercial GO.
 */
export const CAR02_V464_RELEASE_LOCK=true;
export const CAR02_V464_REVIEW_BRANCH='car02-v434-review-only';
export const CAR02_V464_WORKFLOWS=Object.freeze([
 '.github/workflows/car02-v457-signed-evidence-manifest-pg17-qa.yml',
 '.github/workflows/car02-v463-review-ci-provenance-qa.yml',
 '.github/workflows/car02-v464-workflow-placement-qa.yml'
]);
const DENIED=(reason)=>Object.freeze({status:'no_go',reason,releasePermitted:false,workflowLayoutVerified:false});
const ALLOWED=Object.freeze({status:'layout_verified_review_only',reason:'isolated_ci_not_provider_proof',
 releasePermitted:false,workflowLayoutVerified:true,workflowCount:3});
const pathIsSafe=(p)=>typeof p==='string'&&p.length>0&&p.length<256&&
 !p.startsWith('/')&&!p.includes('\\')&&!p.includes('//')&&!p.split('/').includes('..');
const summary=(content,needle)=>content.includes(needle);
/** listPaths/readFile are trusted read-only source adapters, NOT user-supplied data. */
export function createCar02OfflineWorkflowLayoutR464({listPaths,readFile}={}){
 if(CAR02_V464_RELEASE_LOCK!==true||typeof listPaths!=='function'||typeof readFile!=='function')
  throw Error('CAR02_V464_TRUSTED_READ_ONLY_SOURCE_REQUIRED');
 async function inspect({branch}={}){
  if(branch!==CAR02_V464_REVIEW_BRANCH)return DENIED('wrong_branch');
  try{
   const names=await listPaths({branch});
   if(!Array.isArray(names)||names.length>5000||!names.every(pathIsSafe)||new Set(names).size!==names.length)
     return DENIED('invalid_or_duplicated_repository_paths');
   for(const expected of CAR02_V464_WORKFLOWS){
    if(!names.includes(expected))return DENIED('workflow_missing_from_correct_directory');
    const filename=expected.split('/').at(-1);
    if(names.some(x=>x!==expected&&x.split('/').at(-1)===filename))
      return DENIED('duplicate_workflow_outside_authorized_directory');
    const data=await readFile({branch,path:expected});
    if(typeof data!=='string'||data.length<250||data.length>65536)
      return DENIED('unreadable_or_oversized_workflow');
    if(!/^name: CAR02 V4\.(?:57|63|64)(?:R\d+)? .*\(NO_GO HOLD\)/m.test(data)||
      !summary(data,'on:\n')||!summary(data,'branches: [car02-v434-review-only]')||
      !summary(data,'workflow_dispatch:')||!summary(data,'persist-credentials: false')||
      !summary(data,"grep -Fxq '# fail 0'")||!summary(data,'NO_GO')||
      !summary(data,'node --test car02-*.test.mjs'))
      return DENIED('workflow_security_or_regression_gate_missing');
    if(summary(data,'branches: [main]')||summary(data,'permissions:\n  contents: write')||
       summary(data,"grep -Fxq '# tests 385'"))
      return DENIED('unsafe_workflow_scope_or_stale_test_count');
   }
   return ALLOWED;
  }catch{return DENIED('trusted_source_read_failed');}
 }
 return Object.freeze({inspect});
}
