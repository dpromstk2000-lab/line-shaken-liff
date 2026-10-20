import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCar02ScopedStaffAuthorityR435} from './car02-staff-authority-r435.mjs';
import {createCar02AtomicStaffWriteGateR436} from './car02-transaction-gate-r436.mjs';
import {CAR02_V437_RELEASE_LOCK,CAR02_V437_TOUCH_SQL,createCar02TenantCasGateR437} from './car02-tenant-cas-gate-r437.mjs';
const now=2_000_000_000_000;
const shop='street_house_kitsuki',sub='00000000-0000-0000-0000-000000004437';
const id='00000000-0000-0000-0000-000000000437',otherId='00000000-0000-0000-0000-000000001437';
const session='00000000-0000-0000-0000-000000003437',token='v437-server-signed-fixture-abcdef';
const req=()=>new Request('https://car02.test/no-go',{headers:{authorization:'Bearer '+token}});
const input={id,expectedVersion:1};
const denied=p=>assert.rejects(p,e=>e?.code==='CAR02_UNAUTHORIZED'&&e.status===401);
function setup({clock={value:now},resultRows=null,fail='',onLock=null,onCas=null,holdConnect=null}={}){
  let member={shopCode:shop,userSub:sub,active:true,role:'staff',authVersion:3,authGenerationCommittedAtMs:now-50_000};
  const authority=createCar02ScopedStaffAuthorityR435({shopCode:shop,nowMs:()=>clock.value,
   verifyStaffJwt:async()=>({verified:true,sub,exp:Math.floor(now/1000)+1000}),
   readStaffMembership:async()=>({...member}),
   attestProviderSession:async()=>({verified:true,active:true,userSub:sub,sessionId:session,createdAtMs:now-1000,credentialSha256:createHash('sha256').update(token).digest('hex')})});
  const calls=[];
  const client={query:async(sql,params=[])=>{
    calls.push({sql,params});if(sql===fail)throw Error('sensitive internal error');
    if(sql.includes('FOR UPDATE')){onLock?.();return {rows:[{shop_code:shop,user_sub:sub,staff_role:member.role,active:member.active,auth_version:member.authVersion,auth_generation_committed_at_ms:member.authGenerationCommittedAtMs}]};}
    if(sql===CAR02_V437_TOUCH_SQL){onCas?.();return resultRows??{rowCount:1,rows:[{id}]};}
    return {rowCount:0};
  },release:()=>calls.push({sql:'RELEASE'})};
  const pool={connect:async()=>{calls.push({sql:'CONNECT'});if(holdConnect)await holdConnect();if(fail==='CONNECT')throw Error('db offline');return client;}};
  const gate=createCar02TenantCasGateR437({authority,pool,nowMs:()=>clock.value,maxAgeMs:15000});
  return {gate,authority,pool,calls,clock,set member(m){member=m},get member(){return member}};
}
test('release lock and exact SQL never allow OR/expression injection',()=>{
  assert.equal(CAR02_V437_RELEASE_LOCK,true);
  assert.equal(CAR02_V437_TOUCH_SQL,'UPDATE public.ksh_car02_work_orders SET state_version=state_version+1,updated_at=clock_timestamp() WHERE shop_code=$1 AND id=$2 AND state_version=$3 RETURNING id');
  assert.doesNotMatch(CAR02_V437_TOUCH_SQL,/\bOR\b|;|--|\/\*/i);
});
test('V436 review limitation reproduced: misconfigured server SQL with OR is accepted at factory construction (NOT run)',()=>{
  const h=setup();
  assert.doesNotThrow(()=>createCar02AtomicStaffWriteGateR436({authority:h.authority,pool:h.pool,operations:{danger:{sql:'UPDATE public.ksh_car02_work_orders SET status=$3 WHERE shop_code=$1 OR id=$2 RETURNING id',parameters:()=>[shop,id,'approved']}}}));
});
test('same-client membership FOR UPDATE then strict tenant CAS then COMMIT',async()=>{
  const h=setup(),actor=await h.gate.authenticate(req());
  assert.deepEqual(await h.gate.touch({actor,shopCode:shop,input}),{ok:true,kind:'REVIEW_ONLY_CAS_TOUCH',id});
  const statements=h.calls.map(c=>c.sql);
  assert.deepEqual(statements.slice(0,4),['CONNECT','BEGIN',"SET LOCAL lock_timeout = '2s'","SET LOCAL statement_timeout = '15s'"]);
  assert.match(statements[4],/FOR UPDATE/);assert.equal(statements[5],CAR02_V437_TOUCH_SQL);
  assert.deepEqual(h.calls[5].params,[shop,id,1]);assert.deepEqual(statements.slice(-2),['COMMIT','RELEASE']);
});
test('tenant mismatch blocked before connection',async()=>{const h=setup(),a=await h.gate.authenticate(req());await denied(h.gate.touch({actor:a,shopCode:'other-shop',input}));assert.equal(h.calls.length,0);});
test('wrong UUID/version and client SQL overrides rejected before connection',async()=>{
  for(const bad of [{id:otherId+' OR 1=1',expectedVersion:1},{id,expectedVersion:-1},{id,expectedVersion:1.1},{id,expectedVersion:'1'},{id,expectedVersion:1,sql:'DROP TABLE car02'},{id,expectedVersion:1,__proto__:null},[],null]){
    const h=setup(),a=await h.gate.authenticate(req());
    if(bad && Object.getPrototypeOf(bad)===Object.prototype && Object.keys(bad).length===2 && bad.id===id&&bad.expectedVersion===1)continue;
    await denied(h.gate.touch({actor:a,shopCode:shop,input:bad}));assert.equal(h.calls.length,0);
  }
});
test('actor JSON copy and fake role/tenant cannot authorize mutations',async()=>{const h=setup(),a=await h.gate.authenticate(req());await denied(h.gate.touch({actor:{...a},shopCode:shop,input}));await denied(h.gate.touch({actor:{...a,role:'owner'},shopCode:shop,input}));assert.equal(h.calls.length,0);});
test('single-use replay cannot run a second transaction',async()=>{const h=setup(),a=await h.gate.authenticate(req());await h.gate.touch({actor:a,shopCode:shop,input});await denied(h.gate.touch({actor:a,shopCode:shop,input}));assert.equal(h.calls.filter(x=>x.sql===CAR02_V437_TOUCH_SQL).length,1);});
test('two concurrent calls cannot share actor',async()=>{
  let resolve;const wait=new Promise(r=>resolve=r);const h=setup({holdConnect:()=>wait}),a=await h.gate.authenticate(req());
  const p=h.gate.touch({actor:a,shopCode:shop,input});
  await denied(h.gate.touch({actor:a,shopCode:shop,input}));resolve();await p;
  assert.equal(h.calls.filter(x=>x.sql==='CONNECT').length,1);
});
test('revocation between issue and lock blocks business write',async()=>{const h=setup(),a=await h.gate.authenticate(req());h.member={...h.member,active:false,authVersion:4};await denied(h.gate.touch({actor:a,shopCode:shop,input}));assert.equal(h.calls.some(x=>x.sql===CAR02_V437_TOUCH_SQL),false);assert.equal(h.calls.at(-2).sql,'ROLLBACK');});
test('stale expected version or other-tenant result=0 rolls back',async()=>{const h=setup({resultRows:{rowCount:0,rows:[]}}),a=await h.gate.authenticate(req());await denied(h.gate.touch({actor:a,shopCode:shop,input}));assert.deepEqual(h.calls.slice(-2).map(x=>x.sql),['ROLLBACK','RELEASE']);});
test('multirow or mismatched RETURNING id fail closed',async()=>{for(const resultRows of [{rowCount:2,rows:[{id},{id:otherId}]},{rowCount:1,rows:[{id:otherId}]}]){const h=setup({resultRows}),a=await h.gate.authenticate(req());await denied(h.gate.touch({actor:a,shopCode:shop,input}));assert.equal(h.calls.some(x=>x.sql==='COMMIT'),false);}});
test('authorization can expire AFTER DB write but BEFORE commit and must rollback',async()=>{
  const clock={value:now};const h=setup({clock,onCas:()=>{clock.value+=16000}}),a=await h.gate.authenticate(req());
  await denied(h.gate.touch({actor:a,shopCode:shop,input}));assert.deepEqual(h.calls.slice(-2).map(x=>x.sql),['ROLLBACK','RELEASE']);
});
test('authorization can expire during locked membership check',async()=>{
  const clock={value:now};const h=setup({clock,onLock:()=>{clock.value+=16000}}),a=await h.gate.authenticate(req());
  await denied(h.gate.touch({actor:a,shopCode:shop,input}));assert.equal(h.calls.some(x=>x.sql===CAR02_V437_TOUCH_SQL),false);
});
test('SQL failure and commit error are denied, with rollback attempted',async()=>{
  for(const fail of [CAR02_V437_TOUCH_SQL,'COMMIT']){const h=setup({fail}),a=await h.gate.authenticate(req());await denied(h.gate.touch({actor:a,shopCode:shop,input}));assert.equal(h.calls.at(-2).sql,'ROLLBACK');}
});
test('invalid config and no fallback to old provider-only auth',()=>{assert.throws(()=>createCar02TenantCasGateR437(),/CAR02_V437_CONFIG_REQUIRED/);});
