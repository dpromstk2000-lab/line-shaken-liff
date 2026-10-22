/** DPRO CAR02 V4.75: synthetic, read-only dual-review attestation; NEVER authorizes release.
 * Both reviewer identities must come from trusted isolated registries, not request or JWT claims.
 * An offline review result is not approval, dispatch, webhook ACK or a release token.
 */
export const CAR02_V475_RELEASE_LOCK=true;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const ULID=/^[0-9A-HJKMNP-TV-Z]{26}$/;
const HEX=/^[a-f0-9]{64}$/;
const REVIEWER=/^reviewer_[a-z0-9]{1,32}$/;
const fields=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join('|')===keys.slice().sort().join('|');
const personFields=['source','shopCode','reviewerId','verified','independent','active'];
const recordFields=['source','shopCode','eventId','eventDigest','quarantineReason','reviewState','evidenceDigest'];
const signFields=['source','shopCode','eventId','eventDigest','evidenceDigest','reviewerId','reviewStatus'];
const deny=(reason,observed=0)=>Object.freeze({status:'no_go',reason,reviewersObserved:observed,classification:'quarantine_review_only',
 releasePermitted:false,writeAuthorized:false,jobDispatched:false,realWebhookAcknowledged:false,
 lineDeliveryProven:false,realProviderVerified:false,quarantineLifted:false,realBusinessWrites:false});
export function createCar02OfflineDualReviewR475({expectedShopCode,authorizeAuditor,inspectIsolation,
 readQuarantine,readReviewers,readSignoffs,nowMs=Date.now}={}){
 if(!SHOP.test(expectedShopCode??'')||![authorizeAuditor,inspectIsolation,readQuarantine,readReviewers,readSignoffs,nowMs].every(f=>typeof f==='function'))
  throw Error('CAR02_V475_ISOLATED_READERS_REQUIRED');
 async function inspect({request,eventId,eventDigest,evidenceDigest}={}){
  if(!ULID.test(eventId??'')||!HEX.test(eventDigest??'')||!HEX.test(evidenceDigest??''))return deny('invalid_review_input');
  let auditor,isolation,record,reviewers,signoffs,at;
  try{[auditor,isolation]=await Promise.all([authorizeAuditor({request}),inspectIsolation()]);}
  catch{return deny('isolated_auditor_unavailable');}
  if(auditor?.verified!==true||auditor.mode!=='isolated_qa'||auditor.role!=='dual_review_auditor'||
   auditor.shopCode!==expectedShopCode||isolation?.verified!==true||
   isolation.environment!=='disposable_pg17_or_offline_mock'||isolation.testOnly!==true)return deny('isolated_auditor_unverified');
  try{at=nowMs();record=await readQuarantine({shopCode:expectedShopCode,eventId});}
  catch{return deny('quarantine_read_unavailable');}
  if(!Number.isSafeInteger(at)||at<=0||!fields(record,recordFields)||record.source!=='disposable_mock_quarantine'||
   record.shopCode!==expectedShopCode||record.eventId!==eventId||record.eventDigest!==eventDigest||
   record.evidenceDigest!==evidenceDigest||record.reviewState!=='quarantined_review_only'||
   !['integrity_mismatch','poison_event','manual_hold','max_retry_review'].includes(record.quarantineReason))return deny('quarantine_evidence_unverified');
  try{[reviewers,signoffs]=await Promise.all([readReviewers({shopCode:expectedShopCode,eventId}),readSignoffs({shopCode:expectedShopCode,eventId})]);}
  catch{return deny('dual_review_unavailable');}
  if(!Array.isArray(reviewers)||reviewers.length!==2||!Array.isArray(signoffs)||signoffs.length!==2)return deny('two_independent_reviews_missing');
  const ids=new Set();
  for(const reviewer of reviewers){
   if(!fields(reviewer,personFields)||reviewer.source!=='isolated_mock_reviewer_registry'||reviewer.shopCode!==expectedShopCode||
      !REVIEWER.test(reviewer.reviewerId)||reviewer.verified!==true||reviewer.independent!==true||reviewer.active!==true||ids.has(reviewer.reviewerId))
      return deny('independent_reviewer_unverified');
   ids.add(reviewer.reviewerId);
  }
  const seen=new Set();
  for(const signoff of signoffs){
   if(!fields(signoff,signFields)||signoff.source!=='disposable_mock_review_ledger'||signoff.shopCode!==expectedShopCode||
      signoff.eventId!==eventId||signoff.eventDigest!==eventDigest||signoff.evidenceDigest!==evidenceDigest||
      signoff.reviewStatus!=='quarantine_audit_recorded'||!ids.has(signoff.reviewerId)||seen.has(signoff.reviewerId))
      return deny('review_attestation_mismatch');
   seen.add(signoff.reviewerId);
  }
  return deny('two_independent_mock_reviews_recorded_still_no_go',2);
 }
 return Object.freeze({inspect,scopedShopCode:expectedShopCode});
}
