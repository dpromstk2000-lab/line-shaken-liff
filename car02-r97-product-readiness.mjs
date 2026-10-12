// CAR02 R97: offline order-intake safety model, not a production deployment gate.
// Never imports an application runtime, reads secrets, calls external services or writes customer data.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export const R97_PRODUCT='DPRO_CAR02';
export const R97_RELEASE=Object.freeze({productionReady:false,productionDeployAllowed:false,
  customerDataMigrationAllowed:false,lineDispatchAllowed:false,releaseDecision:'NO_GO',migrationDecision:'HOLD'});
export const R97_APPROVALS=Object.freeze([
  'scope_and_price','contract_and_billing','privacy_and_data_controller',
  'line_message_and_consent','owner_identity','staff_and_tenant_roles',
  'calendar_and_booking_rules','domain_and_public_pages','support_and_incident_contact'
]);
export const R97_PRODUCTION_BLOCKERS=Object.freeze([
  {id:'PRODUCTION_BACKUP_RESTORE',who:'DB責任者',doneWhen:'実運用バックアップを本番と別の管理環境に復元し証跡確認'},
  {id:'COMPANY_PC_HUMAN_QA',who:'会社PC担当者',doneWhen:'R90 JSONを実機で保存しR91課題整理'},
  {id:'DB_MIGRATION_AUTHORIZATION',who:'DB責任者',doneWhen:'DDL差分・テナント範囲・復旧手順を二者承認'},
  {id:'INITIAL_OWNER_IDENTITY',who:'店舗責任者',doneWhen:'初期オーナーの本人確認・招待・権限変更監査'},
  {id:'STAFF_API_PRODUCTION_WIRING',who:'開発責任者',doneWhen:'実店舗RLS・スタッフ権限とR50/R52結線を別環境で検査'},
  {id:'PRIVATE_PHOTO_PRODUCTION_STORAGE',who:'開発責任者',doneWhen:'実Storage秘密設定・再送・削除回収・DB保存の結合検査'},
  {id:'CONTRACT_LINE_NOTIFICATION_APPROVAL',who:'契約担当者',doneWhen:'LINE配信・通知・顧客同意・契約内容を承認'},
  {id:'ROLLBACK_POST_DEPLOY_QA',who:'運用担当者',doneWhen:'公開・監視・障害復旧・元に戻す手順を承認'}
]);
export const R97_ALLOWED_SERVICES=Object.freeze(['HP','LINE_OFFICIAL','RESERVATION_WEB','CAR02_MANAGEMENT','PRIVATE_PHOTO']);
const INTAKE_SCHEMA='DPRO_CAR02_ORDER_INTAKE_TEMPLATE_R97';
function fail(code){throw Object.assign(new Error(code),{code});}
function exactKeys(o,keys){return o!==null && typeof o==='object' && !Array.isArray(o) &&
  Object.keys(o).sort().join('|')===keys.slice().sort().join('|') && Object.getPrototypeOf(o)===Object.prototype;}
const bool=x=>x===true||x===false;

export function validateR97Intake(input){
 if(!exactKeys(input,['schema','version','customerType','facilityCode','requestedServices','domainPlan','bookingMinutes','approvals']))fail('R97_INTAKE_SCHEMA');
 if(input.schema!==INTAKE_SCHEMA || input.version!==1)fail('R97_INTAKE_VERSION');
 if(input.customerType!==null&&!['new','existing'].includes(input.customerType))fail('R97_CUSTOMER_TYPE');
 if(input.facilityCode!==null && (typeof input.facilityCode!=='string'||!/^[a-z][a-z0-9_]{5,47}$/.test(input.facilityCode)))fail('R97_FACILITY_CODE');
 if(!Array.isArray(input.requestedServices)||input.requestedServices.length!==R97_ALLOWED_SERVICES.length||
   input.requestedServices.join('|')!==R97_ALLOWED_SERVICES.join('|'))fail('R97_SCOPE_TEMPLATE_CHANGED');
 if(input.domainPlan!==null&&!['existing_domain','new_domain','pending'].includes(input.domainPlan))fail('R97_DOMAIN_PLAN');
 if(input.bookingMinutes!==null && ![10,15,30].includes(input.bookingMinutes))fail('R97_BOOKING_INTERVAL');
 if(!exactKeys(input.approvals,R97_APPROVALS))fail('R97_APPROVAL_FIELDS');
 for(const key of R97_APPROVALS)if(!bool(input.approvals[key]))fail('R97_APPROVAL_VALUE_'+key);
 const pending=[...R97_APPROVALS.filter(key=>!input.approvals[key])];
 for(const name of ['customerType','facilityCode','domainPlan','bookingMinutes'])if(input[name]===null || input[name]==='pending')pending.push(name);
 // This routine does not echo actual tenant codes, private contract details, or customer names into reports.
 return Object.freeze({intakeInformationComplete:pending.length===0,
  stage:pending.length?'ORDER_INTAKE_INFORMATION_PENDING':'ORDER_INTAKE_INFORMATION_COMPLETE_NOT_AUTHORIZED',
  pending:Object.freeze(pending),completed:R97_APPROVALS.length - R97_APPROVALS.filter(x=>!input.approvals[x]).length,
  releaseDecision:'NO_GO',migrationDecision:'HOLD'});
}

export function gitBlobSha1(raw){
 assert.ok(typeof raw==='string','R97_RAW_SOURCE_REQUIRED');
 const data=Buffer.from(raw,'utf8');
 return createHash('sha1').update(Buffer.from(`blob ${data.length}\0`)).update(data).digest('hex');
}
export function validateR97SourceBaseline(files,expected){
 if(!exactKeys(files,Object.keys(expected))||Object.keys(expected).length<7)fail('R97_SOURCE_SET_INCOMPLETE');
 for(const [name,sha] of Object.entries(expected)){
  if(!/^[a-f\d]{40}$/.test(sha)||typeof files[name]!=='string'||gitBlobSha1(files[name])!==sha)
    fail('R97_SOURCE_BASELINE_DRIFT_'+name);
 }
 const entry=files['car02-edge-entry-r52.ts'];
 if(typeof entry!=='string'||!entry.includes('const CAR02_RELEASE_LOCK=true;')||
    !entry.includes('isServerReleased:()=>!CAR02_RELEASE_LOCK'))fail('R97_RELEASE_LOCK_DRIFT');
 return Object.freeze({verified:true,count:Object.keys(expected).length,releaseLock:true});
}

export function assembleR97Report({sourceStatus,integration,intake,githubEvidence,playbookReady}={}){
 if(!sourceStatus||sourceStatus.verified!==true||sourceStatus.releaseLock!==true||sourceStatus.count<7)fail('R97_UNVERIFIED_SOURCES');
 if(!integration||integration.releaseDecision!=='NO_GO'||integration.migrationDecision!=='HOLD'||
    integration.integrationReady!==false||integration.sourceAuditOnly!==true||
    integration.unsafeCount!==0||integration.openCount!==6||
    !Array.isArray(integration.openGates)||integration.openGates.length!==6)fail('R97_INTEGRATION_BASELINE_DRIFT');
 if(githubEvidence!=='R96_GITHUB_ACTIONS_SUCCESS_38191039794')fail('R97_GITHUB_EVIDENCE_UNVERIFIED');
 if(playbookReady!==true)fail('R97_PLAYBOOK_MISSING');
 const intakeResult=validateR97Intake(intake);
 return Object.freeze({schema:'DPRO_CAR02_R97_ORDER_READINESS_AUDIT',mode:'SOURCE_ONLY_READ_ONLY',
  githubEvidence:'https://github.com/dpromstk2000-lab/line-shaken-liff/actions/runs/38191039794',
  lastSuccessfulIsolationQA:'R96',sourceFilesVerified:sourceStatus.count,
  orderPreparation:'TEMPLATE_AND_CHECKLIST_READY',
  intake: intakeResult,
  stagingIntegrationGaps:Object.freeze(integration.openGates.slice()),
  productionBlockers:Object.freeze(R97_PRODUCTION_BLOCKERS.map(x=>({...x,state:'PENDING_VERIFICATION'}))),
  ...R97_RELEASE});
}

export function assertR97NeverApprovesProduction(report){
 if(!report||report.schema!=='DPRO_CAR02_R97_ORDER_READINESS_AUDIT'||
    report.productionReady!==false||report.productionDeployAllowed!==false||
    report.customerDataMigrationAllowed!==false||report.lineDispatchAllowed!==false||
    report.releaseDecision!=='NO_GO'||report.migrationDecision!=='HOLD'||
    report.productionBlockers.length!==8||report.stagingIntegrationGaps.length!==6)
   fail('R97_FAIL_CLOSED_GATE');
 return true;
}
