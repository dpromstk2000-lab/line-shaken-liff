import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditR94AWorkflow,WORKFLOW} from './car02-r94a-workflow-readonly-guard.mjs';
const y=readFileSync(new URL(WORKFLOW,`file://${process.cwd()}/`),'utf8');
test('approved workflow is read-only and disposable only',()=>{
 const r=auditR94AWorkflow(y);assert.equal(r.ok,true);
 assert.equal(r.release,'NO_GO');assert.equal(r.migration,'HOLD');
});
for(const [name,text,where] of [
 ['deploy','wrangler deploy','before'],
 ['Supabase mutation','supabase db push','before'],
 ['secrets access','${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}','before'],
 ['write permissions','contents: write','before'],
 ['production URL','https://test.supabase.co','before'],
 ['unexpected action','uses: actions/upload-artifact@v4','before'],
 ['workflow push','  push:','before'],
 ['steps after final guard','      - name: Production deploy\n        run: echo unsafe','after'],
]){
 test(`forbid ${name}`,()=>{
  const match='      - name: Final R94A immutable read-only safety gate';
  const altered=where==='after'?y+'\n'+text:y.replace(match,'      - name: Injected\n        '+(name==='unexpected action'?text:'run: '+text)+'\n'+match);
  assert.throws(()=>auditR94AWorkflow(altered));
 });
}
