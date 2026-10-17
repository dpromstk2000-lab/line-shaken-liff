/** Source-only SHA-pinned audit. No requests, DB, Worker or credentials. */
import {readFileSync} from 'node:fs';
import {V33_APPROVED_BLOBS,auditV33R44ClaimDelegation} from './car02-v33-staff-jwt-claims-isolated.mjs';
const sources=Object.fromEntries(Object.keys(V33_APPROVED_BLOBS).map(p=>[p,readFileSync(new URL('./'+p,import.meta.url),'utf8')]));
const r=auditV33R44ClaimDelegation(sources);
for(const [key,ok] of Object.entries(r.checks))if(ok)console.log(`V33_SOURCE_PASS ${key}`);
for(const x of r.notProven)console.log(`V33_REVIEW_HOLD ${x}`);
if(r.passed!==5||r.total!==5||r.notProven.length!==4||r.productionReady!==false||r.release!=='NO_GO'||r.migration!=='HOLD')throw Error('CAR02_V33_SOURCE_STATUS_UNEXPECTED');
console.log('CAR02_V33_STAFF_CLAIMS_SOURCE_PASS 5/5 UNBOUND=4 NO_GO HOLD');
