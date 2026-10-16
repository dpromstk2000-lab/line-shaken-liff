/** DPRO CAR02 V1.7 staff booking UI preview.
 * Uses V1.6 isolated browser contract and an injected, in-memory synthetic response.
 * NEVER calls a network fetch, production Worker, Supabase, LINE, or real booking API.
 */
import {createCar02StaffBookingBrowserIsolated} from './car02-basic-staff-booking-browser-isolated.mjs';
const $=id=>document.getElementById(id);
const CLIENTS=Object.freeze({
 '11111111-1111-4111-8111-111111111111':{name:'架空顧客A',vehicle:'22222222-2222-4222-8222-222222222222',vehicleLabel:'デモ車両A'},
 '33333333-3333-4333-8333-333333333333':{name:'架空顧客B',vehicle:'44444444-4444-4444-8444-444444444444',vehicleLabel:'デモ車両B'}
});
const slotStore=new Map(),keyStore=new Map();
const displayed={year:0,month:0,day:null,time:null};
let selectedKey=null,lastPayload=null,lastReservationId=null,busy=false;
const localJst=()=>{
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
 return {year:parts.year,month:parts.month,day:parts.day,minutes:parts.hour*60+parts.minute};
};
const isoUTC=d=>d.toISOString().slice(0,10);
const todayUTC=()=>{const p=localJst();return new Date(Date.UTC(p.year,p.month-1,p.day))};
const addDays=(d,n)=>new Date(d.getTime()+n*86400000);
const dayIsAvailable=d=>{const diff=Math.round((d.getTime()-todayUTC().getTime())/86400000);return diff>=0&&diff<=60&&d.getUTCDay()!==0};
const dayFromString=s=>new Date(`${s}T00:00:00.000Z`);
const slotKey=(day,time)=>`${day}T${time}`;
const sendResponse=(body,status)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8'}});
function fakeResponse(url,req){
 // Called by V1.6's injected transport; there is no external fetch call.
 if(url!=='https://car02-booking-qa.invalid/api/car02/booking'||req.method!=='POST')
   return sendResponse({ok:false,code:'CAR02_BOOKING_QA_UNAVAILABLE'},503);
 const head=new Headers(req.headers);
 if(head.get('Authorization')!=='Bearer qa-fake-staff-browser-no-real-auth')
   return sendResponse({ok:false,code:'CAR02_BOOKING_UNAUTHORIZED'},401);
 let input;try{input=JSON.parse(req.body)}catch{return sendResponse({ok:false,code:'CAR02_BOOKING_FIELDS_INVALID'},422)}
 const token=head.get('Idempotency-Key');
 const k=keyStore.get(token),payload=JSON.stringify(input);
 if(k){if(k.payload!==payload)return sendResponse({ok:false,code:'CAR02_BOOKING_IDEMPOTENCY_CONFLICT'},409);return sendResponse({ok:true,data:k.result},201)}
 const same=slotStore.get(slotKey(input.day,input.time));
 if(same)return sendResponse({ok:false,code:'CAR02_BOOKING_SLOT_OCCUPIED'},409);
 const result={reservationId:crypto.randomUUID(),day:input.day,time:input.time,syntheticOnly:true};
 keyStore.set(token,{payload,result});slotStore.set(slotKey(input.day,input.time),{...result,customerId:input.customerId,vehicleId:input.vehicleId});
 return sendResponse({ok:true,data:result},201);
}
const client=createCar02StaffBookingBrowserIsolated({environment:'isolated_qa',allowIsolatedQa:true,connectionEnabled:true,
 credentials:async()=>({kind:'staff',token:'qa-fake-staff-browser-no-real-auth'}),fetchImpl:async(url,req)=>fakeResponse(url,req),
 randomUUID:()=>crypto.randomUUID()});
function validTime(day,time){
 if(!day||!time||!dayIsAvailable(dayFromString(day)))return false;
 if(slotStore.has(slotKey(day,time)))return false;
 const p=localJst();if(day===isoUTC(todayUTC())&&Number(time.slice(0,2))*60+Number(time.slice(3))<=p.minutes)return false;
 return true;
}
function setResult(message,status='neutral'){$('result').textContent=message;$('result').className='result'+(status==='neutral'?'':' '+status)}
function setTab(tab){for(const el of document.querySelectorAll('[data-tab]')){
 const current=el.dataset.tab===tab;el.classList.toggle('active',current);if(current)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');}
 for(const view of document.querySelectorAll('.view'))view.hidden=view.id!==`view-${tab}`;
 $('heading').textContent={booking:'スタッフ予約受付',history:'架空の受付履歴',security:'接続・安全状態'}[tab];if(tab==='history')renderHistory();}
function resetSubmission(){selectedKey=null;lastPayload=null;lastReservationId=null;$('retry').disabled=true;$('sum-id').textContent='未受付';setResult('内容を確認して、架空予約を受付してください。')}
function renderCalendar(){const today=todayUTC(),maximum=addDays(today,60);const minMonth=today.getUTCFullYear()*12+today.getUTCMonth(),maxMonth=maximum.getUTCFullYear()*12+maximum.getUTCMonth(),current=displayed.year*12+displayed.month;
 $('prev').disabled=current<=minMonth;$('next').disabled=current>=maxMonth;
 $('month-label').textContent=`${displayed.year}年${displayed.month+1}月`;
 const first=new Date(Date.UTC(displayed.year,displayed.month,1)),n=new Date(Date.UTC(displayed.year,displayed.month+1,0)).getUTCDate();const offset=(first.getUTCDay()+6)%7;
 const days=$('days');days.replaceChildren();
 for(let i=0;i<offset;i++){const s=document.createElement('span');s.className='cal-spacer';s.setAttribute('aria-hidden','true');days.append(s)}
 for(let d=1;d<=n;d++){const when=new Date(Date.UTC(displayed.year,displayed.month,d)),iso=isoUTC(when);const b=document.createElement('button');b.type='button';b.className='day';b.textContent=String(d);b.setAttribute('aria-label',`${displayed.month+1}月${d}日`);b.disabled=!dayIsAvailable(when);b.setAttribute('aria-pressed',String(displayed.day===iso));b.addEventListener('click',()=>{displayed.day=iso;displayed.time=null;resetSubmission();renderCalendar();renderSlots();renderSummary()});days.append(b)}
}
function renderSlots(){const e=$('slots');e.replaceChildren();for(let m=540;m<=1050;m+=30){const time=`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;const b=document.createElement('button');b.type='button';b.className='slot';b.textContent=time;b.disabled=!validTime(displayed.day,time);b.setAttribute('aria-pressed',String(displayed.time===time));b.addEventListener('click',()=>{displayed.time=time;resetSubmission();renderSlots();renderSummary()});e.append(b)}
 $('submit').disabled=busy||!validTime(displayed.day,displayed.time);
}
function renderSummary(){const c=CLIENTS[$('customer').value];$('sum-customer').textContent=c.name;$('sum-vehicle').textContent=c.vehicleLabel;
 const value=displayed.day&&displayed.time?`${displayed.day} ${displayed.time}`:'未選択';$('sum-date').textContent=value;$('chosen').textContent=displayed.day?(displayed.time?`選択中：${value}`:`${displayed.day} の時間を選んでください`):'日付と時間を選んでください。';}
function renderHistory(){const target=$('history');target.replaceChildren();if(slotStore.size===0){const p=document.createElement('p');p.textContent='架空の受付はまだありません。';target.append(p);return}
 for(const x of [...slotStore.values()].reverse()){const a=document.createElement('article');const c=document.createElement('strong');c.textContent=`${x.day} ${x.time} ／ ${CLIENTS[x.customerId]?.name??'架空顧客'}`;const sm=document.createElement('small');sm.textContent=`架空予約ID：${x.reservationId}`;a.append(c,sm);target.append(a)}}
const friendly=code=>({CAR02_BOOKING_SLOT_OCCUPIED:'この時間はすでに受付済みです。別の時間を選択してください。',CAR02_BOOKING_IDEMPOTENCY_CONFLICT:'予約内容と再送キーが一致しません。新しい予約として選択し直してください。',CAR02_BOOKING_UI_CLOSED:'この予約送信処理は使用できません。',CAR02_BOOKING_UI_IDENTITY_REQUIRED:'スタッフ認証がありません。',CAR02_BOOKING_UI_TIME_INVALID:'時間の形式が正しくありません。',CAR02_BOOKING_UI_WINDOW_INVALID:'受付期間外です。'})[code]??`受付できませんでした（${code||'UNKNOWN'}）。`;
async function send(isRetry){if(busy)return;if(!isRetry&&!validTime(displayed.day,displayed.time))return;
 let input,key;
 if(isRetry){if(!lastPayload||!selectedKey)return;input={...lastPayload};key=selectedKey}
 else{const c=CLIENTS[$('customer').value];input={customerId:$('customer').value,vehicleId:c.vehicle,day:displayed.day,time:displayed.time};key='qa-preview-'+crypto.randomUUID();selectedKey=key;lastPayload={...input}}
 busy=true;$('submit').disabled=true;$('retry').disabled=true;setResult('架空予約を処理しています…');
 try{const data=await client.create(input,{requestKey:key});lastReservationId=data.reservationId;$('sum-id').textContent=data.reservationId;setResult(isRetry?'同じ受付内容で再送しました。新しい予約は増えていません。':'架空予約を受け付けました。実システムには保存していません。','success');}
 catch(err){setResult(friendly(err.code),'error')}
 finally{busy=false;renderCalendar();renderSlots();$('retry').disabled=!selectedKey;}
}
$('customer').addEventListener('change',()=>{const c=CLIENTS[$('customer').value];$('vehicle').replaceChildren();const opt=document.createElement('option');opt.value=c.vehicle;opt.textContent=c.vehicleLabel;$('vehicle').append(opt);resetSubmission();renderSummary();renderSlots()});
$('submit').addEventListener('click',()=>send(false));$('retry').addEventListener('click',()=>send(true));
$('prev').addEventListener('click',()=>{displayed.month--;if(displayed.month<0){displayed.year--;displayed.month=11}displayed.day=null;displayed.time=null;resetSubmission();renderCalendar();renderSlots();renderSummary()});
$('next').addEventListener('click',()=>{displayed.month++;if(displayed.month>11){displayed.year++;displayed.month=0}displayed.day=null;displayed.time=null;resetSubmission();renderCalendar();renderSlots();renderSummary()});
$('reset').addEventListener('click',()=>{slotStore.clear();keyStore.clear();resetSubmission();renderHistory();renderCalendar();renderSlots();renderSummary()});
for(const b of document.querySelectorAll('[data-tab]'))b.addEventListener('click',()=>setTab(b.dataset.tab));
const p=localJst();displayed.year=p.year;displayed.month=p.month-1;
$('customer').dispatchEvent(new Event('change'));renderCalendar();renderSlots();renderSummary();setTab('booking');
