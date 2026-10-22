import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  CAR02_V484_RELEASE_LOCK, CAR02_V484_BASELINE_RUN, CAR02_V484_BRANCH,
  CAR02_V484_REQUIRED_PROOFS, evaluateCar02EvidenceIntakeR484
} from './car02-evidence-provenance-gate-r484.mjs';

const AS_OF='2026-10-22T12:00:00Z';
const environments={synthetic_fixture:'local_mock',review_only_ci:'review_only_ci',external_metadata:'dedicated_car02_staging'};
const digest=s=>createHash('sha256').update(`V484 SYNTHETIC TEST ${s}`).digest('hex');
const makeProof=(i,sourceClass='synthetic_fixture')=>({
  proofKey:CAR02_V484_REQUIRED_PROOFS[i].key,
  providerFamily:CAR02_V484_REQUIRED_PROOFS[i].providerFamily,
  sourceClass, environment:environments[sourceClass],
  artifactSha256:digest(`${i}:${sourceClass}`),capturedAt:'2026-10-21T12:00:00Z'
});
const makeManifest=(sourceClass='synthetic_fixture')=>({
  systemCode:'CAR02',branch:CAR02_V484_BRANCH,
  baselineV483Run:CAR02_V484_BASELINE_RUN,releaseLock:true,
  commercialDecision:'NO_GO_HOLD',
  proofs:CAR02_V484_REQUIRED_PROOFS.map((_,i)=>makeProof(i,sourceClass))
});
const check=manifest=>evaluateCar02EvidenceIntakeR484(manifest,{asOf:AS_OF});
function locked(r) {
  assert.equal(r.version,'V4.84');
  assert.equal(r.decision,'HOLD');
  assert.equal(r.commercialDecision,'NO_GO_HOLD');
  assert.equal(r.releaseLock,true);
  for(const flag of ['commercialReleaseAllowed','projectCreationAllowed','existingProjectReuseAllowed',
    'billingChangeAllowed','providerConnectionAllowed','databaseMutationAllowed',
    'workerDeployAllowed','lineDispatchAllowed','independentVerificationPerformed'])
    assert.equal(r[flag],false,flag);
  assert.equal(r.commercialProviderProofsVerified,0);
  assert.equal(r.requiredCommercialProviderProofs,7);
}

test('V4.84 release lock, branch, predecessor run and exactly seven distinct categories are pinned',()=>{
  assert.equal(CAR02_V484_RELEASE_LOCK,true);
  assert.equal(CAR02_V484_BRANCH,'car02-v434-review-only');
  assert.equal(CAR02_V484_BASELINE_RUN,39727016029);
  assert.equal(CAR02_V484_REQUIRED_PROOFS.length,7);
  assert.equal(new Set(CAR02_V484_REQUIRED_PROOFS.map(p=>p.key)).size,7);
  assert.equal(Object.isFrozen(CAR02_V484_REQUIRED_PROOFS),true);
});
test('all seven synthetic fixtures are never seven provider proofs',()=>{
  const r=check(makeManifest());locked(r);
  assert.equal(r.syntheticFixtureCount,7);
  assert.equal(r.untrustedExternalMetadataCount,0);
  assert.equal(r.missingCount,0);
  assert.equal(r.completeUnverifiedMetadata,false);
  assert.ok(r.proofMatrix.every(x=>x.state==='SYNTHETIC_NOT_PROVIDER_PROOF'));
});
test('seven CI log artifacts are likewise synthetic only',()=>{
  const r=check(makeManifest('review_only_ci'));locked(r);
  assert.equal(r.reviewOnlyCiCount,7);
  assert.equal(r.completeUnverifiedMetadata,false);
  assert.ok(r.proofMatrix.every(x=>x.independentlyVerified===false));
});
test('all seven plausible external metadata rows are STILL unverified and HOLD',()=>{
  const r=check(makeManifest('external_metadata'));locked(r);
  assert.equal(r.untrustedExternalMetadataCount,7);
  assert.equal(r.completeUnverifiedMetadata,true);
  assert.equal(r.reason,'external_metadata_still_requires_independent_verification_and_owner_authority');
  assert.ok(r.proofMatrix.every(x=>x.state==='EXTERNAL_METADATA_UNVERIFIED'));
});
test('zero records never changes commercial release lock',()=>{
  const m=makeManifest();m.proofs=[];
  const r=check(m);locked(r);
  assert.equal(r.submittedCount,0);assert.equal(r.missingCount,7);
  assert.ok(r.proofMatrix.every(x=>x.state==='MISSING'));
});
test('mixed metadata retains per-category source provenance without promotion',()=>{
  const m=makeManifest();m.proofs[0]=makeProof(0,'external_metadata');
  m.proofs[1]=makeProof(1,'review_only_ci');m.proofs.pop();
  const r=check(m);locked(r);
  assert.equal(r.submittedCount,6);assert.equal(r.missingCount,1);
  assert.equal(r.untrustedExternalMetadataCount,1);assert.equal(r.reviewOnlyCiCount,1);
  assert.equal(r.syntheticFixtureCount,4);
  assert.equal(r.proofMatrix[0].state,'EXTERNAL_METADATA_UNVERIFIED');
  assert.equal(r.proofMatrix[1].state,'SYNTHETIC_NOT_PROVIDER_PROOF');
  assert.equal(r.proofMatrix[6].state,'MISSING');
});
test('valid manifest never echoes submitted identifiers, digest or raw evidence',()=>{
  const m=makeManifest();const r=check(m);locked(r);
  const serialized=JSON.stringify(r);
  assert.equal(serialized.includes(m.proofs[0].artifactSha256),false);
  assert.equal(serialized.includes(m.proofs[0].capturedAt),false);
  assert.equal(serialized.includes('2026-10-21'),false);
});
test('evaluation never mutates the submitted manifest',()=>{
  const m=makeManifest();const original=structuredClone(m);check(m);
  assert.deepEqual(m,original);
});
test('result and its per-category objects cannot be mutated',()=>{
  const r=check(makeManifest());locked(r);
  assert.equal(Object.isFrozen(r),true);
  assert.equal(Object.isFrozen(r.proofMatrix),true);
  assert.ok(r.proofMatrix.every(Object.isFrozen));
});

const badManifests=[
  ['missing manifest',()=>undefined,'manifest_shape_invalid'],
  ['null manifest',()=>null,'manifest_shape_invalid'],
  ['array manifest',()=>[],'manifest_shape_invalid'],
  ['unknown top-level release flag',m=>{m.releaseApproved=true;},'manifest_shape_invalid'],
  ['injected top-level credential',m=>{m.service_role_key='private';},'manifest_shape_invalid'],
  ['prototype pollution key',m=>JSON.parse(JSON.stringify(m).replace('"proofs":','"__proto__":{"releaseLock":false},"proofs":')),'manifest_shape_invalid'],
  ['wrong system code',m=>{m.systemCode='TAX';},'baseline_or_release_lock_mismatch'],
  ['wrong branch',m=>{m.branch='main';},'baseline_or_release_lock_mismatch'],
  ['wrong prior CI run',m=>{m.baselineV483Run=39724209237;},'baseline_or_release_lock_mismatch'],
  ['release lock false',m=>{m.releaseLock=false;},'baseline_or_release_lock_mismatch'],
  ['release approved status',m=>{m.commercialDecision='GO';},'baseline_or_release_lock_mismatch'],
  ['no proof array',m=>{delete m.proofs;},'proof_inventory_invalid'],
  ['non-array proofs',m=>{m.proofs={};},'proof_inventory_invalid'],
  ['more than seven records',m=>{m.proofs.push(makeProof(0));},'proof_inventory_invalid'],
  ['null proof',m=>{m.proofs[0]=null;},'proof_record_shape_invalid'],
  ['missing proof field',m=>{delete m.proofs[0].capturedAt;},'proof_record_shape_invalid'],
  ['untrusted verified claim',m=>{m.proofs[0].providerVerified=true;},'proof_record_shape_invalid'],
  ['injected owner approval',m=>{m.proofs[6].ownerApproved=true;},'proof_record_shape_invalid'],
  ['unexpected resource identifier',m=>{m.proofs[0].projectId='real_or_fake';},'proof_record_shape_invalid'],
  ['unknown proof key',m=>{m.proofs[0].proofKey='irrelevant';},'proof_provider_mismatch'],
  ['swapped provider family',m=>{m.proofs[0].providerFamily='line';},'proof_provider_mismatch'],
  ['duplicate category',m=>{m.proofs[1].proofKey=m.proofs[0].proofKey;m.proofs[1].providerFamily=m.proofs[0].providerFamily;},'duplicate_proof_category'],
  ['unknown source class',m=>{m.proofs[0].sourceClass='real_proof';},'provenance_environment_mismatch'],
  ['nonstring malicious source class',m=>{m.proofs[0].sourceClass={toString(){throw Error('never evaluate');}};},'provenance_environment_mismatch'],
  ['mock claimed as dedicated staging',m=>{m.proofs[0].environment='dedicated_car02_staging';},'provenance_environment_mismatch'],
  ['CI claimed as real provider',m=>{m.proofs[0].sourceClass='external_metadata';},'provenance_environment_mismatch'],
  ['external metadata claimed as production',m=>{m.proofs[0]=makeProof(0,'external_metadata');m.proofs[0].environment='production';},'provenance_environment_mismatch'],
  ['malformed digest',m=>{m.proofs[0].artifactSha256='sha256:anything';},'artifact_digest_format_invalid'],
  ['uppercase digest disallowed',m=>{m.proofs[0].artifactSha256=m.proofs[0].artifactSha256.toUpperCase();},'artifact_digest_format_invalid'],
  ['duplicate artifact across categories',m=>{m.proofs[1].artifactSha256=m.proofs[0].artifactSha256;},'artifact_reused_across_categories'],
  ['timezone offset disallowed',m=>{m.proofs[0].capturedAt='2026-10-21T21:00:00+09:00';},'proof_timestamp_invalid'],
  ['invalid calendar date',m=>{m.proofs[0].capturedAt='2026-02-30T12:00:00Z';},'proof_timestamp_invalid'],
  ['milliseconds disallowed',m=>{m.proofs[0].capturedAt='2026-10-21T12:00:00.000Z';},'proof_timestamp_invalid'],
  ['future evidence metadata',m=>{m.proofs[0].capturedAt='2026-10-23T12:00:00Z';},'proof_timestamp_in_future'],
  ['stale metadata over 30 days',m=>{m.proofs[0].capturedAt='2026-09-01T12:00:00Z';},'proof_metadata_stale']
];
for(const [label,change,reason] of badManifests){
  test(`fail-closed evidence intake: ${label}`,()=>{
    const m=makeManifest();const replacement=change(m);
    const r=check(replacement===undefined && !['missing manifest','null manifest','array manifest'].includes(label) ? m : replacement);
    locked(r);assert.equal(r.reason,reason);
    assert.equal(r.proofMatrix,undefined);
  });
}
test('invalid explicit evaluation clock fails closed',()=>{
  const r=evaluateCar02EvidenceIntakeR484(makeManifest(),{asOf:'2026-02-30T12:00:00Z'});
  locked(r);assert.equal(r.reason,'evaluation_clock_invalid');
});
test('at exactly 30 days metadata remains intake-only and HOLD',()=>{
  const m=makeManifest();m.proofs[0].capturedAt='2026-09-22T12:00:00Z';
  const r=check(m);locked(r);assert.equal(r.reason,'commercial_provider_evidence_incomplete');
});
test('the owner category cannot be escalated by a provider artifact',()=>{
  const m=makeManifest('external_metadata');m.proofs[6].providerFamily='supabase';
  const r=check(m);locked(r);assert.equal(r.reason,'proof_provider_mismatch');
});
test('changing baseline cannot be bypassed by seven external claims',()=>{
  const m=makeManifest('external_metadata');m.baselineV483Run=99999999999;
  const r=check(m);locked(r);assert.equal(r.reason,'baseline_or_release_lock_mismatch');
});
