import test from 'node:test';
import assert from 'node:assert/strict';
import {R93_FILES,R93_HARD_GATES,normalizePagesBase,validateLocalR93Sources,verifyR93Pages} from './car02-r93-pages-readonly-audit.mjs';
const REPO='example/qa-repo';
const BASE='https://example.github.io/qa-repo/';
const sources=()=>{
 const m=Object.fromEntries(R93_FILES.map(x=>[x,'// '+x+'\n'+'export const SAMPLE="REVIEW_ONLY";\n'.repeat(5)]));
 m[R93_FILES[0]]='<html><meta http-equiv="Content-Security-Policy" content="script-src \'none\'; connect-src \'none\'"><a href="./CAR02_R90_COMPANY_PC_RECORD.html">R90</a><a href="./CAR02_R91_COMPANY_PC_TRIAGE.html">R91</a> NO_GO HOLD '.repeat(2)+'</html>';
 m[R93_FILES[1]]='<html><meta http-equiv="Content-Security-Policy" content="connect-src \'none\'"><script type="module" src="./car02-staff-review-app-r90.mjs"></script></html>'.repeat(2);
 m[R93_FILES[2]]='<html><meta http-equiv="Content-Security-Policy" content="connect-src \'none\'"><script type="module" src="./car02-r91-triage-app.mjs"></script></html>'.repeat(2);
 m['car02-staff-review-app-r90.mjs']+='\nimport {} from \'./car02-company-pc-record-r90.mjs\';';
 m['car02-r91-triage-app.mjs']+='\nimport {} from \'./car02-r91-triage-model.mjs\';';
 return m;
};
function mock({status=200,meta=BASE,fileStatus={},change={},fileType={},throwFor='',redirect=false}={}){
 const calls=[],contents=sources();
 const fn=async (url,opts={})=>{
   calls.push({url,opts});
   if(throwFor && url.includes(throwFor))throw Error('REMOTE_SECRET_IN_ERROR');
   if(url.startsWith('https://api.github.com/'))return new Response(JSON.stringify({html_url:meta}),{status,headers:{'content-type':'application/json'}});
   const name=new URL(url).pathname.split('/').at(-1),body=change[name]??contents[name];
   return new Response(redirect?'':body,{status:redirect?302:(fileStatus[name]??200),headers:{'content-type':fileType[name]??(name.endsWith('.html')?'text/html':'application/javascript')}});
 };
 return {fn,calls};
}
const run=async(opts={})=>verifyR93Pages({repository:REPO,sources:sources(),fetchImpl:mock().fn,...opts});
const blocked=async fn=>{let r=await fn();assert.equal(r.readiness,'BLOCKED');assert.equal(r.productionReady,false);assert.equal(r.releaseDecision,'NO_GO');assert.equal(r.migrationDecision,'HOLD');return r};

test('R93 reviewed static file set has exactly nine expected resources',()=>assert.equal(R93_FILES.length,9));
test('R93 local static contract valid',()=>assert.equal(validateLocalR93Sources(sources()).valid,true));
for(const [label,change] of [
 ['R92 absent',m=>delete m[R93_FILES[0]]],
 ['R90 relative link removed',m=>m[R93_FILES[0]]=m[R93_FILES[0]].replaceAll('href="./CAR02_R90_COMPANY_PC_RECORD.html"','href="https://bad.example/R90"')],
 ['R91 relative link removed',m=>m[R93_FILES[0]]=m[R93_FILES[0]].replaceAll('href="./CAR02_R91_COMPANY_PC_TRIAGE.html"','href="https://bad.example/R91"')],
 ['R92 release marker absent',m=>m[R93_FILES[0]]=m[R93_FILES[0]].replaceAll('NO_GO','GO')],
 ['R92 script added',m=>m[R93_FILES[0]]+='<script src="evil.js"></script>'],
 ['R90 CSP removed',m=>m[R93_FILES[1]]=m[R93_FILES[1]].replaceAll("connect-src 'none'",'connect-src *')],
 ['R91 CSP removed',m=>m[R93_FILES[2]]=m[R93_FILES[2]].replaceAll("connect-src 'none'",'connect-src *')],
 ['unexpected fetch call',m=>m['car02-r91-triage-app.mjs']+='\nfetch("http://evil.example")'],
 ['dynamic import introduced',m=>m['car02-r91-triage-app.mjs']+='\nimport("./secret.js")'],
 ['R90 model import removed',m=>m['car02-staff-review-app-r90.mjs']=m['car02-staff-review-app-r90.mjs'].replace('from \'./car02-company-pc-record-r90.mjs\'','from \'./other.mjs\'')],
 ['R91 model import removed',m=>m['car02-r91-triage-app.mjs']=m['car02-r91-triage-app.mjs'].replace('from \'./car02-r91-triage-model.mjs\'','from \'./other.mjs\'')]
])test('R93 local contract rejects '+label,()=>{let m=sources();change(m);assert.throws(()=>validateLocalR93Sources(m),/R93_/)});

for(const [name,url] of [
 ['HTTP scheme','http://example.github.io/qa-repo/'],
 ['lookalike hostname','https://example.github.io.evil.com/qa-repo/'],
 ['wrong Pages repo','https://example.github.io/some-other-repo/'],
 ['credential in URL','https://x@example.github.io/qa-repo/'],
 ['querystring','https://example.github.io/qa-repo/?token=x'],
 ['fragment','https://example.github.io/qa-repo/#go'],
 ['wrong path','https://example.github.io/qa-repo/more/'],
 ['non-root custom domain','https://demo.example.com/qa-repo/'],
 ['unsupported port','https://demo.example.com:444/'],
 ['empty URL',''],
])test('R93 rejects untrusted Pages metadata '+name,()=>assert.throws(()=>normalizePagesBase(url,{repository:REPO}),/R93_/));
test('R93 allows exact GitHub Pages project URL from metadata',()=>assert.equal(normalizePagesBase(BASE,{repository:REPO}),BASE));
test('R93 allows a verified custom domain from Pages API metadata only',()=>assert.equal(normalizePagesBase('https://demo.example.com/',{repository:REPO}),'https://demo.example.com/'));
test('R93 does not accept missing owner/repo',()=>assert.throws(()=>normalizePagesBase(BASE,{repository:''}),/R93_/));

test('R93 static Pages response with content hash matches produces public URL but never GO',async()=>{
 const m=mock();const r=await run({fetchImpl:m.fn});
 assert.equal(r.readiness,'STATIC_PAGES_VERIFIED');assert.equal(r.pagesUrl,BASE);assert.equal(r.checks.length,11);
 assert.equal(r.checks.filter(x=>x.pass).length,11);assert.deepEqual(r.blockedReasons,[]);
 assert.deepEqual(Object.fromEntries(Object.keys(R93_HARD_GATES).map(k=>[k,r[k]])),R93_HARD_GATES);
 assert.equal(m.calls.length,10);
 for(const c of m.calls){assert.equal(c.opts.method,'GET');assert.equal(c.opts.redirect,'manual');}
});
test('R93 uses GitHub token ONLY for GitHub metadata and never static Pages assets',async()=>{
 const m=mock();await run({fetchImpl:m.fn,token:'DUMMY_SECRET'});
 assert.equal(m.calls[0].opts.headers.Authorization,'Bearer DUMMY_SECRET');
 for(const c of m.calls.slice(1))assert.equal(c.opts.headers.Authorization,undefined);
});
for(const [name,config,reason] of [
 ['no Pages metadata',{status:404},'R93_PAGES_NOT_CONFIGURED'],
 ['forbidden Pages metadata',{status:403},'R93_PAGES_METADATA_UNAVAILABLE'],
 ['unsafe Pages metadata',{meta:'https://evil.invalid/qa-repo/'},'R93_PAGES_URL_UNTRUSTED'],
 ['missing R92 page',{fileStatus:{'CAR02_R92_COMPANY_PC_START.html':404}},'R93_FILE_HTTP_404'],
 ['missing R90 page',{fileStatus:{'CAR02_R90_COMPANY_PC_RECORD.html':404}},'R93_FILE_HTTP_404'],
 ['missing R91 page',{fileStatus:{'CAR02_R91_COMPANY_PC_TRIAGE.html':404}},'R93_FILE_HTTP_404'],
 ['redirected static page',{redirect:true},'R93_FILE_HTTP_302'],
 ['wrong MIME',{fileType:{'CAR02_R92_COMPANY_PC_START.html':'text/plain'}},'R93_FILE_CONTENT_TYPE'],
 ['stale Pages R90',{change:{'CAR02_R90_COMPANY_PC_RECORD.html':'old deployed version'}},'R93_PAGES_SOURCE_DRIFT'],
 ['JavaScript mismatch',{change:{'car02-r91-triage-app.mjs':'stale deployed JS'}},'R93_PAGES_SOURCE_DRIFT']
])test('R93 blocks '+name,async()=>{
 const m=mock(config),r=await blocked(()=>run({fetchImpl:m.fn}));
 assert.ok(r.blockedReasons.includes(reason),JSON.stringify(r.blockedReasons));
});
test('R93 blocked fetch error never prints exception secrets',async()=>{
 const m=mock({throwFor:'CAR02_R90_COMPANY_PC_RECORD'});const r=await blocked(()=>run({fetchImpl:m.fn}));
 assert.doesNotMatch(JSON.stringify(r),/REMOTE_SECRET_IN_ERROR/);
});
test('R93 unavailable Pages metadata request rejects safely',async()=>{
 const r=await blocked(()=>run({fetchImpl:async()=>{throw Error('SECRET_SERVER_DSN')}}));
 assert.deepEqual(r.blockedReasons,['R93_SAFE_AUDIT_FAILED']);
});
test('R93 rejects content tampering in reviewed checkout before network requests',async()=>{
 const m=mock();const s=sources();s[R93_FILES[0]]+='\n<script>bad</script>';
 const r=await blocked(()=>run({fetchImpl:m.fn,sources:s}));assert.equal(m.calls.length,0);
});
test('R93 wrong repository is denied before network',async()=>{
 const m=mock(),r=await blocked(()=>run({repository:'wrong/../path',fetchImpl:m.fn}));assert.equal(m.calls.length,0);assert.ok(r.blockedReasons.includes('R93_REPOSITORY_INVALID'));
});
