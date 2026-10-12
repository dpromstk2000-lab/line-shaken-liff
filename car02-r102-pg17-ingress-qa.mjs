// Isolated disposable PostgreSQL 17 HTTP-to-ready path with R102 early ingress.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createCar02R102IsolatedIngress} from './car02-r102-early-ingress-isolated.mjs';
import {createR93YInProcessStorageFixture,createR93YIsolatedStorageProtocol} from './car02-r93y-qa-storage-http-fixture.mjs';
import {R99_DB,R99_SHOP,R99_ORIGIN,R99_STAFF,R99_ORDER,R99_REPORT,readR99State} from './car02-r99-disposable-upload-boundary-qa.mjs';
const checkEnv=(env)=>{
 const fields={R102_DISPOSABLE_INGRESS_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',
  PGPASSWORD:'disposable-r93s-ci-only',PGDATABASE:R99_DB};
 for(const [key,value] of Object.entries(fields))assert.equal(env?.[key],value,'R102_ENV_'+key);
};
const url=`${R99_ORIGIN}/functions/v1/dpro-car02-stage/api/car02/uploads/${R99_ORDER}/${R99_REPORT}`;
const key='88888888-8888-4888-8888-000000001102';
const raw=new Uint8Array([255,216,255,224,21,22,23,24,25,26]);
const req=(extras={},body=raw)=>new Request(url,{method:'POST',headers:{origin:R99_ORIGIN,
 authorization:'Bearer qa-valid-r102-fixture','idempotency-key':key,'content-type':'image/jpeg',...extras},body});
export async function runR102Pg17(pool){
 assert.deepEqual(await readR99State(pool),{photos:[],intents:[],outbox:[]});
 const fixture=createR93YInProcessStorageFixture();
 const storage=createR93YIsolatedStorageProtocol({environment:'isolated_qa',dbName:R99_DB,fixture});
 let auth=0;
 const wrap=createCar02R102IsolatedIngress({environment:'isolated_qa',dbName:R99_DB,
  shopCode:R99_SHOP,pool,storage,reviewGate:async()=>true,origins:[R99_ORIGIN],
  authenticate:async()=>{auth++;return {verified:true,shopCode:R99_SHOP,role:'staff',subject:'staff:'+R99_STAFF}}});
 const rejected=[
  [{origin:'https://foreign.invalid'},403],
  [{authorization:'garbage'},401],
  [{'idempotency-key':'invalid'},400],
  [{'x-shop-code':'other_shop'},403],
  [{'x-line-id-token':'invalid'},403],
  [{'content-length':String(5*1024*1024+1)},413],
  [{'content-type':'application/octet-stream'},415],
  [{'content-encoding':'gzip'},415]
 ];
 for(const [headers,status] of rejected){
  const response=await wrap(req(headers));assert.equal(response.status,status,JSON.stringify(headers));
 }
 assert.equal(auth,0,'R102_EARLY_REJECT_AUTH_CALLED');
 assert.equal(fixture.posts,0,'R102_EARLY_REJECT_STORAGE_CALLED');
 assert.deepEqual(await readR99State(pool),{photos:[],intents:[],outbox:[]},'R102_REJECTION_PERSISTED');
 const first=await wrap(req());assert.equal(first.status,201,'R102_FIRST_UPLOAD');
 const body=await first.json();assert.equal(body.state,'ready');assert.equal(fixture.posts,1);
 const retry=await wrap(req());assert.equal(retry.status,201,'R102_RETRY');
 assert.equal((await retry.json()).photoId,body.photoId,'R102_RETRY_DIFFERENT_ID');
 assert.equal(fixture.posts,1,'R102_DUPLICATE_STORAGE_WRITE');
 const state=await readR99State(pool);
 assert.equal(state.photos.length,1);assert.equal(state.photos[0].upload_state,'ready');
 assert.equal(state.intents.length,1);assert.equal(state.outbox.length,0);
 console.log('R102_EARLY_REJECT_DB_STORAGE_ZERO_PASS');
 console.log('R102_DISPOSABLE_POSTGRES17_UPLOAD_AND_RETRY_PASS');
 console.log('R102_NO_GO_HOLD_PASS');
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 checkEnv(process.env);const {default:pg}=await import('pg');
 const pool=new pg.Pool({host:'127.0.0.1',port:5432,user:'postgres',password:'disposable-r93s-ci-only',
  database:R99_DB,max:3,connectionTimeoutMillis:3000,idleTimeoutMillis:1000,
  application_name:'car02_r102_disposable_only'});
 try{await runR102Pg17(pool)}finally{await pool.end()}
}
export {checkEnv as assertR102Environment};
