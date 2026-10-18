/** Read-only QA source runner. No remote requests, no database. */
import {readFileSync} from 'node:fs';
import {auditV34MembershipSource} from './car02-v34-staff-membership-isolated.mjs';
const names=['car02-identity-r44.mjs','car02-runtime-r45.mjs','car02-edge-entry-r52.ts',
 'car02-v33-staff-jwt-claims-isolated.mjs'];
const src=Object.fromEntries(names.map(n=>[n,readFileSync(new URL(n,import.meta.url),'utf8')]));
const a=auditV34MembershipSource(src);
if(a.passed!==7||a.unresolved.length!==4||a.productionReady!==false)throw Error('CAR02_V34_AUDIT_FAILED');
console.log('CAR02_V34_MEMBERSHIP_SOURCE_PASS 7/7 UNBOUND=4 NO_GO HOLD');
