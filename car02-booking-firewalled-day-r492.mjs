/**
 * CAR02 V4.92 — V4.91 firewall projected into a synthetic, offline day view.
 * The V4.85–V4.91 accepted sources remain unmodified.
 * Display eligibility is NOT a booking, hold, availability claim or consent.
 */
import {buildCar02BookingDayViewR486} from './car02-booking-day-view-r486.mjs';
import {evaluateCar02BookingInputFirewallR491} from './car02-booking-input-firewall-r491.mjs';

export const CAR02_V492_RELEASE_LOCK=true;

const hold=reason=>Object.freeze({
  systemCode:'CAR02',version:'V4.92',decision:'HOLD',
  commercialDecision:'NO_GO_HOLD',releaseLock:true,reason,
  slots:Object.freeze([]),candidateTimes:Object.freeze([]),candidateCount:0,
  bookingCreationAllowed:false,databaseMutationAllowed:false,lineDispatchAllowed:false,
  commercialProviderProofsVerified:0,requiredCommercialProviderProofs:7
});

/** Every displayed candidate must pass two independent read-only checks. */
export function buildCar02FirewalledDayR492({day,calendar,now}={}){
  try{
    const base=buildCar02BookingDayViewR486({day,calendar,now});
    if(base.reason!=='synthetic_day_projection_only'||base.releaseLock!==true||
       base.bookingCreationAllowed!==false||base.decision!=='HOLD'||
       base.commercialDecision!=='NO_GO_HOLD'||base.candidateTimes.length>18||
       base.slots.length!==18) return hold('baseline_day_refused');
    const slots=[],candidateTimes=[];
    for(const slot of base.slots){
      if(typeof slot.time!=='string'||typeof slot.selectableInOfflineUi!=='boolean')
        return hold('baseline_slot_shape_invalid');
      const firewall=evaluateCar02BookingInputFirewallR491({
        selection:{day,time:slot.time},calendar,now
      });
      if(firewall.decision!=='HOLD'||firewall.releaseLock!==true||
         firewall.commercialDecision!=='NO_GO_HOLD'||
         firewall.bookingCreationAllowed!==false||
         firewall.databaseMutationAllowed!==false||
         firewall.lineDispatchAllowed!==false||
         firewall.commercialProviderProofsVerified!==0||
         firewall.requiredCommercialProviderProofs!==7)
        return hold('firewall_authority_invariant_invalid');
      const allowed=slot.selectableInOfflineUi&&firewall.candidateAvailableInOfflineUi===true;
      slots.push(Object.freeze({
        time:slot.time,state:allowed?'candidate':'unavailable',selectableInOfflineUi:allowed
      }));
      if(allowed) candidateTimes.push(slot.time);
    }
    if(candidateTimes.length!==base.candidateTimes.length)
      return hold('baseline_firewall_candidate_disagreement');
    return Object.freeze({
      systemCode:'CAR02',version:'V4.92',decision:'HOLD',
      commercialDecision:'NO_GO_HOLD',releaseLock:true,
      reason:'synthetic_firewalled_day_projection_only',
      slots:Object.freeze(slots),candidateTimes:Object.freeze(candidateTimes),
      candidateCount:candidateTimes.length,bookingCreationAllowed:false,
      databaseMutationAllowed:false,lineDispatchAllowed:false,
      commercialProviderProofsVerified:0,requiredCommercialProviderProofs:7
    });
  }catch{return hold('malformed_fixture_failed_closed');}
}
