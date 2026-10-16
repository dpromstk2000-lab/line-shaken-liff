/** CAR02 V2.6 checked-out source report: no network, DB, or secrets. */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {V26_SOURCE_FILES,auditCar02V26ReleaseReadiness} from './car02-v26-release-readiness-audit-isolated.mjs';
const src=Object.fromEntries(V26_SOURCE_FILES.map(name=>[name,readFileSync(resolve(process.cwd(),name),'utf8')]));
const r=auditCar02V26ReleaseReadiness(src);
for(const x of r.checks)console.log(`STATIC_PASS ${x.id}`);
for(const x of r.blockers)console.log(`RELEASE_HOLD ${x.id}`);
if(r.staticChecksPassed!==10||r.blockerCount!==8||r.releaseReady!==false||r.production!=='NO_GO')throw Error('CAR02_V26_REPORT_MUST_NOT_AUTHORIZE_RELEASE');
console.log(`CAR02_V26_STATIC_AUDIT_PASS ${r.staticChecksPassed}/${r.staticChecksTotal} RELEASE_BLOCKERS=${r.blockerCount} NO_GO HOLD`);
