import assert from 'node:assert/strict';
import {test} from 'node:test';
import {V31_FILES,V31_MODE,V31_UNPROVEN,auditCar02V31LegacyBoundary} from './car02-v31-live-route-boundary-audit-isolated.mjs';
const mk=branch=>`<html><script>const CONTROL_ADAPTER_BASE = "https://synthetic.invalid/functions/v1/control-adapter"; const WORKER_API_BASE = CONTROL_ADAPTER_BASE + "/${branch}"; /* QA fixture only */</script></html>`;
const edge=`// Synthetic R51 QA fixture\nconst NAME='dpro-car02-stage';const PREFIXES=['/functions/v1/'+NAME,'/'+NAME];
const PATH=new RegExp('^/api/car02(?:/other)?$','i');
if(path===null)return json(404,'CAR02_NOT_FOUND');`;
const entry=`// synthetic R52 QA fixture\nconst CAR02_RELEASE_LOCK=true;
if(CAR02_RELEASE_LOCK)throw Error('CAR02_NOT_RELEASED');
const route=createCar02EdgeBoundaryR51({isServerReleased:()=>!CAR02_RELEASE_LOCK,createRuntime});`;
const api=`// synthetic candidate R43 API fixture\nexport function createCar02Api(){};
const route=url.pathname.replace(/\\/+$/,'').match(/^\\/api\\/car02$/);
if(!route) return block('CAR02_NOT_FOUND',404);
if(await releaseEnabled(req)!==true)return block('CAR02_NOT_RELEASED',503);`;
const files=()=>({'dashboard.html':mk('wangan'),'owner-ipad.html':mk('ksh'),
'index.html':mk('ksh'),'member.html':mk('ksh'),
'car02-edge-boundary-r51.mjs':edge,'car02-edge-entry-r52.ts':entry,'car02-api.mjs':api});
const run=o=>auditCar02V31LegacyBoundary(o);
const breakFile=(name,from,to)=>{const a=files();a[name]=a[name].replace(from,to);return a};
const cases=[
 ['one owner uses wangan',()=>assert.equal(run(files()).legacyBranchCounts.wangan,1)],
 ['three other screens use ksh',()=>assert.equal(run(files()).legacyBranchCounts.ksh,3)],
 ['all static checks pass',()=>assert.equal(run(files()).staticChecksPassed,12)],
 ['exact total is twelve',()=>assert.equal(run(files()).staticChecksTotal,12)],
 ['reports six unresolved gates',()=>assert.equal(run(files()).unresolved.length,6)],
 ['keeps release NO_GO',()=>assert.equal(run(files()).release,'NO_GO')],
 ['keeps migration HOLD',()=>assert.equal(run(files()).migration,'HOLD')],
 ['does not approve production',()=>assert.equal(run(files()).productionReady,false)],
 ['does not claim live mapping',()=>assert.equal(run(files()).legacyToCar02Bound,false)],
 ['does not claim live networking',()=>assert.equal(run(files()).realAdapterConnectivityTested,false)],
 ['mode forbids network evidence',()=>assert.equal(V31_MODE.realEndpointInvoked,false)],
 ['mode forbids auth approval',()=>assert.equal(V31_MODE.liveAuthVerified,false)],
 ['mode is not sendable',()=>assert.equal(V31_MODE.sendable,false)],
 ['mode is immutable',()=>assert.equal(Object.isFrozen(V31_MODE),true)],
 ['input files enumerated',()=>assert.equal(V31_FILES.length,7)],
 ['unproven gate list frozen',()=>assert.equal(Object.isFrozen(V31_UNPROVEN),true)],
 ['null source denied',()=>assert.throws(()=>run(null),/SOURCE_MAP_REQUIRED/)],
 ['array source denied',()=>assert.throws(()=>run([]),/SOURCE_MAP_REQUIRED/)],
 ['missing source denied',()=>{const a=files();delete a['index.html'];assert.throws(()=>run(a),/SOURCE_REQUIRED/)}],
 ['short source denied',()=>{const a=files();a['index.html']='x';assert.throws(()=>run(a),/SOURCE_REQUIRED/)}],
 ['owner misrouted to ksh blocked',()=>assert.throws(()=>run(breakFile('dashboard.html','/wangan','/ksh')),/LEGACY_ROUTE_DRIFT/)],
 ['iPad misrouted to wangan blocked',()=>assert.throws(()=>run(breakFile('owner-ipad.html','/ksh','/wangan')),/LEGACY_ROUTE_DRIFT/)],
 ['customer index misrouted blocked',()=>assert.throws(()=>run(breakFile('index.html','/ksh','/wangan')),/LEGACY_ROUTE_DRIFT/)],
 ['member misrouted blocked',()=>assert.throws(()=>run(breakFile('member.html','/ksh','/wangan')),/LEGACY_ROUTE_DRIFT/)],
 ['mismatched adapter base denied',()=>assert.throws(()=>run(breakFile('index.html','synthetic.invalid','unexpected.invalid')),/BASE_MISMATCH/)],
 ['non-HTTPS adapter denied',()=>assert.throws(()=>run(breakFile('member.html','https:','http:')),/ADAPTER_BASE_DRIFT|ADAPTER_URL_INVALID/)],
 ['duplicate worker base assignment denied',()=>{const a=files();a['index.html']+='const WORKER_API_BASE = CONTROL_ADAPTER_BASE + "/ksh";';assert.throws(()=>run(a),/LEGACY_ROUTE_DRIFT|MULTIPLE/)}],
 ['missing stage name denied',()=>assert.throws(()=>run(breakFile('car02-edge-boundary-r51.mjs','dpro-car02-stage','other-gateway')),/PREFIX_DRIFT/)],
 ['unprefixed edge route denied',()=>assert.throws(()=>run(breakFile('car02-edge-boundary-r51.mjs',"if(path===null)return json(404,'CAR02_NOT_FOUND')",'return null;')),/UNPREFIXED_ROUTE/)],
 ['legacy proxy through R51 rejected',()=>{const a=files();a['car02-edge-boundary-r51.mjs']+='const unsafe="/wangan";';assert.throws(()=>run(a),/STAGE_LEGACY_ROUTE_MIXED/)}],
 ['release lock false denied',()=>assert.throws(()=>run(breakFile('car02-edge-entry-r52.ts','CAR02_RELEASE_LOCK=true','CAR02_RELEASE_LOCK=false')),/HARD_RELEASE_LOCK/)],
 ['release callback opening denied',()=>assert.throws(()=>run(breakFile('car02-edge-entry-r52.ts','()=>!CAR02_RELEASE_LOCK','()=>true')),/R52_GATING_DRIFT/)],
 ['R43 api route missing rejected',()=>assert.throws(()=>run(breakFile('car02-api.mjs',"api\\/car02",'api\\/ksh')),/BUSINESS_API_ROUTE_DRIFT/)],
 ['R43 api release guard denied',()=>assert.throws(()=>run(breakFile('car02-api.mjs','await releaseEnabled(req)!==true','await releaseEnabled(req)===true')),/BUSINESS_API_RELEASE_CHECK_DRIFT/)],
];
for(const [name,fn] of cases)test(name,fn);
