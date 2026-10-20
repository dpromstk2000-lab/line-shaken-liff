import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCar02ScopedStaffAuthorityR435} from './car02-staff-authority-r435.mjs';
import {
 CAR02_V438_RELEASE_LOCK,CAR02_V438_MUTATE_SQL,CAR02_V438_RECEIPT_SQL,
 createCar02IdempotentTouchR438
} from './car02-idempotency-r438.mjs';
const shop='qa_shop_a', otherShop='qa_shop_b',sub='00000000-0000-0000-0000-000000004398';
const order='00000000-0000-0000-0000-000000004381',key='00000000-0000-0000-0000-000000004388';
const session='00000000-0000-0000-0000-000000004399', token='signed-v438-review-staff-token';
const now=2000000000000;
const req=()=>new Request('https://car02.test/no-release',{headers:{authorization:'Bearer '+token}});
const sha=x=>createHash('sha256').update(x).digest('hex');
const denied=p=>assert.rejects(p,e=>e?.code==='CAR02_UNAUTHORIZED'&&e?.status===401);
const input=(overrides={})=>({id:order,requestKey:key,expectedVersion:1,...overrides});
function setup({lostAck=false,committedDespiteLostAck=false,lookupUnavailable=false,malformedMutation=false,
                tamperedDurable=false,failWrite=false,clockRef={value:now}}={}){
 const events=[];
 const receipts=new Map();let pending=null,checks=0,connections=0,member={shopCode:shop,userSub:sub,role:'staff',active:true,authVersion:1,authGenerationCommittedAtMs:now-50000};
 const authority=createCar02ScopedStaffAuthorityR435({shopCode:shop,nowMs:()=>clockRef.value,
   verifyStaffJwt:async()=>({verified:true,sub,exp:Math.floor(now/1000)+500}),
   readStaffMembership:async()=>({...member}),
   attestProviderSession:async()=>({verified:true,active:true,userSub:sub,sessionId:session,createdAtMs:now-1000,credentialSha256:sha(token)})});
 const pool={connect:async()=>{
   connections++;const connectionNumber=connections;
   events.push(`CONNECT${connectionNumber}`);
   if(connectionNumber>1&&lookupUnavailable)throw Error('lookup network lost');
   return {release:(err)=>events.push(err?'RELEASE_ERROR':'RELEASE'),query:async(sql,params=[])=>{
    const name=sql===CAR02_V438_MUTATE_SQL?'MUTATION':sql===CAR02_V438_RECEIPT_SQL?'RECEIPT':sql.includes('FOR UPDATE')?'AUTH_LOCK':sql;
    events.push(name);
    if(name==='AUTH_LOCK'){
      checks++;return {rows:[{shop_code:shop,user_sub:sub,staff_role:member.role,active:member.active,
        auth_version:member.authVersion,auth_generation_committed_at_ms:member.authGenerationCommittedAtMs}]};
    }
    if(name==='MUTATION'){
      if(failWrite)throw Error('sensitive failure');
      assert.deepEqual(params,[shop,sub,key,order,1]);
      const prior=receipts.get(`${shop}|${sub}|${key}`);
      const row=prior?{...prior,replayed:true}:{shopCode:shop,actorSub:sub,requestKey:key,id:order,
        expectedVersion:1,newVersion:2,replayed:false};
      if(!prior)pending={...row,replayed:false};
      if(malformedMutation)return {rows:[{receipt:{...row,id:'00000000-0000-0000-0000-000000004000'}}]};
      return {rows:[{receipt:row}]};
    }
    if(name==='COMMIT'){
      if(pending){if(!lostAck||committedDespiteLostAck)receipts.set(`${shop}|${sub}|${key}`,pending);pending=null;}
      if(lostAck)throw Error('transport lost after COMMIT may have executed');
      return {rowCount:0};
    }
    if(name==='ROLLBACK'){pending=null;return {rowCount:0};}
    if(name==='RECEIPT'){
      assert.deepEqual(params,[shop,sub,key]);
      const found=receipts.get(`${shop}|${sub}|${key}`);
      if(!found)return{rows:[]};
      return{rows:[{shop_code:found.shopCode,actor_sub:found.actorSub,request_key:found.requestKey,
       order_id:tamperedDurable?'00000000-0000-0000-0000-000000004000':found.id,
       expected_version:found.expectedVersion,new_version:found.newVersion}]};
    }
    return {rowCount:0};
   }};
 }};
 const gate=createCar02IdempotentTouchR438({authority,pool,nowMs:()=>clockRef.value,maxAgeMs:15000});
 return {gate,events,receipts,clockRef,receiptSeed(){receipts.set(`${shop}|${sub}|${key}`,{shopCode:shop,actorSub:sub,requestKey:key,id:order,expectedVersion:1,newVersion:2,replayed:false})},
    get checks(){return checks},get connections(){return connections},set member(x){member=x},get member(){return member}};
}
const touch=(gate,actor,x=input(),target=shop)=>gate.touch({actor,shopCode:target,input:x});
test('V4.38 hard release lock, immutable server-selected SQL and configuration',()=>{
 assert.equal(CAR02_V438_RELEASE_LOCK,true);
 assert.match(CAR02_V438_MUTATE_SQL,/^SELECT public\.v438_qa_apply_touch\(/);
 assert.match(CAR02_V438_RECEIPT_SQL,/WHERE shop_code=\$1 AND actor_sub=\$2 AND request_key=\$3$/);
 assert.throws(()=>createCar02IdempotentTouchR438(),/V438_CONFIG_REQUIRED/);
});
test('successful COMMIT publishes definitive receipt after same-tx membership lock',async()=>{
 const h=setup(),actor=await h.gate.authenticate(req());const r=await touch(h.gate,actor);
 assert.deepEqual(r,{status:'committed',reconciled:false,replayed:false,requestKey:key});
 assert.equal(h.receipts.size,1);assert.equal(h.checks,1);
 assert.ok(h.events.indexOf('AUTH_LOCK')<h.events.indexOf('MUTATION'));
 assert.ok(h.events.indexOf('MUTATION')<h.events.indexOf('COMMIT'));
});
test('COMMIT acknowledgement lost but durable receipt exists: recover on independent connection',async()=>{
 const h=setup({lostAck:true,committedDespiteLostAck:true}),actor=await h.gate.authenticate(req());
 const r=await touch(h.gate,actor);
 assert.deepEqual(r,{status:'committed',reconciled:true,replayed:false,requestKey:key});
 assert.equal(h.connections,2);assert.deepEqual(h.events.slice(-5),['COMMIT','RELEASE_ERROR','CONNECT2','RECEIPT','RELEASE']);
});
test('COMMIT lost and no durable receipt => INDETERMINATE, not rolled back or successful',async()=>{
 const h=setup({lostAck:true,committedDespiteLostAck:false}),actor=await h.gate.authenticate(req());
 const r=await touch(h.gate,actor);
 assert.deepEqual(r,{status:'indeterminate',reconciled:false,requestKey:key});
 assert.equal(h.events.includes('ROLLBACK'),false);assert.equal(h.receipts.size,0);
});
test('COMMIT lost plus reconciliation transport failure remains INDETERMINATE',async()=>{
 const h=setup({lostAck:true,committedDespiteLostAck:true,lookupUnavailable:true}),actor=await h.gate.authenticate(req());
 assert.equal((await touch(h.gate,actor)).status,'indeterminate');
 assert.equal(h.receipts.size,1,'cannot incorrectly infer rollback from read failure');
});
test('COMMIT lost plus wrong durable receipt never reports success',async()=>{
 const h=setup({lostAck:true,committedDespiteLostAck:true,tamperedDurable:true}),actor=await h.gate.authenticate(req());
 assert.equal((await touch(h.gate,actor)).status,'indeterminate');
});
test('new valid actor + same key replays prior durable result without double write',async()=>{
 const h=setup();h.receiptSeed();const actor=await h.gate.authenticate(req());
 const r=await touch(h.gate,actor);assert.equal(r.replayed,true);
 assert.equal(h.receipts.size,1);
});
test('same issued actor cannot submit a second request or race',async()=>{
 const h=setup();const actor=await h.gate.authenticate(req());
 await touch(h.gate,actor);await denied(touch(h.gate,actor));
 assert.equal(h.events.filter(x=>x==='MUTATION').length,1);
});
test('forged actor and cross-tenant requests fail before any database connect',async()=>{
 const h=setup(),actor=await h.gate.authenticate(req());
 await denied(touch(h.gate,{...actor}));await denied(touch(h.gate,actor,input(),otherShop));
 assert.equal(h.connections,0);
});
test('incorrect keys, SQL fields and malformed versions are refused before a transaction',async()=>{
 for(const x of [input({requestKey:'bad'}),input({expectedVersion:0}),input({sql:'DELETE FROM x'}),
  input({expectedVersion:1.5}),input({id:'wrong'}),Object.assign(Object.create(null),input())]){
   const h=setup(),actor=await h.gate.authenticate(req());await denied(touch(h.gate,actor,x));
   assert.equal(h.connections,0);
 }
});
test('revoked staff is denied under lock and rolls back without mutation',async()=>{
 const h=setup(),actor=await h.gate.authenticate(req());
 h.member={...h.member,active:false,authVersion:2};await denied(touch(h.gate,actor));
 assert.equal(h.events.includes('MUTATION'),false);
 assert.equal(h.events.includes('ROLLBACK'),true);
});
test('SQL function errors and untrusted receipt fail closed',async()=>{
 for(const config of [{failWrite:true},{malformedMutation:true}]){
   const h=setup(config),actor=await h.gate.authenticate(req());
   await denied(touch(h.gate,actor));assert.equal(h.events.includes('COMMIT'),false);
   assert.equal(h.events.includes('ROLLBACK'),true);
 }
});
test('capability expires before update, and no receipts or commits occur',async()=>{
 const clockRef={value:now};const h=setup({clockRef}),actor=await h.gate.authenticate(req());
 clockRef.value+=16000;await denied(touch(h.gate,actor));assert.equal(h.connections,0);
});
