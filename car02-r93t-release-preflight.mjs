// Execute from repository root: node car02-r93t-release-preflight.mjs
// Reads local GitHub repository files only, prints a JSON report; NO production connections.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {auditCar02R93TSourceContracts,R93T_APPROVED_BASELINE} from './car02-r93t-release-readiness-audit.mjs';
const sources={};const sha={};
for(const [name,expected] of Object.entries(R93T_APPROVED_BASELINE)){
 const buffer=readFileSync(name);
 const actual=createHash('sha1').update(Buffer.from(`blob ${buffer.length}\0`)).update(buffer).digest('hex');
 if(actual!==expected)throw Error(`R93T_SOURCE_DRIFT_${name}`);
 sources[name]=buffer.toString('utf8');sha[name]=actual;
}
const audit=auditCar02R93TSourceContracts(sources);
if(audit.unsafeCount!==0||audit.openCount!==6||audit.integrationReady!==false||audit.releaseDecision!=='NO_GO')
 throw Error('R93T_UNEXPECTED_RELEASE_STATUS');
console.log(JSON.stringify({sourceSha:sha,...audit},null,2));
