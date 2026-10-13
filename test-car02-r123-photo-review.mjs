import test from 'node:test';
import assert from 'node:assert/strict';
import {bindR123OfflineEvidence,createR123OfflineReview,R123_CONTRACT} from './car02-r123-photo-review-offline.mjs';
const T=1791800000000;
const uuid=c=>`${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const ids={order:uuid('1'),report:uuid('2'),intent:uuid('3'),uploader:'staff:'+uuid('4'),
 owner:'staff:'+uuid('5'),staff:'staff:'+uuid('6'),other:'staff:'+uuid('7')};
const base=()=>({state:'QUARANTINED',revision:7,shop:'street_house_demo',orderId:ids.order,reportId:ids.report,
 intentKey:ids.intent,uploader:ids.uploader,uploaderRole:'staff',bucket:'ksh-car02-private-photos',
 path:`street_house_demo/${ids.order}/${ids.report}/${ids.intent}.jpg`,mime:'image/jpeg',size:401,
 sha256:'a'.repeat(64),quarantineReason:'READBACK_MISMATCH',quarantinedAtMs:T-120000});
const evidence=s=>({evidenceId:uuid('8'),shop:s.shop,intentKey:s.intentKey,revision:s.revision,
 observedAtMs:T-60000,observedState:'QUARANTINED',objectExists:true,bucket:s.bucket,path:s.path,
 observedMime:s.mime,observedSize:s.size,observedSha256:s.sha256,readbackWasVerified:true});
const reviews=(s,e)=>{const b=bindR123OfflineEvidence(s,e);return [
 {reviewId:uuid('9'),subject:ids.owner,shop:s.shop,role:'owner',verified:true,active:true,
  snapshotHash:b.snapshotHash,evidenceHash:b.evidenceHash,revision:s.revision,
  reviewedAtMs:T-30000,decision:'request_manual_staging_validation'},
 {reviewId:uuid('a'),subject:ids.staff,shop:s.shop,role:'staff',verified:true,active:true,
  snapshotHash:b.snapshotHash,evidenceHash:b.evidenceHash,revision:s.revision,
  reviewedAtMs:T-20000,decision:'request_manual_staging_validation'}];};
const reviewer=()=>createR123OfflineReview({environment:'isolated_qa',dbName:'car02_r123_offline_qa_ci',releaseLock:true,nowMs:T});
const run=(sf,ef,rf)=>{const s=base();sf?.(s);const e=evidence(s);ef?.(e,s);const r=reviews(s,e);rf?.(r,s,e);return reviewer().inspect(s,e,r);};
const reject=(code,...mods)=>assert.throws(()=>run(...mods),{code:'R123_'+code});
test('baseline offline review requires independent owner and staff',()=>{
 const x=run();assert.equal(x.decision,'MANUAL_STAGING_VALIDATION_PENDING');
 assert.equal(x.deleteAllowed,false);assert.equal(x.markReadyAllowed,false);
 assert.equal(x.mutationAllowed,false);assert.equal(x.quarantineState,'QUARANTINED');
 assert.equal(x.recordHash.length,64);assert.equal(x.reviewers.length,2);
});
test('baseline deterministic content binding',()=>assert.equal(run().recordHash,run().recordHash));
test('baseline records distinct bound reviewers',()=>assert.notEqual(run().reviewers[0].subject,run().reviewers[1].subject));
test('no bypass with live environment',()=>assert.throws(()=>createR123OfflineReview({environment:'production',dbName:'car02_r123_offline_qa_ci',releaseLock:true,nowMs:T}),{code:'R123_ISOLATED_ONLY'}));
test('no bypass with incorrect DB identity',()=>assert.throws(()=>createR123OfflineReview({environment:'isolated_qa',dbName:'postgres',releaseLock:true,nowMs:T}),{code:'R123_ISOLATED_ONLY'}));
test('no bypass when release lock open',()=>assert.throws(()=>createR123OfflineReview({environment:'isolated_qa',dbName:'car02_r123_offline_qa_ci',releaseLock:false,nowMs:T}),{code:'R123_ISOLATED_ONLY'}));
test('no bypass with invalid deterministic clock',()=>assert.throws(()=>createR123OfflineReview({environment:'isolated_qa',dbName:'car02_r123_offline_qa_ci',releaseLock:true,nowMs:NaN}),{code:'R123_ISOLATED_ONLY'}));
test('READY photo is not a quarantine',()=>reject('STATE',s=>s.state='READY'));
test('wrong revision type rejected',()=>reject('STATE',s=>s.revision=0));
test('forged tenant path rejected',()=>reject('PATH',s=>s.path='other_demo/'+s.orderId+'/'+s.reportId+'/'+s.intentKey+'.jpg'));
test('invalid shop scope rejected',()=>reject('SCOPE',s=>s.shop='Bad!!'));
test('invalid bucket rejected',()=>reject('BUCKET_MIME',s=>s.bucket='public'));
test('invalid checksum rejected',()=>reject('INTEGRITY',s=>s.sha256='xx'));
test('oversized photo rejected',()=>reject('INTEGRITY',s=>s.size=5242881));
test('invalid reason rejected',()=>reject('QUARANTINE_REASON',s=>s.quarantineReason='DELETE_REQUESTED'));
test('different evidence tenant rejected',()=>reject('EVIDENCE_SCOPE',null,e=>e.shop='other_demo'));
test('different evidence revision rejected',()=>reject('EVIDENCE_SCOPE',null,e=>e.revision=8));
test('fake Storage object presence rejected',()=>reject('EVIDENCE_OBJECT',null,e=>e.objectExists=false));
test('different checksum rejected',()=>reject('EVIDENCE_MISMATCH',null,e=>e.observedSha256='b'.repeat(64)));
test('different size rejected',()=>reject('EVIDENCE_MISMATCH',null,e=>e.observedSize=402));
test('unverified readback rejected',()=>reject('READBACK_UNPROVEN',null,e=>e.readbackWasVerified=false));
test('evidence before quarantine rejected',()=>reject('EVIDENCE_TIME',null,e=>e.observedAtMs=T-180000));
test('future evidence rejected',()=>reject('EVIDENCE_TIME',null,e=>e.observedAtMs=T+10));
test('stale evidence rejected',()=>reject('STALE_EVIDENCE',s=>s.quarantinedAtMs=T-26*3600000,e=>e.observedAtMs=T-25*3600000));
test('wrong Storage state rejected',()=>reject('EVIDENCE_STATE',null,e=>e.observedState='READY'));
test('only one reviewer rejected',()=>reject('TWO_REVIEWERS_REQUIRED',null,null,r=>r.pop()));
test('unverified reviewer rejected',()=>reject('REVIEW_AUTH_SCOPE',null,null,r=>r[0].verified=false));
test('disabled reviewer rejected',()=>reject('REVIEW_AUTH_SCOPE',null,null,r=>r[0].active=false));
test('cross-tenant reviewer rejected',()=>reject('REVIEW_AUTH_SCOPE',null,null,r=>r[1].shop='other_demo'));
test('self-review by uploader rejected',()=>reject('INDEPENDENT_REVIEW',null,null,r=>r[0].subject=ids.uploader));
test('duplicate reviewer rejected',()=>reject('INDEPENDENT_REVIEW',null,null,r=>r[1].subject=ids.owner));
test('duplicate review event rejected',()=>reject('REVIEW_ID_REPLAY',null,null,r=>r[1].reviewId=r[0].reviewId));
test('old snapshot hash rejected',()=>reject('STALE_REVIEW_BINDING',null,null,r=>r[0].snapshotHash='f'.repeat(64)));
test('old evidence hash rejected',()=>reject('STALE_REVIEW_BINDING',null,null,r=>r[0].evidenceHash='f'.repeat(64)));
test('review revision mismatch rejected',()=>reject('STALE_REVIEW_BINDING',null,null,r=>r[0].revision=9));
test('review before observation rejected',()=>reject('REVIEW_TIME',null,null,(r,s,e)=>r[0].reviewedAtMs=e.observedAtMs-1));
test('future review rejected',()=>reject('REVIEW_TIME',null,null,r=>r[0].reviewedAtMs=T+100));
test('premature release decision rejected',()=>reject('REVIEW_DECISION',null,null,r=>r[1].decision='release_now'));
test('no owner involvement rejected',()=>reject('OWNER_REVIEW_REQUIRED',null,null,r=>r[0].role='staff'));
test('two owners accepted if distinct and neither was uploader',()=>assert.equal(run(null,null,r=>r[1].role='owner').reviewers.length,2));
test('no misleading production readiness flags',()=>{
 assert.equal(R123_CONTRACT.productionReady,false);assert.equal(R123_CONTRACT.realAuthenticationTested,false);
 assert.equal(R123_CONTRACT.noPersistentReplayGuard,true);assert.equal(R123_CONTRACT.noDelete,true);
});
