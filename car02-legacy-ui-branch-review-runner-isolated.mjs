/** CAR02 V2.2 checked-out source audit. No networking, secrets or data writes. */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {auditCar02LegacyUiBranches,CAR02_LEGACY_UI_BRANCHES} from './car02-legacy-ui-branch-review-isolated.mjs';
const names=[...new Set(Object.values(CAR02_LEGACY_UI_BRANCHES).map(x=>x.file))];
const sources={};
for(const p of names)sources[p]=readFileSync(resolve(process.cwd(),p),'utf8');
const r52=readFileSync(resolve(process.cwd(),'car02-edge-entry-r52.ts'),'utf8');
if(!/\bconst\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/.test(r52))throw Error('CAR02_V22_R52_RELEASE_NOT_LOCKED');
const audit=auditCar02LegacyUiBranches(sources);
if(audit.pass!==4||audit.block!==0||audit.liveApiChecked!==false)throw Error('CAR02_V22_AUDIT_NOT_SAFE');
for(const c of audit.checks)console.log(`PASS V22 ${c.page} -> ${c.branch} (legacyList=${c.legacyList}; SOURCE_ONLY)`);
console.log(`CAR02_V22_LEGACY_BRANCH_READONLY_SOURCE_PASS ${audit.pass}/4 NO_GO HOLD`);
