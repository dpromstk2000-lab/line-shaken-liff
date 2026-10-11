// DPRO CAR02 R93Z read-only Actions guard, pure parser for local safety QA.
// Checks the full workflow text BEFORE running; this file never executes YAML steps.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
export const WORKFLOW='.github/workflows/car02-r93z-http-pg17-single-chain-isolated-qa.yml';
export function auditR93ZWorkflow(y){
 if(typeof y!=='string'||!y.startsWith('name: DPRO CAR02 R93Z '))throw Error('R93Z_WORKFLOW_NAME');
 const lines=y.replace(/\r\n/g,'\n');
 if(!/^on:\n  workflow_dispatch:\npermissions:\n  contents: read\njobs:/m.test(lines))throw Error('R93Z_TRIGGER_OR_PERMISSIONS');
 const end='      - name: Final R93Z immutable read-only safety gate';
 const at=lines.indexOf(end);
 if(at<0||lines.indexOf(end,at+end.length)>=0||lines.indexOf('\n      - name: ',at+end.length)>=0)
   throw Error('R93Z_FINAL_GATE_POSITION');
 const prior=lines.slice(0,at);
 const uses=[...prior.matchAll(/^\s*uses:\s*(.+)$/gm)].map(m=>m[1].trim());
 if(uses.length!==1||uses[0]!=='actions/checkout@v5')throw Error('R93Z_UNAPPROVED_ACTION');
 if(!prior.includes('image: postgres:17')||!prior.includes('PGHOST: 127.0.0.1')||
    !prior.includes('PGDATABASE: car02_r93q_qa_ci')||!prior.includes("R93Z_DISPOSABLE_PG17_QA: 'yes'")||
    !prior.includes('R93Z_DISPOSABLE_DB_REMOVED'))throw Error('R93Z_PG17_ISOLATION_MISSING');
 const forbidden=[/\bwrangler\s+deploy\b/i,/\bsupabase\s+(?:db\s+push|functions\s+deploy)\b/i,
  /\bsecrets\s*[.:]/i,/\bGITHUB_TOKEN\b/i,/\bcontents\s*:\s*write\b/i,
  /\b(?:pull-requests|actions|packages|deployments)\s*:\s*write\b/i,
  /(?:^|\n)\s*environment\s*:/i,/\b(?:git\s+push|npm\s+publish)\b/i,/\b(?:curl|wget)\s+.*https?:\/\//i,
  /\.supabase\.co|workers\.dev/i,/\b(?:schedule|pull_request|push)\s*:/i];
 if(forbidden.some(re=>re.test(prior)))throw Error('R93Z_FORBIDDEN_RELEASE_OR_NETWORK');
 const tail=lines.slice(at+end.length);
 if(!tail.includes('node car02-r93z-workflow-readonly-guard.mjs')||!tail.trim().endsWith('R93Z_READONLY_GUARD_PASS'))
   throw Error('R93Z_FINAL_GATE_TAIL');
 return Object.freeze({ok:true,release:'NO_GO',migration:'HOLD',productionWrites:false,pg17Disposable:true});
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const result=auditR93ZWorkflow(readFileSync(WORKFLOW,'utf8'));
 if(!result.ok)process.exitCode=1;
 else console.log('R93Z_READONLY_GUARD_PASS');
}
