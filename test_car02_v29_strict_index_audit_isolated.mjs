import assert from 'node:assert/strict';
import {test} from 'node:test';
import {V29_MODE,V29_CATALOG_SQL,V29_SQL_HASH,verifyV29Sql,
 assessV29IndexCatalog,createV29QaIndexCatalogReader} from './car02-v29-strict-index-audit-isolated.mjs';
const expected={GITHUB_ACTIONS:'true',NODE_ENV:'test',CAR02_RELEASE_LOCK:'true',
 CAR02_BASIC_PG17_QA:'yes',PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',
 PGPASSWORD:'qa_only_local',PGDATABASE:'car02_qa'};
const row=(n=2,m=0,e=0)=>({index_count:String(n),unique_mention_count:String(m),effective_index_count:String(e)});
const options={host:'127.0.0.1',port:5432,user:'postgres',password:'qa_only_local',database:'car02_qa'};
const pool={options,connect:async()=>({query:async()=>({rows:[{transaction_read_only:'on'}]}),release:()=>{}})};
const init=(x={})=>createV29QaIndexCatalogReader({pool,env:{...expected},environment:'disposable_qa',allowDisposableQa:true,...x});
const cases=[
 ['R52 remains NO_GO',()=>assert.equal(V29_MODE.release,'NO_GO')],
 ['migration remains HOLD',()=>assert.equal(V29_MODE.migration,'HOLD')],
 ['never live DB verified',()=>assert.equal(V29_MODE.realSchemaVerified,false)],
 ['never deployable',()=>assert.equal(V29_MODE.productionReady,false)],
 ['never sendable',()=>assert.equal(V29_MODE.sendable,false)],
 ['SQL SHA is pinned',()=>assert.match(V29_SQL_HASH,/^[a-f0-9]{64}$/)],
 ['SQL remains SELECT-only',()=>assert.match(V29_CATALOG_SQL,/^WITH idx AS \(/)],
 ['SQL uses catalog not row scan',()=>assert.match(V29_CATALOG_SQL,/FROM pg_index AS i/)],
 ['SQL requires valid indexes',()=>assert.match(V29_CATALOG_SQL,/indisvalid AND indisready/)],
 ['SQL compares exact key columns',()=>assert.match(V29_CATALOG_SQL,/key_columns=ARRAY\['reservation_id'\]/)],
 ['SQL excludes expressions',()=>assert.match(V29_CATALOG_SQL,/AND plain_keys/)],
 ['SQL has placeholder for allowlisted table',()=>assert.match(V29_CATALOG_SQL,/c\.relname=\$1/)],
 ['correct SQL accepted',()=>assert.equal(verifyV29Sql(V29_CATALOG_SQL).pinned,true)],
 ['SQL drift rejected',()=>assert.throws(()=>verifyV29Sql(V29_CATALOG_SQL+' '),/CAR02_V29_SQL_DRIFT/)],
 ['SQL type rejected',()=>assert.throws(()=>verifyV29Sql(null),/CAR02_V29_SQL_DRIFT/)],
 ['zero effective indexes remains HOLD',()=>assert.equal(assessV29IndexCatalog(row(4,3,0),{table:'ksh_car02_work_orders'}).positiveCatalogSignal,false)],
 ['candidate unique mention does not mean coverage',()=>assert.equal(assessV29IndexCatalog(row(4,3,0),{table:'ksh_car02_work_orders'}).next,'HOLD_UNIQUENESS_NOT_PROVEN')],
 ['exact structural match still HOLD',()=>assert.equal(assessV29IndexCatalog(row(4,3,1),{table:'ksh_car02_work_orders'}).migration,'HOLD')],
 ['effective index cannot approve production',()=>assert.equal(assessV29IndexCatalog(row(4,3,1),{table:'ksh_car02_work_orders'}).productionReady,false)],
 ['QA probe table is allowed',()=>assert.equal(assessV29IndexCatalog(row(4,1,0),{table:'car02_v29_qa_index_probe'}).table,'car02_v29_qa_index_probe')],
 ['other table denied',()=>assert.throws(()=>assessV29IndexCatalog(row(),{table:'important_prod_table'}),/CATALOG_INVALID/)],
 ['negative count rejected',()=>assert.throws(()=>assessV29IndexCatalog(row(-1,0,0),{table:'ksh_car02_work_orders'}),/COUNT_INVALID/)],
 ['decimal rejected',()=>assert.throws(()=>assessV29IndexCatalog({...row(),index_count:2.5},{table:'ksh_car02_work_orders'}),/COUNT_INVALID/)],
 ['too large count rejected',()=>assert.throws(()=>assessV29IndexCatalog({...row(),index_count:'999999999999999999999'},{table:'ksh_car02_work_orders'}),/COUNT_INVALID/)],
 ['invalid schema result rejected',()=>assert.throws(()=>assessV29IndexCatalog({index_count:0},{table:'ksh_car02_work_orders'}),/CATALOG_INVALID/)],
 ['extra fields rejected',()=>assert.throws(()=>assessV29IndexCatalog({...row(),secret:'x'},{table:'ksh_car02_work_orders'}),/CATALOG_INVALID/)],
 ['candidate count greater than indexes denied',()=>assert.throws(()=>assessV29IndexCatalog(row(1,2,0),{table:'ksh_car02_work_orders'}),/CONTRADICTORY/)],
 ['effective count greater than candidates denied',()=>assert.throws(()=>assessV29IndexCatalog(row(2,1,2),{table:'ksh_car02_work_orders'}),/CONTRADICTORY/)],
 ['reader construction succeeds in QA only',()=>assert.equal(typeof init().inspect,'function')],
 ['reader production environment denied',()=>assert.throws(()=>init({environment:'production'}),/DISPOSABLE_ONLY/)],
 ['reader without explicit flag denied',()=>assert.throws(()=>init({allowDisposableQa:false}),/DISPOSABLE_ONLY/)],
 ['reader nonplain env rejected',()=>assert.throws(()=>init({env:process.env}),/DISPOSABLE_ONLY/)],
 ['reader wrong DB denied',()=>assert.throws(()=>init({pool:{...pool,options:{...options,database:'postgres'}}}),/DISPOSABLE_ONLY/)],
 ['reader different host denied',()=>assert.throws(()=>init({pool:{...pool,options:{...options,host:'db.example.com'}}}),/DISPOSABLE_ONLY/)],
 ['reader wrong port denied',()=>assert.throws(()=>init({pool:{...pool,options:{...options,port:6543}}}),/DISPOSABLE_ONLY/)],
 ['reader false release lock denied',()=>assert.throws(()=>init({env:{...expected,CAR02_RELEASE_LOCK:'false'}}),/DISPOSABLE_ONLY/)],
 ['reader forged github context denied',()=>assert.throws(()=>init({env:{...expected,GITHUB_ACTIONS:'false'}}),/DISPOSABLE_ONLY/)],
 ['reader passes only allowable table names',async()=>await assert.rejects(init().inspect('other_shop'),/TABLE_NOT_ALLOWED/)],
];
for(const [label,fn] of cases)test(label,fn);
