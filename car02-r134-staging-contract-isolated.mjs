/**
 * DPRO CAR02 R134 — SYNTHETIC STAGING API CONTRACT SIMULATOR ONLY.
 * This is NOT a server, authentication system, DB-backed transaction, or customer API.
 * No network, filesystem, production credentials, LINE, payments or persisted records.
 * Supplied actor roles are test fixtures, never security credentials.
 */
import {createHash} from 'node:crypto';
import {R133_POLICY, SOURCES, initialJourney, advanceJourney, slotIsAllowed, journeySummary} from './car02-r133-integrated-journey-isolated.mjs';

export const R134_POLICY=Object.freeze({version:'R134',scope:'SYNTHETIC_IN_MEMORY_CONTRACT_ONLY',
 release:'NO_GO',migration:'HOLD',productionReady:false,stagingDeployed:false,
 realAuthentication:false,realTenantIsolation:false,realDbAtomicity:false,
 externalEvidenceVerified:false,productionWrites:false,lineDispatch:false,
 bookingCreated:false,photosStored:false,paymentMade:false,approvalLegallyVerified:false});
export const R134_OPERATIONS=Object.freeze(['RESERVE','REPORT','PRESENT_QUOTE','CUSTOMER_DECISION','COMPLETE_WORK','CANCEL']);
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/;
const KEY=/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/;
const isPlain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const shape=(x,fields)=>isPlain(x)&&Object.keys(x).sort().join('|')===fields.slice().sort().join('|');
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const clone=x=>structuredClone(x);
const fail=c=>{throw new Error(`R134_${c}`)};
const must=(yes,code)=>{if(!yes)fail(code)};
const FIELDS=['tenantId','actor','op','commandId','expectedVersion','nowMs','payload'];
const PAYLOAD={
 RESERVE:['customerId','source','date','time'], REPORT:['bookingId','note'],
 PRESENT_QUOTE:['bookingId','lines','explanation'],
 CUSTOMER_DECISION:['bookingId','choice','reason'], COMPLETE_WORK:['bookingId'], CANCEL:['bookingId']
};
function assertPolicy(){
 must(process.env.CAR02_RELEASE_LOCK==='true'&&process.env.R134_OFFLINE_QA==='yes','ISOLATION_REQUIRED');
 must(R133_POLICY.release==='NO_GO'&&R133_POLICY.migration==='HOLD'&&!R133_POLICY.productionBooking,'R133_RELEASE_GATE');
}
function authActor(a){must(shape(a,['id','role'])&&ID.test(a.id)&&['CUSTOMER','STAFF','OWNER'].includes(a.role),'ACTOR_FIXTURE');}
function requiresRole(actor,roles){must(roles.includes(actor.role),'ROLE_DENIED');}
function tenantRecord(tenants,tid){let t=tenants.get(tid);if(!t){t={version:0,nextBooking:0,bookings:new Map(),replay:new Map(),audit:[]};tenants.set(tid,t)}return t;}
function auditEntry(t,tenantId,req,bookingId,status,requestDigest){
 const prev=t.audit.length?t.audit.at(-1).hash:'0'.repeat(64);
 const body={index:t.audit.length+1,tenantId,commandId:req.commandId,op:req.op,bookingId,actorId:req.actor.id,
 actorRole:req.actor.role,status,atMs:req.nowMs,requestDigest,previousHash:prev};
 const entry={...body,hash:digest(body)};t.audit.push(entry);
}
export function verifyR134Audit(entries,tenantId){
 must(Array.isArray(entries)&&ID.test(tenantId),'AUDIT_INPUT');
 let prev='0'.repeat(64);
 for(let i=0;i<entries.length;i++){
  const e=entries[i];must(shape(e,['index','tenantId','commandId','op','bookingId','actorId','actorRole','status','atMs','requestDigest','previousHash','hash']),'AUDIT_SHAPE');
  const {hash,...body}=e;
  must(e.index===i+1&&e.tenantId===tenantId&&e.previousHash===prev&&digest(body)===hash,'AUDIT_TAMPER');
  prev=hash;
 }
 return {valid:true,records:entries.length,lastHash:prev,release:'NO_GO',migration:'HOLD',notExternalProof:true};
}
export function createR134Sandbox(){
 assertPolicy();const tenants=new Map();
 function execute(req){
  assertPolicy();
  must(shape(req,FIELDS),'REQUEST_SHAPE');
  must(typeof req.tenantId==='string'&&ID.test(req.tenantId),'TENANT');
  authActor(req.actor);
  must(R134_OPERATIONS.includes(req.op),'OPERATION');
  must(typeof req.commandId==='string'&&KEY.test(req.commandId),'COMMAND_ID');
  must(Number.isSafeInteger(req.expectedVersion)&&req.expectedVersion>=0,'EXPECTED_VERSION');
  must(Number.isSafeInteger(req.nowMs)&&req.nowMs>=0,'CLOCK');
  must(shape(req.payload,PAYLOAD[req.op]),'PAYLOAD_SHAPE');
  const t=tenantRecord(tenants,req.tenantId);
  const requestDigest=digest({tenantId:req.tenantId,actor:req.actor,op:req.op,commandId:req.commandId,nowMs:req.nowMs,payload:req.payload});
  // A retry can use the former version. Different contents for the same key fail closed.
  const existing=t.replay.get(req.commandId);
  if(existing){must(existing.requestDigest===requestDigest,'IDEMPOTENCY_COLLISION');return {...clone(existing.response),replayed:true};}
  must(t.version===req.expectedVersion,'VERSION_CONFLICT');
  let bookingId, journey;
  if(req.op==='RESERVE'){
   must(ID.test(req.payload.customerId),'CUSTOMER_ID');
   must(['CUSTOMER','STAFF','OWNER'].includes(req.actor.role),'ROLE_DENIED');
   if(req.actor.role==='CUSTOMER')must(req.payload.customerId===req.actor.id,'CUSTOMER_OWNERSHIP');
   must(SOURCES.includes(req.payload.source),'SOURCE');
   const busy=[...t.bookings.values()].filter(x=>x.journey.status!=='CANCELLED').map(x=>`${x.journey.slot.date} ${x.journey.slot.time}`);
   journey=initialJourney(req.payload.source);
   journey=advanceJourney(journey,{type:'SELECT_SLOT',date:req.payload.date,time:req.payload.time},{nowMs:req.nowMs,busy});
   journey=advanceJourney(journey,{type:'CONFIRM_DEMO'},{nowMs:req.nowMs,busy});
   t.nextBooking++;
   bookingId=`CAR02-DEMO-${req.tenantId}-${String(t.nextBooking).padStart(6,'0')}`;
   t.bookings.set(bookingId,{bookingId,tenantId:req.tenantId,customerId:req.payload.customerId,journey});
  }else{
   bookingId=req.payload.bookingId;
   must(typeof bookingId==='string'&&/^CAR02-DEMO-[A-Za-z0-9][A-Za-z0-9_-]{2,31}-\d{6}$/.test(bookingId),'BOOKING_ID');
   const item=t.bookings.get(bookingId);
   must(Boolean(item),'BOOKING_NOT_FOUND');
   if(req.actor.role==='CUSTOMER')must(item.customerId===req.actor.id,'CUSTOMER_OWNERSHIP');
   if(['REPORT','PRESENT_QUOTE','COMPLETE_WORK'].includes(req.op))requiresRole(req.actor,['STAFF','OWNER']);
   if(req.op==='CUSTOMER_DECISION')requiresRole(req.actor,['CUSTOMER']);
   if(req.op==='CANCEL')requiresRole(req.actor,['CUSTOMER','STAFF','OWNER']);
   const action=req.op==='REPORT'?{type:'REPORT',note:req.payload.note}:
    req.op==='PRESENT_QUOTE'?{type:'PRESENT_QUOTE',lines:req.payload.lines,explanation:req.payload.explanation}:
    req.op==='CUSTOMER_DECISION'?{type:'CUSTOMER_DECISION',choice:req.payload.choice,reason:req.payload.reason}:
    req.op==='COMPLETE_WORK'?{type:'COMPLETE_WORK'}:{type:'CANCEL_DEMO'};
   journey=advanceJourney(item.journey,action,{nowMs:req.nowMs});
   t.bookings.set(bookingId,{...item,journey});
  }
  t.version++;
  const response={bookingId,tenantId:req.tenantId,version:t.version,journey:journeySummary(journey),
   release:'NO_GO',migration:'HOLD',realBookingCreated:false,synthetic:true,replayed:false};
  auditEntry(t,req.tenantId,req,bookingId,journey.status,requestDigest);
  t.replay.set(req.commandId,{requestDigest,response:clone(response)});
  return clone(response);
 }
 function view({tenantId,actor,bookingId}){
  assertPolicy();must(ID.test(tenantId),'TENANT');authActor(actor);
  const t=tenants.get(tenantId);const item=t?.bookings.get(bookingId);
  must(Boolean(item),'BOOKING_NOT_FOUND');
  if(actor.role==='CUSTOMER')must(item.customerId===actor.id,'CUSTOMER_OWNERSHIP');
  return {bookingId:item.bookingId,tenantId,customerId:item.customerId,journey:clone(item.journey),
   release:'NO_GO',migration:'HOLD',synthetic:true};
 }
 function audit({tenantId,actor}){
  assertPolicy();must(ID.test(tenantId),'TENANT');authActor(actor);requiresRole(actor,['OWNER']);
  return clone(tenants.get(tenantId)?.audit??[]);
 }
 function version(tenantId){assertPolicy();must(ID.test(tenantId),'TENANT');return tenants.get(tenantId)?.version??0;}
 return Object.freeze({execute,view,audit,version,policy:R134_POLICY});
}
