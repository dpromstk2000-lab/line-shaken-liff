/** CAR02 V4.87 — pure synthetic month grid from the V4.86 daily view. */
import {buildCar02BookingDayViewR486} from './car02-booking-day-view-r486.mjs';

export const CAR02_V487_RELEASE_LOCK = true;
export const CAR02_V487_BOOKING_HORIZON_DAYS = 60;

const DAY_MS=86400000;
const stamp=(y,m,d)=>`${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
const freezeCells=cells=>Object.freeze(cells.map(cell=>Object.freeze(cell)));

export function car02JstTodayR487(now) {
  if(!(now instanceof Date)||Object.getPrototypeOf(now)!==Date.prototype||
      Object.keys(now).length!==0||!Number.isFinite(Date.prototype.getTime.call(now))) return null;
  const fields=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
    timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(now).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
  return stamp(fields.year,fields.month,fields.day);
}
export function car02PlusUtcDaysR487(day,days) {
  if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)||
      !Number.isInteger(days)||days<0||days>366) return null;
  const first=new Date(`${day}T00:00:00.000Z`);
  if(!Number.isFinite(first.getTime())||first.toISOString().slice(0,10)!==day) return null;
  return new Date(first.getTime()+days*DAY_MS).toISOString().slice(0,10);
}
export function car02CoverageYearR487(day) {
  if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date=new Date(`${day}T00:00:00.000Z`);
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==day) return null;
  const [year,month,d]=day.split('-').map(Number);
  const last=new Date(Date.UTC(year+1,month,0)).getUTCDate();
  return stamp(year+1,month,Math.min(d,last));
}
const withheld = reason => Object.freeze({
  systemCode:'CAR02',version:'V4.87',decision:'HOLD',commercialDecision:'NO_GO_HOLD',
  releaseLock:true,reason,monthTitle:'',cells:Object.freeze([]),
  previousMonthAllowed:false,nextMonthAllowed:false,
  bookingCreationAllowed:false,providerConnected:false,
  realAvailabilityVerified:false,verifiedCommercialProviderProofs:0,
  requiredCommercialProviderProofs:7
});

/** All cells and flags remain read-only synthetic UI projections. */
export function buildCar02MonthGridR487({year,month,calendar,now}={}) {
  try {
    if(!Number.isInteger(year)||year<2000||year>2100||
        !Number.isInteger(month)||month<1||month>12) return withheld('month_invalid');
    const today=car02JstTodayR487(now);
    if(!today) return withheld('clock_invalid');
    const end=car02PlusUtcDaysR487(today,60);
    const firstOfMonth=stamp(year,month,1);
    const windowMin=today.slice(0,7),windowMax=end.slice(0,7),selected=firstOfMonth.slice(0,7);
    if(selected<windowMin||selected>windowMax) return withheld('month_outside_booking_window');
    const first=new Date(Date.UTC(year,month-1,1));
    const firstOffset=(first.getUTCDay()+6)%7; // Monday first
    const length=new Date(Date.UTC(year,month,0)).getUTCDate();
    const cells=[];
    for(let i=0;i<firstOffset;i++) cells.push({type:'pad'});
    for(let d=1;d<=length;d++) {
      const day=stamp(year,month,d);
      // The V4.86 policy is the ONLY source of the candidate-day decision.
      const view=buildCar02BookingDayViewR486({day,calendar,now});
      if(['calendar_shape_or_isolation_invalid','one_year_calendar_coverage_missing',
           'closed_day_inventory_invalid','occupied_slot_inventory_invalid',
           'clock_invalid','input_shape_invalid','untrusted_input_rejected',
           'baseline_rule_unpinned'].includes(view.reason)) return withheld(view.reason);
      cells.push({type:'day',day,number:d,selectableInOfflineUi:view.candidateCount>0,
        candidateCount:view.candidateCount});
    }
    while(cells.length%7!==0) cells.push({type:'pad'});
    const result={systemCode:'CAR02',version:'V4.87',decision:'HOLD',
      commercialDecision:'NO_GO_HOLD',releaseLock:true,
      reason:'synthetic_month_projection_only',monthTitle:`${year}年${month}月`,
      cells:freezeCells(cells),previousMonthAllowed:selected>windowMin,
      nextMonthAllowed:selected<windowMax,bookingCreationAllowed:false,
      providerConnected:false,realAvailabilityVerified:false,
      verifiedCommercialProviderProofs:0,requiredCommercialProviderProofs:7};
    return Object.freeze(result);
  } catch {
    return withheld('untrusted_calendar_rejected');
  }
}
