// DPRO CAR02 R80 — review-only API wiring inventory / fail-closed drift guard.
// This report CANNOT authorize schema migration, release, production access, or secrets.
// It deliberately reports missing product wiring instead of silently treating unit QA as production readiness.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const valid=(x)=>typeof x==='string'&&x.length>0;
const check=(id,ok,detail)=>Object.freeze({id,ok:ok===true,detail});
const expectedFiles=Object.freeze({
 snapshot:'R79_EVIDENCE_SNAPSHOT.json',
 entry:'car02-edge-entry-r52.ts',
 boundary:'car02-edge-boundary-r51.mjs',
 unified:'car02-unified-runtime-r50.mjs',
 verified:'car02-runtime-verified-r46.mjs',
 staff:'car02-staff-permissions-r70.mjs',
 photoUpload:'car02-private-photo-r47.mjs',
 photoView:'car02-private-photo-view-r48.mjs',
 photoRepo:'car02-pg-photo-view-r48.mjs',
 staffSchema:'R46_STAFF_GRANTS_QA_ONLY.sql',
 auditSchema:'R70_STAFF_PERMISSION_AUDIT_QA_ONLY.sql',
});
export function inspectCar02WiringR80(sources={}){
 const snapshot=sources.snapshot&&typeof sources.snapshot==='object'&&!Array.isArray(sources.snapshot)?sources.snapshot:{};
 const edge=snapshot.edge_stage&&typeof snapshot.edge_stage==='object'?snapshot.edge_stage:{};
 const entry=valid(sources.entry)?sources.entry:'';
 const boundary=valid(sources.boundary)?sources.boundary:'';
 const unified=valid(sources.unified)?sources.unified:'';
 const verified=valid(sources.verified)?sources.verified:'';
 const staff=valid(sources.staff)?sources.staff:'';
 const photoUpload=valid(sources.photoUpload)?sources.photoUpload:'';
 const photoView=valid(sources.photoView)?sources.photoView:'';
 const photoRepo=valid(sources.photoRepo)?sources.photoRepo:'';
 const staffSchema=valid(sources.staffSchema)?sources.staffSchema:'';
 const auditSchema=valid(sources.auditSchema)?sources.auditSchema:'';
 const checked=[
  check('snapshot_identity',snapshot.project_id==='cbknucemarcpbscirzyv'&&snapshot.project_name==='liff-salon-reserve'&&snapshot.region==='ap-northeast-1','Historical snapshot identity only; not live connection attestation'),
  check('snapshot_is_review_only',snapshot.operation==='READ_ONLY_METADATA_AGGREGATES'&&/^20\d\d-\d\d-\d\d$/.test(snapshot.date||''),'Snapshot date is retained; counts can change'),
  check('source_release_lock',/\bconst\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/.test(entry)&&/if\s*\(\s*CAR02_RELEASE_LOCK\s*\)\s*throw\s+Error\(['"]CAR02_NOT_RELEASED['"]\)/.test(entry),'Hardcoded release lock in the review entrypoint'),
  check('source_route_release_gate',/isServerReleased\s*:\s*\(\)\s*=>\s*!CAR02_RELEASE_LOCK/.test(entry)&&/if\s*\(!released\)return json\(503,['"]CAR02_NOT_RELEASED['"]\)/.test(boundary),'Boundary returns 503 before runtime initialization'),
  check('stage_snapshot_still_locked',edge.slug==='dpro-car02-stage'&&edge.CAR02_RELEASE_LOCK===true&&edge.contracted===false&&edge.goLiveApproved===false,'Observed locked at snapshot time; not a current network check'),
  check('stage_db_unmigrated_snapshot',snapshot.car02_tables===0&&snapshot.car02_photo_bucket_count===0,'CAR02 schema/storage did not yet exist at snapshot time'),
  check('production_backup_not_verified',snapshot.live_backup_completed===false&&snapshot.separate_production_restore_verified===false,'No production backup or production restore authorization'),
  check('server_identity_wired',/createCar02AuthProvidersR46/.test(unified)&&/createCar02VerifiedRuntimeR46/.test(unified)&&/createCar02AuthProvidersR46/.test(verified),'Verified identity is assembled for existing business/photo view routes'),
  check('photo_view_wired',/import\s*\{\s*createCar02PrivatePhotoViewR48\s*,\s*createCar02PhotoHttpR48\s*\}/.test(unified)&&/createCar02PhotoHttpR48\(\{viewer,authenticate,releaseEnabled/.test(unified)&&/if\(PHOTO_PATH\.test\(url\.pathname\)\)return photo\(request\)/.test(unified),'Private photo GET read handler is assembled; no live release'),
  check('photo_view_scoped',/o\.shop_code\s*=\s*\$2/.test(photoRepo)&&/o\.customer_id\s*=\s*\$4::uuid/.test(photoRepo)&&/q\.photos_snapshot/.test(photoRepo)&&/sha256\(bytes\)!==meta\.sha256/.test(photoView),'Source contains tenant, customer-quote and digest checks'),
  check('staff_change_logic_exists',/export\s+function\s+createCar02StaffPermissionsR70/.test(staff)&&/CAR02_OWNER_REQUIRED/.test(staff)&&/ksh_car02_staff_access_audit/.test(staff),'Staff-change logic has actor/audit handling as isolated code'),
  check('staff_permission_not_http_wired',!/(?:createCar02StaffPermissionsR70|car02-staff-permissions-r70\.mjs)/.test(unified+entry+boundary),'Missing: staff permission mutation HTTP entrypoint'),
  check('photo_upload_logic_exists',/export\s+function\s+createCar02PrivatePhotoR47/.test(photoUpload)&&/async upload\(/.test(photoUpload),'Server-only photo uploader exists as an isolated module'),
  check('photo_upload_not_http_wired',!/(?:createCar02PrivatePhotoR47|car02-private-photo-r47\.mjs)/.test(unified+entry+boundary),'Missing: private photo upload HTTP entrypoint'),
  check('staff_schema_qa_only',/QA\/REVIEW ONLY|QA\/REVIEW ONLY/i.test(staffSchema)&&/CREATE TABLE public\.ksh_car02_staff_access/.test(staffSchema),'Staff grants schema is QA-only and is not a production migration'),
  check('audit_schema_qa_only',/DO NOT APPLY TO PRODUCTION/.test(auditSchema)&&/CREATE TABLE public\.ksh_car02_staff_access_audit/.test(auditSchema),'Audit schema is QA-only and is not a production migration'),
 ];
 const staticEvidenceOk=checked.every(c=>c.ok);
 const blockers=Object.freeze([
  'PRODUCTION_BACKUP_AND_SEPARATE_RESTORE_NOT_VERIFIED',
  'SHARED_SUPABASE_SCHEMA_MIGRATION_NOT_APPROVED',
  'INITIAL_OWNER_IDENTITY_AND_PROVISIONING_NOT_IMPLEMENTED',
  'STAFF_PERMISSION_HTTP_ENTRYPOINT_NOT_WIRED',
  'PRIVATE_PHOTO_UPLOAD_HTTP_ENTRYPOINT_NOT_WIRED',
  'PRIVATE_STORAGE_BUCKET_NOT_PROVISIONED',
  'CONTRACT_AND_LIVE_ACCEPTANCE_NOT_APPROVED',
 ]);
 return Object.freeze({system:'DPRO_CAR02',version:'R80',mode:'REVIEW_ONLY_STATIC',
   evidenceDate:snapshot.date||'UNKNOWN',staticEvidenceOk,
   productionReady:false,releaseDecision:'NO_GO',migrationDecision:'HOLD',
   checks:checked,failedChecks:checked.filter(x=>!x.ok).map(x=>x.id),
   blockers,credentialOrNetworkUsage:false,
   note:staticEvidenceOk?'Static review matches known source wiring and documents outstanding integration. Not production-ready.':'Repository/snapshot drift or incomplete input. STOP and review before any migration or release.'});
}
function main(){
 try{
  const src={};
  for(const [key,path] of Object.entries(expectedFiles))src[key]=key==='snapshot'?JSON.parse(readFileSync(resolve(path),'utf8')):readFileSync(resolve(path),'utf8');
  const result=inspectCar02WiringR80(src);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if(!result.staticEvidenceOk)process.exitCode=1;
 }catch(e){
  process.stderr.write('CAR02_R80_INCOMPLETE_SOURCES: '+String(e?.code||'INVALID_INPUT')+'\n');
  process.exitCode=1;
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main();
