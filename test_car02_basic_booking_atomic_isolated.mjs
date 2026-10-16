import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAtomicBookingInput,createAtomicBookingQa,ATOMIC_BOOKING_MODE} from './car02-basic-booking-atomic-isolated.mjs';
const C='11111111-1111-4111-8111-111111111111',V='22222222-2222-4222-8222-222222222222';
const input={customerId:C,vehicleId:V,day:'2026-10-19',time:'10:30',requestKey:'synthetic-booking-0001'};
const now=new Date('2026-10-16T00:00:00Z');
const v=x=>validateAtomicBookingInput(x,{now});
test('stays NO_GO/HOLD and non-deployable',()=>{assert.equal(ATOMIC_BOOKING_MODE.release,'NO_GO');assert.equal(ATOMIC_BOOKING_MODE.migration,'HOLD');assert.equal(ATOMIC_BOOKING_MODE.nonDeployable,true)});
test('valid future JST half hour and strict UUID references',()=>assert.deepEqual(v(input),input));
test('extra role/shop/user fields never accepted',()=>assert.throws(()=>v({...input,shopCode:'other_shop'}),/FIELDS_INVALID/));
test('missing customer or vehicle UUID denied',()=>{assert.throws(()=>v({...input,customerId:'name'}),/UUID_REQUIRED/);assert.throws(()=>v({...input,vehicleId:'name'}),/UUID_REQUIRED/)});
test('invalid idempotency key denied',()=>assert.throws(()=>v({...input,requestKey:'short'}),/REQUEST_KEY_INVALID/));
test('past date blocked',()=>assert.throws(()=>v({...input,day:'2026-10-15'}),/WINDOW_INVALID/));
test('61 days later blocked',()=>assert.throws(()=>v({...input,day:'2026-12-17'}),/WINDOW_INVALID/));
test('February 30 and bad month rejected',()=>{assert.throws(()=>v({...input,day:'2027-02-30'}),/DATE_INVALID/);assert.throws(()=>v({...input,day:'2027-13-01'}),/DATE_INVALID/)});
test('closed Sunday blocked',()=>assert.throws(()=>v({...input,day:'2026-10-18'}),/CLOSED_DAY/));
test('invalid minutes blocked',()=>assert.throws(()=>v({...input,time:'10:15'}),/TIME_INVALID/));
test('too early and too late blocked',()=>{assert.throws(()=>v({...input,time:'08:30'}),/BUSINESS_HOURS/);assert.throws(()=>v({...input,time:'18:00'}),/BUSINESS_HOURS/)});
test('today past time blocked with Tokyo local comparison',()=>assert.throws(()=>validateAtomicBookingInput({...input,day:'2026-10-16',time:'09:00'},{now:new Date('2026-10-16T01:00:00Z')}),/WINDOW_INVALID/));
test('QA constructor rejects production environment',()=>assert.throws(()=>createAtomicBookingQa({environment:'production',allowDisposableQa:true,pool:{connect(){}}}),/ISOLATION_REQUIRED/));
test('QA constructor rejects missing explicit consent',()=>assert.throws(()=>createAtomicBookingQa({environment:'disposable_qa',pool:{connect(){}}}),/ISOLATION_REQUIRED/));
test('QA constructor rejects ordinary local or production env',()=>{
  const pool={connect(){},options:{host:'127.0.0.1',database:'car02_qa',user:'postgres',port:5432}};
  // Explicitly inject a NON-CI environment. GitHub Actions itself sets all
  // synthetic QA variables, so the ambient process.env is not a negative case.
  assert.throws(()=>createAtomicBookingQa({environment:'disposable_qa',allowDisposableQa:true,pool,env:{}}),/DISPOSABLE_ONLY/);
  // Forged runner context but incorrect database must also fail closed.
  assert.throws(()=>createAtomicBookingQa({environment:'disposable_qa',allowDisposableQa:true,pool,
    env:{GITHUB_ACTIONS:'true',NODE_ENV:'test',CAR02_RELEASE_LOCK:'true',CAR02_BASIC_PG17_QA:'yes',
      PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGPASSWORD:'qa_only_local',PGDATABASE:'production'}}),/DISPOSABLE_ONLY/);
  // A non-loopback pool must be rejected even if caller claims a disposable QA environment.
  assert.throws(()=>createAtomicBookingQa({environment:'disposable_qa',allowDisposableQa:true,
    pool:{...pool,options:{...pool.options,host:'db.production.invalid'}},
    env:{GITHUB_ACTIONS:'true',NODE_ENV:'test',CAR02_RELEASE_LOCK:'true',CAR02_BASIC_PG17_QA:'yes',
      PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGPASSWORD:'qa_only_local',PGDATABASE:'car02_qa'}}),/DISPOSABLE_ONLY/);
});
