/** CAR02 basic-version source connection audit — READ ONLY, offline, no deployment. */
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const SPEC = Object.freeze({
  'car02-api.mjs':['createCar02Api','service.create','service.report','service.present','service.decide','service.complete'],
  'car02-core.mjs':['createCar02Service','assertLinks','customerId','vehicleId','reservationId'],
  'car02-pg-adapter.mjs':['createCar02PgAdapter','ksh_demo_customers','ksh_demo_vehicles','ksh_demo_reservations','ksh_car02_work_orders'],
  'car02-runtime-verified-r46.mjs':['createCar02VerifiedRuntimeR46','createCar02RuntimeR45'],
  'car02-edge-entry-r52.ts':['CAR02_RELEASE_LOCK=true','CAR02_NOT_RELEASED'],
  'R13_MIGRATION_QA_ONLY.sql':['ksh_demo_customers','ksh_demo_vehicles','ksh_demo_reservations','ksh_car02_work_orders']
});
const fileName=x=>typeof x==='string'&&!x.includes('/')&&!x.includes('\\')&&!x.includes('..')&&Object.hasOwn(SPEC,x);
export async function auditCar02Source(root,{loader=async p=>readFile(p,'utf8')}={}){
  if(typeof root!=='string'||!root)throw Error('CAR02_AUDIT_ROOT_REQUIRED');
  const evidence=[];
  for(const [filename,needles] of Object.entries(SPEC)){
    if(!fileName(filename))throw Error('CAR02_AUDIT_BAD_FILENAME');
    let content;
    try{content=await loader(path.join(root,filename))}catch{evidence.push({filename,status:'MISSING',missing:needles});continue}
    const missing=needles.filter(t=>!content.includes(t));
    evidence.push({filename,status:missing.length?'REVIEW':'SOURCE_PRESENT',missing});
  }
  const r52=evidence.find(x=>x.filename==='car02-edge-entry-r52.ts');
  const all=evidence.every(x=>x.status==='SOURCE_PRESENT');
  // Static evidence is NEVER permission to deploy, connect real data or migrate DB.
  return {kind:'OFFLINE_SOURCE_AUDIT',evidence,sourceContractsPresent:all,
    release:'NO_GO',migration:'HOLD',liveApiConnected:false,realBookingWriteVerified:false,
    realLineIdentityVerified:false,realTenantRlsVerified:false,
    releaseLockPresent:r52?.status==='SOURCE_PRESENT',
    blockers:['REAL_BOOKING_WRITE_ENDPOINT','REAL_CUSTOMER_VEHICLE_PROVISIONING',
      'SERVER_VERIFIED_AUTH_BINDING','REAL_TENANT_RLS','PHOTO_PRIVATE_STORAGE',
      'BACKUP_RESTORE_EVIDENCE','HUMAN_ACCEPTANCE','OWNER_RELEASE_APPROVAL']};
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname)){
  const root=process.argv[2];if(!root){console.error('Usage: node car02-basic-connection-audit.mjs <repository-root>');process.exitCode=2}
  else {const result=await auditCar02Source(root);console.log(JSON.stringify(result,null,2));if(!result.sourceContractsPresent)process.exitCode=1;}
}
