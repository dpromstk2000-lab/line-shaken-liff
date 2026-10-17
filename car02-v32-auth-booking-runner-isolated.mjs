/** Checks ONLY current repository source. No network or secrets. */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {V32_FILES,auditCar02V32AuthBookingSources} from './car02-v32-auth-booking-boundary-isolated.mjs';
const src=Object.fromEntries(V32_FILES.map(p=>[p,readFileSync(resolve(process.cwd(),p),'utf8')]));
const result=auditCar02V32AuthBookingSources(src);
if(result.checksPassed!==16||result.requiredDependencies.length!==8||result.productionReady||
 result.verifiedJWTProviderAttached||result.realBookingEndpointAccessible||
 result.release!=='NO_GO'||result.migration!=='HOLD')throw Error('CAR02_V32_UNSAFE_RELEASE_REPORT');
for(const c of result.checks)console.log('V32_STATIC_PASS '+c.id);
for(const g of result.requiredDependencies)console.log('V32_REVIEW_HOLD '+g);
console.log('CAR02_V32_AUTH_BOOKING_SOURCE_PASS 16/16 UNPROVEN=8 NO_GO HOLD');
