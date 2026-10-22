/** CAR02 V4.87 isolated browser-only calendar preview; never books anything. */
import {buildCar02BookingDayViewR486} from './car02-booking-day-view-r486.mjs';
import {buildCar02MonthGridR487,car02JstTodayR487,
  car02PlusUtcDaysR487,car02CoverageYearR487} from './car02-booking-month-grid-r487.mjs';

export function createCar02SyntheticCalendarR487(now) {
  const today=car02JstTodayR487(now);
  if(!today) return null;
  const closed=car02PlusUtcDaysR487(today,7);
  const occupiedA=car02PlusUtcDaysR487(today,4);
  const occupiedB=car02PlusUtcDaysR487(today,5);
  return Object.freeze({
    systemCode:'CAR02', environment:'isolated_qa',
    coverageThrough:car02CoverageYearR487(today),
    closedDays:Object.freeze([closed]),
    occupiedSlots:Object.freeze([`${occupiedA}T10:30`,`${occupiedB}T13:00`])
  });
}

/** Call from a same-origin, offline-served HTML module. No globals at import. */
export function mountCar02BookingCalendarPreviewR487(root,clock=()=>new Date()) {
  const $=id=>root.getElementById(id);
  const required=['month-title','days','slots','prev-month','next-month',
    'chosen-day','chosen-time','confirm-preview','notice','slot-description'];
  if(required.some(id=>!$(id))) throw Error('preview_dom_missing');
  const now=clock();
  const today=car02JstTodayR487(now);
  if(!today) throw Error('preview_clock_invalid');
  const [initialYear,initialMonth]=today.split('-').map(Number);
  let year=initialYear,month=initialMonth,chosenDay=null,chosenTime=null;
  const setText=(id,text)=>{$(id).textContent=text;};
  const status=text=>setText('notice',text);
  const makeButton=(label,extraClass='')=>{
    const b=root.createElement('button');b.type='button';b.className=extraClass;b.textContent=label;
    return b;
  };
  function renderSlots() {
    const host=$('slots');host.replaceChildren();
    setText('chosen-day',chosenDay||'未選択');
    setText('chosen-time',chosenTime||'未選択');
    $('confirm-preview').disabled=!(chosenDay&&chosenTime);
    if(!chosenDay){setText('slot-description','日付を選ぶと30分単位の時間候補が表示されます。');return;}
    const actualNow=clock();
    const view=buildCar02BookingDayViewR486({day:chosenDay,
      calendar:createCar02SyntheticCalendarR487(actualNow),now:actualNow});
    if(view.reason!=='synthetic_day_projection_only'){
      chosenTime=null;
      $('confirm-preview').disabled=true;
      setText('chosen-time','未選択');
      setText('slot-description','この日は候補時間を表示できません。別の日付を選んでください。');
      return;
    }
    setText('slot-description','青：選択できるデモ候補 ／ 灰色：デモ上の使用不可枠');
    for(const item of view.slots) {
      const b=makeButton(item.time,item.selectableInOfflineUi?'time candidate':'time unavailable');
      b.disabled=!item.selectableInOfflineUi;
      b.setAttribute('aria-pressed',String(chosenTime===item.time));
      b.setAttribute('aria-label',`${item.time} ${item.selectableInOfflineUi?'デモ選択可':'選択不可'}`);
      b.addEventListener('click',()=>{
        chosenTime=item.time;
        renderSlots();
        status(`${chosenDay} ${chosenTime} をデモ候補として選びました。予約は成立していません。`);
      });
      host.append(b);
    }
  }
  function renderMonth() {
    const actualNow=clock();
    const grid=buildCar02MonthGridR487({year,month,
      calendar:createCar02SyntheticCalendarR487(actualNow),now:actualNow});
    const host=$('days');host.replaceChildren();
    if(grid.reason!=='synthetic_month_projection_only'){
      chosenDay=null;chosenTime=null;renderSlots();
      setText('month-title','候補を表示できません');
      $('prev-month').disabled=true;$('next-month').disabled=true;
      status('隔離カレンダーを確認できません。実際の予約操作は行えません。');
      return;
    }
    setText('month-title',grid.monthTitle);
    $('prev-month').disabled=!grid.previousMonthAllowed;
    $('next-month').disabled=!grid.nextMonthAllowed;
    for(const cell of grid.cells){
      if(cell.type==='pad'){
        const spacer=root.createElement('span');spacer.className='empty';
        spacer.setAttribute('aria-hidden','true');host.append(spacer);continue;
      }
      const button=makeButton(String(cell.number),'calendar-day');
      button.disabled=!cell.selectableInOfflineUi;
      button.setAttribute('aria-pressed',String(chosenDay===cell.day));
      button.setAttribute('aria-label',`${cell.day} ${cell.selectableInOfflineUi?'デモ候補あり':'デモ候補なし'}`);
      if(cell.day===car02JstTodayR487(actualNow)) button.setAttribute('aria-current','date');
      button.addEventListener('click',()=>{
        chosenDay=cell.day;chosenTime=null;
        renderMonth();renderSlots();
        status(`${cell.day} を選択しました。時間を選んでください。`);
      });
      host.append(button);
    }
    renderSlots();
  }
  const shiftMonth=difference=>{
    const next=new Date(Date.UTC(year,month-1+difference,1));
    year=next.getUTCFullYear();month=next.getUTCMonth()+1;
    chosenDay=null;chosenTime=null;
    renderMonth();
  };
  $('prev-month').addEventListener('click',()=>shiftMonth(-1));
  $('next-month').addEventListener('click',()=>shiftMonth(1));
  $('confirm-preview').addEventListener('click',()=>{
    if(!(chosenDay&&chosenTime)) return;
    const liveNow=clock();
    const checked=buildCar02BookingDayViewR486({day:chosenDay,
      calendar:createCar02SyntheticCalendarR487(liveNow),now:liveNow});
    if(!checked.candidateTimes.includes(chosenTime)){
      chosenTime=null;renderSlots();
      status('この枠は選択できません。時間を選び直してください。');
      return;
    }
    status(`${chosenDay} ${chosenTime}：画面表示を確認しました。実際の予約登録・仮確保・通知は行いません。`);
  });
  renderMonth();
  status('安全な隔離プレビューです。架空の空き枠のみを表示しています。');
  return Object.freeze({getSelected:()=>Object.freeze({day:chosenDay,time:chosenTime})});
}

if(typeof document!=='undefined' && document.body?.hasAttribute('data-car02-r487-preview')) {
  mountCar02BookingCalendarPreviewR487(document);
}
