import test from 'node:test';
import assert from 'node:assert/strict';
import {createCar02BrowserClientR49,Car02ClientError} from './car02-browser-client-r49.mjs';
import {createCar02MockTransportR49,CAR02_R49_DEMO_IDS} from './car02-mock-transport-r49.mjs';
const {orderId,customerId,vehicleId}=CAR02_R49_DEMO_IDS;
const key=()=>`car02-r49-replay-${Math.random().toString(36).slice(2).padEnd(12,'0')}`;
function clients(){const mock=createCar02MockTransportR49();let role='staff';const c=createCar02BrowserClientR49({apiOrigin:'https://car02-stage.invalid/',connectionEnabled:true,fetchImpl:mock.fetchImpl,credentials:()=>({kind:role,token:role==='staff'?'demo-staff-token':'demo-customer-token'})});return{c,mock,setRole:x=>role=x};}
test('R49 complete mock HTTP workflow via browser transport, no production network',async()=>{
 const{c,mock,setRole}=clients();let o=await c.get(orderId);assert.equal(o.status,'draft');
 o=await c.saveReport(orderId,{observation:'エンジンルーム目視点検',photos:[],expectedVersion:o.version},key());assert.equal(o.version,2);
 o=await c.presentQuote(orderId,{items:[{name:'ベルト交換',price:9800}],expectedVersion:o.version},key());assert.equal(o.quote.total,10780);assert.equal(o.status,'pending');
 setRole('customer');let data=await c.get(orderId);assert.equal(data.version,3);
 o=await c.decision(orderId,{decision:'approved',reason:'',expectedVersion:data.version},key());assert.equal(o.status,'approved');
 setRole('staff');o=await c.complete(orderId,{expectedVersion:o.version},key());assert.equal(o.status,'completed');
 const events=await c.history(orderId);assert.equal(events.length,5);assert.equal(mock.inspect().version,5);
});
test('R49 cannot approve quote as staff, or present quote as customer',async()=>{
 const{c,setRole}=clients();await assert.rejects(c.decision(orderId,{decision:'approved',reason:'',expectedVersion:1},key()),e=>e instanceof Car02ClientError&&e.code==='CAR02_UNAUTHORIZED');
 setRole('customer');await assert.rejects(c.presentQuote(orderId,{items:[{name:'X',price:10}],expectedVersion:1},key()),e=>e.code==='CAR02_UNAUTHORIZED');
});
test('R49 replay key does not double advance version',async()=>{
 const{c,mock}=clients(),id=key();const payload={observation:'点検',photos:[],expectedVersion:1};const x=await c.saveReport(orderId,payload,id);const y=await c.saveReport(orderId,payload,id);assert.equal(x.version,2);assert.equal(y.version,2);assert.equal(mock.inspect().events.length,2);
});
test('R49 concurrent stale version update fails',async()=>{
 const{c}=clients();await c.saveReport(orderId,{observation:'OK',photos:[],expectedVersion:1},key());await assert.rejects(c.saveReport(orderId,{observation:'old',photos:[],expectedVersion:1},key()),e=>e.code==='CAR02_VERSION_CONFLICT');
});
test('R49 demo store reset clears states and events',async()=>{
 const{c,mock}=clients();await c.saveReport(orderId,{observation:'OK',photos:[],expectedVersion:1},key());mock.reset();const o=await c.get(orderId);assert.equal(o.status,'draft');assert.equal(o.version,1);assert.equal(o.events.length,1);
});
test('R49 QA transport contains only synthetic references',()=>{assert.ok(customerId&&vehicleId);assert.equal(createCar02MockTransportR49().inspect().photos.length,0)});
