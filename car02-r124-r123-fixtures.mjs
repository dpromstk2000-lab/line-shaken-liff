// DPRO CAR02 R124 — deterministic synthetic R123 decision records for CI.
// Imports the ACTUAL R123 reviewed model to test the bridge; no network or Storage.
import {createR123OfflineReview, bindR123OfflineEvidence} from './car02-r123-photo-review-offline.mjs';
const NOW = 3_000_000;
const U='11111111-1111-4111-8111-111111111111';
const R1='22222222-2222-4222-8222-222222222222';
const R2='33333333-3333-4333-8333-333333333333';
const ZERO='a'.repeat(64);
const id = x => `${String(x).padStart(8,'0')}-4444-4444-8444-444444444444`;
const make = (shop,number) => {
 const orderId=id(100+number), reportId=id(200+number), intentKey=id(300+number), evidenceId=id(400+number);
 const snapshot={shop,orderId,reportId,intentKey,revision:1,state:'QUARANTINED',
  uploader:`staff:${U}`,uploaderRole:'staff',bucket:'ksh-car02-private-photos',
  path:`${shop}/${orderId}/${reportId}/${intentKey}.jpg`,mime:'image/jpeg',size:35,sha256:ZERO,
  quarantineReason:'READBACK_MISMATCH',quarantinedAtMs:1_000_000};
 const evidence={evidenceId,shop,intentKey,revision:1,observedAtMs:2_000_000,
  observedState:'QUARANTINED',objectExists:true,bucket:snapshot.bucket,path:snapshot.path,
  observedMime:snapshot.mime,observedSize:snapshot.size,
  observedSha256:snapshot.sha256,readbackWasVerified:true};
 const binding=bindR123OfflineEvidence(snapshot,evidence);
 const reviewers=[
  {reviewId:id(500+number*2),subject:`staff:${R1}`,role:'owner',verified:true,active:true,shop,
    snapshotHash:binding.snapshotHash,evidenceHash:binding.evidenceHash,
    revision:1,reviewedAtMs:2_100_000,decision:'request_manual_staging_validation'},
  {reviewId:id(501+number*2),subject:`staff:${R2}`,role:'staff',verified:true,active:true,shop,
    snapshotHash:binding.snapshotHash,evidenceHash:binding.evidenceHash,
    revision:1,reviewedAtMs:2_200_000,decision:'request_manual_staging_validation'}];
 return createR123OfflineReview({environment:'isolated_qa',dbName:'car02_r123_offline_qa_ci',releaseLock:true,nowMs:NOW})
  .inspect(snapshot,evidence,reviewers);
};
const records=[make('shop_a',1),make('shop_a',2),make('shop_b',3)];
const assert=x=>{if(!x||x.length!==3||x.some(r=>r.decision!=='MANUAL_STAGING_VALIDATION_PENDING'||r.release!=='NO_GO'))throw Error('R124_SYNTHETIC_BRIDGE');};
assert(records);
process.stdout.write(JSON.stringify(records));
