/**
 * CAR02 V4.90 — deterministic boundary sweep of the already approved
 * V4.85–V4.89 OFFLINE display-only sources. Never mutates or connects.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CAR02_V485_SLOT_MINUTES,evaluateCar02BookingCalendarR485}
  from './car02-booking-calendar-policy-r485.mjs';
import {buildCar02BookingDayViewR486} from './car02-booking-day-view-r486.mjs';
import {buildCar02MonthGridR487,car02JstTodayR487,car02PlusUtcDaysR487}
  from './car02-booking-month-grid-r487.mjs';
import {createCar02SyntheticCalendarR487}
  from './car02-booking-calendar-preview-r487.mjs';

export const CAR02_V490_RELEASE_LOCK=true;
export const CAR02_V490_BASELINE_HTML_SHA256=
  '6b07eacfb56aaf2004fdf4bbddb2e40563a3e957304fad3c9abcd763a5ebbc38';
export const CAR02_V490_CLOCK_FIXTURES=Object.freeze([
  '2026-10-22T01:10:00.000Z',
  '2026-12-31T14:59:00.000Z',
  '2026-12-31T15:01:00.000Z',
  '2027-01-31T23:50:00.000Z',
  '2028-02-28T14:59:00.000Z',
  '2028-02-28T15:01:00.000Z',
  '2028-02-29T06:00:00.000Z',
  '2028-12-31T15:01:00.000Z'
]);

const TIMES=Object.freeze(Array.from({length:18},(_,i)=>{
  const minute=9*60+i*30;
  return `${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
}));
const hold=(reason)=>Object.freeze({
  systemCode:'CAR02',version:'V4.90',decision:'HOLD',commercialDecision:'NO_GO_HOLD',
  releaseLock:true,reason,boundaryVerified:false,findings:Object.freeze([reason]),
  checkedClocks:0,checkedDays:0,checkedSlots:0,checkedMonths:0,
  providerProofsVerified:0,requiredProviderProofs:7,bookingCreationAllowed:false
});

/** Reproducible scan; even a PASS here never grants production authority. */
export function scanCar02BookingBoundariesR490(){
  try {
    if(CAR02_V490_RELEASE_LOCK!==true||CAR02_V485_SLOT_MINUTES!==30)
      return hold('baseline_or_release_lock_invalid');
    const source=readFileSync(new URL('./CAR02_V489_STANDALONE_OFFLINE_BOOKING_PREVIEW.html',import.meta.url));
    if(createHash('sha256').update(source).digest('hex')!==CAR02_V490_BASELINE_HTML_SHA256)
      return hold('v489_html_sha256_mismatch');
    const findings=[];
    let checkedDays=0,checkedSlots=0,checkedMonths=0;
    for(const iso of CAR02_V490_CLOCK_FIXTURES){
      const now=new Date(iso),today=car02JstTodayR487(now);
      const calendar=createCar02SyntheticCalendarR487(now);
      if(!today||!calendar){findings.push(`clock_invalid:${iso}`);continue;}
      for(let offset=0;offset<=61;offset++){
        const day=car02PlusUtcDaysR487(today,offset);
        const view=buildCar02BookingDayViewR486({day,calendar,now});
        checkedDays++;
        const expected=[];
        for(const time of TIMES){
          const verdict=evaluateCar02BookingCalendarR485({selection:{day,time},calendar,now});
          checkedSlots++;
          if(verdict.releaseLock!==true||verdict.bookingCreationAllowed!==false||
              verdict.commercialDecision!=='NO_GO_HOLD') findings.push(`authority:${iso}:${day}:${time}`);
          if(verdict.reason==='candidate_available_offline_only') expected.push(time);
        }
        if(JSON.stringify(view.candidateTimes)!==JSON.stringify(expected)||
            view.candidateCount!==expected.length)
          findings.push(`slot_parity:${iso}:${day}`);
        if(offset===61&&expected.length!==0) findings.push(`horizon_61:${iso}:${day}`);
        if(new Date(`${day}T00:00:00Z`).getUTCDay()===0&&expected.length!==0)
          findings.push(`sunday_open:${iso}:${day}`);
        if(offset===7&&expected.length!==0) findings.push(`synthetic_closure_open:${iso}:${day}`);
      }
      const last=car02PlusUtcDaysR487(today,60);
      const firstMonth=Date.UTC(Number(today.slice(0,4)),Number(today.slice(5,7))-1,1);
      const finalMonth=Date.UTC(Number(last.slice(0,4)),Number(last.slice(5,7))-1,1);
      for(let stamp=firstMonth;stamp<=finalMonth;){
        const d=new Date(stamp),year=d.getUTCFullYear(),month=d.getUTCMonth()+1;
        const grid=buildCar02MonthGridR487({year,month,calendar,now});
        checkedMonths++;
        if(grid.reason!=='synthetic_month_projection_only'){
          findings.push(`month_hold:${iso}:${year}-${month}:${grid.reason}`);
        }else{
          for(const cell of grid.cells.filter(x=>x.type==='day')){
            const view=buildCar02BookingDayViewR486({day:cell.day,calendar,now});
            if(cell.candidateCount!==view.candidateCount||
                cell.selectableInOfflineUi!==(view.candidateCount>0))
              findings.push(`month_day_parity:${iso}:${cell.day}`);
          }
        }
        stamp=Date.UTC(year,month,1);
      }
    }
    return Object.freeze({
      systemCode:'CAR02',version:'V4.90',decision:'HOLD',commercialDecision:'NO_GO_HOLD',
      releaseLock:true,reason:findings.length?'boundary_invariant_failed':'offline_boundary_sweep_only',
      boundaryVerified:findings.length===0,findings:Object.freeze(findings),
      checkedClocks:CAR02_V490_CLOCK_FIXTURES.length,checkedDays,checkedSlots,checkedMonths,
      providerProofsVerified:0,requiredProviderProofs:7,bookingCreationAllowed:false
    });
  } catch {
    return hold('boundary_sweep_failed_closed');
  }
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const r=scanCar02BookingBoundariesR490();
  process.stdout.write(JSON.stringify(r)+'\n');
  if(!r.boundaryVerified)process.exitCode=1;
}
