/** DPRO CAR02 V1.6 — staff-assisted booking browser transport candidate.
 * ISOLATED QA ONLY. It accepts ONLY the reserved .invalid host and an injected
 * transport. It cannot access any real API, mint an identity, or bypass R52.
 * Not used by the public five-screen demo and not a customer self-booking API.
 */
export const CAR02_STAFF_BOOKING_BROWSER_MODE=Object.freeze({
 environment:'isolated_qa',productionReady:false,release:'NO_GO',migration:'HOLD',
 deployable:false,realAuth:false,customerSelfBooking:false,realEndpoint:false
});
const URL_QA='https://car02-booking-qa.invalid/api/car02/booking';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const KEY=/^[A-Za-z0-9_-]{12,100}$/;
const EXACT=['customerId','vehicleId','day','time'];
const ERROR_CODES=new Set([
 'CAR02_NOT_RELEASED','CAR02_BOOKING_ORIGIN_DENIED','CAR02_BOOKING_UNAUTHORIZED',
 'CAR02_BOOKING_STAFF_REQUIRED','CAR02_BOOKING_REQUEST_KEY_INVALID','CAR02_BOOKING_MEDIA_TYPE',
 'CAR02_BOOKING_FIELDS_INVALID','CAR02_BOOKING_DATE_INVALID','CAR02_BOOKING_CLOSED_DAY',
 'CAR02_BOOKING_TIME_INVALID','CAR02_BOOKING_BUSINESS_HOURS','CAR02_BOOKING_WINDOW_INVALID',
 'CAR02_BOOKING_REFERENCE_SCOPE_MISMATCH','CAR02_BOOKING_SLOT_OCCUPIED',
 'CAR02_BOOKING_IDEMPOTENCY_CONFLICT','CAR02_BOOKING_QA_UNAVAILABLE'
]);
export class Car02BookingBrowserError extends Error{
 constructor(code,status=0){super(code);this.name='Car02BookingBrowserError';this.code=code;this.status=status;}
}
const fail=(code,status=0)=>{throw new Car02BookingBrowserError(code,status)};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,keys)=>plain(x)&&Object.keys(x).sort().join('|')===keys.slice().sort().join('|');
const isUuid=x=>typeof x==='string'&&UUID.test(x);
function jstNow(now){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
 return {date:`${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`,minutes:p.hour*60+p.minute};
}
export function validateStaffBookingBrowserInput(input,{now=new Date()}={}){
 if(!exact(input,EXACT))fail('CAR02_BOOKING_UI_FIELDS_INVALID');
 if(!isUuid(input.customerId)||!isUuid(input.vehicleId))fail('CAR02_BOOKING_UI_REFERENCE_INVALID');
 if(typeof input.day!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(input.day))fail('CAR02_BOOKING_UI_DATE_INVALID');
 const d=new Date(input.day+'T00:00:00.000Z');
 if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==input.day)fail('CAR02_BOOKING_UI_DATE_INVALID');
 if(d.getUTCDay()===0)fail('CAR02_BOOKING_UI_CLOSED_DAY');
 if(typeof input.time!=='string'||!/^([01][0-9]|2[0-3]):(00|30)$/.test(input.time))fail('CAR02_BOOKING_UI_TIME_INVALID');
 const [h,m]=input.time.split(':').map(Number),minute=h*60+m;
 if(minute<540||minute>1050)fail('CAR02_BOOKING_UI_HOURS_INVALID');
 const nowJst=jstNow(now);const distance=(d.getTime()-new Date(nowJst.date+'T00:00:00Z').getTime())/86400000;
 if(distance<0||distance>60||(distance===0&&minute<=nowJst.minutes))fail('CAR02_BOOKING_UI_WINDOW_INVALID');
 return Object.freeze({...input});
}
function safeError(response,body){
 const code=plain(body)&&ERROR_CODES.has(body.code)?body.code:'CAR02_BOOKING_UI_HTTP_ERROR';
 fail(code,response.status);
}
async function decode(response,input){
 const type=response?.headers?.get?.('content-type')||'';
 if(!type.toLowerCase().includes('application/json'))fail('CAR02_BOOKING_UI_RESPONSE_INVALID');
 const length=Number(response.headers.get('content-length')||0);
 if(length>4096)fail('CAR02_BOOKING_UI_RESPONSE_TOO_LARGE');
 let raw;try{raw=await response.text()}catch{fail('CAR02_BOOKING_UI_RESPONSE_INVALID')}
 if(raw.length>4096)fail('CAR02_BOOKING_UI_RESPONSE_TOO_LARGE');
 let parsed;try{parsed=JSON.parse(raw)}catch{fail('CAR02_BOOKING_UI_RESPONSE_INVALID')}
 if(response.status!==201||parsed?.ok!==true)safeError(response,parsed);
 if(!plain(parsed)||!exact(parsed.data,['reservationId','day','time','syntheticOnly'])||
   !isUuid(parsed.data.reservationId)||parsed.data.syntheticOnly!==true||
   parsed.data.day!==input.day||parsed.data.time!==input.time)
   fail('CAR02_BOOKING_UI_RESPONSE_INVALID');
 return Object.freeze({reservationId:parsed.data.reservationId,day:parsed.data.day,time:parsed.data.time,syntheticOnly:true});
}
export function createCar02StaffBookingBrowserIsolated({
 environment,allowIsolatedQa=false,connectionEnabled=false,
 endpoint=URL_QA,credentials,fetchImpl,now=()=>new Date(),randomUUID
}={}){
 if(environment!=='isolated_qa'||allowIsolatedQa!==true||endpoint!==URL_QA||
    typeof credentials!=='function'||typeof fetchImpl!=='function'||typeof now!=='function'||
    typeof randomUUID!=='function')fail('CAR02_BOOKING_UI_ISOLATION_REQUIRED');
 return Object.freeze({
  async create(input,{requestKey}={}){
   if(connectionEnabled!==true)fail('CAR02_BOOKING_UI_CLOSED');
   const validated=validateStaffBookingBrowserInput(input,{now:now()});
   const key=requestKey??('qa-booking-'+randomUUID());
   if(typeof key!=='string'||!KEY.test(key))fail('CAR02_BOOKING_UI_KEY_INVALID');
   let auth;try{auth=await credentials()}catch{fail('CAR02_BOOKING_UI_IDENTITY_REQUIRED')}
   if(!plain(auth)||auth.kind!=='staff'||typeof auth.token!=='string'||
     auth.token.length<8||auth.token.length>8192||/\s/.test(auth.token))fail('CAR02_BOOKING_UI_IDENTITY_REQUIRED');
   const headers=new Headers({'Accept':'application/json','Content-Type':'application/json',
     'Authorization':'Bearer '+auth.token,'Idempotency-Key':key});
   let response;
   try{
    response=await fetchImpl(URL_QA,{method:'POST',headers,body:JSON.stringify(validated),
       redirect:'error',cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',
       signal:AbortSignal.timeout(12000)});
   }catch{fail('CAR02_BOOKING_UI_TRANSPORT_UNAVAILABLE')}
   if(!response||typeof response.status!=='number')fail('CAR02_BOOKING_UI_RESPONSE_INVALID');
   return decode(response,validated);
  }
 });
}
