import assert from 'node:assert/strict';
import {test} from 'node:test';
import {V32_FILES,V32_GAPS,V32_MODE,auditCar02V32AuthBookingSources} from './car02-v32-auth-booking-boundary-isolated.mjs';
const long=s=>s+' '.repeat(201);
const sample=()=>({
 'car02-identity-r44.mjs':long(`Boolean(lineToken)===Boolean(authHeader)
 verifyStaffJwt({accessToken:token}); jwt?.verified!==true;
 resolveStaffAccess({userSub:jwt.sub,shopCode}); staff.shopCode!==shopCode; staff.userSub!==jwt.sub;
 !isLive(staff); !['owner','staff'].includes(staff.role);
 verifyLineIdToken({idToken:lineToken, clientId:lineClientId}); id?.iss!=='https://access.line.me';
 resolveLineCustomer({shopCode,lineSub:id.sub}); member.shopCode!==shopCode;`),
 'car02-runtime-r45.mjs':long(`QA ONLY; Not a Cloudflare Worker bundle; createCar02Authenticator; createCar02ReleaseGate`),
 'car02-basic-booking-http-isolated.mjs':long(`environment!=='disposable_qa'; allowDisposableQa!==true;
 const PATH='/api/car02/booking'; !['staff','owner'].includes(actor.role);
 actor.subject.startsWith('staff:'); origins.has(origin);
 request.headers.get('idempotency-key'); identicalKeys(data,FIELDS);`),
 'car02-basic-staff-booking-browser-isolated.mjs':long(`https://car02-booking-qa.invalid/api/car02/booking;
 environment!=='isolated_qa'; endpoint!==URL_QA; connectionEnabled!==true; auth.kind!=='staff';`),
 'car02-edge-boundary-r51.mjs':long(`if(path===null)return json(404,'CAR02_NOT_FOUND');`),
 'car02-edge-entry-r52.ts':long(`const CAR02_RELEASE_LOCK=true; throw Error('CAR02_NOT_RELEASED');
 isServerReleased:()=>!CAR02_RELEASE_LOCK;`),
 'car02-api.mjs':long(`await releaseEnabled(req)!==true; await authenticate(req);
 actor.verified!==true; shop:actor.shopCode; ['customerId','vehicleId','reservationId'];`)
});
const at=(src,key,from,to)=>({...src,[key]:src[key].replace(from,to)});
const cases=[];const run=(name,fn)=>cases.push([name,fn]);
run('current synthetic source test passes 16 contractual guards',()=>assert.equal(auditCar02V32AuthBookingSources(sample()).checksPassed,16));
run('the file inventory is seven exact sources',()=>assert.equal(V32_FILES.length,7));
run('the source review has eight explicit blockers',()=>assert.equal(V32_GAPS.length,8));
run('no public release in the report',()=>assert.equal(auditCar02V32AuthBookingSources(sample()).release,'NO_GO'));
run('migration remains HOLD',()=>assert.equal(auditCar02V32AuthBookingSources(sample()).migration,'HOLD'));
run('productionReady always false',()=>assert.equal(auditCar02V32AuthBookingSources(sample()).productionReady,false));
run('provider not declared connected',()=>assert.equal(auditCar02V32AuthBookingSources(sample()).verifiedJWTProviderAttached,false));
run('tenant not declared verified',()=>assert.equal(auditCar02V32AuthBookingSources(sample()).realStaffTenantCheckComplete,false));
run('booking not declared public',()=>assert.equal(auditCar02V32AuthBookingSources(sample()).realBookingEndpointAccessible,false));
run('mode always non-deployable',()=>assert.equal(V32_MODE.deployable,false));
run('mode cannot claim signed identity',()=>assert.equal(V32_MODE.signedIdentityVerifiedLive,false));
run('no live bookings implied',()=>assert.equal(V32_MODE.bookingLive,false));
run('source checks have unique ids',()=>{const a=auditCar02V32AuthBookingSources(sample()).checks.map(x=>x.id);assert.equal(new Set(a).size,16)});
run('source checks immutable objects',()=>assert.equal(Object.isFrozen(auditCar02V32AuthBookingSources(sample()).checks[0]),true));
run('missing map denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources(),/REQUIRED_SOURCES/));
run('empty source denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources({}),/REQUIRED_SOURCES/));
run('nonplain map denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources(Object.create(null)),/REQUIRED_SOURCES/));
run('wrong type source denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources({...sample(),'car02-api.mjs':{}}),/REQUIRED_SOURCES/));
run('missing R44 denied',()=>{const s=sample();delete s['car02-identity-r44.mjs'];assert.throws(()=>auditCar02V32AuthBookingSources(s),/REQUIRED_SOURCES/)});
run('missing stage denied',()=>{const s=sample();delete s['car02-edge-entry-r52.ts'];assert.throws(()=>auditCar02V32AuthBookingSources(s),/REQUIRED_SOURCES/)});
run('credential coexistence drift denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-identity-r44.mjs','Boolean(lineToken)===Boolean(authHeader)','Boolean(lineToken)!==Boolean(authHeader)')),/R44_EXACTLY_ONE_CREDENTIAL/));
run('JWT verifier removal denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-identity-r44.mjs','verifyStaffJwt({accessToken:token})','verifyToken(token)')),/R44_STAFF_JWT_VERIFIER_INJECTED/));
run('JWT verified claim removal denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-identity-r44.mjs','jwt?.verified!==true','false')),/R44_STAFF_JWT_VERIFIER_INJECTED/));
run('membership resolver removal denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-identity-r44.mjs','resolveStaffAccess({userSub:jwt.sub,shopCode})','resolveStaffAccess()')),/R44_STAFF_MEMBERSHIP_RESOLVED_ON_SERVER/));
run('wrong tenant staff permitted drift denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-identity-r44.mjs','staff.shopCode!==shopCode','false')),/R44_STAFF_MEMBERSHIP_RESOLVED_ON_SERVER/));
run('wrong staff identity drift denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-identity-r44.mjs','staff.userSub!==jwt.sub','false')),/R44_STAFF_MEMBERSHIP_RESOLVED_ON_SERVER/));
run('inactive role check removal denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-identity-r44.mjs','!isLive(staff)','false')),/R44_INACTIVE_AND_WRONG_ROLE_DENIED/));
run('staff role guard removal denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-identity-r44.mjs',"!['owner','staff'].includes(staff.role)",'false')),/R44_INACTIVE_AND_WRONG_ROLE_DENIED/));
run('LINE verifier argument change denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-identity-r44.mjs','clientId:lineClientId','clientId:unverified')),/R44_LINE_SIGNATURE_CALLBACK_INJECTED/));
run('LINE issuer mismatch removal denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-identity-r44.mjs',"id?.iss!=='https://access.line.me'",'false')),/R44_LINE_SIGNATURE_CALLBACK_INJECTED/));
run('LINE customer resolver bypass denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-identity-r44.mjs','resolveLineCustomer({shopCode,lineSub:id.sub})','resolveCustomer()')),/R44_LINE_CUSTOMER_SCOPE_RESOLVED/));
run('LINE member wrong shop allowed drift denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-identity-r44.mjs','member.shopCode!==shopCode','false')),/R44_LINE_CUSTOMER_SCOPE_RESOLVED/));
run('R45 runtime no longer QA only denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-runtime-r45.mjs','QA ONLY','PRODUCTION')), /R45_DISPOSABLE_ONLY/));
run('R45 runtime no release gate denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-runtime-r45.mjs','createCar02ReleaseGate','releaseAll')), /R45_DISPOSABLE_ONLY/));
run('booking no longer QA isolated denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-basic-booking-http-isolated.mjs',"environment!=='disposable_qa'",'false')),/BOOKING_HTTP_QA_ONLY/));
run('public booking route changed denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-basic-booking-http-isolated.mjs',"const PATH='/api/car02/booking'","const PATH='/booking'")),/BOOKING_HTTP_QA_ONLY/));
run('customer authorized for staff booking denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-basic-booking-http-isolated.mjs',"!['staff','owner'].includes(actor.role)",'false')),/BOOKING_HTTP_STAFF_ONLY/));
run('staff subject rule removed denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-basic-booking-http-isolated.mjs',"actor.subject.startsWith('staff:')",'true')),/BOOKING_HTTP_STAFF_ONLY/));
run('booking origin check removed denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-basic-booking-http-isolated.mjs','origins.has(origin)','true')),/BOOKING_HTTP_BODY_ORIGIN_AND_KEY_GUARDS/));
run('booking request key check removed denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-basic-booking-http-isolated.mjs',"request.headers.get('idempotency-key')",'none')),/BOOKING_HTTP_BODY_ORIGIN_AND_KEY_GUARDS/));
run('booking payload shape check removed denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-basic-booking-http-isolated.mjs','identicalKeys(data,FIELDS)','true')),/BOOKING_HTTP_BODY_ORIGIN_AND_KEY_GUARDS/));
run('browser real host not accepted',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-basic-staff-booking-browser-isolated.mjs','https://car02-booking-qa.invalid','https://real.example.com')),/BOOKING_BROWSER_NONROUTABLE/));
run('browser endpoint pin removal denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-basic-staff-booking-browser-isolated.mjs','endpoint!==URL_QA','false')),/BOOKING_BROWSER_NONROUTABLE/));
run('browser explicit connection disabled by default',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-basic-staff-booking-browser-isolated.mjs','connectionEnabled!==true','false')),/BOOKING_BROWSER_REQUIRES_EXPLICIT/));
run('browser staff credential class required',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-basic-staff-booking-browser-isolated.mjs',"auth.kind!=='staff'",'false')),/BOOKING_BROWSER_REQUIRES_EXPLICIT/));
run('R51 unprefixed path must reject',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-edge-boundary-r51.mjs',"if(path===null)return json(404,'CAR02_NOT_FOUND')",'if(path===null)return null')),/R51_NO_LEGACY/));
run('R51 must not proxy WANGAN',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-edge-boundary-r51.mjs','CAR02_NOT_FOUND','/wangan CAR02_NOT_FOUND')),/R51_NO_LEGACY/));
run('R52 lock removal denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-edge-entry-r52.ts','CAR02_RELEASE_LOCK=true','CAR02_RELEASE_LOCK=false')),/R52_GATE_HARD_CLOSED/));
run('R52 lock callback override denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-edge-entry-r52.ts','()=>!CAR02_RELEASE_LOCK','()=>true')),/R52_GATE_HARD_CLOSED/));
run('R43 release check removal denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-api.mjs','await releaseEnabled(req)!==true','false')),/R43_BACKEND_AUTH_AND_RELEASE_GATES/));
run('R43 verified actor guard removal denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-api.mjs','actor.verified!==true','false')),/R43_BACKEND_AUTH_AND_RELEASE_GATES/));
run('R43 shop sourced from request denied',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-api.mjs','shop:actor.shopCode','shop:req.shopCode')),/R43_SHOP_DERIVED_FROM_ACTOR/));
run('R43 request-supplied identity fields not added',()=>assert.throws(()=>auditCar02V32AuthBookingSources(at(sample(),'car02-api.mjs',"['customerId','vehicleId','reservationId']","['customerId','vehicleId','shopCode']")),/R43_SHOP_DERIVED_FROM_ACTOR/));
for(const [name,fn] of cases)test(name,fn);
