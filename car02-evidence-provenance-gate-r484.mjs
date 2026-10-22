/**
 * DPRO CAR02 V4.84 — offline evidence *intake*, not provider verification.
 * This module never contacts Supabase, LINE, an archive, KMS, GitHub, or a user.
 * A caller-controlled manifest, even one containing plausible hashes and dates,
 * can NEVER prove ownership, provider authenticity, or commercial readiness.
 */
export const CAR02_V484_RELEASE_LOCK = true;
export const CAR02_V484_BASELINE_RUN = 39727016029;
export const CAR02_V484_BRANCH = 'car02-v434-review-only';
export const CAR02_V484_REQUIRED_PROOFS = Object.freeze([
  Object.freeze({key:'auth_session_revocation', providerFamily:'supabase'}),
  Object.freeze({key:'staff_worker_store_acl', providerFamily:'cross_provider'}),
  Object.freeze({key:'transaction_commit_acl_fence', providerFamily:'supabase'}),
  Object.freeze({key:'line_webhook_delivery_retry', providerFamily:'line'}),
  Object.freeze({key:'independent_offsite_worm', providerFamily:'independent_archive'}),
  Object.freeze({key:'independent_signature_key_rotation', providerFamily:'independent_kms'}),
  Object.freeze({key:'owner_isolated_staging_acceptance', providerFamily:'owner_acceptance'})
]);

const proofMap = new Map(CAR02_V484_REQUIRED_PROOFS.map(r => [r.key,r]));
const topKeys = new Set(['systemCode','branch','baselineV483Run','releaseLock','commercialDecision','proofs']);
const proofKeys = new Set(['proofKey','providerFamily','sourceClass','environment','artifactSha256','capturedAt']);
const sourceEnvironments = Object.freeze({
  synthetic_fixture:'local_mock',
  review_only_ci:'review_only_ci',
  external_metadata:'dedicated_car02_staging'
});
const maxAgeMs = 30*24*60*60*1000;
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const exactKeys = (obj, allowed) => Object.keys(obj).every(k => allowed.has(k));
const validTimestamp = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return NaN;
  const ms=Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value.replace('Z','.000Z') ? ms : NaN;
};

function hold(reason, counts = {}) {
  return Object.freeze({
    systemCode:'CAR02', version:'V4.84', branch:CAR02_V484_BRANCH,
    decision:'HOLD', commercialDecision:'NO_GO_HOLD', reason,
    releaseLock:true, commercialReleaseAllowed:false, projectCreationAllowed:false,
    existingProjectReuseAllowed:false, billingChangeAllowed:false,
    providerConnectionAllowed:false, databaseMutationAllowed:false,
    workerDeployAllowed:false, lineDispatchAllowed:false,
    independentVerificationPerformed:false,
    commercialProviderProofsVerified:0,
    requiredCommercialProviderProofs:CAR02_V484_REQUIRED_PROOFS.length,
    ...counts
  });
}

/**
 * Evaluate shape and provenance claims, never their authenticity.
 * `asOf` is injected solely to make offline freshness tests deterministic.
 * No user data, proof URLs, token, provider ID or raw manifest is returned.
 */
export function evaluateCar02EvidenceIntakeR484(manifest, {asOf = new Date().toISOString().replace(/\.\d{3}Z$/,'Z')} = {}) {
  const now = validTimestamp(asOf);
  if (!Number.isFinite(now)) return hold('evaluation_clock_invalid');
  if (!plain(manifest) || !exactKeys(manifest,topKeys)) return hold('manifest_shape_invalid');
  if (manifest.systemCode !== 'CAR02' || manifest.branch !== CAR02_V484_BRANCH ||
      manifest.baselineV483Run !== CAR02_V484_BASELINE_RUN ||
      manifest.releaseLock !== true || manifest.commercialDecision !== 'NO_GO_HOLD') {
    return hold('baseline_or_release_lock_mismatch');
  }
  if (!Array.isArray(manifest.proofs) || manifest.proofs.length > CAR02_V484_REQUIRED_PROOFS.length) {
    return hold('proof_inventory_invalid');
  }

  const seenKeys = new Set();
  const seenDigests = new Set();
  const classification = new Map();
  let syntheticCount = 0, ciCount = 0, untrustedExternalMetadataCount = 0;
  for (const item of manifest.proofs) {
    if (!plain(item) || !exactKeys(item,proofKeys) || Object.keys(item).length !== proofKeys.size)
      return hold('proof_record_shape_invalid');
    const requirement=proofMap.get(item.proofKey);
    if (!requirement || item.providerFamily !== requirement.providerFamily)
      return hold('proof_provider_mismatch');
    if (seenKeys.has(item.proofKey)) return hold('duplicate_proof_category');
    seenKeys.add(item.proofKey);
    if (typeof item.sourceClass !== 'string' || !Object.hasOwn(sourceEnvironments,item.sourceClass) ||
        sourceEnvironments[item.sourceClass] !== item.environment)
      return hold('provenance_environment_mismatch');
    if (typeof item.artifactSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.artifactSha256))
      return hold('artifact_digest_format_invalid');
    if (seenDigests.has(item.artifactSha256)) return hold('artifact_reused_across_categories');
    seenDigests.add(item.artifactSha256);
    const captured=validTimestamp(item.capturedAt);
    if (!Number.isFinite(captured)) return hold('proof_timestamp_invalid');
    if (captured > now) return hold('proof_timestamp_in_future');
    if (now-captured > maxAgeMs) return hold('proof_metadata_stale');
    if (item.sourceClass === 'synthetic_fixture') syntheticCount++;
    else if (item.sourceClass === 'review_only_ci') ciCount++;
    else untrustedExternalMetadataCount++;
    classification.set(item.proofKey,item.sourceClass === 'external_metadata'
      ? 'EXTERNAL_METADATA_UNVERIFIED' : 'SYNTHETIC_NOT_PROVIDER_PROOF');
  }

  const proofMatrix = Object.freeze(CAR02_V484_REQUIRED_PROOFS.map(({key,providerFamily}) =>
    Object.freeze({proofKey:key, providerFamily,
      state:classification.get(key) || 'MISSING', independentlyVerified:false})));
  const counts= {
    submittedCount:manifest.proofs.length,
    missingCount:CAR02_V484_REQUIRED_PROOFS.length-manifest.proofs.length,
    syntheticFixtureCount:syntheticCount,
    reviewOnlyCiCount:ciCount,
    untrustedExternalMetadataCount,
    completeUnverifiedMetadata:untrustedExternalMetadataCount === CAR02_V484_REQUIRED_PROOFS.length,
    proofMatrix
  };
  const reason=counts.completeUnverifiedMetadata
    ? 'external_metadata_still_requires_independent_verification_and_owner_authority'
    : 'commercial_provider_evidence_incomplete';
  return hold(reason,counts);
}
