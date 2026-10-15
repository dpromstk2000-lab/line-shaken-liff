/**
 * DPRO CAR02 — Order-to-build readiness, OFFLINE / READ-ONLY.
 * This module prepares a customer-specific implementation plan, NOT a live tenant,
 * API, database migration, deployed Worker, LINE account or production release.
 */
import { createHash } from 'node:crypto';

export const KIT_ID = 'DPRO_CAR02_CUSTOMER_BUILD_PREP_V1_20261015';
export const SERVICES = Object.freeze(['HP','LINE_OFFICIAL','RESERVATION_WEB','CAR02_MANAGEMENT','PRIVATE_PHOTO']);
export const APPROVAL_KEYS = Object.freeze([
 'scope_and_price','contract_and_billing','privacy_and_data_controller',
 'line_message_and_consent','owner_identity','staff_and_tenant_roles',
 'calendar_and_booking_rules','domain_and_public_pages','support_and_incident_contact'
]);
export const REQUIREMENTS = Object.freeze([
 ['PRODUCT_SCOPE','提供機能・料金・契約範囲を確定'],
 ['OWNER_IDENTITY','店舗オーナー本人確認と権限割当'],
 ['CLIENT_ACCOUNTS','顧客名義の必要アカウント・管理者招待'],
 ['ISOLATED_STAGING','お客様専用の隔離検証環境'],
 ['WORKER_API_DB','Worker・API・DBの実結合検査'],
 ['REAL_AUTH_RLS','実認証・店舗/顧客/スタッフ権限RLS検証'],
 ['BOOKING_E2E','予約・重複防止・取消・変更の実接続E2E'],
 ['REPORT_ESTIMATE_E2E','整備報告・見積・承認・完了E2E'],
 ['PHOTO_STORAGE_IF_ENABLED','写真が対象なら非公開Storage・失敗時回復検証'],
 ['LINE_IF_ENABLED','LINEが対象なら本人確認・同意・通知検証'],
 ['BACKUP_RESTORE','必要なデータの保護・隔離先での復元証明'],
 ['HUMAN_ACCEPTANCE','オーナー・スタッフのPC/スマホ受入QA'],
 ['OPERATIONS_ROLLBACK','監視・サポート・障害復旧とロールバック'],
 ['EXPLICIT_RELEASE_SIGNOFF','承認済み構成に対する明示的な公開判定']
]);
const isPlain = x => x!==null && typeof x==='object' && !Array.isArray(x) && Object.getPrototypeOf(x)===Object.prototype;
const exactKeys=(x,keys)=>isPlain(x)&&Object.keys(x).sort().join('|')===keys.slice().sort().join('|');
function deny(code){throw Object.assign(new Error('CAR02_'+code),{code:'CAR02_'+code});}
export function blankDraft(){return {
 schema:'DPRO_CAR02_CUSTOMER_BUILD_DRAFT_V1',version:1,
 customerType:null,facilityCode:null,domainPlan:null,bookingMinutes:30,
 services:['HP','RESERVATION_WEB','CAR02_MANAGEMENT'],
 approvals:Object.fromEntries(APPROVAL_KEYS.map(k=>[k,false]))
};}
export function validateDraft(v){
 if(!exactKeys(v,['schema','version','customerType','facilityCode','domainPlan','bookingMinutes','services','approvals']))deny('SHAPE');
 if(v.schema!=='DPRO_CAR02_CUSTOMER_BUILD_DRAFT_V1'||v.version!==1)deny('VERSION');
 if(v.customerType!==null&&!['new','existing'].includes(v.customerType))deny('CUSTOMER_TYPE');
 if(v.facilityCode!==null && (typeof v.facilityCode!=='string'||!/^[a-z][a-z0-9_]{5,47}$/.test(v.facilityCode)))deny('FACILITY_CODE');
 if(v.domainPlan!==null&&!['existing_domain','new_domain','pending'].includes(v.domainPlan))deny('DOMAIN');
 if(![10,15,30].includes(v.bookingMinutes))deny('MINUTES');
 if(!Array.isArray(v.services)||v.services.length<1||v.services.length>SERVICES.length||
    new Set(v.services).size!==v.services.length||v.services.some(x=>!SERVICES.includes(x)))deny('SERVICES');
 if(v.services.includes('PRIVATE_PHOTO')&&!v.services.includes('CAR02_MANAGEMENT'))deny('PHOTO_REQUIRES_MANAGEMENT');
 if(!exactKeys(v.approvals,APPROVAL_KEYS)||APPROVAL_KEYS.some(k=>typeof v.approvals[k]!=='boolean'))deny('APPROVALS');
 return true;
}
export function assessDraft(v){
 validateDraft(v);
 const missing=APPROVAL_KEYS.filter(k=>!v.approvals[k]);
 if(v.customerType===null)missing.push('customerType');
 if(v.facilityCode===null)missing.push('facilityCode');
 if(v.domainPlan===null||v.domainPlan==='pending')missing.push('domainPlan');
 const requested=v.services.slice();
 const required=REQUIREMENTS.filter(([id])=>(id!=='PHOTO_STORAGE_IF_ENABLED'||requested.includes('PRIVATE_PHOTO'))&&
   (id!=='LINE_IF_ENABLED'||requested.includes('LINE_OFFICIAL'))).map(([id,label])=>({id,label,status:'NOT_VERIFIED'}));
 return Object.freeze({kit:KIT_ID,scope:'OFFLINE_ORDER_PREPARATION',
  orderIntakeComplete:missing.length===0,
  intakeState:missing.length===0?'INFORMATION_COMPLETE_NOT_DEPLOY_AUTHORIZED':'INFORMATION_PENDING',
  missing,requestedServices:requested,requiredGates:required,
  realEnvironmentVerified:false,customerTenantCreated:false,workerDeployed:false,
  realBookingCreated:false,realPhotoStored:false,lineSent:false,
  productionReady:false,releaseAuthorized:false,migrationAuthorized:false,
  releaseDecision:'NO_GO',migrationDecision:'HOLD',realWorldGatesOpen:true});
}
export function hashAsGitBlob(text){
 if(typeof text!=='string')deny('SOURCE');
 const buf=Buffer.from(text,'utf8');
 return createHash('sha1').update(Buffer.from(`blob ${buf.length}\0`)).update(buf).digest('hex');
}
export function checkSourceSnapshot(actual, expected){
 if(!isPlain(actual)||!isPlain(expected)||Object.keys(expected).length<4||!exactKeys(actual,Object.keys(expected)))deny('SOURCE_SET');
 for(const [name,sha] of Object.entries(expected)){
  if(!/^[0-9a-f]{40}$/.test(sha)||typeof actual[name]!=='string'||hashAsGitBlob(actual[name])!==sha)deny('SOURCE_CHANGED_'+name);
 }
 return Object.freeze({readOnly:true,sourcesVerified:Object.keys(expected).length,releaseDecision:'NO_GO',migrationDecision:'HOLD',deploymentAuthorized:false});
}
export function protectedDecision(){
 return Object.freeze({releaseDecision:'NO_GO',migrationDecision:'HOLD',
 customerDeployAuthorized:false,productionDbWriteAuthorized:false,
 workerDeployAuthorized:false,lineDispatchAuthorized:false,
 privatePhotoDeleteAuthorized:false,technicalReviewRequired:true});
}
