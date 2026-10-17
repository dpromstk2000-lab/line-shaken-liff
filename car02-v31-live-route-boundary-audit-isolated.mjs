/** DPRO CAR02 V3.1 -- checked-out source-only compatibility map.
 * No network, DB, secrets, Worker, deployment, or modifications.
 * Existing /wangan and /ksh routes are NOT equivalent to locked /api/car02.
 */
export const V31_FILES=Object.freeze([
 'dashboard.html','owner-ipad.html','index.html','member.html',
 'car02-edge-boundary-r51.mjs','car02-edge-entry-r52.ts','car02-api.mjs']);
export const V31_MODE=Object.freeze({mode:'source_only',realEndpointInvoked:false,
 liveAuthVerified:false,liveRouteMappingVerified:false,productionReady:false,
 release:'NO_GO',migration:'HOLD',sendable:false});
const expected=Object.freeze({
 'dashboard.html':'wangan','owner-ipad.html':'ksh',
 'index.html':'ksh','member.html':'ksh'
});
const failures=Object.freeze([
 'WANGAN_TO_CAR02_NOT_BOUND','KSH_TO_CAR02_NOT_BOUND',
 'REAL_STAFF_AUTH_NOT_VERIFIED','REAL_RESERVATION_LIFECYCLE_NOT_VERIFIED',
 'R13_RELEASE_MIGRATION_HOLD','BACKUP_AND_CREDENTIAL_REVIEW_PENDING']);
export const V31_UNPROVEN=failures;
const fail=code=>{throw Object.assign(new Error(code),{code})};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const add=(arr,id)=>arr.push(Object.freeze({id,result:'STATIC_PASS'}));
function config(html,file){
 const bs=[...html.matchAll(/\bconst\s+CONTROL_ADAPTER_BASE\s*=\s*(["'])(https:\/\/[^"'\s]+)\1\s*;/g)];
 if(bs.length!==1)fail('CAR02_V31_ADAPTER_BASE_DRIFT_'+file.replace(/[^a-z]/gi,'_'));
 let u;try{u=new URL(bs[0][2])}catch{fail('CAR02_V31_ADAPTER_URL_INVALID')}
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname==='/'||
    !u.pathname.includes('/functions/v1/'))fail('CAR02_V31_ADAPTER_URL_INVALID');
 const branches=[...html.matchAll(/\bconst\s+WORKER_API_BASE\s*=\s*CONTROL_ADAPTER_BASE\s*\+\s*(["'])\/(wangan|ksh)\1\s*;/g)];
 if(branches.length!==1||branches[0][2]!==expected[file])
   fail('CAR02_V31_LEGACY_ROUTE_DRIFT_'+file.replace(/[^a-z]/gi,'_'));
 // An additional active assignment can silently change what the UI actually calls.
 const all=[...html.matchAll(/\b(?:const|let|var)\s+WORKER_API_BASE\s*=/g)];
 if(all.length!==1)fail('CAR02_V31_MULTIPLE_LEGACY_ENDPOINTS');
 return {base:bs[0][2],route:branches[0][2]};
}
export function auditCar02V31LegacyBoundary(sources){
 if(!plain(sources))fail('CAR02_V31_SOURCE_MAP_REQUIRED');
 for(const name of V31_FILES){if(typeof sources[name]!=='string'||sources[name].length<100)
   fail('CAR02_V31_SOURCE_REQUIRED_'+name.replace(/[^a-z]/gi,'_'));}
 const checked=[],baseValues=[];
 for(const [file,branch] of Object.entries(expected)){
  const conf=config(sources[file],file);baseValues.push(conf.base);
  add(checked,'LEGACY_'+file.replace(/[^a-z0-9]/gi,'_').toUpperCase()+'_'+branch.toUpperCase());
 }
 if(new Set(baseValues).size!==1)fail('CAR02_V31_LEGACY_ADAPTER_BASE_MISMATCH');
 add(checked,'FOUR_LEGACY_UI_SAME_ADAPTER_BASE');
 const edge=sources['car02-edge-boundary-r51.mjs'];
 if(!/\bconst\s+NAME\s*=\s*['"]dpro-car02-stage['"]\s*;/.test(edge)||
    !edge.includes("'/functions/v1/'+NAME")||!edge.includes("'/'+NAME"))
    fail('CAR02_V31_STAGE_GATEWAY_PREFIX_DRIFT');
 add(checked,'R51_SEPARATE_CAR02_STAGE_PREFIX');
 if(!edge.includes('const PATH=new RegExp(')||!edge.includes("'^/api/car02")||
    !edge.includes("if(path===null)return json(404,'CAR02_NOT_FOUND')"))
    fail('CAR02_V31_UNPREFIXED_ROUTE_NOT_BLOCKED');
 add(checked,'R51_UNPREFIXED_CAR02_ROUTE_REJECTED');
 if(/\/(?:wangan|ksh)\b/.test(edge))fail('CAR02_V31_STAGE_LEGACY_ROUTE_MIXED');
 add(checked,'R51_NO_LEGACY_WANGAN_KSH_PROXY');
 const entry=sources['car02-edge-entry-r52.ts'];
 if(!/\bconst\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/.test(entry)||
    !entry.includes("throw Error('CAR02_NOT_RELEASED')"))
    fail('CAR02_V31_R52_HARD_RELEASE_LOCK_DRIFT');
 add(checked,'R52_HARD_RELEASE_LOCK');
 if(!/isServerReleased\s*:\s*\(\)\s*=>\s*!CAR02_RELEASE_LOCK/.test(entry))
    fail('CAR02_V31_R52_GATING_DRIFT');
 add(checked,'R52_RELEASE_CALLBACK_CLOSED');
 const api=sources['car02-api.mjs'];
 if(!api.includes('export function createCar02Api(')||
    !api.includes('const route=url.pathname')||
    !api.includes('api\\/car02')||
    !api.includes("if(!route) return block('CAR02_NOT_FOUND',404"))
    fail('CAR02_V31_BUSINESS_API_ROUTE_DRIFT');
 add(checked,'R43_BUSINESS_API_DISTINCT_PATH');
 if(!api.includes('await releaseEnabled(req)!==true')||
    !api.includes("return block('CAR02_NOT_RELEASED',503"))
    fail('CAR02_V31_BUSINESS_API_RELEASE_CHECK_DRIFT');
 add(checked,'R43_RELEASE_CHECK_CLOSED');
 return Object.freeze({mode:V31_MODE,staticChecksPassed:checked.length,
  staticChecksTotal:12,checks:Object.freeze(checked),
  legacyBranchCounts:Object.freeze({wangan:1,ksh:3}),
  distinctLegacyAndCar02RouteFamilies:true,realAdapterConnectivityTested:false,
  legacyToCar02Bound:false,release:'NO_GO',migration:'HOLD',productionReady:false,
  unresolved:Object.freeze([...failures]),
  message:'SOURCE-ONLY route boundary evidence; NOT evidence of live connection.'});
}
