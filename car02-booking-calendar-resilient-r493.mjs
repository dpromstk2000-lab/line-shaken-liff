/**
 * V4.93 OFFLINE UI resilience boundary. The V4.92 controller remains immutable.
 * Hostile/missing fixtures, clock faults and DOM setup faults fail closed.
 * Never adds booking, network, storage, billing or notification capability.
 */
import {mountCar02BookingCalendarFirewalledR492}
  from './car02-booking-calendar-firewalled-r492.mjs';
import {createCar02SyntheticCalendarR487}
  from './car02-booking-calendar-preview-r487.mjs';

export const CAR02_V493_RELEASE_LOCK=true;

const invalidDate=()=>new Date(NaN);
const unselected=()=>Object.freeze({day:null,time:null});

function safeClock(clock){
  try{
    const d=clock();
    if(!(d instanceof Date)||Object.getPrototypeOf(d)!==Date.prototype||
       Reflect.ownKeys(d).length!==0)return invalidDate();
    const milliseconds=Date.prototype.getTime.call(d);
    return Number.isFinite(milliseconds)?new Date(milliseconds):invalidDate();
  }catch{return invalidDate();}
}

function safeSyntheticFactory(factory,now){
  try{return factory(now);}catch{return null;}
}

function fullyLockDom(root){
  try{
    if(!root||typeof root.getElementById!=='function')return;
    for(const id of ['prev-month','next-month','confirm-preview']){
      const control=root.getElementById(id);
      if(control)control.disabled=true;
    }
    for(const id of ['days','slots'])root.getElementById(id)?.replaceChildren?.();
    const status=root.getElementById('notice');
    if(status)status.textContent='入力・時計・画面の検査に失敗しました。表示を停止しました。予約は行いません。';
    const month=root.getElementById('month-title');
    if(month)month.textContent='安全確認が必要です';
    for(const id of ['chosen-day','chosen-time']){
      const item=root.getElementById(id);
      if(item)item.textContent='未選択';
    }
  }catch{
    // Root itself may be a hostile test double. No effect escapes this boundary.
  }
}

/** Preview-only controller with failure containment and immutable API. */
export function mountCar02BookingCalendarResilientR493(
  root,clock=()=>new Date(),calendarFactory=createCar02SyntheticCalendarR487
){
  try{
    if(typeof clock!=='function'||typeof calendarFactory!=='function')
      throw Error('preview_dependencies_invalid');
    const inner=mountCar02BookingCalendarFirewalledR492(
      root,()=>safeClock(clock),now=>safeSyntheticFactory(calendarFactory,now)
    );
    if(!inner||typeof inner.getSelected!=='function')
      throw Error('preview_controller_invalid');
    return Object.freeze({
      getSelected:()=>inner.getSelected(),
      releaseLock:true,commercialDecision:'NO_GO_HOLD',
      bookingCreationAllowed:false
    });
  }catch{
    fullyLockDom(root);
    return Object.freeze({
      getSelected:unselected,
      releaseLock:true,commercialDecision:'NO_GO_HOLD',
      bookingCreationAllowed:false
    });
  }
}

if(typeof document!=='undefined'&&document.body?.hasAttribute('data-car02-r493-preview')){
  mountCar02BookingCalendarResilientR493(document);
}
