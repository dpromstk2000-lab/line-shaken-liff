import {test} from 'node:test';
import assert from 'node:assert/strict';
import {V33_MODE,createV33QaStaffClaimsGuard,auditV33R44ClaimDelegation,V33_APPROVED_BLOBS}
 from './car02-v33-staff-jwt-claims-isolated.mjs';
const NOW=1800000000;
const ISS='https://auth.qa.invalid',AUD='car02-staff-qa',ALG='RS256';
const GOOD={verified:true,iss:ISS,aud:AUD,alg:ALG,sub:'qa-staff-01',iat:NOW-30,nbf:NOW-30,exp:NOW+120};
const safeOpts={environment:'isolated_qa',allowIsolatedQa:true,verifySignedJwt:async()=>({...GOOD}),
 trustedIssuer:ISS,trustedAudience:AUD,expectedAlgorithm:ALG,nowSeconds:()=>NOW};
const build=(o={})=>createV33QaStaffClaimsGuard({...safeOpts,...o});
const token='synthetic-token-long-12345';
const verify=(g=build())=>g({accessToken:token});
const reject=async fn=>assert.rejects(fn,/CAR02_V33_STAFF_CLAIMS_REJECTED/);
const cases=[];const add=(name,fn)=>cases.push([name,fn]);
for(const [label,value] of Object.entries({productionReady:false,deployable:false,
 signatureVerificationImplemented:false,liveVerifierBound:false,liveStaffResolverBound:false,
 release:'NO_GO',migration:'HOLD',environment:'isolated_qa'}))add('mode '+label,()=>assert.equal(V33_MODE[label],value));
add('correct signed-claims callback accepted only inside QA',async()=>assert.deepEqual(await verify(),{verified:true,sub:'qa-staff-01',exp:NOW+120}));
add('output frozen',async()=>assert.ok(Object.isFrozen(await verify())));
add('output minimal',async()=>assert.deepEqual(Object.keys(await verify()).sort(),['exp','sub','verified']));
add('no token leaked',async()=>assert.ok(!JSON.stringify(await verify()).includes(token)));
add('valid ES256 alternative if deliberately configured',async()=>{
 const g=build({expectedAlgorithm:'ES256',verifySignedJwt:async()=>({...GOOD,alg:'ES256'})});
 assert.equal((await verify(g)).verified,true);
});
const BAD_CONFIG=[
 ['production environment',{environment:'production'}],
 ['missing explicit isolation',{allowIsolatedQa:false}],
 ['missing verifier',{verifySignedJwt:null}],
 ['injected nonfunction verifier',{verifySignedJwt:'pass'}],
 ['issuer HTTP',{trustedIssuer:'http://auth.qa.invalid'}],
 ['issuer missing',{trustedIssuer:''}],
 ['issuer credential component',{trustedIssuer:'https://u:p@auth.qa.invalid'}],
 ['issuer query string',{trustedIssuer:'https://auth.qa.invalid/?fake=1'}],
 ['issuer fragment',{trustedIssuer:'https://auth.qa.invalid/#key'}],
 ['issuer whitespace',{trustedIssuer:' https://auth.qa.invalid'}],
 ['missing audience',{trustedAudience:''}],
 ['audience leading whitespace',{trustedAudience:' car02-staff-qa'}],
 ['algorithm none',{expectedAlgorithm:'none'}],
 ['algorithm HS256 in this QA policy',{expectedAlgorithm:'HS256'}],
 ['algorithm missing',{expectedAlgorithm:null}],
 ['invalid clock',{nowSeconds:5}],
 ['bad TTL zero',{maxTtlSeconds:0}],
 ['bad TTL over 24 hours',{maxTtlSeconds:86401}],
 ['bad TTL float',{maxTtlSeconds:600.5}]
];
for(const [label,bad] of BAD_CONFIG)add('configuration denied '+label,()=>assert.throws(()=>build(bad),/CAR02_V33_STAFF_CLAIMS_REJECTED/));
const BAD_CLAIMS=[
 ['unverified',{verified:false}],['verified absent',{verified:undefined}],
 ['wrong issuer',{iss:'https://outside.invalid'}],['missing issuer',{iss:undefined}],
 ['wrong audience',{aud:'foreign-app'}],['audience array',{aud:[AUD]}],
 ['audience null',{aud:null}],['wrong alg',{alg:'HS256'}],['none alg',{alg:'none'}],
 ['missing alg',{alg:null}],['subject blank',{sub:''}],['subject whitespace',{sub:' suspicious'}],
 ['subject nonstring',{sub:123}],['iat in future',{iat:NOW+1}],
 ['iat float',{iat:NOW-0.25}],['iat absent',{iat:undefined}],
 ['nbf in future',{nbf:NOW+1}],['nbf absent',{nbf:undefined}],
 ['expired at now',{exp:NOW}],['expired earlier',{exp:NOW-1}],
 ['expiration string',{exp:String(NOW+120)}],['expiration nonfinite',{exp:Infinity}],
 ['expired before issued',{exp:NOW-31}],['too long lifetime',{exp:NOW+4000}],
 ['null claims',null],['array claims',[]],['nonplain claims',new Date()]
];
for(const [label,mutated] of BAD_CLAIMS)add('claims rejected '+label,async()=>{
 const claims=mutated===null||Array.isArray(mutated)||mutated instanceof Date?mutated:{...GOOD,...mutated};
 await reject(()=>verify(build({verifySignedJwt:async()=>claims})));
});
const BAD_TOKEN=[undefined,null,'short','synthetic token with space','\nnotvalid12345',12345,'x'.repeat(8193)];
for(const [i,t] of BAD_TOKEN.entries())add('token rejected #'+i,async()=>await reject(()=>build()({accessToken:t})));
add('error from cryptographic verifier fails closed',async()=>await reject(()=>verify(build({verifySignedJwt:async()=>{throw Error('sensitive token detail')}}))));
add('verifier failure never exposes sensitive callback error',async()=>{
 try{await verify(build({verifySignedJwt:async()=>{throw Error('raw-sensitive-credential')}}))}catch(e){
  assert.equal(e.message,'CAR02_V33_STAFF_CLAIMS_REJECTED');assert.ok(!JSON.stringify(e).includes('raw-sensitive'));
 }
});
add('no silent signed callback fallback',async()=>{
 let calls=0;await verify(build({verifySignedJwt:async()=>{calls++;return {...GOOD}}}));assert.equal(calls,1);
});
add('boundary rejects nonnumber wall clock',async()=>await reject(()=>verify(build({nowSeconds:()=>String(NOW)}))));
add('boundary rejects invalid wall clock',async()=>await reject(()=>verify(build({nowSeconds:()=>NaN}))));
add('clock callback error sanitized',async()=>await reject(()=>verify(build({nowSeconds:()=>{throw Error('sensitive clock detail')}}))));
add('exact expires does not allow replay after exp',async()=>await reject(()=>verify(build({nowSeconds:()=>NOW+120}))));
add('Ttl guard accepts exactly one hour',async()=>{
 const g=build({maxTtlSeconds:3600,verifySignedJwt:async()=>({...GOOD,iat:NOW-1,exp:NOW+3599})});
 assert.equal((await verify(g)).verified,true);
});
add('Ttl guard rejects hour+one second',async()=>await reject(()=>verify(build({verifySignedJwt:async()=>({...GOOD,iat:NOW-1,exp:NOW+3600})}))));
add('source blobs keyed to three protected files',()=>assert.equal(Object.keys(V33_APPROVED_BLOBS).length,3));
add('source blobs valid hex hashes',()=>assert.ok(Object.values(V33_APPROVED_BLOBS).every(v=>/^[a-f0-9]{40}$/.test(v))));
add('source audit refuses nonexistent source',()=>assert.throws(()=>auditV33R44ClaimDelegation({}),/CAR02_V33_STAFF_CLAIMS_REJECTED/));
add('source audit refuses undeclared source fields',()=>assert.throws(()=>auditV33R44ClaimDelegation(Object.fromEntries(Object.keys(V33_APPROVED_BLOBS).map(p=>[p,'hi']).concat([['secret','no']]))),/CAR02_V33_STAFF_CLAIMS_REJECTED/));
for(const [name,fn] of cases)test(name,fn);
