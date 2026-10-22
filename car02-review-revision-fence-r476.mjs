/**
 * CAR02 V4.76: offline read-only review-revision fence.
 * Re-checks a trusted synthetic review revision around an independently observed
 * V4.75 dual-review. No real identity claims, DB writes, LINE, release, or dispatch.
 * This is NEVER authorization: a changed revision invalidates prior observations.
 */
export const CAR02_V476_RELEASE_LOCK=true;
const SHOP=/^[a-z0-9][a-z0-9_-]{1,63}$/;
const ULID=/^[0-9A-HJKMNP-TV-Z]{26}$/;
const HEX=/^[a-f0-9]{64}$/;
const SNAP_KEYS=['source','shopCode','eventId','eventDigest','evidenceDigest','revision','invalidated','observedAtMs'];
const shape=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype&&
 Object.keys(v).sort().join('|')===keys.slice().sort().join('|');
const deny=(reason,observed=0)=>Object.freeze({status:'no_go',reason,reviewersObserved:observed,
 classification:'offline_quarantine_revision_review_only',releasePermitted:false,writeAuthorized:false,
 quarantineLifted:false,jobDispatched:false,lineDeliveryProven:false,realWebhookAcknowledged:false,
 realBusinessWrites:false,realProviderVerified:false});
function validSnapshot(v,expected,now){
 return shape(v,SNAP_KEYS)&&v.source==='disposable_mock_review_revision'&&v.shopCode===expected.shopCode&&
 v.eventId===expected.eventId&&v.eventDigest===expected.eventDigest&&v.evidenceDigest===expected.evidenceDigest&&
 Number.isSafeInteger(v.revision)&&v.revision>0&&v.revision<=Number.MAX_SAFE_INTEGER-1&&
 typeof v.invalidated==='boolean'&&Number.isSafeInteger(v.observedAtMs)&&v.observedAtMs>0&&
 v.observedAtMs<=now;
}
function validDualReview(v){
 return v!==null&&typeof v==='object'&&v.status==='no_go'&&
 v.reason==='two_independent_mock_reviews_recorded_still_no_go'&&v.reviewersObserved===2&&
 v.releasePermitted===false&&v.writeAuthorized===false&&v.quarantineLifted===false&&
 v.realBusinessWrites===false&&v.lineDeliveryProven===false&&v.realProviderVerified===false;
}
export function createCar02OfflineReviewRevisionFenceR476({expectedShopCode,authorizeAuditor,
 inspectIsolation,inspectDualReview,readReviewRevision,nowMs=Date.now}={}){
 if(!SHOP.test(expectedShopCode??'')||![authorizeAuditor,inspectIsolation,inspectDualReview,readReviewRevision,nowMs].every(f=>typeof f==='function'))
  throw Error('CAR02_V476_OFFLINE_READERS_REQUIRED');
 async function inspect({request,eventId,eventDigest,evidenceDigest}={}){
  if(!ULID.test(eventId??'')||!HEX.test(eventDigest??'')||!HEX.test(evidenceDigest??''))return deny('invalid_offline_review_input');
  let auditor,isolation;
  try{[auditor,isolation]=await Promise.all([authorizeAuditor({request}),inspectIsolation()]);}
  catch{return deny('isolated_auditor_unavailable');}
  if(auditor?.verified!==true||auditor?.role!=='review_revision_auditor'||auditor?.mode!=='isolated_qa'||auditor?.shopCode!==expectedShopCode||
    isolation?.verified!==true||isolation?.environment!=='disposable_pg17_or_offline_mock'||isolation?.testOnly!==true)
   return deny('isolated_auditor_unverified');
  let at,a,b,dual;
  const p={shopCode:expectedShopCode,eventId,eventDigest,evidenceDigest};
  try{
   at=nowMs();
   if(!Number.isSafeInteger(at)||at<=0)return deny('clock_unverified');
   a=await readReviewRevision(p);
   if(!validSnapshot(a,p,at)||a.invalidated)return deny('initial_revision_invalid_or_untrusted');
   dual=await inspectDualReview({request,eventId,eventDigest,evidenceDigest});
   if(!validDualReview(dual))return deny('dual_review_not_independently_verified');
   b=await readReviewRevision(p);
  }catch{return deny('revision_observation_unavailable');}
  if(!validSnapshot(b,p,at)||b.invalidated)return deny('final_revision_invalid_or_untrusted');
  if(a.revision!==b.revision||a.observedAtMs!==b.observedAtMs)return deny('revision_changed_during_review');
  // Return NO_GO even for a perfectly consistent synthetic pair.
  return deny('stable_two_mock_reviewers_still_no_go',2);
 }
 return Object.freeze({inspect,scopedShopCode:expectedShopCode});
}
