/** Source-only audit: CI checkout required, no API or database. */
import {readFileSync} from 'node:fs';
import {auditV35MutationBoundary} from './car02-v35-tx-time-membership-isolated.mjs';
const paths=['car02-identity-r44.mjs','car02-runtime-r45.mjs','car02-edge-entry-r52.ts',
 'car02-pg-adapter.mjs','car02-v34-staff-membership-isolated.mjs'];
const sources=Object.fromEntries(paths.map(p=>[p,readFileSync(new URL(p,import.meta.url),'utf8')]));
const result=auditV35MutationBoundary(sources);
if(result.passed!==8||result.blockers.length!==5||result.productionReady!==false||
   result.missingRealTransactionGuarantee!==true)throw Error('CAR02_V35_SOURCE_AUDIT_FAILED');
console.log('CAR02_V35_TX_RECHECK_SOURCE_PASS 8/8 BLOCKERS=5 NO_GO HOLD');
