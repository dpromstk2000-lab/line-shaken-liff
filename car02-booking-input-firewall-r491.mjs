/**
 * CAR02 V4.91: strict, OFFLINE-only adapter for untrusted in-memory booking
 * inputs. Not wired to the accepted UI or any live service.
 * Never creates a booking, obtains a credential, or relaxes R52.
 */
import {evaluateCar02BookingCalendarR485} from './car02-booking-calendar-policy-r485.mjs';

export const CAR02_V491_RELEASE_LOCK=true;
export const CAR02_V491_BASE_RUN_ID=39748618887;
const INPUT_KEYS=['selection','calendar','now'];
const SELECTION_KEYS=['day','time'];
const CALENDAR_KEYS=['systemCode','environment','coverageThrough','closedDays','occupiedSlots'];
const ALLOWED_REASONS=new Set([
  'candidate_available_offline_only','selection_shape_invalid',
  'calendar_shape_or_isolation_invalid','one_year_calendar_coverage_missing',
  'closed_day_inventory_invalid','occupied_slot_inventory_invalid',
  'selected_day_invalid','selected_time_not_half_hour',
  'outside_business_hours','booking_date_outside_open_window',
  'sunday_closed','owner_declared_closed_day','synthetic_slot_occupied',
  'clock_invalid'
]);

function plainRecordWithOwnDataKeys(value,keys){
  if(value===null||typeof value!=='object'||Array.isArray(value))return false;
  const proto=Object.getPrototypeOf(value);
  if(proto!==Object.prototype&&proto!==null)return false;
  const own=Reflect.ownKeys(value);
  if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)))return false;
  for(const key of keys){
    const desc=Object.getOwnPropertyDescriptor(value,key);
    if(!desc||!Object.hasOwn(desc,'value'))return false;
  }
  return true;
}

function denseStringArray(value,max){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>max)return false;
  const own=Reflect.ownKeys(value);
  if(own.length!==value.length+1||!own.includes('length'))return false;
  for(let i=0;i<value.length;i++){
    const desc=Object.getOwnPropertyDescriptor(value,String(i));
    if(!desc||!Object.hasOwn(desc,'value')||typeof desc.value!=='string')return false;
  }
  return true;
}

const locked=(reason,candidate=false)=>Object.freeze({
  systemCode:'CAR02',version:'V4.91',decision:'HOLD',commercialDecision:'NO_GO_HOLD',
  releaseLock:true,reason,candidateAvailableInOfflineUi:candidate,
  bookingCreationAllowed:false,realCalendarOwnershipVerified:false,
  liveHolidayProviderChecked:false,staffIdentityVerified:false,
  databaseMutationAllowed:false,lineDispatchAllowed:false,
  commercialProviderProofsVerified:0,requiredCommercialProviderProofs:7
});

/** Always returns an immutable, non-authorizing decision; all errors fail closed. */
export function evaluateCar02BookingInputFirewallR491(payload){
  try {
    if(!plainRecordWithOwnDataKeys(payload,INPUT_KEYS))return locked('payload_shape_invalid');
    if(!plainRecordWithOwnDataKeys(payload.selection,SELECTION_KEYS))return locked('selection_shape_invalid');
    if(!plainRecordWithOwnDataKeys(payload.calendar,CALENDAR_KEYS))return locked('calendar_shape_invalid');
    if(!denseStringArray(payload.calendar.closedDays,366)||
       !denseStringArray(payload.calendar.occupiedSlots,10000))
      return locked('calendar_inventory_shape_invalid');
    if(!(payload.now instanceof Date)||Object.getPrototypeOf(payload.now)!==Date.prototype||
       Reflect.ownKeys(payload.now).length!==0||
       !Number.isFinite(Date.prototype.getTime.call(payload.now)))return locked('clock_invalid');

    const baseline=evaluateCar02BookingCalendarR485(payload);
    if(!baseline||baseline.systemCode!=='CAR02'||baseline.releaseLock!==true||
       baseline.decision!=='HOLD'||baseline.commercialDecision!=='NO_GO_HOLD'||
       baseline.bookingCreationAllowed!==false||baseline.databaseMutationAllowed!==false||
       baseline.lineDispatchAllowed!==false||baseline.commercialProviderProofsVerified!==0||
       baseline.requiredCommercialProviderProofs!==7||!ALLOWED_REASONS.has(baseline.reason))
      return locked('baseline_policy_result_invalid');
    const candidate=baseline.reason==='candidate_available_offline_only'&&
      baseline.candidateAvailableInOfflineUi===true;
    return locked(baseline.reason,candidate);
  }catch{
    return locked('malformed_input_failed_closed');
  }
}
