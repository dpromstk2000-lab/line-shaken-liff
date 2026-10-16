import {makeCar02Demo} from './car02-basic-flow-isolated.mjs';
import {createCar02StaffBookingBrowserIsolated} from './car02-basic-staff-booking-browser-isolated.mjs';
const $=id=>document.getElementById(id);
const labels={dashboard:['業務ダッシュボード','予約と整備案件の進捗を1つの画面で確認します。'],booking:['予約WEB','架空の予約受付フローを確認します。'],staff:['スタッフ整備','報告・見積・作業完了まで操作します。'],customer:['お客様確認','追加見積の確認と承認を体験します。'],owner:['オーナー管理','業務一覧と安全状態を確認します。']};
const statusText={booked:'整備報告待ち',reported:'見積作成待ち',awaiting_approval:'承認待ち',approved:'承認済み',declined:'見送り',completed:'作業完了'};
const state={model:null,ids:[],selected:null,tab:'dashboard'};
const calendar={year:0,month:0,day:'',slot:''};
// V1.8: ONE shared in-memory dataset across the booking, staff, customer and owner views.
// Neither the test server nor the V1.6 browser contract calls any network resource.
const QA_CLIENTS=Object.freeze({
 '11111111-1111-4111-8111-111111111111':{customer:'架空顧客A',vehicle:'デモ車両A',vehicleId:'22222222-2222-4222-8222-222222222222'},
 '33333333-3333-4333-8333-333333333333':{customer:'架空顧客B',vehicle:'デモ車両B',vehicleId:'44444444-4444-4444-8444-444444444444'}
});
const staffRequests=new Map(),staffSlots=new Map(),staffRefs=new Map();
let staffLast=null,staffBusy=false;
const responseJson=(data,status)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
function fakeStaffBookingHttp(url,req){
 if(url!=='https://car02-booking-qa.invalid/api/car02/booking'||req.method!=='POST')return responseJson({ok:false,code:'CAR02_BOOKING_QA_UNAVAILABLE'},503);
 if(new Headers(req.headers).get('Authorization')!=='Bearer qa-v18-synthetic-staff-only')return responseJson({ok:false,code:'CAR02_BOOKING_UNAUTHORIZED'},401);
 let data;try{data=JSON.parse(req.body)}catch{return responseJson({ok:false,code:'CAR02_BOOKING_FIELDS_INVALID'},422)}
 const client=QA_CLIENTS[data.customerId];
 if(!client||client.vehicleId!==data.vehicleId)return responseJson({ok:false,code:'CAR02_BOOKING_REFERENCE_SCOPE_MISMATCH'},403);
 const key=new Headers(req.headers).get('Idempotency-Key'),payload=JSON.stringify(data),prior=staffRequests.get(key);
 if(prior)return prior.payload===payload?responseJson({ok:true,data:prior.result},201):responseJson({ok:false,code:'CAR02_BOOKING_IDEMPOTENCY_CONFLICT'},409);
 const start=data.day+'T'+data.time;
 if(staffSlots.has(start)||calBooked(start))return responseJson({ok:false,code:'CAR02_BOOKING_SLOT_OCCUPIED'},409);
 // Create the case BEFORE committing the synthetic UUID, to avoid a demo orphan.
 let record;try{record=state.model.create(actor('staff'),{customer:client.customer,vehicle:client.vehicle,start})}
 catch{return responseJson({ok:false,code:'CAR02_BOOKING_SLOT_OCCUPIED'},409)}
 const result={reservationId:crypto.randomUUID(),day:data.day,time:data.time,syntheticOnly:true};
 staffRefs.set(record.id,result.reservationId);staffSlots.set(start,record.id);
 staffRequests.set(key,{payload,result,caseId:record.id});
 if(!state.ids.includes(record.id))state.ids.unshift(record.id);
 state.selected=record.id;
 return responseJson({ok:true,data:result},201);
}
const staffBookingClient=createCar02StaffBookingBrowserIsolated({environment:'isolated_qa',allowIsolatedQa:true,connectionEnabled:true,
 credentials:async()=>({kind:'staff',token:'qa-v18-synthetic-staff-only'}),
 fetchImpl:async(url,req)=>fakeStaffBookingHttp(url,req),randomUUID:()=>crypto.randomUUID()});
async function submitStaffBooking(retry=false){
 if(staffBusy)return;
 let request;
 if(retry){if(!staffLast)return;request=staffLast}
 else{
  if(!calendar.day||!calendar.slot||!calSlotEnabled(calendar.day,calendar.slot)){
   notice('booking-result','予約可能な時間を選択してください。',true);return;
  }
  const customerId=$('staff-customer').value,client=QA_CLIENTS[customerId];
  if(!client){notice('booking-result','架空顧客を選んでください。',true);return}
  request={input:{customerId,vehicleId:client.vehicleId,day:calendar.day,time:calendar.slot},requestKey:'qa-v18-'+crypto.randomUUID()};
 }
 staffBusy=true;renderCalendar();
 try{
  const r=await staffBookingClient.create(request.input,{requestKey:request.requestKey});
  staffLast=request;
  const record=staffRequests.get(request.requestKey);
  if(!record||record.result.reservationId!==r.reservationId)throw Error('CAR02_V18_SYNTHETIC_MAPPING_FAILED');
  state.selected=record.caseId;
  $('staff-uuid').textContent='架空予約UUID：'+r.reservationId+' ／ 案件番号：'+record.caseId;
  render();notice('booking-result',retry?'同一キーで再送済み。予約・案件は増えていません。':'架空予約UUIDを発行し、整備・お客様・オーナー画面に連動しました。');
 }catch(err){notice('booking-result','受付失敗（架空）：'+String(err.code||err.message),true)}
 finally{staffBusy=false;renderCalendar()}
}

const actor=(role,record)=>({shop:'demo_shop',role,...(role==='customer'?{customer:record?.customer}:{})});
const localDate=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
function future(days,hour=10,minute=30){const d=new Date();d.setDate(d.getDate()+days);d.setHours(hour,minute,0,0);return localDate(d)}
function cases(){return state.ids.map(id=>{try{return state.model.view(actor('owner'),id)}catch{return null}}).filter(Boolean)}

const calIso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const calStart=d=>new Date(d.getFullYear(),d.getMonth(),d.getDate());
function calWindow(day){
 const base=calStart(new Date()), target=calStart(day);
 const distance=Math.round((target-base)/86400000);
 return distance>=0&&distance<=60&&target.getDay()!==0;
}
function calBooked(start){return cases().some(r=>r.start===start)}
function calSlotEnabled(day,time){
 const date=new Date(day+'T'+time);const d=new Date(day+'T00:00');
 return calWindow(d) && Number.isFinite(date.getTime())&&date.getTime()>Date.now() && !calBooked(day+'T'+time);
}
function calMonthKey(y,m){return y*12+m}
function calendarInit(){
 const today=new Date();calendar.year=today.getFullYear();calendar.month=today.getMonth();calendar.day='';calendar.slot='';
 const day=new Date(today);day.setDate(day.getDate()+1);
 for(let i=0;i<8;i++){if(calWindow(day)){calendar.day=calIso(day);break}day.setDate(day.getDate()+1)}
 if(calendar.day){const d=new Date(calendar.day+'T00:00');calendar.year=d.getFullYear();calendar.month=d.getMonth()}
}
function renderCalendar(){
 const today=new Date(),end=new Date(today);end.setDate(end.getDate()+60);
 const minKey=calMonthKey(today.getFullYear(),today.getMonth()),maxKey=calMonthKey(end.getFullYear(),end.getMonth());
 $('cal-prev').disabled=calMonthKey(calendar.year,calendar.month)<=minKey;
 $('cal-next').disabled=calMonthKey(calendar.year,calendar.month)>=maxKey;
 $('cal-month').textContent=`${calendar.year}年 ${calendar.month+1}月`;
 const days=$('cal-days');days.replaceChildren();
 const first=new Date(calendar.year,calendar.month,1);
 for(let i=0;i<(first.getDay()+6)%7;i++)days.append(el('span','cal-empty'));
 const last=new Date(calendar.year,calendar.month+1,0).getDate();
 for(let d=1;d<=last;d++){
  const date=new Date(calendar.year,calendar.month,d), iso=calIso(date),can=calWindow(date);
  const b=el('button','cal-day',String(d));b.type='button';b.disabled=!can;b.dataset.date=iso;b.setAttribute('aria-label',`${iso}${can?'':' 選択不可'}`);
  b.setAttribute('aria-pressed',String(calendar.day===iso));
  if(iso===calIso(today))b.append(el('span','today-dot','今日'));
  if(can)b.addEventListener('click',()=>{calendar.day=iso;calendar.slot='';renderCalendar()});
  days.append(b);
 }
 const slots=$('cal-slots');slots.replaceChildren();
 if(calendar.day){
  for(let minutes=9*60;minutes<=17*60+30;minutes+=30){
   const time=`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
   const b=el('button','cal-slot',time);b.type='button';b.dataset.slot=time;
   b.disabled=!calSlotEnabled(calendar.day,time);b.setAttribute('aria-pressed',String(calendar.slot===time));
   b.setAttribute('aria-label',time+(b.disabled?' 受付不可・予約済み':''));
   if(!b.disabled)b.addEventListener('click',()=>{calendar.slot=time;renderCalendar()});
   slots.append(b);
  }
 } else slots.append(el('span','label-note','予約日を選択してください。'));
 const selected=calendar.day&&calendar.slot&&calSlotEnabled(calendar.day,calendar.slot);
 $('b-date').value=selected?calendar.day+'T'+calendar.slot:'';
 $('booking-create').disabled=!selected;
 $('booking-staff-create').disabled=!selected||staffBusy;
 $('booking-staff-retry').disabled=!staffLast||staffBusy;
 $('cal-selection').textContent=selected?`選択中：${calendar.day.replaceAll('-','/')} ${calendar.slot}〜（30分）`:'予約日と空いている時間を選択してください。';
}
function calendarMonth(delta){const next=new Date(calendar.year,calendar.month+delta,1);calendar.year=next.getFullYear();calendar.month=next.getMonth();calendar.day='';calendar.slot='';renderCalendar()}

function selected(){return cases().find(x=>x.id===state.selected)||null}
function el(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=String(text);return node}
function notice(where,message,isError=false){const n=$(where);n.textContent=message;n.hidden=false;n.classList.toggle('error',isError)}
function clearNotices(){for(const id of ['booking-result','staff-result','customer-result','owner-result']){$(id).hidden=true;$(id).textContent=''}}
function appendDetail(target,r){const root=$(target);root.replaceChildren();if(!r){root.append(el('div','empty','対象案件がありません。予約WEBから架空予約を作成してください。'));return}
 const dl=el('dl','detail');const rows=[['案件番号',r.id],...(staffRefs.has(r.id)?[['架空予約UUID',staffRefs.get(r.id)]]:[]),['お客様',r.customer],['車両',r.vehicle],['予約日時',r.start.replace('T',' ')],['状態',statusText[r.status]||r.status],['見積合計',r.quote.reduce((s,x)=>s+x.price,0).toLocaleString('ja-JP')+'円'],['データ版',r.version]];
 for(const [k,v] of rows){const d=el('div','detailrow');d.append(el('dt','',k),el('dd','',v));dl.append(d)}root.append(dl)
}
function makeList(target,recs){const root=$(target);root.replaceChildren();if(!recs.length){root.append(el('div','empty','まだ案件がありません。'));return}for(const r of recs){const b=el('button','item'+(r.id===state.selected?' selected':''));b.type='button';b.setAttribute('aria-pressed',String(r.id===state.selected));const line=el('div','');line.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:10px';line.append(el('strong','',r.customer+' ／ '+r.vehicle));const pill=el('span','pill'+(r.status==='completed'?' ok':r.status==='awaiting_approval'?' wait':r.status==='declined'?' off':''),statusText[r.status]||r.status);line.append(pill);b.append(line,el('small','',r.start.replace('T',' ')+' · '+r.id));b.addEventListener('click',()=>{state.selected=r.id;render()});root.append(b)}}
function renderStats(recs){$('stat-all').textContent=recs.length;$('stat-booked').textContent=recs.filter(x=>x.status==='booked').length;$('stat-pending').textContent=recs.filter(x=>x.status==='awaiting_approval').length;$('stat-completed').textContent=recs.filter(x=>x.status==='completed').length}
function renderCustomer(r){const root=$('customer-quote');root.replaceChildren();$('customer-history').replaceChildren();if(!r){root.append(el('div','empty','対象案件がありません。'));$('customer-history').append(el('div','empty','履歴はありません。'));return}
 root.append(el('p','muted','お客様：'+r.customer+'　／　車両：'+r.vehicle));if(r.quote.length){root.append(el('h3','','お見積り内容'));for(const item of r.quote){const d=el('div','detailrow');d.append(el('dt','',item.name),el('dd','',item.price.toLocaleString('ja-JP')+'円'));root.append(d)}root.append(el('p','amount',r.quote.reduce((s,x)=>s+x.price,0).toLocaleString('ja-JP')+'円'))}else root.append(el('div','empty','見積はまだ提示されていません。'));root.append(el('p','muted','状態：'+statusText[r.status]));if(staffRefs.has(r.id))root.append(el('p','label-note','架空予約UUID：'+staffRefs.get(r.id)));const history=el('ol','timeline');for(const h of r.history)history.append(el('li','',h));$('customer-history').append(history)
}
function renderOwner(recs){const body=$('owner-table');body.replaceChildren();for(const r of recs){const tr=el('tr','');for(const v of [r.id,staffRefs.get(r.id)||'—',r.customer,r.start.replace('T',' '),statusText[r.status]||r.status])tr.append(el('td','',v));body.append(tr)}if(!recs.length){const tr=el('tr','');const td=el('td','','予約はありません。');td.colSpan=5;tr.append(td);body.append(tr)}}
function render(){const recs=cases();if(state.selected&&!recs.some(x=>x.id===state.selected))state.selected=recs[0]?.id||null;const r=selected();renderStats(recs);for(const t of ['dashboard','booking','staff','customer'])makeList(t+'-list',recs);appendDetail('dashboard-detail',r);appendDetail('staff-detail',r);renderCustomer(r);renderOwner(recs);
 renderCalendar();$('dashboard-go-staff').disabled=!r;$('dashboard-go-customer').disabled=!r;$('staff-report').disabled=!r||r.status!=='booked';$('staff-quote').disabled=!r||r.status!=='reported';$('staff-complete').disabled=!r||r.status!=='approved';$('customer-approve').disabled=!r||r.status!=='awaiting_approval';$('customer-decline').disabled=!r||r.status!=='awaiting_approval';}
function navigate(tab){if(!labels[tab])return;state.tab=tab;for(const b of document.querySelectorAll('[data-tab]')){if(b.dataset.tab===tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')}for(const v of document.querySelectorAll('.view'))v.hidden=v.id!=='view-'+tab;$('pageTitle').textContent=labels[tab][0];$('pageLead').textContent=labels[tab][1];clearNotices();render();window.scrollTo({top:0,behavior:'instant'})}
function operation(fn,location){try{const r=fn();if(r&&typeof r==='object'&&r.id&&!state.ids.includes(r.id))state.ids.unshift(r.id);if(r?.id)state.selected=r.id;render();notice(location,'操作完了（ブラウザ内の架空データ）')}catch(e){notice(location,'操作できません：'+(e.code||e.message),true)}}
function init(){staffRequests.clear();staffSlots.clear();staffRefs.clear();staffLast=null;staffBusy=false;$('staff-uuid').textContent='架空予約UUID：まだ登録されていません。';state.model=makeCar02Demo();state.ids=[];state.selected=null;const samples=[['架空顧客A','デモ車両A',future(1)],['架空顧客B','デモ車両B',future(2)]];for(const [customer,vehicle,start]of samples){const record=state.model.create(actor('staff'),{customer,vehicle,start});state.ids.push(record.id)}state.selected=state.ids[0];calendarInit();render()}
for(const b of document.querySelectorAll('[data-tab]'))b.addEventListener('click',()=>navigate(b.dataset.tab));
$('dashboard-go-staff').addEventListener('click',()=>navigate('staff'));$('dashboard-go-customer').addEventListener('click',()=>navigate('customer'));
$('booking-staff-create').addEventListener('click',()=>submitStaffBooking(false));
$('booking-staff-retry').addEventListener('click',()=>submitStaffBooking(true));
$('booking-create').addEventListener('click',()=>{const date=$('b-date').value;if(!date||!calSlotEnabled(calendar.day,calendar.slot)){notice('booking-result','空いている予約枠を選択してください。',true);return}operation(()=>state.model.create(actor('staff'),{customer:$('b-customer').value,vehicle:$('b-vehicle').value,start:date}),'booking-result')});
$('cal-prev').addEventListener('click',()=>calendarMonth(-1));
$('cal-next').addEventListener('click',()=>calendarMonth(1));
$('staff-report').addEventListener('click',()=>operation(()=>{const r=selected();return state.model.act(actor('staff'),r.id,'report',{observation:$('s-observation').value,expectedVersion:r.version})},'staff-result'));
$('staff-quote').addEventListener('click',()=>operation(()=>{const r=selected();return state.model.act(actor('staff'),r.id,'quote',{items:[{name:$('s-item').value,price:Number($('s-price').value)}],expectedVersion:r.version})},'staff-result'));
$('staff-complete').addEventListener('click',()=>operation(()=>{const r=selected();return state.model.act(actor('staff'),r.id,'complete',{expectedVersion:r.version})},'staff-result'));
$('customer-approve').addEventListener('click',()=>operation(()=>{const r=selected();return state.model.act(actor('customer',r),r.id,'decision',{decision:'approved',expectedVersion:r.version})},'customer-result'));
$('customer-decline').addEventListener('click',()=>operation(()=>{const r=selected();return state.model.act(actor('customer',r),r.id,'decision',{decision:'declined',expectedVersion:r.version})},'customer-result'));
$('owner-reset').addEventListener('click',()=>{init();navigate('owner');notice('owner-result','架空データを初期化しました')});
init();navigate('dashboard');
