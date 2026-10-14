/**
 * DPRO CAR02 R132 - PREPRODUCTION READINESS INVENTORY, OFFLINE QA ONLY.
 * This module cannot approve a release, alter HOLD, or verify real external proof.
 * Every caller-supplied candidate is UNTRUSTED, even if it says PASS/APPROVED.
 * Verification of identity, secrets, authorization, independent storage, the
 * trusted clock, production DB, LINE and booking must happen outside this model.
 */
import {createHash} from 'node:crypto';
import {R131_POLICY} from './car02-r131-independent-hold-seal-isolated.mjs';

export const R132_POLICY=Object.freeze({
  version:'R132',scope:'OFFLINE_NONPRODUCTION_READINESS_INVENTORY',
  release:'NO_GO',migration:'HOLD',productionReady:false,
  deployAuthorized:false,databaseMigrationAuthorized:false,
  automaticHoldReleaseAuthorized:false,externalProofVerified:false,
  realAuthVerified:false,productionWritesAllowed:false,
});
// These are proposed release blockers, not a grant of release authority.
const definitions=[
 ['OWNER_AUTH','identity','Live owner/staff authorization and server-side privilege enforcement'],
 ['TENANT_RLS','database','Live tenant segregation, tenant switching and role-based access'],
 ['BACKUP_RESTORE','recovery','Verified staging backup, timed restore and rollback drill'],
 ['PHOTO_STORAGE','storage','Live photo private storage, quarantine, retention and deletion controls'],
 ['EXTERNAL_WITNESS','trust','Physically or administratively separate witness durability and outage test'],
 ['TRUST_ANCHOR','trust','Independent trusted key, expiry, revocation and out-of-band pin custody'],
 ['TRUSTED_CLOCK','trust','Trusted clock, unique challenge and identity proof of signers'],
 ['BOOKING_ATOMICITY','booking','Atomic slot booking, cancel/rebook and anti-duplicate live integration'],
 ['LINE_LIFF','line','LINE Official and LIFF configuration, consent and safe notification delivery'],
 ['HP_ROUTING','website','Real site to booking route, origin and production URL verification'],
 ['CUSTOMER_CONSENT','privacy','Customer privacy, notification and photo retention consent confirmed'],
 ['OPERATIONS','operations','Monitoring, incident response, operational backup and human release sign-off'],
];
export const R132_GATES=Object.freeze(definitions.map(([id,area,requirement])=>Object.freeze({id,area,requirement,blocking:true,externalVerificationRequired:true})));
const ids=new Set(R132_GATES.map(g=>g.id));
const keys=(x,a)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join('|')===a.slice().sort().join('|');
const FIELDS=['gateId','tenantId','kind','reference','issuedAtMs','expiresAtMs','assertion'];
const fail=c=>{throw Error(`R132_${c}`)};
const must=(c,code)=>{if(!c)fail(code)};
const SAFE_REF=/^[A-Za-z0-9][A-Za-z0-9_.:\/-]{2,119}$/;
const HEX=/^[a-f0-9]{64}$/;
const hash=x=>createHash('sha256').update(JSON.stringify(x),'utf8').digest('hex');
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);

/** Candidate metadata is never promoted to independently verified proof. */
export function assessReadiness({tenantId,nowMs,candidates=[]}){
 must(process.env.CAR02_RELEASE_LOCK==='true'&&process.env.R132_OFFLINE_QA==='yes','ISOLATION_REQUIRED');
 must(R131_POLICY.release==='NO_GO'&&R131_POLICY.migration==='HOLD'&&R131_POLICY.productionReady===false,'UPSTREAM_POLICY');
 must(typeof tenantId==='string'&&/^[a-zA-Z0-9_-]{3,32}$/.test(tenantId),'TENANT');
 must(Number.isSafeInteger(nowMs)&&nowMs>=0,'CLOCK');
 must(Array.isArray(candidates)&&candidates.length<=R132_GATES.length,'CANDIDATE_COUNT');
 const byId=new Map();
 for(const c of candidates){
  must(keys(c,FIELDS),'CANDIDATE_SHAPE');
  must(typeof c.gateId==='string'&&ids.has(c.gateId),'UNKNOWN_GATE');
  must(!byId.has(c.gateId),'DUPLICATE_GATE');
  must(c.tenantId===tenantId,'CROSS_TENANT');
  must(c.kind==='DOCUMENT_REFERENCE_ONLY','SOURCE_UNTRUSTED');
  must(c.assertion==='UNVERIFIED_CANDIDATE','ASSERTION_UNTRUSTED');
  must(typeof c.reference==='string'&&SAFE_REF.test(c.reference)&&!c.reference.includes('..')&&!c.reference.includes('//'),'REFERENCE_UNSAFE');
  must(Number.isSafeInteger(c.issuedAtMs)&&Number.isSafeInteger(c.expiresAtMs)&&c.issuedAtMs>=0&&c.expiresAtMs>c.issuedAtMs&&c.expiresAtMs-c.issuedAtMs<=86_400_000,'EVIDENCE_WINDOW');
  byId.set(c.gateId,c);
 }
 const gates=R132_GATES.map(g=>{
   const c=byId.get(g.id);
   const classification=!c?'NO_EVIDENCE':c.issuedAtMs>nowMs?'FUTURE_CANDIDATE':c.expiresAtMs<nowMs?'STALE_CANDIDATE':'UNVERIFIED_CANDIDATE';
   return {...g,evidenceStatus:classification,releaseGate:'OPEN',independentlyVerified:false,candidateDigest:c?hash(c):null};
 });
 const coverage=gates.filter(g=>g.evidenceStatus==='UNVERIFIED_CANDIDATE').length;
 const report={...R132_POLICY,tenantId,assessmentTimeMs:nowMs,gateCount:gates.length,openBlockingGates:gates.length,
   r131GitHubResultNotIndependentlyFetched:true,offlineR131IsProductionProof:false,candidateCoverage:coverage,
   status:'NO_GO_PENDING_REAL_WORLD_VERIFICATION',gates,
   nextRequired:'Obtain independently verified staging/production evidence and separate authorized human release decision; do not modify production in R132.'};
 // A digest detects accidental changes only; the digest is NOT a signature.
 return {...report,reportDigest:hash(report)};
}

/** Catch forged or partial inventory snapshots; never an authorization method. */
export function verifyInventorySnapshot(report){
 must(report&&typeof report==='object'&&!Array.isArray(report),'REPORT');
 must(keys(report,[...Object.keys(R132_POLICY),'tenantId','assessmentTimeMs','gateCount','openBlockingGates','r131GitHubResultNotIndependentlyFetched','offlineR131IsProductionProof','candidateCoverage','status','gates','nextRequired','reportDigest']),'REPORT_SHAPE');
 const {reportDigest,...body}=report;
 must(HEX.test(reportDigest)&&hash(body)===reportDigest,'REPORT_TAMPERED');
 must(Object.entries(R132_POLICY).every(([k,v])=>report[k]===v),'POLICY_TAMPERED');
 must(report.status==='NO_GO_PENDING_REAL_WORLD_VERIFICATION'&&report.openBlockingGates===R132_GATES.length&&report.gateCount===R132_GATES.length,'GATES_CLOSED');
 must(report.r131GitHubResultNotIndependentlyFetched===true&&report.offlineR131IsProductionProof===false,'OFFLINE_MISREPRESENTED');
 must(Array.isArray(report.gates)&&report.gates.length===R132_GATES.length,'GATE_SHAPE');
 for(let i=0;i<R132_GATES.length;i++){
   const expected=R132_GATES[i],found=report.gates[i];
   must(found?.id===expected.id&&found.area===expected.area&&found.requirement===expected.requirement&&found.blocking===true&&found.externalVerificationRequired===true&&found.releaseGate==='OPEN'&&found.independentlyVerified===false,'GATE_FORGED');
   must(['NO_EVIDENCE','FUTURE_CANDIDATE','STALE_CANDIDATE','UNVERIFIED_CANDIDATE'].includes(found.evidenceStatus),'EVIDENCE_FORGED');
 }
 return {valid:true,release:'NO_GO',migration:'HOLD',authorized:false,blockerCount:R132_GATES.length};
}
if(process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1]}`).href&&process.argv.includes('--report')){
 const report=assessReadiness({tenantId:'CAR02',nowMs:1_000_000,candidates:[]});
 verifyInventorySnapshot(report);
 process.stdout.write(JSON.stringify(report,null,2)+'\n');
}
