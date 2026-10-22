/**
 * CAR02 V4.88 — keyboard-accessible, synthetic-only booking-calendar preview.
 * No network, storage, booking, hold, checkout, provider or LINE capability.
 * V4.85-V4.87 policy files remain immutable baseline sources.
 */
import {buildCar02BookingDayViewR486} from './car02-booking-day-view-r486.mjs';
import {buildCar02MonthGridR487,car02JstTodayR487} from './car02-booking-month-grid-r487.mjs';
import {createCar02SyntheticCalendarR487} from './car02-booking-calendar-preview-r487.mjs';

export const CAR02_V488_RELEASE_LOCK=true;
const ids=['month-title','days','slots','prev-month','next-month',
  'chosen-day','chosen-time','confirm-preview','notice','slot-description'];

export function mountCar02BookingCalendarAccessibleR488(root,clock=()=>new Date()) {
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
    const b=root.createElement('button');
    b.type='button';b.className=cls;b.textContent=label;
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
    return buildCar02BookingDayViewR486({day,calendar:createCar02SyntheticCalendarR487(now),now});
  };
  function updateDayButtons(){
    for(const item of displayedDays){
      item.button.setAttribute('aria-pressed',String(selectedDay===item.day));
      item.button.tabIndex=item.day===rovingDay?0:-1;
    }
  }
  function moveFocus(sourceDay,key,event){
    const index=displayedDays.findIndex(item=>item.day===sourceDay);
    if(index<0) return;
    const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[key];
    let target=-1;
    if(delta!==undefined){
      for(let i=index+delta;i>=0&&i<displayedDays.length;i+=delta){
        if(!displayedDays[i].button.disabled){target=i;break;}
      }
    } else if(key==='Home'||key==='End'){
      const firstOfWeek=Math.floor((monthFirstOffset+index)/7)*7-monthFirstOffset;
      const indices=Array.from({length:7},(_,i)=>firstOfWeek+i)
        .filter(i=>i>=0&&i<displayedDays.length&&!displayedDays[i].button.disabled);
      target=indices.length?(key==='Home'?indices[0]:indices.at(-1)):-1;
    } else return;
    event?.preventDefault?.();
    if(target<0) return;
    rovingDay=displayedDays[target].day;
    updateDayButtons();
    displayedDays[target].button.focus?.();
  }
  function updateTimeButtons(){
    for(const button of $('slots').children){
      if(button.className.includes('candidate'))
        button.setAttribute('aria-pressed',String(button.textContent===selectedTime));
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
    if(view.reason!=='synthetic_day_projection_only'){
      selectedTime=null;
      text('slot-description','この日は候補時間を表示できません。別の日付を選んでください。');
      updateSummary();return;
    }
    text('slot-description','選択できるデモ候補は青、選択不可は灰色で表示されます。');
    if(selectedTime&&!view.candidateTimes.includes(selectedTime)) selectedTime=null;
    for(const slot of view.slots){
      const button=makeButton(slot.time,slot.selectableInOfflineUi?'time candidate':'time unavailable');
      button.disabled=!slot.selectableInOfflineUi;
      button.setAttribute('aria-label',`${slot.time} ${slot.selectableInOfflineUi?'デモ選択可':'選択不可'}`);
      button.setAttribute('aria-pressed',String(selectedTime===slot.time));
      button.addEventListener('click',()=>{
        // Recheck at click time: the Japanese date or the time window can roll over.
        const live=dayView(selectedDay);
        if(!live.candidateTimes.includes(slot.time)){
          selectedTime=null;renderTimes();
          announce('時間候補の有効期限が切れました。別の時間を選んでください。');
          return;
        }
        selectedTime=slot.time;
        // Keep the focused element mounted; replacing it loses keyboard focus.
        updateTimeButtons();
        announce(`${selectedDay} ${selectedTime} をデモ候補として選びました。予約は成立していません。`);
      });
      host.append(button);
    }
    updateSummary();
  }
  function renderMonth(){
    const now=clock();
    const grid=buildCar02MonthGridR487({year,month,
      calendar:createCar02SyntheticCalendarR487(now),now});
    $('days').replaceChildren();displayedDays=[];
    if(grid.reason!=='synthetic_month_projection_only'){
      selectedDay=null;selectedTime=null;rovingDay=null;
      text('month-title','候補を表示できません');
      $('prev-month').disabled=true;$('next-month').disabled=true;
      renderTimes();
      announce('隔離カレンダーを確認できません。実際の予約操作は行えません。');
      return;
    }
    text('month-title',grid.monthTitle);
    monthFirstOffset=grid.cells.findIndex(cell=>cell.type==='day');
    $('prev-month').disabled=!grid.previousMonthAllowed;
    $('next-month').disabled=!grid.nextMonthAllowed;
    const selectable=grid.cells.filter(cell=>cell.type==='day'&&cell.selectableInOfflineUi);
    if(!selectable.some(cell=>cell.day===rovingDay)) rovingDay=selectable[0]?.day??null;
    for(const cell of grid.cells){
      if(cell.type==='pad'){
        const pad=root.createElement('span');pad.className='empty';
        pad.setAttribute('aria-hidden','true');$('days').append(pad);continue;
      }
      const b=makeButton(String(cell.number),'calendar-day');
      b.disabled=!cell.selectableInOfflineUi;
      b.setAttribute('aria-label',`${cell.day} ${cell.selectableInOfflineUi?'デモ候補あり':'デモ候補なし'}`);
      if(cell.day===car02JstTodayR487(now)) b.setAttribute('aria-current','date');
      b.addEventListener('click',()=>{
        // Do not redraw the month grid: keyboard focus remains on the selected date.
        selectedDay=cell.day;selectedTime=null;rovingDay=cell.day;
        updateDayButtons();renderTimes();
        announce(`${cell.day} を選択しました。時間を選んでください。`);
      });
      b.addEventListener('keydown',e=>moveFocus(cell.day,e.key,e));
      displayedDays.push({day:cell.day,button:b});
      $('days').append(b);
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
    if(!(selectedDay&&selectedTime)) return;
    const checked=dayView(selectedDay);
    if(!checked.candidateTimes.includes(selectedTime)){
      selectedTime=null;renderTimes();
      announce('この時間は選択できなくなりました。時間を選び直してください。');
      return;
    }
    announce(`${selectedDay} ${selectedTime}：画面表示を確認しました。予約登録・仮確保・通知は行いません。`);
  });
  renderMonth();
  announce('安全な隔離プレビューです。架空の空き枠のみを表示しています。');
  return Object.freeze({getSelected:selected});
}

if(typeof document!=='undefined'&&document.body?.hasAttribute('data-car02-r488-preview')){
  mountCar02BookingCalendarAccessibleR488(document);
}
