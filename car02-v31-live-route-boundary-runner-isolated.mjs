/** Source-only runner against real checked-out GitHub sources; no network. */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {V31_FILES,auditCar02V31LegacyBoundary} from './car02-v31-live-route-boundary-audit-isolated.mjs';
const sources=Object.fromEntries(V31_FILES.map(f=>[f,readFileSync(resolve(process.cwd(),f),'utf8')]));
const report=auditCar02V31LegacyBoundary(sources);
if(report.staticChecksPassed!==12||report.unresolved.length!==6||
  report.productionReady!==false||report.legacyToCar02Bound!==false||
  report.release!=='NO_GO'||report.migration!=='HOLD')throw Error('CAR02_V31_RELEASE_SAFETY_VIOLATION');
for(const c of report.checks)console.log('V31_STATIC_PASS '+c.id);
for(const g of report.unresolved)console.log('V31_REVIEW_HOLD '+g);
console.log('CAR02_V31_LEGACY_ROUTE_SOURCE_PASS 12/12 UNPROVEN=6 NO_GO HOLD');
