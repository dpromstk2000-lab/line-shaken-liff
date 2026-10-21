import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CAR02_V465_RELEASE_LOCK,CAR02_V465_REQUIRED_COLUMNS,CAR02_V465_CATALOG_SQL,
 createCar02OfflineStagingSchemaProbeR465} from './car02-staging-schema-probe-r465.mjs';
const auth={verified:true,mode:'isolated_qa',role:'schema_auditor',dataAccess:'catalog_only'};
const isolated={verified:true,environment:'disposable_pg17',database:'car02_v465_disposable',testOnly:true};
const rows=Object.entries(CAR02_V465_REQUIRED_COLUMNS).flatMap(([table,cols])=>
 Object.entries(cols).map(([column,type])=>({schema_name:table.split('.')[0],table_name:table.split('.')[1],
  column_name:column,type_name:type,is_not_null:true})));
const locked=o=>{assert.equal(o.status,'no_go');assert.equal(o.releasePermitted,false);
 assert.equal(o.writeAuthorized,false);assert.equal(o.providerSessionVerified,false);
 assert.equal(o.metadataOnly,true);assert.equal(Object.isFrozen(o),true);return o;};
function fixture({a=auth,i=isolated,data=rows,throwStage='',invalidClient=false,releaseMissing=false}={}){
 const calls=[];let releases=[];let connects=0;
 const f=createCar02OfflineStagingSchemaProbeR465({
  authorizeInspector:async arg=>{calls.push(['authorize',arg]);if(throwStage==='authorize')throw Error('secret');return a},
  inspectIsolation:async()=>{calls.push(['isolation']);if(throwStage==='isolation')throw Error('secret');return i},
  pool:{connect:async()=>{connects++;if(throwStage==='connect')throw Error('secret');
   if(invalidClient)return{query:null,release:()=>{}};
   const q={query:async sql=>{calls.push(['query',sql]);
     if(throwStage==='begin'&&sql.startsWith('BEGIN'))throw Error('fail begin');
     if(throwStage==='query'&&sql===CAR02_V465_CATALOG_SQL)throw Error('fail query');
     if(throwStage==='rollback'&&sql==='ROLLBACK')throw Error('fail rollback');
     if(sql===CAR02_V465_CATALOG_SQL)return{rows:data};return{rows:[]}},
     ...(releaseMissing?{}:{release:e=>releases.push(Boolean(e))})};return q}}
 });
 return{f,calls,releases,get connects(){return connects}};
}
const run=x=>x.f.inspect({request:{callerTriedToOverrideMode:'production',shopCode:'shop_other'}});
test('hard release lock, metadata-only catalog SQL, no data reads or writes',()=>{
 assert.equal(CAR02_V465_RELEASE_LOCK,true);
 assert.equal(Object.isFrozen(CAR02_V465_REQUIRED_COLUMNS),true);
 assert.match(CAR02_V465_CATALOG_SQL,/pg_catalog\.pg_class/);
 assert.match(CAR02_V465_CATALOG_SQL,/pg_catalog\.pg_attribute/);
 assert.doesNotMatch(CAR02_V465_CATALOG_SQL,/\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bDROP\b|\bCREATE\b/i);
 assert.doesNotMatch(CAR02_V465_CATALOG_SQL,/\bFROM\s+auth\.sessions\b|\bFROM\s+public\.ksh_car02_staff_access\b/i);
});
test('required trusted adapters are mandatory',()=>{
 assert.throws(()=>createCar02OfflineStagingSchemaProbeR465(),/OFFLINE_ADAPTERS_REQUIRED/);
});
test('valid synthetic catalog still NO_GO without session values or business write capability',async()=>{
 const x=fixture(),r=locked(await run(x));assert.equal(r.reason,'metadata_review_only');
 assert.deepEqual(r.missingColumns,[]);assert.equal(Object.isFrozen(r.missingColumns),true);
 assert.deepEqual(x.calls.filter(v=>v[0]==='query').map(v=>v[1]),[
  'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',"SET LOCAL statement_timeout = '5s'",
  "SET LOCAL lock_timeout = '1s'",CAR02_V465_CATALOG_SQL,'ROLLBACK']);
 assert.deepEqual(x.releases,[false]);
});
test('no auth.sessions metadata is a blocker',async()=>{
 const x=fixture({data:rows.filter(x=>x.schema_name!=='auth')});
 const r=locked(await run(x));assert.equal(r.reason,'required_columns_absent');
 assert.equal(r.missingColumns.length,3);
});
test('missing staff active column is a blocker',async()=>{
 const x=fixture({data:rows.filter(x=>x.column_name!=='active')});
 assert.deepEqual(locked(await run(x)).missingColumns,['public.ksh_car02_staff_access.active']);
});
test('wrong column type cannot pass as metadata ready',async()=>{
 const x=fixture({data:rows.map(x=>x.column_name==='user_id'?{...x,type_name:'text'}:x)});
 assert.deepEqual(locked(await run(x)).missingColumns,['auth.sessions.user_id']);
});
test('missing table catalog rows fail closed with all missing fields',async()=>{
 const r=locked(await run(fixture({data:[]})));assert.equal(r.missingColumns.length,7);
});
test('duplicate catalog rows never trusted',async()=>{
 const r=locked(await run(fixture({data:[...rows,rows[0]]})));assert.equal(r.reason,'catalog_untrusted_or_unavailable');
});
test('unknown public table is never enumerated by injected rows',async()=>{
 const r=locked(await run(fixture({data:[...rows,{...rows[0],schema_name:'public',table_name:'customers'}]})));
 assert.equal(r.reason,'catalog_untrusted_or_unavailable');
});
test('hostile catalog metadata shape fails closed',async()=>{
 for(const data of [null,{},[null],[{...rows[0],is_not_null:'true'}],[{...rows[0],column_name:'evil;DELETE'}],
 [{...rows[0],type_name:'text\nDELETE'}],Array(129).fill(rows[0])]){
  const r=locked(await run(fixture({data})));assert.equal(r.reason,'catalog_untrusted_or_unavailable');
 }
});
test('no provider-level schema proof from fake production environment',async()=>{
 const x=fixture({i:{...isolated,environment:'production'}});
 assert.equal(locked(await run(x)).reason,'isolation_or_inspector_unverified');assert.equal(x.connects,0);
});
test('unverified or missing independent isolation attestation refuses connection',async()=>{
 for(const i of [null,{...isolated,verified:false},{...isolated,testOnly:false},{...isolated,database:'actual_project'}]){
  const x=fixture({i});locked(await run(x));assert.equal(x.connects,0);
 }
});
test('wrong role, mode and dataAccess refuse connection before catalog',async()=>{
 for(const change of [{role:'owner'},{role:'staff'},{role:'auditor'},{mode:'production'},
  {dataAccess:'read_all'},{verified:false}]){
  const x=fixture({a:{...auth,...change}});locked(await run(x));assert.equal(x.connects,0);
 }
});
test('request cannot override independently attested scope',async()=>{
 const x=fixture();locked(await run(x));
 assert.equal(x.calls[0][1].request.shopCode,'shop_other');assert.equal(x.connects,1);
 assert.ok(x.calls.some(x=>x[0]==='isolation'));
});
test('independent attestation errors fail closed',async()=>{
 for(const key of ['authorize','isolation']){const x=fixture({throwStage:key});
  assert.equal(locked(await run(x)).reason,'isolation_or_inspector_unverified');assert.equal(x.connects,0)}
});
test('connection, query and BEGIN failures never return metadata readiness',async()=>{
 for(const key of ['connect','query','begin']){
  const x=fixture({throwStage:key});assert.equal(locked(await run(x)).reason,'catalog_untrusted_or_unavailable');
 }
});
test('rollback failure is not interpreted as successful metadata audit',async()=>{
 const x=fixture({throwStage:'rollback'});assert.equal(locked(await run(x)).reason,'catalog_untrusted_or_unavailable');
 assert.deepEqual(x.releases,[true]);
});
test('invalid client is never trusted and no business queries occur',async()=>{
 const x=fixture({invalidClient:true});assert.equal(locked(await run(x)).reason,'catalog_untrusted_or_unavailable');
});
test('missing client release is fail-closed and produces no success-only outcome',async()=>{
 const x=fixture({releaseMissing:true});
 // A pool with a missing release method is rejected before BEGIN.
 assert.equal(locked(await run(x)).reason,'catalog_untrusted_or_unavailable');
});
test('R52 original hard release lock preserved and audit module remains unreferenced',()=>{
 const s=readFileSync(new URL('./car02-edge-entry-r52.ts',import.meta.url),'utf8');
 assert.match(s,/const\s+CAR02_RELEASE_LOCK=true/);
 assert.doesNotMatch(s,/staging-schema-probe-r465/);
});
test('inspection result never exposes personal data, service key or authorization',async()=>{
 const r=locked(await run(fixture()));assert.deepEqual(Object.keys(r),[
  'status','reason','metadataOnly','releasePermitted','writeAuthorized','providerSessionVerified','missingColumns']);
});
