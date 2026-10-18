/** SHA-pinned repository checkout review only. No auth, DB, network or deploy. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {auditV38R43TransactionReplaySources} from './car02-v38-r43-transaction-audit-isolated.mjs';
const pins={
 'car02-pg-adapter.mjs':'dc57effaec3ed9b6ec309420b3506a57ec7a599f',
 'car02-identity-r44.mjs':'91c3ef3475c837828ae7640d9cab75bcc46e3ced',
 'car02-edge-entry-r52.ts':'f0e31fb9f9d98524519d01dffd3489893d3d3302',
 'car02-v37-authorized-replay-fence-isolated.mjs':'b5086a323349d493f694a20f65e955c8cd1b76f8'
};
const blobSha=s=>createHash('sha1').update(`blob ${Buffer.byteLength(s)}\0`,'utf8').update(s,'utf8').digest('hex');
const source={};
for(const [file,sha] of Object.entries(pins)){
  const src=readFileSync(new URL(file,import.meta.url),'utf8');
  if(blobSha(src)!==sha)throw Error(`CAR02_V38_SOURCE_DRIFT:${file}`);
  source[file]=src;
}
const r=auditV38R43TransactionReplaySources({
 pg:source['car02-pg-adapter.mjs'],identity:source['car02-identity-r44.mjs'],
 edge:source['car02-edge-entry-r52.ts'],replay:source['car02-v37-authorized-replay-fence-isolated.mjs']
},{environment:'isolated_qa',allowIsolatedQa:true});
if(r.sourceDriftDetected||r.passed!==11||r.blockerCount!==5||r.productionReady!==false||r.release!=='NO_GO')throw Error('CAR02_V38_REVIEW_GATES_FAILED');
for(const [name,ok] of Object.entries(r.checks))console.log(`V38_SOURCE_PASS ${name}: ${ok}`);
for(const name of r.blockers)console.log(`V38_REVIEW_BLOCKER ${name}`);
console.log('CAR02_V38_R43_REPLAY_AUDIT_PASS 11/11 BLOCKERS=5 NO_GO HOLD');
console.log('V38_SOURCE_REVIEW_ONLY: NO_REAL_DB_LOCK_OR_LIVE_AUTH_CLAIM');
