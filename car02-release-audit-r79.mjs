// DPRO CAR02 R79 - READ-ONLY REVIEW SAFETY GATE.
// No HTTP requests, database connections, secrets, deployments or release toggles.
// A passing result means only that review-only/NO-GO safeguards remain visible.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const PROJECT='cbknucemarcpbscirzyv';
const STAGE='dpro-car02-stage';
const check=(id,ok,note)=>Object.freeze({id,ok:ok===true,note});
const isObject=x=>x!==null && typeof x==='object' && !Array.isArray(x);

export function auditCar02R79({snapshot,edgeEntry,edgeBoundary}={}){
  const s=isObject(snapshot)?snapshot:{};
  const edge=isObject(s.edge_stage)?s.edge_stage:{};
  const entry=typeof edgeEntry==='string'?edgeEntry:'';
  const boundary=typeof edgeBoundary==='string'?edgeBoundary:'';
  const checks=[
    check('project_identity',s.project_id===PROJECT&&s.project_name==='liff-salon-reserve'&&s.region==='ap-northeast-1','The reviewed project identity is exact.'),
    check('snapshot_type',s.operation==='READ_ONLY_METADATA_AGGREGATES'&&/^20\d\d-\d\d-\d\d$/.test(s.date||''),'Read-only evidence snapshot (not live attestation).'),
    check('existing_systems_preserved',s.baseline_tables_present===4&&s.expected_shop_rows===1,'Existing reservation/shop baseline identified.'),
    check('no_car02_schema',s.car02_tables===0&&s.car02_functions===0&&s.car02_triggers===0&&s.car02_photo_bucket_count===0,'Migration has not been applied; no CAR02 photo bucket.'),
    check('production_backup_pending',s.live_backup_completed===false&&s.separate_production_restore_verified===false,'Production backup/restore MUST remain an explicit blocker.'),
    check('no_go_declared',s.release_decision==='NO_GO'&&s.migration_decision==='HOLD_BACKUP_AND_RESTORE','Evidence snapshot explicitly prohibits release and migration.'),
    check('stage_locked_snapshot',edge.slug===STAGE&&edge.status==='ACTIVE'&&edge.CAR02_RELEASE_LOCK===true&&edge.contracted===false&&edge.goLiveApproved===false,'Read-only observation of locked staging at snapshot time.'),
    check('edge_hard_lock_source',/\bconst\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/.test(entry),'Repository edge entry has a hardcoded true release lock.'),
    check('edge_route_uses_lock',/isServerReleased\s*:\s*\(\)\s*=>\s*!CAR02_RELEASE_LOCK/.test(entry),'Edge entry passes inverse hard lock to boundary.'),
    check('edge_runtime_guard',/if\s*\(\s*CAR02_RELEASE_LOCK\s*\)\s*throw\s+Error\(\s*['"]CAR02_NOT_RELEASED['"]\s*\)/.test(entry),'Runtime cannot initialize while hard-locked.'),
    check('edge_boundary_fail_closed',/if\s*\(\s*!released\s*\)\s*return\s+json\(503,\s*['"]CAR02_NOT_RELEASED['"]\)/.test(boundary),'Unreleased endpoints return HTTP 503.'),
    check('edge_boundary_runtime_after_lock',(()=>{const gate=boundary.indexOf('if(!released)return json(503');const runtime=boundary.indexOf('createRuntime()');return gate>=0&&runtime>gate})(),'Runtime initialization occurs after release check.'),
  ];
  const safetyOk=checks.every(c=>c.ok);
  return Object.freeze({system:'DPRO_CAR02',version:'R79',mode:'REVIEW_ONLY',
    safetyOk,releaseDecision:'NO_GO',migrationDecision:'HOLD',
    evidenceDate:s.date||'UNKNOWN',productionBackupVerified:false,
    productionRestoreVerified:false,automaticApproval:false,
    checks,failures:checks.filter(c=>!c.ok).map(c=>c.id),
    explanation:safetyOk?
      'Review-only controls match the supplied snapshot and repository sources. Production release and migration are NOT authorized.':
      'One or more review-only controls cannot be verified. STOP: no release, migration or privileged connection.'});
}

function main(){
  const [snapshotPath='R79_EVIDENCE_SNAPSHOT.json',entryPath='car02-edge-entry-r52.ts',boundaryPath='car02-edge-boundary-r51.mjs']=process.argv.slice(2);
  try{
    const snapshot=JSON.parse(readFileSync(resolve(snapshotPath),'utf8'));
    const edgeEntry=readFileSync(resolve(entryPath),'utf8');
    const edgeBoundary=readFileSync(resolve(boundaryPath),'utf8');
    const result=auditCar02R79({snapshot,edgeEntry,edgeBoundary});
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    if(!result.safetyOk)process.exitCode=1;
  }catch(e){
    process.stderr.write('R79_FAIL_CLOSED: unable to verify required local inputs ('+String(e?.code||'INVALID_INPUT')+')\n');
    process.exitCode=1;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main();
