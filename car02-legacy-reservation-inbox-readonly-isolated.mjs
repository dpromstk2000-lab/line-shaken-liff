/**
 * DPRO CAR02 V2.1 — LEGACY /wangan + /ksh reservation LIST display compatibility.
 * ISOLATED READ-ONLY PROJECTION. This is NOT an authenticated legacy API consumer.
 * It NEVER performs HTTP, database writes, token validation, or migrations.
 * List items are UNTRUSTED, and can only generate an ID to be REVALIDATED in R13.
 * Customer names, phones, vehicle details, and client-supplied tenant claims are discarded.
 */
export const CAR02_LEGACY_INBOX_MODE=Object.freeze({
  source:'legacy_reservation_list_shape',environment:'isolated_qa',readOnly:true,
  productionReady:false,sendable:false,realLegacyApiConnected:false,
  realAuthVerified:false,release:'NO_GO',migration:'HOLD'
});
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const CLOSED=new Set(['キャンセル','キャンセル済み','削除済み','引渡し完了','cancelled','canceled','deleted']);
const KNOWN=new Set(['仮入庫','入庫予定','受付・入庫済み','点検中','見積作成中',
  'お客様確認待ち','作業中','最終確認','引渡し可能',...CLOSED]);
const plain=o=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&Object.getPrototypeOf(o)===Object.prototype;
const fail=code=>{throw Object.assign(new Error(code),{code})};
const dateOK=x=>{
 if(typeof x!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(x))return false;
 const d=new Date(x+'T00:00:00.000Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===x;
};
const normalizedTime=x=>typeof x==='string'&&/^([01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9])?$/.test(x)?x.slice(0,5):null;
const MAX_ROWS=300;
function projectRow(row){
 if(!plain(row)||typeof row.id!=='string'||!UUID.test(row.id))return null;
 const status=typeof row.status==='string'&&KNOWN.has(row.status)?row.status:'要確認';
 const day=dateOK(row.reservation_date)?row.reservation_date:null;
 const time=normalizedTime(row.reservation_time);
 // This is a display hint ONLY. The tenant/ownership/booking state must be checked server-side.
 const reviewable=day!==null&&time!==null&&status!=='要確認'&&!CLOSED.has(status);
 return Object.freeze({reservationId:row.id.toLowerCase(),day,time,status,
   reviewable,needsServerVerification:true,sendable:false,readOnly:true});
}
/** The actual legacy UI reads {reservations: []} from /api/reservations.
 * Other legacy fields are permitted but NEVER exposed. Reject duplicate IDs rather
 * than silently selecting an ambiguous/forged row.
 */
export function projectCar02LegacyReservationInbox(source,{maxRows=200}={}){
 if(!plain(source)||!Array.isArray(source.reservations)||source.reservations.length>MAX_ROWS||
    !Number.isSafeInteger(maxRows)||maxRows<1||maxRows>MAX_ROWS)
    fail('CAR02_LEGACY_INBOX_RESPONSE_INVALID');
 const seen=new Set(),records=[];let discarded=0,notReviewable=0;
 for(const row of source.reservations){
  const item=projectRow(row);
  if(!item){discarded++;continue;}
  if(seen.has(item.reservationId))fail('CAR02_LEGACY_INBOX_DUPLICATE_ID');
  seen.add(item.reservationId);
  if(!item.reviewable)notReviewable++;
  if(records.length<maxRows)records.push(item);
 }
 return Object.freeze({items:Object.freeze(records),total:source.reservations.length,
   discarded,notReviewable,limited:seen.size>records.length,
   clientVerified:false,sendable:false,readOnly:true,release:'NO_GO',migration:'HOLD'});
}
/** Only V2.0 read-only R13 bridge may promote an ID to a prepared descriptor.
 * Must receive a trusted QA-only actor separately from the untrusted list.
 * It never grants the user authority or changes a reservation / work order.
 */
export function createCar02LegacyInboxSelectionQa({handoff,actor,environment,allowIsolatedQa=false}={}){
 if(environment!=='isolated_qa'||allowIsolatedQa!==true||
   !handoff||typeof handoff.prepare!=='function'||typeof handoff.send!=='undefined'||
   !plain(actor)||actor.verified!==true||!['staff','owner'].includes(actor.role)||
   !actor.subject||!actor.shopCode)fail('CAR02_LEGACY_INBOX_ISOLATION_REQUIRED');
 return Object.freeze({
  async prepareSelected(snapshot,selection){
   if(!plain(snapshot)||!Array.isArray(snapshot.items)||snapshot.clientVerified!==false||
      snapshot.sendable!==false||!plain(selection)||
      Object.keys(selection).sort().join('|')!=='idempotencyKey|reservationId')
      fail('CAR02_LEGACY_INBOX_SELECTION_INVALID');
   const {reservationId,idempotencyKey}=selection;
   if(typeof reservationId!=='string'||!UUID.test(reservationId))fail('CAR02_LEGACY_INBOX_UUID_REQUIRED');
   const item=snapshot.items.find(x=>x.reservationId===reservationId.toLowerCase());
   if(!item||item.reviewable!==true||item.sendable!==false||item.needsServerVerification!==true)
      fail('CAR02_LEGACY_INBOX_NOT_REVIEWABLE');
   const result=await handoff.prepare({actor,reservationId:item.reservationId,idempotencyKey});
   if(result.sendable!==false||result.readOnly!==true||result.authorization!=='SERVER_VERIFICATION_REQUIRED'||
      result.body?.reservationId!==item.reservationId)fail('CAR02_LEGACY_INBOX_BRIDGE_INVALID');
   return Object.freeze({...result,source:'LEGACY_LIST_DISPLAY_R13_RECHECK',
     displayVerified:false,sendable:false,readOnly:true});
  }
 });
}
