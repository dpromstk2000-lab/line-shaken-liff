import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCar02ScopedStaffAuthorityR435} from './car02-staff-authority-r435.mjs';
import {createCar02AtomicStaffWriteGateR436,CAR02_V436_RELEASE_LOCK} from './car02-transaction-gate-r436.mjs';
const clock=2_000_000_000_000;
const shop='street_house_kitsuki', sub='00000000-0000-0000-0000-000000004436';
const token='signed-v436-staff-token-abcdef',session='00000000-0000-0000-0000-000000000436';
const id='00000000-0000-0000-0000-000000004236';
const sql='UPDATE public.ksh_car02_work_orders SET status=$3 WHERE shop_code=$1 AND id=$2 RETURNING id';
const deny=p=>assert.rejects(p,e=>e?.code==='CAR02_UNAUTHORIZED'&&e.status===401);
const req=()=>new Request('https://car02.test/isolated-review',{headers:{authorization:'Bearer '+token}});
function fixture({expiredAfter=15000,writeRowCount=1,failAt='',clockRef={value:clock},sleepConnect=null,onAuthCheck=null}={}){
 let member={shopCode:shop,userSub:sub,active:true,role:'staff',authVersion:7,authGenerationCommittedAtMs:clock-90000};
 const events=[];
 const authority=createCar02ScopedStaffAuthorityR435({shopCode:shop,nowMs:()=>clockRef.value,
  verifyStaffJwt:async()=>({verified:true,sub,exp:Math.floor(clock/1000)+360}),
  readStaffMembership:async()=>({...member}),
  attestProviderSession:async()=>({verified:true,active:true,userSub:sub,sessionId:session,createdAtMs:clock-1000,credentialSha256:createHash('sha256').update(token).digest('hex')})});
 const client={query:async (query,values=[])=>{
   events.push({query,values});
   if(query===failAt)throw Error('sensitive database failure');
   if(query==='SELECT')throw Error('wrong statement');
   if(query.includes('FOR UPDATE')){if(onAuthCheck)onAuthCheck();return {rows:[{shop_code:shop,user_sub:sub,staff_role:member.role,active:member.active,auth_version:member.authVersion,auth_generation_committed_at_ms:member.authGenerationCommittedAtMs}]};}
   if(query===sql)return {rowCount:writeRowCount,rows:writeRowCount?[{id}]:[]};
   return {rowCount:0};
  },release:()=>{events.push({query:'RELEASE'})}};
 const pool={connect:async()=>{events.push({query:'CONNECT'});if(sleepConnect)await sleepConnect();if(failAt==='CONNECT')throw Error('postgres unavailable');return client;}};
 const gate=createCar02AtomicStaffWriteGateR436({authority,pool,capabilityMaxAgeMs:expiredAfter,nowMs:()=>clockRef.value,
  operations:{update_status:{sql,parameters:({shopCode,input})=>[shopCode,input?.id,input?.status]}}});
 return {gate,events,clockRef,set member(v){member=v},get member(){return member},pool,authority};
}
const mutate=(gate,actor,operation='update_status',shopCode=shop,input={id,status:'approved'})=>gate.mutate({actor,shopCode,operation,input});
test('hard release lock closed and config is restricted',()=>{
 assert.equal(CAR02_V436_RELEASE_LOCK,true);
 assert.throws(()=>createCar02AtomicStaffWriteGateR436(),/CAR02_V436_SERVER_CONFIG_REQUIRED/);
 const x=fixture();
 assert.throws(()=>createCar02AtomicStaffWriteGateR436({authority:x.authority,pool:x.pool,operations:{write:{sql:'COMMIT; UPDATE public.ksh_car02_work_orders SET active=true WHERE shop_code=$1 RETURNING id',parameters:()=>[]}}}),/CAR02_V436_UNREVIEWED_SQL_REJECTED/);
 assert.throws(()=>createCar02AtomicStaffWriteGateR436({authority:x.authority,pool:x.pool,operations:{w:{sql:'UPDATE public.ksh_car02_work_orders SET status=$3 RETURNING id',parameters:()=>[]}}}),/CAR02_V436_UNREVIEWED_SQL_REJECTED/);
});
test('one update executes between actor row-lock and COMMIT on the same client',async()=>{
 const h=fixture();const actor=await h.gate.authenticate(req());const out=await mutate(h.gate,actor);
 assert.deepEqual(out,{ok:true,operation:'update_status',rowCount:1});
 const steps=h.events.map(x=>x.query);
 assert.deepEqual(steps,['CONNECT','BEGIN',"SET LOCAL lock_timeout = '2s'","SET LOCAL statement_timeout = '15s'",steps[4],sql,'COMMIT','RELEASE']);
 assert.match(steps[4],/FROM public.ksh_car02_staff_access/);assert.match(steps[4],/FOR UPDATE/);
 assert.deepEqual(h.events[5].values,[shop,id,'approved']);
 assert.equal(Object.isFrozen(out),true);
});
test('same actor cannot mutate twice, even sequentially',async()=>{
 const h=fixture();const actor=await h.gate.authenticate(req());await mutate(h.gate,actor);
 await deny(mutate(h.gate,actor));assert.equal(h.events.filter(x=>x.query===sql).length,1);
});
test('simultaneous calls cannot reuse a single issued actor',async()=>{
 let wake;const waiting=new Promise(resolve=>wake=resolve);const h=fixture({sleepConnect:()=>waiting});
 const actor=await h.gate.authenticate(req());const a=mutate(h.gate,actor);const b=mutate(h.gate,actor);
 await deny(b);wake();assert.equal((await a).ok,true);assert.equal(h.events.filter(x=>x.query==='CONNECT').length,1);
});
test('JSON copies, frozen clones, and unrelated authorities denied before connection',async()=>{
 const h=fixture(),other=fixture();const actor=await h.gate.authenticate(req());
 await deny(mutate(h.gate,JSON.parse(JSON.stringify(actor))));
 await deny(mutate(h.gate,Object.freeze({...actor})));
 await deny(mutate(other.gate,actor));
 assert.equal(h.events.length,0);assert.equal(other.events.length,0);
});
test('invalid shop or operation never opens database connection',async()=>{
 const h=fixture(),actor=await h.gate.authenticate(req());
 await deny(mutate(h.gate,actor,'drop_table'));await deny(mutate(h.gate,actor,'update_status','other_shop'));
 assert.equal(h.events.length,0);
});
test('authorization generation mismatch ROLLBACKs before business update',async()=>{
 const h=fixture(),actor=await h.gate.authenticate(req());
 h.member={...h.member,authVersion:8,active:true,authGenerationCommittedAtMs:clock-100};
 await deny(mutate(h.gate,actor));assert.equal(h.events.some(x=>x.query===sql),false);
 assert.deepEqual(h.events.slice(-2).map(x=>x.query),['ROLLBACK','RELEASE']);
});
test('revoked staff ROLLBACKs and denies before business update',async()=>{
 const h=fixture(),actor=await h.gate.authenticate(req());h.member={...h.member,active:false,authVersion:9};
 await deny(mutate(h.gate,actor));assert.equal(h.events.some(x=>x.query===sql),false);
 assert.equal(h.events.at(-2).query,'ROLLBACK');
});
test('SQL failure never COMMITs and response hides database details',async()=>{
 const h=fixture({failAt:sql}),actor=await h.gate.authenticate(req());
 await deny(mutate(h.gate,actor));assert.equal(h.events.some(x=>x.query==='COMMIT'),false);
 assert.deepEqual(h.events.slice(-2).map(x=>x.query),['ROLLBACK','RELEASE']);
});
test('zero-row or multirow updates fail closed with ROLLBACK',async()=>{
 for (const writeRowCount of [0,2]){
  const h=fixture({writeRowCount}),actor=await h.gate.authenticate(req());
  await deny(mutate(h.gate,actor));assert.equal(h.events.some(x=>x.query==='COMMIT'),false);
  assert.equal(h.events.at(-2).query,'ROLLBACK');
 }
});
test('COMMIT error attempts rollback and never reports success',async()=>{
 const h=fixture({failAt:'COMMIT'}),actor=await h.gate.authenticate(req());
 await deny(mutate(h.gate,actor));assert.deepEqual(h.events.slice(-3).map(x=>x.query),['COMMIT','ROLLBACK','RELEASE']);
});
test('connection error is hidden and still consumes actor',async()=>{
 const h=fixture({failAt:'CONNECT'}),actor=await h.gate.authenticate(req());
 await deny(mutate(h.gate,actor));await deny(mutate(h.gate,actor));
 assert.equal(h.events.filter(x=>x.query==='CONNECT').length,1);
});
test('capability expires before starting mutation',async()=>{
 const t={value:clock},h=fixture({expiredAfter:500,clockRef:t}),actor=await h.gate.authenticate(req());
 t.value+=501;await deny(mutate(h.gate,actor));assert.equal(h.events.length,0);
});
test('capability expiration while waiting for DB authorization blocks business write',async()=>{
 const t={value:clock},h=fixture({expiredAfter:1000,clockRef:t,onAuthCheck:()=>{t.value+=1001}});const actor=await h.gate.authenticate(req());
 await deny(mutate(h.gate,actor));assert.equal(h.events.some(x=>x.query===sql),false);
 assert.equal(h.events.at(-2).query,'ROLLBACK');
});
test('no caller-selected arbitrary SQL accepted by operation whitelist',async()=>{
 const h=fixture(),actor=await h.gate.authenticate(req());
 await deny(h.gate.mutate({actor,shopCode:shop,operation:'COMMIT',input:{sql:'DROP TABLE public.ksh_car02_staff_access'}}));
 assert.equal(h.events.length,0);
});
test('two newly authenticated actors may execute separate transactions',async()=>{
 const h=fixture(),a=await h.gate.authenticate(req()),b=await h.gate.authenticate(req());
 await mutate(h.gate,a);await mutate(h.gate,b);assert.equal(h.events.filter(x=>x.query==='COMMIT').length,2);
});
