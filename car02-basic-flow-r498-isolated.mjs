/** CAR02 customer journey in-memory acceptance model. Synthetic test data ONLY.
 * NOT a production API, database, authentication, tenant RLS or release proof.
 */
export const DELIVERY_MODE = Object.freeze({environment:'isolated_demo',release:'NO_GO',migration:'HOLD',externalAccess:false,photoStorage:false});
const error=(code)=>{const e=new Error(code);e.code=code;throw e};
const requireText=(v,max=160)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=max;
// Local wall-clock datetime: reject rollover (e.g. February 30) and off-grid times.
const validDate=(v)=>{
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:(00|30)$/.test(v))return false;
 const [year,month,day,hour,minute]=v.match(/\d+/g).map(Number);
 const d=new Date(year,month-1,day,hour,minute,0,0);
 return year>=2000&&year<=9999&&d.getFullYear()===year&&d.getMonth()===month-1&&
  d.getDate()===day&&d.getHours()===hour&&d.getMinutes()===minute;
};
export function makeCar02Demo({now=()=>new Date()}={}) {
  const cases=new Map();let seq=0;
  function requireCase(id,shop){let c=cases.get(id);if(!c)error('CASE_NOT_FOUND');if(c.shop!==shop)error('TENANT_DENIED');return c;}
  const roles={create:['staff','owner'],reschedule:['staff','owner'],cancel:['staff','owner'],report:['staff','owner'],quote:['staff','owner'],decision:['customer'],complete:['staff','owner']};
  function role(action,actor){if(!actor||!requireText(actor.shop,80)||!roles[action].includes(actor.role))error('ROLE_DENIED')}
  function version(c,expected){if(!Number.isSafeInteger(expected)||expected!==c.version)error('VERSION_CONFLICT')}
  const copy=(c)=>structuredClone(c);
  return Object.freeze({
    create(actor,data){role('create',actor);if(!data||!requireText(data.customer,80)||!requireText(data.vehicle,80)||!validDate(data.start)||new Date(data.start).getTime()<=now().getTime())error('BOOKING_INVALID');
      // Conservative model: one reservation per store/time slot. Real DB must enforce atomic uniqueness.
      if([...cases.values()].some(c=>c.shop===actor.shop&&c.status!=='cancelled'&&c.start===data.start))error('BOOKING_SLOT_OCCUPIED');
      const id=`DEMO-${String(++seq).padStart(4,'0')}`;let c={id,shop:actor.shop,customer:data.customer.trim(),vehicle:data.vehicle.trim(),start:data.start,status:'booked',report:'',quote:[],decision:null,version:1,history:['予約作成']};cases.set(id,c);return copy(c)},
    view(actor,id){if(!actor||!requireText(actor.shop,80))error('ROLE_DENIED');const c=requireCase(id,actor.shop);if(actor.role==='customer'&&actor.customer!==c.customer)error('CUSTOMER_DENIED');if(!['customer','staff','owner'].includes(actor.role))error('ROLE_DENIED');return copy(c)},
    act(actor,id,action,data={}){if(!(action in roles))error('ACTION_DENIED');role(action,actor);const c=requireCase(id,actor.shop);version(c,data.expectedVersion);
      const previousStart=c.start;
      if(action==='reschedule'){if(c.status!=='booked')error('TRANSITION_DENIED');if(!validDate(data.start)||new Date(data.start).getTime()<=now().getTime())error('BOOKING_INVALID');if(c.start===data.start)error('BOOKING_UNCHANGED');if([...cases.values()].some(other=>other.id!==c.id&&other.shop===c.shop&&other.status!=='cancelled'&&other.start===data.start))error('BOOKING_SLOT_OCCUPIED');c.start=data.start}
      if(action==='cancel'){if(c.status!=='booked')error('TRANSITION_DENIED');c.status='cancelled'}
      if(action==='report'){if(c.status!=='booked'||!requireText(data.observation,10000))error('TRANSITION_DENIED');c.report=data.observation.trim();c.status='reported'}
      if(action==='quote'){if(c.status!=='reported'||!Array.isArray(data.items)||data.items.length<1||data.items.length>30||!data.items.every(x=>requireText(x.name)&&Number.isSafeInteger(x.price)&&x.price>=0&&x.price<=100000000))error('TRANSITION_DENIED');c.quote=data.items.map(x=>({name:x.name.trim(),price:x.price}));c.status='awaiting_approval'}
      if(action==='decision'){if(c.status!=='awaiting_approval'||actor.customer!==c.customer||!['approved','declined'].includes(data.decision))error('TRANSITION_DENIED');c.decision=data.decision;c.status=data.decision==='approved'?'approved':'declined'}
      if(action==='complete'){if(c.status!=='approved')error('TRANSITION_DENIED');c.status='completed'}
      c.version++;c.history.push(action==='reschedule'?`予約変更 ${previousStart.replace('T',' ')} → ${c.start.replace('T',' ')}`:action==='cancel'?'予約キャンセル':({report:'整備報告',quote:'見積作成',decision:'顧客'+(c.decision==='approved'?'承認':'否認'),complete:'作業完了'})[action]);return copy(c)
    },
    count:()=>cases.size
  });
}

