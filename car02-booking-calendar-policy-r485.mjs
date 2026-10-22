/**
 * CAR02 V4.85 — synthetic Japanese booking/calendar policy only.
 * Produces a UI candidate decision. Never authenticates, reserves a slot,
 * writes to a database, sends LINE, or authorizes a commercial booking.
 * Schedule values are untrusted local fixtures, NOT owner-approved holidays.
 */
export const CAR02_V485_RELEASE_LOCK = true;
export const CAR02_V485_MAX_BOOKING_DAYS = 60;
export const CAR02_V485_SLOT_MINUTES = 30;
export const CAR02_V485_REQUIRED_HOLIDAY_YEARS = 1;

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):(00|30)$/;
const slotPattern = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):(00|30)$/;
const policyFields = new Set(['systemCode','environment','coverageThrough','closedDays','occupiedSlots']);
const requestFields = new Set(['day','time']);
const isPlain = v => v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  (Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const safeFields=(v,keys) => isPlain(v) && Object.keys(v).length===keys.size &&
  Object.keys(v).every(k=>keys.has(k)) &&
  Object.values(Object.getOwnPropertyDescriptors(v)).every(desc=>Object.hasOwn(desc,'value'));

function dayEpoch(day) {
  if(typeof day!=='string'||!dayPattern.test(day)) return NaN;
  const d=new Date(`${day}T00:00:00.000Z`);
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===day ? d.getTime():NaN;
}
function jstNow(date) {
  const fields=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
    timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts(date).filter(part=>part.type!=='literal').map(part=>[part.type,Number(part.value)]));
  const today=`${fields.year}-${String(fields.month).padStart(2,'0')}-${String(fields.day).padStart(2,'0')}`;
  return {today,minutes:fields.hour*60+fields.minute};
}
function nextYearDayUtc(today) {
  const [y,m,d]=today.split('-').map(Number);
  const maxDay=new Date(Date.UTC(y+1,m,0)).getUTCDate();
  return Date.UTC(y+1,m-1,Math.min(d,maxDay));
}
function hold(reason,candidateAvailable=false) {
  return Object.freeze({
    systemCode:'CAR02',version:'V4.85',decision:'HOLD',commercialDecision:'NO_GO_HOLD',
    releaseLock:true,reason,candidateAvailableInOfflineUi:candidateAvailable,
    bookingCreationAllowed:false,realCalendarOwnershipVerified:false,
    liveHolidayProviderChecked:false,staffIdentityVerified:false,
    databaseMutationAllowed:false,lineDispatchAllowed:false,
    commercialProviderProofsVerified:0,requiredCommercialProviderProofs:7
  });
}

/** Pure policy evaluator; all calendar data is untrusted and synthetic. */
export function evaluateCar02BookingCalendarR485({selection,calendar,now}={}) {
  if(!(now instanceof Date)||!Number.isFinite(now.getTime())) return hold('clock_invalid');
  if(!safeFields(selection,requestFields)) return hold('selection_shape_invalid');
  if(!safeFields(calendar,policyFields)||calendar.systemCode!=='CAR02'||
      calendar.environment!=='isolated_qa'||!Array.isArray(calendar.closedDays)||
      !Array.isArray(calendar.occupiedSlots)||calendar.closedDays.length>366||
      calendar.occupiedSlots.length>10000) return hold('calendar_shape_or_isolation_invalid');
  const {today,minutes:nowMinute}=jstNow(now);
  const todayMs=dayEpoch(today);
  const yearEndMs=nextYearDayUtc(today);
  const coveredMs=dayEpoch(calendar.coverageThrough);
  if(!Number.isFinite(coveredMs)||coveredMs<yearEndMs)
    return hold('one_year_calendar_coverage_missing');

  const closures=new Set();
  for(const day of calendar.closedDays) {
    const ms=dayEpoch(day);
    if(!Number.isFinite(ms)||ms<todayMs||ms>coveredMs||closures.has(day))
      return hold('closed_day_inventory_invalid');
    closures.add(day);
  }
  const occupied=new Set();
  for(const slot of calendar.occupiedSlots) {
    if(typeof slot!=='string') return hold('occupied_slot_inventory_invalid');
    const match=slotPattern.exec(slot);
    if(!match) return hold('occupied_slot_inventory_invalid');
    const ms=dayEpoch(match[1]);
    const hour=Number(slot.slice(11,13)),minute=Number(slot.slice(14,16));
    const total=hour*60+minute;
    if(!Number.isFinite(ms)||ms<todayMs||ms>coveredMs||total<540||total>1050||occupied.has(slot))
      return hold('occupied_slot_inventory_invalid');
    occupied.add(slot);
  }
  const ms=dayEpoch(selection.day);
  if(!Number.isFinite(ms)) return hold('selected_day_invalid');
  if(typeof selection.time!=='string'||!timePattern.test(selection.time))
    return hold('selected_time_not_half_hour');
  const hour=Number(selection.time.slice(0,2)),minute=Number(selection.time.slice(3,5));
  const total=hour*60+minute;
  if(total<540||total>1050) return hold('outside_business_hours');
  const distance=(ms-todayMs)/86400000;
  if(distance<0||distance>CAR02_V485_MAX_BOOKING_DAYS||
     (distance===0&&total<=nowMinute)) return hold('booking_date_outside_open_window');
  if(new Date(ms).getUTCDay()===0) return hold('sunday_closed');
  if(closures.has(selection.day)) return hold('owner_declared_closed_day');
  if(occupied.has(`${selection.day}T${selection.time}`)) return hold('synthetic_slot_occupied');
  return hold('candidate_available_offline_only',true);
}
