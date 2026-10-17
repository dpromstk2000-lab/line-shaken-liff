import test from 'node:test';
import assert from 'node:assert/strict';
import {V27_MODE,V27_QA_UNIQUE_INDEX_SQL,auditCar02V27R13UniquenessSource as review,
 verifyCar02V27QaIndexDefinition as verify} from './car02-v27-order-uniqueness-audit-isolated.mjs';
const R13=`-- CREATE UNIQUE INDEX misleading_comment ON public.ksh_car02_work_orders(shop_code,reservation_id);
 CREATE TABLE public.ksh_car02_work_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),shop_code text NOT NULL,
 customer_id uuid,vehicle_id uuid,reservation_id uuid,
 status text NOT NULL DEFAULT 'draft',state_version bigint NOT NULL DEFAULT 1,
 customer_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb, vehicle_snapshot jsonb
 ); CREATE INDEX ksh_car02_work_orders_reservation_idx ON public.ksh_car02_work_orders(reservation_id);\n${'some other R13 SQL '.repeat(110)}`;
const A=`export function createCar02PgAdapter(pool) {
 async function transaction() {
 const t={ async assertLinks({customerId,vehicleId,reservationId}){},
 async create(o){ const rec=await c.query(\`INSERT INTO public.ksh_car02_work_orders
 (shop_code,customer_id,vehicle_id,reservation_id,status,state_version) VALUES ($1,$2,$3,$4,'draft',1)\`); }
 }; }
 await c.query('INSERT INTO public.ksh_car02_operations(shop_code,actor_scope,idempotency_key) VALUES ($1,$2,$3)'); }
 ${'unrelated pg adapter '.repeat(120)}`;
const ok=()=>review({r13:R13,adapter:A});
test('mode always release NO_GO',()=>assert.equal(V27_MODE.release,'NO_GO'));
test('mode always migration HOLD',()=>assert.equal(V27_MODE.migration,'HOLD'));
test('mode never sends',()=>assert.equal(V27_MODE.sendable,false));
test('cannot assert real schema check',()=>assert.equal(V27_MODE.liveSchemaChecked,false));
test('source reports lack of unique reservation constraint',()=>assert.equal(ok().uniqueBookingConstraintVerified,false));
test('source reports scoped idempotency but not booking uniqueness',()=>assert.equal(ok().r45HasScopedIdempotency,true));
test('source reports release closed',()=>assert.equal(ok().release,'NO_GO'));
test('source reports production not ready',()=>assert.equal(ok().productionReady,false));
test('source does not claim real transaction',()=>assert.equal(ok().realTransactionVerified,false));
test('source identifies explicit gap',()=>assert.ok(ok().gaps.includes('R13_BOOKING_UNIQUENESS_NOT_ENFORCED')));
test('freezes audit object',()=>assert.ok(Object.isFrozen(ok())));
test('freezes gap array',()=>assert.ok(Object.isFrozen(ok().gaps)));
test('rejects missing SQL',()=>assert.throws(()=>review({adapter:A}),/SOURCE_REQUIRED/));
test('rejects missing adapter',()=>assert.throws(()=>review({r13:R13}),/SOURCE_REQUIRED/));
test('rejects too short SQL',()=>assert.throws(()=>review({r13:'',adapter:A}),/SOURCE_REQUIRED/));
test('rejects missing order table',()=>assert.throws(()=>review({r13:R13.replace('ksh_car02_work_orders (','ksh_fake_orders ('),adapter:A}),/ORDER_SCHEMA_UNRECOGNIZED/));
test('rejects missing reservation column',()=>assert.throws(()=>review({r13:R13.replace('reservation_id uuid,','booking_id uuid,'),adapter:A}),/ORDER_SCHEMA_UNRECOGNIZED/));
test('rejects ordinary-index drift',()=>assert.throws(()=>review({r13:R13.replace('CREATE INDEX ksh_car02_work_orders_reservation_idx','CREATE INDEX changed_idx'),adapter:A}),/EXPECTED_R13_INDEX_DRIFT/));
test('recognizes new booking unique index as a schema change needing review',()=>assert.throws(()=>review({r13:R13+'\nCREATE UNIQUE INDEX new_unique ON public.ksh_car02_work_orders(shop_code,reservation_id);',adapter:A}),/ALREADY_HAS_BOOKING_UNIQUENESS/));
test('recognizes single-column unique index as drift',()=>assert.throws(()=>review({r13:R13+'\nCREATE UNIQUE INDEX new_unique ON public.ksh_car02_work_orders(reservation_id);',adapter:A}),/ALREADY_HAS_BOOKING_UNIQUENESS/));
test('recognizes table unique constraint as drift',()=>assert.throws(()=>review({r13:R13.replace('reservation_id uuid,','reservation_id uuid,UNIQUE(shop_code,reservation_id),'),adapter:A}),/ALREADY_HAS_BOOKING_UNIQUENESS/));
test('rejects adapter lacking INSERT',()=>assert.throws(()=>review({r13:R13,adapter:A.replace('INSERT INTO public.ksh_car02_work_orders','INSERT INTO public.fake_table')}),/R45_CONTRACT_DRIFT/));
test('rejects adapter missing link validation',()=>assert.throws(()=>review({r13:R13,adapter:A.replace('async assertLinks(','async gone(')}),/R45_CONTRACT_DRIFT/));
test('rejects adapter missing operation key',()=>assert.throws(()=>review({r13:R13,adapter:A.replace('idempotency_key','key')}),/R45_CONTRACT_DRIFT/));
test('QA index is unique',()=>assert.ok(/CREATE UNIQUE INDEX/.test(V27_QA_UNIQUE_INDEX_SQL)));
test('QA index scoped by shop and booking',()=>assert.match(V27_QA_UNIQUE_INDEX_SQL,/\(shop_code,reservation_id\)/));
test('QA index skips null booking for unrelated work',()=>assert.match(V27_QA_UNIQUE_INDEX_SQL,/WHERE reservation_id IS NOT NULL/));
test('QA index only for disposable stage',()=>assert.equal(verify(V27_QA_UNIQUE_INDEX_SQL).qaOnly,true));
test('QA index is not a production deploy package',()=>assert.equal(verify(V27_QA_UNIQUE_INDEX_SQL).readyForProduction,false));
test('QA index DDL exact expected name',()=>assert.throws(()=>verify(V27_QA_UNIQUE_INDEX_SQL.replace('car02_v27_qa_one_order_per_reservation','production_unique')),/DDL_INVALID/));
test('QA index rejects nonunique variant',()=>assert.throws(()=>verify(V27_QA_UNIQUE_INDEX_SQL.replace('CREATE UNIQUE INDEX','CREATE INDEX')),/DDL_INVALID/));
test('QA index rejects omitting tenant key',()=>assert.throws(()=>verify(V27_QA_UNIQUE_INDEX_SQL.replace('shop_code,','')),/DDL_INVALID/));
test('QA index rejects dropping nullable protection',()=>assert.throws(()=>verify(V27_QA_UNIQUE_INDEX_SQL.replace(' WHERE reservation_id IS NOT NULL','')),/DDL_INVALID/));
test('QA index rejects extra SQL / multiple statements',()=>assert.throws(()=>verify(V27_QA_UNIQUE_INDEX_SQL+'; DROP DATABASE car02_qa'),/DDL_INVALID/));
test('QA index rejects empty text',()=>assert.throws(()=>verify(''),/DDL_INVALID/));
test('QA index rejects non-string',()=>assert.throws(()=>verify(null),/DDL_INVALID/));
test('QA audit has no HTTP or auth claims',()=>assert.deepEqual(ok().gaps.slice(-1),['LIVE_AUTH_AND_RELEASE_NOT_PROVEN']));
