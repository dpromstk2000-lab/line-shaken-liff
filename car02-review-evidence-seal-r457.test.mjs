import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {CAR02_V457_RELEASE_LOCK,CAR02_V457_READ_SQL,createCar02OfflineReviewEvidenceSealR457,
 verifyCar02OfflineReviewEvidenceR457} from './car02-review-evidence-seal-r457.mjs';
const keys=generateKeyPairSync('ed25519'),otherKeys=generateKeyPairSync('ed25519');
const shop='qa_shop_a',event='00000000-0000-0000-0000-000000004533',h='a'.repeat(64),zero='0'.repeat(64),now=2000000000000;
const review={event_id:event,integrity_state:'consistent_closed',review_stage:'closed_without_delivery_assertion',audit_steps:2,evidence_sha256:h};
const denied=p=>assert.rejects(p,e=>e?.code==='CAR02_EVIDENCE_UNVERIFIED'&&e.status===403);
function f(opt={}){
 const calls=[];
 const source={readSnapshot:async ({sql,params})=>{calls.push({sql,params});if(opt.broken)throw Error('secret SQL info');return{rows:opt.rows??[review]};},
 authorizeAuditor:async()=>({verified:opt.verified??true,mode:opt.mode??'isolated_qa',role:opt.role??'auditor',shopCode:opt.shop??shop}),
 privateKey:opt.privateKey??keys.privateKey,keyId:'synthetic_epoch_4',keyEpoch:4,nowMs:()=>now};
 return{exporter:createCar02OfflineReviewEvidenceSealR457(source),calls};
}
async function seal(opt={}){return f(opt).exporter.seal({request:{},eventId:event,sequence:1,previousDigest:zero})}
const verification=(envelope,over={})=>({envelope,expectedShopCode:shop,expectedEventId:event,
 pinnedPublicKey:keys.publicKey,expectedKeyId:'synthetic_epoch_4',minimumKeyEpoch:4,
 expectedSequence:1,expectedPreviousDigest:zero,nowMs:now+1000,...over});
function tamper(env,change){return {...env,payload:{...env.payload,...change}};}
test('hard release lock, fixed private schema read query, no configured signer fallback',()=>{
 assert.equal(CAR02_V457_RELEASE_LOCK,true);
 assert.equal(CAR02_V457_READ_SQL,'SELECT event_id,integrity_state,review_stage,audit_steps,evidence_sha256 FROM v457_private.qa_review_evidence($1::text,$2::uuid)');
 assert.throws(()=>createCar02OfflineReviewEvidenceSealR457(),/TRUSTED_SIGNER_REQUIRED/);
});
test('real Ed25519 sign and verify a consistent closed V456 observation',async()=>{
 const env=await seal(),o=verifyCar02OfflineReviewEvidenceR457(verification(env));
 assert.equal(o.status,'verified_review_only');assert.equal(o.envelopeDigest,env.envelopeDigest);
 assert.ok(Object.isFrozen(env));assert.ok(Object.isFrozen(env.payload));assert.ok(Object.isFrozen(o));
});
test('read-only server-supplied shop and exact event passed to static SQL',async()=>{
 const x=f();await x.exporter.seal({request:{shopCode:'qa_shop_b',role:'owner'},eventId:event,sequence:1});
 assert.deepEqual(x.calls,[{sql:CAR02_V457_READ_SQL,params:[shop,event]}]);
});
test('changing the raw evidence digest invalidates signed source',async()=>{
 const env=await seal();await denied(Promise.resolve().then(()=>verifyCar02OfflineReviewEvidenceR457(verification(tamper(env,{evidenceSha256:'f'.repeat(64)})))));
});
test('changing integrity or closed status cannot fake delivery or signoff',async()=>{
 const env=await seal();for(const update of [{integrityState:'delivery_confirmed'},{reviewStage:'delivered'},{auditSteps:1}]){
  assert.throws(()=>verifyCar02OfflineReviewEvidenceR457(verification(tamper(env,update))),/EVIDENCE_UNVERIFIED/);
 }
});
test('cross-tenant or another event cannot reuse a signed bundle',async()=>{
 const env=await seal();for(const options of [{expectedShopCode:'qa_shop_b'},
  {expectedEventId:'00000000-0000-0000-0000-000000004541'}])
  assert.throws(()=>verifyCar02OfflineReviewEvidenceR457(verification(env,options)),/EVIDENCE_UNVERIFIED/);
});
test('different signing key does not verify against pinned public key',async()=>{
 const env=await seal({privateKey:otherKeys.privateKey});
 assert.throws(()=>verifyCar02OfflineReviewEvidenceR457(verification(env)),/EVIDENCE_UNVERIFIED/);
});
test('verified signature but wrong key ID or old key epoch is rejected',async()=>{
 const env=await seal();for(const x of [{expectedKeyId:'synthetic_epoch_5'},{minimumKeyEpoch:5}])
  assert.throws(()=>verifyCar02OfflineReviewEvidenceR457(verification(env,x)),/EVIDENCE_UNVERIFIED/);
});
test('external independent sequence floor is mandatory, rejecting replay or jumps',async()=>{
 const env=await seal();for(const sequence of [0,2,3])
  assert.throws(()=>verifyCar02OfflineReviewEvidenceR457(verification(env,{expectedSequence:sequence})),/EVIDENCE_UNVERIFIED/);
});
test('external previous digest anchor mismatch prevents evidence replacement',async()=>{
 const env=await seal();assert.throws(()=>verifyCar02OfflineReviewEvidenceR457(verification(env,{expectedPreviousDigest:'1'.repeat(64)})),/EVIDENCE_UNVERIFIED/);
});
test('expired and future-dated evidence cannot pass verification',async()=>{
 const env=await seal();for(const over of [{nowMs:now-1},{nowMs:now+300001}])
  assert.throws(()=>verifyCar02OfflineReviewEvidenceR457(verification(env,over)),/EVIDENCE_UNVERIFIED/);
});
test('signature or attached signed-envelope checksum tampering is caught',async()=>{
 const env=await seal();assert.throws(()=>verifyCar02OfflineReviewEvidenceR457(verification({...env,signature:(env.signature[0]==='a'?'b':'a')+env.signature.slice(1)})),/EVIDENCE_UNVERIFIED/);
 assert.throws(()=>verifyCar02OfflineReviewEvidenceR457(verification({...env,envelopeDigest:'b'.repeat(64)})),/EVIDENCE_UNVERIFIED/);
});
test('extra unexpected payload or envelope fields fail closed',async()=>{
 const env=await seal();assert.throws(()=>verifyCar02OfflineReviewEvidenceR457(verification({...env,delivery:true})),/EVIDENCE_UNVERIFIED/);
 assert.throws(()=>verifyCar02OfflineReviewEvidenceR457(verification(tamper(env,{recipient:'staff'}))),/EVIDENCE_UNVERIFIED/);
});
test('unsigned, malformed or non-Ed25519 input rejected',async()=>{
 const env=await seal();for(const key of [null,undefined,'not-a-key',otherKeys.privateKey]){
  assert.throws(()=>verifyCar02OfflineReviewEvidenceR457(verification(env,{pinnedPublicKey:key})),/EVIDENCE_UNVERIFIED/);
 }
 const rsa=generateKeyPairSync('rsa',{modulusLength:2048});
 assert.throws(()=>createCar02OfflineReviewEvidenceSealR457({...f(),readSnapshot:()=>({rows:[review]}),authorizeAuditor:()=>({verified:true,mode:'isolated_qa',role:'auditor',shopCode:shop}),privateKey:rsa.privateKey,keyId:'bad_rsa',keyEpoch:4}),/TRUSTED_SIGNER_REQUIRED/);
});
test('unclosed, missing, duplicate and inconsistent DB snapshots are rejected before signing',async()=>{
 for(const rows of [[],[review,review],[{...review,integrity_state:'inconsistent'}],
  [{...review,review_stage:'awaiting_independent_signoff'}],[{...review,evidence_sha256:'bad'}]]){
  const x=f({rows});await denied(x.exporter.seal({eventId:event,sequence:1}));
 }
});
test('unverified, wrong-role, wrong shop or nonisolated auditor never reads DB',async()=>{
 for(const options of [{verified:false},{mode:'production'},{role:'owner'},{shop:'../another'}]){
  const x=f(options);await denied(x.exporter.seal({eventId:event,sequence:1}));assert.equal(x.calls.length,0);
 }
});
test('invalid event, sequence, or previous anchor denied before reading evidence',async()=>{
 const x=f();for(const overrides of [{eventId:'bad'},{sequence:0},{sequence:1.1},{previousDigest:'not_hex'}]){
  await denied(x.exporter.seal({eventId:event,sequence:1,...overrides}));
 }assert.equal(x.calls.length,0);
});
test('database failure during source snapshot does not sign synthetic evidence',async()=>{
 const x=f({broken:true});await denied(x.exporter.seal({eventId:event,sequence:1}));assert.equal(x.calls.length,1);
});
test('same source and exact signer epoch but next sequence generates new verified envelope digest',async()=>{
 const x=f(),a=await x.exporter.seal({eventId:event,sequence:1}),b=await x.exporter.seal({eventId:event,sequence:2,previousDigest:a.envelopeDigest});
 assert.notEqual(a.envelopeDigest,b.envelopeDigest);
 assert.equal(verifyCar02OfflineReviewEvidenceR457(verification(b,{expectedSequence:2,expectedPreviousDigest:a.envelopeDigest})).status,'verified_review_only');
 assert.throws(()=>verifyCar02OfflineReviewEvidenceR457(verification(b)),/EVIDENCE_UNVERIFIED/);
});
test('no claim of LINE delivery or real external WORM and R52 remains hard locked',()=>{
 const live=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
 const source=readFileSync(new URL('./car02-review-evidence-seal-r457.mjs',import.meta.url),'utf8');
 assert.match(live,/const\s+CAR02_RELEASE_LOCK\s*=\s*true/);
 assert.doesNotMatch(live,/review-evidence-seal-r457|v457_private/);
 assert.match(source,/NOT independent WORM/);
 assert.match(source,/NEVER DEPLOY/);
});
