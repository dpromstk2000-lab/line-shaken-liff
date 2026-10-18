/** DPRO CAR02 V4.7 source READ ONLY (real repo sources in CI; local fixtures labeled). */
import {readFileSync} from 'node:fs';
import {V47_MODE} from './car02-v47-durable-outbox-lease-isolated.mjs';
const read=p=>readFileSync(p,'utf8');
const r13=read('R13_MIGRATION_QA_ONLY.sql'),r43=read('car02-pg-adapter.mjs');
const gate=read('car02-edge-entry-r52.ts');
const previous=read('car02-v46-postcommit-outbox-isolated.mjs');
const model=read('car02-v47-durable-outbox-lease-isolated.mjs');
const tests=read('test_car02_v47_durable_outbox_lease_isolated.mjs');
const proposal=read('CAR02_V47_DURABLE_OUTBOX_LEASE_PG17_REVIEW_ONLY.sql');
const tbl=r13.match(/CREATE TABLE public\.ksh_car02_notification_outbox\s*\(([\s\S]*?)\);/);
const columns=tbl?.[1]||'';
const open=proposal.indexOf('/*'),close=proposal.lastIndexOf('*/');
const executableOutside=proposal.slice(0,open)+'\n'+proposal.slice(close+2);
const checks={
 existingOutboxTable:!!tbl,
 existingOutboxHasUniqueDedupe:/dedupe_key\s+text\s+NOT NULL UNIQUE/i.test(columns),
 existingOutboxNoClaimToken:!(/\bclaim_token\b/i.test(columns)),
 existingOutboxNoLeaseExpiry:!(/\blease_expires_at\b/i.test(columns)),
 existingOutboxStatusLacksUnknown:columns.includes("'sending','sent','retry'")&&!columns.includes("'unknown'"),
 existingOutboxRls:r13.includes('ALTER TABLE public.ksh_car02_notification_outbox ENABLE ROW LEVEL SECURITY'),
 existingAdapterQueuesOutbox:r43.includes('INSERT INTO public.ksh_car02_notification_outbox'),
 existingAdapterUsesCommit:r43.includes("await c.query('COMMIT')"),
 existingAdapterHasNoDurableDispatcher:!r43.includes('provider_message_id'),
 existingV46InMemoryOnly:previous.includes('in-memory atomic-outbox')&&previous.includes('realPgAtomicityProven:false'),
 v47NonDeployable:V47_MODE.deployable===false&&V47_MODE.release==='NO_GO',
 v47NoRealPgOrLine:V47_MODE.realPg===false&&V47_MODE.realLine===false,
 v47NoDbOrNetworkCalls:!/(?:pool|client|db)\.query\s*\(|\bfetch\s*\(/.test(model),
 v47UsesRandomClaimToken:model.includes('randomUUID()'),
 v47PersistsClaimIntentInModel:model.includes("r.claimToken=claimToken")&&model.includes("r.leaseExpiresMs=nowMs+leaseMs"),
 v47RejectsStaleLease:model.includes('CAR02_V47_STALE_LEASE'),
 v47QuarantinesExpired:model.includes("quarantine(r,'lease_expired_unconfirmed'")&&model.includes("r.deliveryStatus='unknown'"),
 v47DoesNotAutoretryUnknown:model.includes("r.deliveryStatus!=='pending'"),
 v47RejectsLateAck:model.includes('CAR02_V47_STALE_ACK'),
 v47ManualEvidenceRequired:model.includes('verifiedEvidence.length<16'),
 v47TestsCrashRecovery:tests.includes('crashed worker expiry sweep quarantines'),
 v47TestsOverlappingDispatch:tests.includes('same token cannot be concurrently dispatched'),
 v47SqlIsNonExecutableReviewOnly:open>=0&&close>open&&/NON-EXECUTABLE REVIEW ONLY/.test(proposal)&&!/^(?:ALTER TABLE|UPDATE|CREATE|DROP|BEGIN|COMMIT)\b/m.test(executableOutside),
 v47DraftHasClaimColumns:proposal.includes('ADD COLUMN claim_token uuid')&&proposal.includes('ADD COLUMN lease_expires_at timestamptz'),
 v47DraftUsesTenantScopedSkipLocked:proposal.includes('w.shop_code=$1')&&proposal.includes('FOR UPDATE OF o SKIP LOCKED'),
 v47DraftFenceTokenAndExpiry:proposal.includes('o.claim_token=$4')&&proposal.includes('o.lease_expires_at>now()'),
 v47DraftQuarantinesExpired:proposal.includes("SET delivery_status='unknown'")&&proposal.includes('lease_expires_at<=now()'),
 releaseLockActive:/const\s+CAR02_RELEASE_LOCK\s*=\s*true/.test(gate)
};
for(const [n,p] of Object.entries(checks))console.log('V47_SOURCE_'+(p?'PASS ':'FAIL ')+n);
const count=Object.values(checks).filter(Boolean).length,total=Object.keys(checks).length;
if(count!==total)process.exitCode=1;
else console.log(`CAR02_V47_DURABLE_OUTBOX_LEASE_REVIEW_PASS ${count}/${total} BLOCKERS=6 NO_GO HOLD`);
console.log('V47_QA_ONLY: IN_MEMORY_LEASE_FENCING; SQL_COMMENT_ONLY; NO_REAL_PG; NO_LINE; NO_EXECUTION; RELEASE_HOLD');
