/** DPRO CAR02 V3.2 – source-only identity, booking and tenant safety gate.
 * No fetch, secrets, real token verification, database, Worker or deployment.
 * This report records what the checked-out source *requires*, NOT what is live.
 */
export const V32_FILES=Object.freeze([
 'car02-identity-r44.mjs','car02-runtime-r45.mjs',
 'car02-basic-booking-http-isolated.mjs',
 'car02-basic-staff-booking-browser-isolated.mjs',
 'car02-edge-boundary-r51.mjs','car02-edge-entry-r52.ts',
 'car02-api.mjs'
]);
export const V32_GAPS=Object.freeze([
 'TRUSTED_STAFF_JWT_VERIFIER_NOT_BOUND',
 'TRUSTED_SHOP_STAFF_MEMBERSHIP_RESOLVER_NOT_BOUND',
 'TRUSTED_LINE_TOKEN_AND_CUSTOMER_RESOLVER_NOT_BOUND',
 'REAL_BOOKING_ENDPOINT_AND_LIFECYCLE_NOT_BOUND',
 'LEGACY_UI_ROUTE_MAPPING_NOT_PROVEN',
 'REAL_DB_BACKUP_AND_MIGRATION_NOT_VERIFIED',
 'REAL_TENANT_CROSS_SHOP_ACCEPTANCE_NOT_VERIFIED',
 'R52_RELEASE_LOCK_CLOSED'
]);
export const V32_MODE=Object.freeze({mode:'source_only_review',
 signedIdentityVerifiedLive:false,tenantVerifiedLive:false,bookingLive:false,
 productionReady:false,deployable:false,sendable:false,release:'NO_GO',migration:'HOLD'});
const fail=code=>{throw Object.assign(new Error(code),{code});};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
export function auditCar02V32AuthBookingSources(sources){
 if(!plain(sources)||V32_FILES.some(p=>typeof sources[p]!=='string'||sources[p].length<200))
   fail('CAR02_V32_REQUIRED_SOURCES_MISSING');
 const [id,rt,http,browser,edge,entry,api]=V32_FILES.map(p=>sources[p]);
 const checks=[
  ['R44_EXACTLY_ONE_CREDENTIAL',id.includes('Boolean(lineToken)===Boolean(authHeader)')],
  ['R44_STAFF_JWT_VERIFIER_INJECTED',id.includes('verifyStaffJwt({accessToken:token})')&&id.includes('jwt?.verified!==true')],
  ['R44_STAFF_MEMBERSHIP_RESOLVED_ON_SERVER',id.includes('resolveStaffAccess({userSub:jwt.sub,shopCode})')&&id.includes('staff.shopCode!==shopCode')&&id.includes('staff.userSub!==jwt.sub')],
  ['R44_INACTIVE_AND_WRONG_ROLE_DENIED',id.includes('!isLive(staff)')&&id.includes("!['owner','staff'].includes(staff.role)")],
  ['R44_LINE_SIGNATURE_CALLBACK_INJECTED',id.includes('verifyLineIdToken({idToken:lineToken, clientId:lineClientId})')&&id.includes("id?.iss!=='https://access.line.me'")],
  ['R44_LINE_CUSTOMER_SCOPE_RESOLVED',id.includes('resolveLineCustomer({shopCode,lineSub:id.sub})')&&id.includes('member.shopCode!==shopCode')],
  ['R45_DISPOSABLE_ONLY_NO_DEFAULT_CREDENTIALS',rt.includes('QA ONLY')&&rt.includes('Not a Cloudflare Worker bundle')&&rt.includes('createCar02Authenticator')&&rt.includes('createCar02ReleaseGate')],
  ['BOOKING_HTTP_QA_ONLY_NO_PUBLIC_ROUTE',http.includes("environment!=='disposable_qa'")&&http.includes('allowDisposableQa!==true')&&http.includes("const PATH='/api/car02/booking'")],
  ['BOOKING_HTTP_STAFF_ONLY',http.includes("!['staff','owner'].includes(actor.role)")&&http.includes("actor.subject.startsWith('staff:')")],
  ['BOOKING_HTTP_BODY_ORIGIN_AND_KEY_GUARDS',http.includes('origins.has(origin)')&&http.includes("request.headers.get('idempotency-key')")&&http.includes('identicalKeys(data,FIELDS)')],
  ['BOOKING_BROWSER_NONROUTABLE_INVALID_HOST',browser.includes('https://car02-booking-qa.invalid/api/car02/booking')&&browser.includes("environment!=='isolated_qa'")&&browser.includes('endpoint!==URL_QA')],
  ['BOOKING_BROWSER_REQUIRES_EXPLICIT_OPEN',browser.includes('connectionEnabled!==true')&&browser.includes("auth.kind!=='staff'")],
  ['R51_NO_LEGACY_FALLTHROUGH',edge.includes("if(path===null)return json(404,'CAR02_NOT_FOUND')")&&!/\/(?:wangan|ksh)\b/.test(edge)],
  ['R52_GATE_HARD_CLOSED',/\bconst\s+CAR02_RELEASE_LOCK\s*=\s*true\s*;/.test(entry)&&entry.includes("throw Error('CAR02_NOT_RELEASED')")&&/isServerReleased\s*:\s*\(\)\s*=>\s*!CAR02_RELEASE_LOCK/.test(entry)],
  ['R43_BACKEND_AUTH_AND_RELEASE_GATES',api.includes('await releaseEnabled(req)!==true')&&api.includes('await authenticate(req)')&&api.includes('actor.verified!==true')],
  ['R43_SHOP_DERIVED_FROM_ACTOR',api.includes('shop:actor.shopCode')&&api.includes("['customerId','vehicleId','reservationId']")]
 ];
 const invalid=checks.find(([,ok])=>!ok);
 if(invalid)fail('CAR02_V32_SOURCE_DRIFT_'+invalid[0]);
 return Object.freeze({mode:V32_MODE,checks:Object.freeze(checks.map(([id])=>Object.freeze({id,status:'STATIC_PASS'}))),
   checksPassed:checks.length,checksTotal:16,
   requiredDependencies:Object.freeze([...V32_GAPS]),
   verifiedJWTProviderAttached:false,verifiedLineProviderAttached:false,
   realStaffTenantCheckComplete:false,realBookingEndpointAccessible:false,
   migrationAuthorized:false,productionReady:false,release:'NO_GO',migration:'HOLD',
   statement:'In-source safeguards found. No live token signature, tenant membership, booking, or adapter proven.'});
}
