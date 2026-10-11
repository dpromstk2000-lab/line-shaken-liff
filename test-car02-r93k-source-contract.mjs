import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {R93K_CONTRACT} from './car02-r93k-r83-repository-bridge-isolated.mjs';
const r83=readFileSync(new URL('./car02-pg-photo-repository-r83.mjs',import.meta.url),'utf8');
const r93h=readFileSync(new URL('./car02-r93h-upload-compensation-isolated.mjs',import.meta.url),'utf8');
const r93k=readFileSync(new URL('./car02-r93k-r83-repository-bridge-isolated.mjs',import.meta.url),'utf8');
const r93i=readFileSync(new URL('./car02-r93i-r47-safe-bridge-isolated.mjs',import.meta.url),'utf8');
const conditions=[
 ['R83 database is isolated to distinct naming',r83.includes("^car02_r83_qa_")],
 ['R93H database is isolated to distinct naming',r93h.includes("^car02_r93h_qa_")],
 ['R93K holds its own isolated namespace',r93k.includes("^car02_r93k_qa_")],
 ['R83 reserve result only id',r83.includes('return Object.freeze({id:row.id})')],
 ['R83 markReady returns object',r83.includes("return Object.freeze({id:photoId,state:'ready'})")],
 ['R93H reserve expects photoId + pending',r93h.includes('r.photoId')&&r93h.includes("r.state!=='pending'")],
 ['R93H markReady strictly Boolean',r93h.includes('ready!==true')],
 ['R83 getPending metadata exists',r83.includes('async getPending(')],
 ['R83 legacy cancel exists',r83.includes('async cancel(')],
 ['R83 legacy cancel does not enqueue durable outbox',!r83.includes('tombstoneAndEnqueue')],
 ['R93K never calls legacy cancel',!r93k.includes('r83Port.cancel(')],
 ['R93K requires atomic compensation port',r93k.includes('atomicCompensationPort.tombstoneAndEnqueue(')],
 ['R93K checks pending metadata',r93k.includes('r83Port.getPending(')],
 ['R93H requires durable outbox on uncertain upload',r93h.includes('repository.tombstoneAndEnqueue(')],
 ['R93I accepts repository injection',r93i.includes('dbName.replace(\'r93i\',\'r93h\'),repository,storage')],
 ['R93K not live',R93K_CONTRACT.liveWiring===false],
 ['R93K migration pending',R93K_CONTRACT.r83ProductionMigrationNotReviewed===true],
 ['R93K database names are not falsely considered compatible',R93K_CONTRACT.r83AndR93hDatabaseNamesCurrentlyIncompatible===true],
 ['R93K will not claim transactional adapter is done',R93K_CONTRACT.transactionalAdapterNotYetImplemented===true],
 ['R93K keeps release held',R93K_CONTRACT.releaseDecision==='NO_GO'&&R93K_CONTRACT.migrationDecision==='HOLD']
];
for(const [label,pass] of conditions)test('Source contract — '+label,()=>assert.equal(pass,true));
