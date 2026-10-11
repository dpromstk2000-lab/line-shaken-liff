// DPRO CAR02 R93 — READ-ONLY GitHub Pages deployment/link preflight.
// REVIEW/QA ONLY. Never writes GitHub, deploys anything, calls business APIs,
// authenticates users, connects to Supabase/Cloudflare, or approves production.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

export const R93_FILES=Object.freeze([
 'CAR02_R92_COMPANY_PC_START.html',
 'CAR02_R90_COMPANY_PC_RECORD.html',
 'CAR02_R91_COMPANY_PC_TRIAGE.html',
 'car02-staff-review-app-r90.mjs',
 'car02-r91-triage-app.mjs',
 'car02-r91-triage-model.mjs',
 'car02-staff-review-model-r86.mjs',
 'car02-company-pc-record-r90.mjs',
 'car02-r89-acceptance-model.mjs'
]);
export const R93_HARD_GATES=Object.freeze({productionReady:false,releaseDecision:'NO_GO',migrationDecision:'HOLD',businessMutations:false,sqlChanges:false,lineDispatch:false});
const MAX_BYTES=200000;
const error=(code)=>Object.assign(new Error(code),{code});
const sha=(s)=>createHash('sha256').update(s,'utf8').digest('hex');
const exactRepo=s=>typeof s==='string' && /^[a-z\d](?:[a-z\d-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/.test(s);
const has=(text,needle)=>typeof text==='string'&&text.includes(needle);
export function validateLocalR93Sources(files){
 if(!files||typeof files!=='object'||Array.isArray(files))throw error('R93_SOURCES_INVALID');
 for(const file of R93_FILES){if(typeof files[file]!=='string'||files[file].length<80||files[file].length>MAX_BYTES)throw error('R93_LOCAL_SOURCE_MISSING');}
 const start=files[R93_FILES[0]],r90=files[R93_FILES[1]],r91=files[R93_FILES[2]];
 if(!has(start,'href="./CAR02_R90_COMPANY_PC_RECORD.html"')||!has(start,'href="./CAR02_R91_COMPANY_PC_TRIAGE.html"')||
    !has(start,"connect-src 'none'")||!has(start,"script-src 'none'")||!has(start,'NO_GO')||!has(start,'HOLD')||/<script\b/i.test(start))throw error('R93_NAVIGATION_OR_RELEASE_DRIFT');
 if(!has(r90,'src="./car02-staff-review-app-r90.mjs"')||!has(r91,'src="./car02-r91-triage-app.mjs"')||
    !has(r90,"connect-src 'none'")||!has(r91,"connect-src 'none'"))throw error('R93_APPLICATION_ASSETS_DRIFT');
 for(const js of R93_FILES.filter(x=>x.endsWith('.mjs'))){
    const s=files[js];
    if(/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(s) || /\bimport\s*\(/.test(s) ||
      /\bhttps?:\/\//.test(s.replaceAll(/\/\/[^\n]*/g,'')))throw error('R93_UNEXPECTED_NETWORK_SOURCE');
 }
 // Expected module dependency names from existing canonical R90/R91 sources.
 if(!has(files['car02-staff-review-app-r90.mjs'],"from './car02-company-pc-record-r90.mjs'")||
    !has(files['car02-r91-triage-app.mjs'],"from './car02-r91-triage-model.mjs'"))throw error('R93_MODULE_GRAPH_DRIFT');
 return Object.freeze({valid:true,files:R93_FILES.length,productionReady:false,releaseDecision:'NO_GO',migrationDecision:'HOLD'});
}
export function normalizePagesBase(htmlUrl,{repository}={}){
 if(!exactRepo(repository)||typeof htmlUrl!=='string'||htmlUrl.length>512)throw error('R93_PAGES_URL_UNTRUSTED');
 let u;try{u=new URL(htmlUrl)}catch{throw error('R93_PAGES_URL_UNTRUSTED')}
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.port||u.pathname.includes('/../')||u.pathname.includes('/./'))throw error('R93_PAGES_URL_UNTRUSTED');
 const [owner,name]=repository.split('/');
 // GitHub Pages project URLs are under /repo/, except repository homepage Pages.
 if(u.hostname.toLowerCase()===owner.toLowerCase()+'.github.io'){
   const expected=name.toLowerCase()===owner.toLowerCase()+'.github.io'?'/':'/'+name+'/';
   if(u.pathname!==expected)throw error('R93_PAGES_URL_UNTRUSTED');
 }else if(!/^(?=.{1,253}$)[A-Za-z\d-]+(?:\.[A-Za-z\d-]+)+$/.test(u.hostname)||u.pathname!=='/'){
   // A verified Pages API may return a custom domain; never infer one.
   throw error('R93_PAGES_URL_UNTRUSTED');
 }
 return u.href;
}
function contentTypeOk(file,ct){return file.endsWith('.html')?ct.toLowerCase().includes('text/html'):
  /(javascript|ecmascript|text\/plain)/i.test(ct);}
async function readLimited(response){
 const declared=Number(response.headers.get('content-length')||0);
 if(declared>MAX_BYTES)return null;
 let total=0;const chunks=[];
 if(!response.body)return null;
 for await(const c of response.body){total+=c.byteLength;if(total>MAX_BYTES)return null;chunks.push(c)}
 return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
}
export async function verifyR93Pages({repository,token='',sources,fetchImpl=fetch}={}){
 const report={schema:'DPRO_CAR02_R93_PAGES_READONLY_AUDIT',mode:'READ_ONLY',
  ...R93_HARD_GATES,readiness:'BLOCKED',pagesUrl:null,checks:[],blockedReasons:[]};
 const record=(name,pass,reason='')=>{report.checks.push({name,pass});if(!pass)report.blockedReasons.push(reason||name)};
 try{if(!exactRepo(repository))throw error('R93_REPOSITORY_INVALID');
  validateLocalR93Sources(sources);record('LOCAL_SOURCE_AND_RELEASE_GATE',true);
  // GitHub repository metadata is authoritative for Pages public URL; no URL guessing.
  const meta=await fetchImpl(`https://api.github.com/repos/${repository}/pages`,{
   method:'GET',redirect:'manual',signal:AbortSignal.timeout(9000),
   headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',
    ...(token?{Authorization:'Bearer '+token}:{})}
  });
  if(meta.status!==200)throw error(meta.status===404?'R93_PAGES_NOT_CONFIGURED':'R93_PAGES_METADATA_UNAVAILABLE');
  const pageInfo=await meta.json().catch(()=>null);
  const base=normalizePagesBase(pageInfo?.html_url,{repository});report.pagesUrl=base;
  record('PAGES_METADATA',true);
  // Fetch only same-origin static files returned by the Pages metadata; no redirects.
  for(const file of R93_FILES){
   const url=new URL(file,base);
   if(url.origin!==new URL(base).origin||!url.pathname.startsWith(new URL(base).pathname))throw error('R93_STATIC_URL_UNTRUSTED');
   let response;
   try{response=await fetchImpl(url.href,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(9000),headers:{Accept:'text/html,application/javascript;q=0.9,*/*;q=0.5'}})}
   catch{record(file,false,'R93_FILE_REQUEST_FAILED');continue}
   if(response.status!==200){record(file,false,'R93_FILE_HTTP_'+response.status);continue}
   if(!contentTypeOk(file,response.headers.get('content-type')||'')){record(file,false,'R93_FILE_CONTENT_TYPE');continue}
   let body;try{body=await readLimited(response)}catch{body=null}
   if(body===null){record(file,false,'R93_FILE_TOO_LARGE_OR_UNREADABLE');continue}
   // Confirm deployed file is identical to reviewed GitHub main source.
   if(sha(body)!==sha(sources[file])){record(file,false,'R93_PAGES_SOURCE_DRIFT');continue}
   record(file,true);
  }
  if(report.blockedReasons.length===0)report.readiness='STATIC_PAGES_VERIFIED';
 }catch(e){report.blockedReasons.push(e?.code?.startsWith('R93_')?e.code:'R93_SAFE_AUDIT_FAILED');}
 return Object.freeze({...report,checks:Object.freeze(report.checks),blockedReasons:Object.freeze(report.blockedReasons)});
}
export function loadR93LocalSources(dir=new URL('.',import.meta.url)){
 return Object.fromEntries(R93_FILES.map(file=>[file,readFileSync(new URL(file,dir),'utf8')]));
}
if(process.argv[1]&&new URL('file://'+process.argv[1]).href===import.meta.url){
 const repository=process.env.GITHUB_REPOSITORY||'';
 const result=await verifyR93Pages({repository,token:process.env.GITHUB_TOKEN||'',sources:loadR93LocalSources()});
 console.log(JSON.stringify(result,null,2));
 console.log(result.readiness==='STATIC_PAGES_VERIFIED'?'R93_PAGES_READONLY_PASS: URL verified; release remains NO_GO/HOLD':'R93_PAGES_READONLY_BLOCKED: inspect reasons; do not change production settings');
 if(result.readiness!=='STATIC_PAGES_VERIFIED')process.exitCode=1;
}
