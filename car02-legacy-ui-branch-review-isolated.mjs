/** DPRO CAR02 V2.2: legacy UI branch compatibility & safe reservation list review.
 * NO NETWORK, NO DB, NO AUTH, NO SEND, NO DEPLOY. QA-ONLY source contract.
 * /wangan owner UI and /ksh intake/customer UIs MUST NOT be conflated.
 */
import {projectCar02LegacyReservationInbox} from './car02-legacy-reservation-inbox-readonly-isolated.mjs';
export const CAR02_LEGACY_BRANCH_REVIEW_MODE=Object.freeze({
  environment:'isolated_qa',readOnly:true,realAuth:false,legacyConnected:false,
  release:'NO_GO',migration:'HOLD',sendable:false,deployable:false
});
const fail=code=>{throw Object.assign(new Error(code),{code})};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const SPECS=Object.freeze({
  owner:Object.freeze({file:'dashboard.html',branch:'wangan',list:true,markers:Object.freeze(['/api/reservations','/api/customers','function renderReservations('])}),
  ipad:Object.freeze({file:'owner-ipad.html',branch:'ksh',list:true,markers:Object.freeze(['/api/reservations','/api/customers','function renderReservationCard('])}),
  booking:Object.freeze({file:'index.html',branch:'ksh',list:false,markers:Object.freeze(['/api/public/calendar','/api/public/reservation-time-options','/api/inquiries'])}),
  member:Object.freeze({file:'member.html',branch:'ksh',list:false,markers:Object.freeze(['/api/public/customer-profile','recentReservations','function renderReservationCard('])})
});
export const CAR02_LEGACY_UI_BRANCHES=SPECS;
const BRANCH_RE=/\bconst\s+WORKER_API_BASE\s*=\s*CONTROL_ADAPTER_BASE\s*\+\s*["']\/(wangan|ksh)["']\s*;/g;
/** Read the four existing checked-out source strings; never output source or secrets. */
export function auditCar02LegacyUiBranches(sources){
 if(!plain(sources))fail('CAR02_LEGACY_BRANCH_SOURCES_REQUIRED');
 const checks=[];
 for(const [kind,spec] of Object.entries(SPECS)){
  const source=sources[spec.file];
  if(typeof source!=='string'||source.length<1000)fail('CAR02_LEGACY_BRANCH_SOURCE_MISSING_'+kind);
  const declared=[...source.matchAll(BRANCH_RE)].map(x=>x[1]);
  if(declared.length!==1||declared[0]!==spec.branch)fail('CAR02_LEGACY_BRANCH_ROUTE_DRIFT_'+kind);
  for(const marker of spec.markers)if(!source.includes(marker))fail('CAR02_LEGACY_BRANCH_PAGE_CONTRACT_DRIFT_'+kind);
  checks.push(Object.freeze({page:kind,branch:spec.branch,legacyList:spec.list,ok:true}));
 }
 return Object.freeze({checks:Object.freeze(checks),pass:checks.length,block:0,
  release:'NO_GO',migration:'HOLD',liveApiChecked:false,sourcesOnly:true});
}
/** An untrusted legacy list can be shown as an anonymized QA review ONLY.
 * page and branch must be chosen by the caller from a checked-out page contract,
 * never from row.shop_code / request fields. This makes no auth claim.
 */
export function createCar02BranchBoundInboxQa({page,branch,environment,allowIsolatedQa=false}={}){
 const spec=SPECS[page];
 if(environment!=='isolated_qa'||allowIsolatedQa!==true||!spec||!spec.list||branch!==spec.branch)
   fail('CAR02_LEGACY_BRANCH_REVIEW_ISOLATION_REQUIRED');
 return Object.freeze({
  project(response,{maxRows=200}={}){
   if(!plain(response)||!Array.isArray(response.reservations))fail('CAR02_LEGACY_BRANCH_RESPONSE_INVALID');
   // Reject extra caller-provided branch/identity claims in the envelope, not just ignore them.
   const forbidden=['branch','shopCode','shop_code','tenant','actor','token','authorization'];
   if(forbidden.some(k=>Object.prototype.hasOwnProperty.call(response,k)))fail('CAR02_LEGACY_BRANCH_ENVELOPE_CLAIM_DENIED');
   const projected=projectCar02LegacyReservationInbox(response,{maxRows});
   return Object.freeze({...projected,sourcePage:page,sourceBranch:spec.branch,
    sourceVerified:false,serverVerified:false,sendable:false,readOnly:true});
  },
  /** This marker is for isolated *review* only, not a request to R45. */
  inspectionOnly(snapshot,reservationId){
   if(!plain(snapshot)||snapshot.sourcePage!==page||snapshot.sourceBranch!==spec.branch||
      snapshot.sendable!==false||snapshot.clientVerified!==false||snapshot.sourceVerified!==false||
      !Array.isArray(snapshot.items)||typeof reservationId!=='string')fail('CAR02_LEGACY_BRANCH_SNAPSHOT_INVALID');
   const item=snapshot.items.find(x=>x.reservationId===reservationId.toLowerCase());
   if(!item||item.reviewable!==true||item.sendable!==false||item.needsServerVerification!==true)
     fail('CAR02_LEGACY_BRANCH_BOOKING_NOT_REVIEWABLE');
   return Object.freeze({reservationId:item.reservationId,sourcePage:page,sourceBranch:spec.branch,
     requiresServerR13Recheck:true,authorizesOrder:false,sendable:false,release:'NO_GO',migration:'HOLD'});
  }
 });
}
/** KSH fixture may be inspected with KSH-only selector. Wangan cannot be promoted. */
export function assertCar02QaR13BranchBoundary(marker,{expectedBranch='ksh'}={}){
 if(!plain(marker)||marker.sourceBranch!==expectedBranch||marker.sourcePage!=='ipad'||
   marker.requiresServerR13Recheck!==true||marker.authorizesOrder!==false||marker.sendable!==false||
   typeof marker.reservationId!=='string')fail('CAR02_LEGACY_BRANCH_R13_BOUNDARY_DENIED');
 return Object.freeze({reservationId:marker.reservationId,sendable:false,
   authorization:'SERVER_VERIFICATION_REQUIRED',release:'NO_GO',migration:'HOLD'});
}
