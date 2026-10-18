/** DPRO CAR02 V4.6 read-only source review, never SQL execution or deployment. */
import {readFileSync} from 'node:fs';
import {V46_MODE} from './car02-v46-postcommit-outbox-isolated.mjs';
const read=p=>readFileSync(p,'utf8');
const model=read('car02-v46-postcommit-outbox-isolated.mjs');
const tests=read('test_car02_v46_postcommit_outbox_isolated.mjs');
const r43=read('car02-pg-adapter.mjs');
const r13=read('R13_MIGRATION_QA_ONLY.sql');
const gate=read('car02-edge-entry-r52.ts');
const checks={
 qaNonDeployable:V46_MODE.deployable===false&&V46_MODE.realDb===false&&V46_MODE.release==='NO_GO',
 noNetworkOrDatabaseInNewModel:!/(?:pool|client|db)\.query\s*\(|\bfetch\s*\(/.test(model),
 noRealExactlyOnceClaim:V46_MODE.exactlyOnceDeliveryProven===false&&V46_MODE.realLine===false,
 modelHasStagedQuote:model.includes('const stagedOrder=')&&model.includes('const stagedOutbox='),
 modelPublishesAfterCheckpoint:model.indexOf("if(onStage)await onStage('beforeCommit')")<model.indexOf('orders.set(key,copy(stagedOrder))'),
 modelRollbackHasNoOutboxMutation:model.includes("record.steps.push('ROLLBACK')"),
 modelDedupesByQuote:model.includes('car02:quote:${quoteId}:presented'),
 modelNoAutomaticUnknownRetry:model.includes("r.deliveryStatus='unknown'")&&model.includes("r.deliveryStatus!=='pending'"),
 modelRequiresLease:model.includes('r.claimToken!==lease.claimToken'),
 modelRequiresManualReconcile:model.includes('manualReviewConfirmedNotDelivered!==true'),
 modelRejectsOverlap:model.includes('active.has(key)'),
 testsStageFaults:tests.includes("['beforeInsert','afterInsert','beforeCommit']"),
 testsUnknownSends:tests.includes("['throw','timeout','ambiguous','wrong-shape','no-provider-id']"),
 testsCrossTenant:tests.includes('shop scope blocks cross-tenant claim'),
 r13HasOutboxTable:r13.includes('CREATE TABLE public.ksh_car02_notification_outbox ('),
 r13UniqueDedupKey:/dedupe_key\s+text\s+NOT NULL\s+UNIQUE/.test(r13),
 r13HasPendingSendingStates:r13.includes("'pending','sending','sent','retry','failed','cancelled'"),
 r13OutboxRlsEnabled:r13.includes('ALTER TABLE public.ksh_car02_notification_outbox ENABLE ROW LEVEL SECURITY'),
 r13NoDurableLeaseToken:!(/CREATE TABLE public\.ksh_car02_notification_outbox \(([\s\S]*?)\);/.exec(r13)?.[1]||'').includes('claim_token'),
 r43OutboxEnqueuedInQuoteWrite:r43.includes('INSERT INTO public.ksh_car02_notification_outbox')&&r43.includes("'quote_presented'"),
 r43UsesRelationalCommit:r43.includes("await c.query('COMMIT')"),
 r43NoRealOutboxDispatcher:!r43.includes('providerMessageId')&&!r43.includes('dispatchOutbox'),
 releaseGateHardLocked:/const\s+CAR02_RELEASE_LOCK\s*=\s*true/.test(gate)
};
for(const [name,pass] of Object.entries(checks))console.log('V46_SOURCE_'+(pass?'PASS ':'FAIL ')+name);
const pass=Object.values(checks).filter(Boolean).length,total=Object.keys(checks).length;
if(pass!==total)process.exitCode=1;
else console.log(`CAR02_V46_POSTCOMMIT_OUTBOX_REVIEW_PASS ${pass}/${total} BLOCKERS=6 NO_GO HOLD`);
console.log('V46_QA_ONLY: IN_MEMORY_ATOMIC_OUTBOX; NO_PG; NO_LINE; NO_REAL_DISPATCH; UNCERTAIN_SEND_MANUAL_REVIEW; RELEASE_HOLD');
