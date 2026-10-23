/**
 * V4.92 isolated UI: keyboard-accessible and V4.91 input-firewall guarded.
 * No HTTP, storage, customer form, booking, hold, billing or notifications.
 */
import {buildCar02FirewalledDayR492} from './car02-booking-firewalled-day-r492.mjs';
import {buildCar02MonthGridR487,car02JstTodayR487} from './car02-booking-month-grid-r487.mjs';
import {createCar02SyntheticCalendarR487} from './car02-booking-calendar-preview-r487.mjs';
import {evaluateCar02BookingInputFirewallR491} from './car02-booking-input-firewall-r491.mjs';

export const CAR02_V492_UI_RELEASE_LOCK=true;
const ids=['month-title','days','slots','prev-month','next-month',
  'chosen-day','chosen-time','confirm-preview','notice','slot-description'];
const times=Object.freeze(Array.from({length:18},(_,i)=>{
  const minutes=540+i*30;
  return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
}));

/** Optional fixture argument is only for isolated negative testing. */
export function mountCar02BookingCalendarFirewalledR492(
  root,clock=()=>new Date(),calendarFactory=createCar02SyntheticCalendarR487
){
  if(!root||typeof root.getElementById!=='function'||typeof root.createElement!=='function')
    throw Error('preview_dom_missing');
  const $=id=>root.getElementById(id);
  if(ids.some(id=>!$(id))) throw Error('preview_dom_missing');
  const today=car02JstTodayR487(clock());
  if(!today) throw Error('preview_clock_invalid');
  let [year,month]=today.split('-').map(Number);
  let selectedDay=null,selectedTime=null,rovingDay=null;
  let displayedDays=[],monthFirstOffset=0;
  const text=(id,value)=>{$(id).textContent=value;};
  const announce=value=>text('notice',value);
  const makeButton=(label,cls)=>{
    const b=root.createElement('button');b.type='button';b.className=cls;b.textContent=label;
    return b;
  };
  const selected=()=>Object.freeze({day:selectedDay,time:selectedTime});
  const updateSummary=()=>{
    text('chosen-day',selectedDay||'未選択');
    text('chosen-time',selectedTime||'未選択');
    $('confirm-preview').disabled=!(selectedDay&&selectedTime);
  };
  const dayView=day=>{
    const now=clock();
    return buildCar02FirewalledDayR492({day,calendar:calendarFactory(now),now});
  };
  const validDay=day=>{
    const view=dayView(day);
    return view.reason==='synthetic_firewalled_day_projection_only'&&view.candidateCount>0;
  };
  const visibleDayCandidate=(day,calendar,now)=>times.some(time=>{
    const decision=evaluateCar02BookingInputFirewallR491({
      selection:{day,time},calendar,now
    });
    return decision.releaseLock===true&&decision.bookingCreationAllowed===false&&
      decision.candidateAvailableInOfflineUi===true;
  });
  function updateDayButtons(){
    for(const item of displayedDays){
      item.button.setAttribute('aria-pressed',String(selectedDay===item.day));
      item.button.tabIndex=item.day===rovingDay?0:-1;
    }
  }
  function moveFocus(sourceDay,key,event){
    const index=displayedDays.findIndex(item=>item.day===sourceDay);
    if(index<0)return;
    const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[key];
    let target=-1;
    if(delta!==undefined){
      for(let i=index+delta;i>=0&&i<displayedDays.length;i+=delta){
        if(!displayedDays[i].button.disabled){target=i;break;}
      }
    }else if(key==='Home'||key==='End'){
      const start=Math.floor((monthFirstOffset+index)/7)*7-monthFirstOffset;
      const eligible=Array.from({length:7},(_,i)=>start+i)
        .filter(i=>i>=0&&i<displayedDays.length&&!displayedDays[i].button.disabled);
      target=eligible.length?(key==='Home'?eligible[0]:eligible.at(-1)):-1;
    }else return;
    event?.preventDefault?.();
    if(target<0)return;
    rovingDay=displayedDays[target].day;
    updateDayButtons();displayedDays[target].button.focus?.();
  }
  function updateTimeButtons(){
    for(const b of $('slots').children){
      if(b.className.includes('candidate'))
        b.setAttribute('aria-pressed',String(b.textContent===selectedTime));
    }
    updateSummary();
  }
  function renderTimes(){
    const host=$('slots');host.replaceChildren();
    if(!selectedDay){
      text('slot-description','日付を選ぶと30分単位の時間候補が表示されます。');
      updateSummary();return;
    }
    const view=dayView(selectedDay);
    if(view.reason!=='synthetic_firewalled_day_projection_only'){
      selectedTime=null;
      text('slot-description','入力防御検査により、この日のデモ候補は表示できません。');
      updateSummary();return;
    }
    text('slot-description','青：2段階の入力防御を通過した架空候補 ／ 灰色：選択不可');
    if(selectedTime&&!view.candidateTimes.includes(selectedTime))selectedTime=null;
    for(const slot of view.slots){
      const enabled=slot.selectableInOfflineUi;
      const b=makeButton(slot.time,enabled?'time candidate':'time unavailable');
      b.disabled=!enabled;
      b.setAttribute('aria-label',`${slot.time} ${enabled?'デモ選択可':'選択不可'}`);
      b.setAttribute('aria-pressed',String(selectedTime===slot.time));
      b.addEventListener('click',()=>{
        const live=dayView(selectedDay);
        if(!live.candidateTimes.includes(slot.time)){
          selectedTime=null;renderTimes();
          announce('入力防御検査で候補が失効しました。別の時間を選んでください。');
          return;
        }
        selectedTime=slot.time;
        updateTimeButtons();
        announce(`${selectedDay} ${selectedTime} を架空のデモ候補として選びました。予約は成立していません。`);
      });
      host.append(b);
    }
    updateSummary();
  }
  function renderMonth(){
    const now=clock();
    const calendar=calendarFactory(now);
    const grid=buildCar02MonthGridR487({year,month,calendar,now});
    $('days').replaceChildren();displayedDays=[];
    if(grid.reason!=='synthetic_month_projection_only'){
      selectedDay=null;selectedTime=null;rovingDay=null;
      text('month-title','候補を表示できません');
      $('prev-month').disabled=true;$('next-month').disabled=true;
      renderTimes();announce('入力防御検査に通らないためデモを表示できません。');return;
    }
    text('month-title',grid.monthTitle);
    monthFirstOffset=grid.cells.findIndex(cell=>cell.type==='day');
    $('prev-month').disabled=!grid.previousMonthAllowed;
    $('next-month').disabled=!grid.nextMonthAllowed;
    const selectable=grid.cells.filter(cell=>cell.type==='day'&&cell.selectableInOfflineUi&&
      visibleDayCandidate(cell.day,calendar,now));
    if(!selectable.some(cell=>cell.day===rovingDay))rovingDay=selectable[0]?.day??null;
    for(const cell of grid.cells){
      if(cell.type==='pad'){
        const pad=root.createElement('span');pad.className='empty';
        pad.setAttribute('aria-hidden','true');$('days').append(pad);continue;
      }
      const enabled=selectable.some(item=>item.day===cell.day);
      const b=makeButton(String(cell.number),'calendar-day');
      b.disabled=!enabled;
      b.setAttribute('aria-label',`${cell.day} ${enabled?'デモ候補あり':'デモ候補なし'}`);
      if(cell.day===car02JstTodayR487(now))b.setAttribute('aria-current','date');
      b.addEventListener('click',()=>{
        if(!validDay(cell.day)){
          selectedDay=null;selectedTime=null;renderTimes();
          announce('入力防御検査で日付候補が失効しました。');return;
        }
        selectedDay=cell.day;selectedTime=null;rovingDay=cell.day;
        updateDayButtons();renderTimes();
        announce(`${cell.day} を選択しました。架空の時間候補を選んでください。`);
      });
      b.addEventListener('keydown',e=>moveFocus(cell.day,e.key,e));
      displayedDays.push({day:cell.day,button:b});$('days').append(b);
    }
    updateDayButtons();renderTimes();
  }
  function shiftMonth(delta){
    const next=new Date(Date.UTC(year,month-1+delta,1));
    year=next.getUTCFullYear();month=next.getUTCMonth()+1;
    selectedDay=null;selectedTime=null;rovingDay=null;
    renderMonth();
  }
  $('prev-month').addEventListener('click',()=>shiftMonth(-1));
  $('next-month').addEventListener('click',()=>shiftMonth(1));
  $('confirm-preview').addEventListener('click',()=>{
    if(!(selectedDay&&selectedTime))return;
    const checked=dayView(selectedDay);
    if(!checked.candidateTimes.includes(selectedTime)){
      selectedTime=null;renderTimes();
      announce('入力防御検査により候補が失効しました。時間を選び直してください。');return;
    }
    announce(`${selectedDay} ${selectedTime}：架空デモの画面表示のみ確認しました。予約登録・仮確保・通知は行いません。`);
  });
  renderMonth();
  announce('V4.92 安全な隔離プレビューです。すべて架空の候補です。');
  return Object.freeze({getSelected:selected});
}

if(typeof document!=='undefined'&&document.body?.hasAttribute('data-car02-r492-preview')){
  mountCar02BookingCalendarFirewalledR492(document);
}
