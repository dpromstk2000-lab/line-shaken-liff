// DPRO CAR02 R98: offline-only intake worksheet model; shared by browser and Node QA.
// No runtime/network/production imports. This cannot authorize deployment.
export const R98_SCHEMA='DPRO_CAR02_ORDER_INTAKE_TEMPLATE_R97';
export const R98_APPROVALS=Object.freeze([
 ['scope_and_price','提供範囲と料金'],
 ['contract_and_billing','契約・請求条件'],
 ['privacy_and_data_controller','個人情報・データ管理責任'],
 ['line_message_and_consent','LINE通知・同意'],
 ['owner_identity','オーナー本人確認方針'],
 ['staff_and_tenant_roles','スタッフ権限と店舗分離'],
 ['calendar_and_booking_rules','予約とカレンダーの運用'],
 ['domain_and_public_pages','ドメイン・公開ページ'],
 ['support_and_incident_contact','サポート・障害連絡体制']
]);
export const R98_SERVICES=Object.freeze(['HP','LINE_OFFICIAL','RESERVATION_WEB','CAR02_MANAGEMENT','PRIVATE_PHOTO']);
export const R98_HARD_LOCK=Object.freeze({productionReady:false,productionDeployAllowed:false,customerDataMigrationAllowed:false,lineDispatchAllowed:false,releaseDecision:'NO_GO',migrationDecision:'HOLD'});
const fields=Object.freeze(['schema','version','customerType','facilityCode','requestedServices','domainPlan','bookingMinutes','approvals']);
const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype&&Object.keys(x).sort().join('|')===keys.slice().sort().join('|');
const fail=code=>{throw Object.assign(new Error(code),{code});};
export function blankR98Intake(){return {schema:R98_SCHEMA,version:1,customerType:null,facilityCode:null,
 requestedServices:[...R98_SERVICES],domainPlan:null,bookingMinutes:null,
 approvals:Object.fromEntries(R98_APPROVALS.map(([k])=>[k,false]))};}
export function validateR98Intake(v){
 if(!exact(v,fields))fail('R98_SCHEMA_DENIED');
 if(v.schema!==R98_SCHEMA||v.version!==1)fail('R98_VERSION_DENIED');
 if(v.customerType!==null&&!['new','existing'].includes(v.customerType))fail('R98_CUSTOMER_TYPE_DENIED');
 if(v.facilityCode!==null&&!(typeof v.facilityCode==='string'&&/^[a-z][a-z0-9_]{5,47}$/.test(v.facilityCode)))fail('R98_FACILITY_CODE_DENIED');
 if(!Array.isArray(v.requestedServices)||v.requestedServices.join('|')!==R98_SERVICES.join('|'))fail('R98_PRODUCT_SCOPE_DENIED');
 if(v.domainPlan!==null&&!['existing_domain','new_domain','pending'].includes(v.domainPlan))fail('R98_DOMAIN_PLAN_DENIED');
 if(v.bookingMinutes!==null&&![10,15,30].includes(v.bookingMinutes))fail('R98_BOOKING_RULE_DENIED');
 const names=R98_APPROVALS.map(x=>x[0]);
 if(!exact(v.approvals,names))fail('R98_APPROVAL_FIELDS_DENIED');
 for(const name of names)if(typeof v.approvals[name]!=='boolean')fail('R98_APPROVAL_VALUE_DENIED');
 const pending=names.filter(name=>!v.approvals[name]);
 for(const key of ['customerType','facilityCode','domainPlan','bookingMinutes'])if(v[key]===null||v[key]==='pending')pending.push(key);
 return Object.freeze({intakeInformationComplete:pending.length===0,completedApprovals:names.length-names.filter(n=>!v.approvals[n]).length,
 pending:Object.freeze(pending),stage:pending.length?'ORDER_INTAKE_INFORMATION_PENDING':'ORDER_INTAKE_INFORMATION_COMPLETE_NOT_AUTHORIZED',
 ...R98_HARD_LOCK});
}
export function parseR98Import(text){
 if(typeof text!=='string'||text.length>12000||text.length<10)fail('R98_IMPORT_LENGTH_DENIED');
 let data;try{data=JSON.parse(text)}catch{fail('R98_IMPORT_NOT_JSON')}
 validateR98Intake(data);
 return structuredClone(data);
}
export function exportR98Json(v){validateR98Intake(v);return JSON.stringify(v,null,2)+'\n';}
export const R98_INFO=Object.freeze({mode:'OFFLINE_ONLY',contractReadinessIsNotDeploymentApproval:true,personalDataExcluded:true,doesNotStoreInBrowser:true,...R98_HARD_LOCK});
