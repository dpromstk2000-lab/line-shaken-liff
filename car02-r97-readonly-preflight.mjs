// CAR02 R97 repository-only audit: never changes application code or a backend.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {R93T_APPROVED_BASELINE,auditCar02R93TSourceContracts} from './car02-r93t-release-readiness-audit.mjs';
import {verifyR96Workflow} from './car02-r96-workflow-readonly-guard.mjs';
import {validateR97SourceBaseline,assembleR97Report,assertR97NeverApprovesProduction} from './car02-r97-product-readiness.mjs';

export function runR97ReadOnlyPreflight(read=path=>readFileSync(path,'utf8')){
 const names=Object.keys(R93T_APPROVED_BASELINE);
 const sources=Object.fromEntries(names.map(n=>[n,read(n)]));
 const sourceStatus=validateR97SourceBaseline(sources,R93T_APPROVED_BASELINE);
 const integration=auditCar02R93TSourceContracts(sources);
 const template=JSON.parse(read('CAR02_R97_CUSTOMER_INTAKE_TEMPLATE.json'));
 const playbook=read('CAR02_R97_ORDER_TO_GO_LIVE_PLAYBOOK.txt');
 assert.ok(playbook.length>1600&&playbook.includes('R47')&&playbook.includes('R52')&&
  playbook.includes('NO_GO')&&playbook.includes('HOLD')&&playbook.includes('R90 JSON')&&
  playbook.includes('Supabase')&&playbook.includes('LINE'),'R97_PLAYBOOK_INCOMPLETE');
 const prior=verifyR96Workflow(read('.github/workflows/car02-r96-backup-corruption-recovery-qa.yml'));
 assert.equal(prior.release,'NO_GO');assert.equal(prior.migration,'HOLD');
 const report=assembleR97Report({sourceStatus,integration,intake:template,
  playbookReady:true,githubEvidence:'R96_GITHUB_ACTIONS_SUCCESS_38191039794'});
 assertR97NeverApprovesProduction(report);
 assert.equal(report.intake.intakeInformationComplete,false,'R97_TEMPLATE_MUST_BE_UNFILLED');
 assert.equal(report.intake.pending.length,13,'R97_TEMPLATE_EXPECTED_EMPTY');
 return report;
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const report=runR97ReadOnlyPreflight();
 console.log(JSON.stringify(report,null,2));
 console.log('R97_PRODUCT_READINESS_SOURCE_ONLY_NO_GO_HOLD_PASS');
}
