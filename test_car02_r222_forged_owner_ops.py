#!/usr/bin/env python3
"""R222: adversarial evidence tests, full-file I/O, and denied-command safety."""
import copy, json, os, tempfile, unittest
from pathlib import Path
from unittest.mock import Mock,patch
import car02_r221_forged_owner_ops_isolated as r
COMMIT='f'*40

def snap(n):return {table:format(n*1000+i,'032x') for i,table in enumerate(r.TABLES)}
def sample():
    stages={}
    for i,name in enumerate(r.STAGES):
        stages[name]=dict(before=snap(i+1),afterDenied=snap(i+1),afterAuthorized=snap(i+2),
             attacks=[dict(actor=r.ATTACKERS[name][j%2],sqlstate='42501',reason=r.REASONS[name][j%2]) for j in range(8)],
             authorizedResult=r.AUTHORIZED[name],operationRows=1,auditRows=1,
             finalState={'move':'ACTIVE','cancel':'CANCELLED','decision':'APPROVED','report':'REPORTED'}[name])
    x=dict(r.LOCK,githubCommit=COMMIT,stages=stages,finalSnapshot=snap(5));x['sha256']=r.seal(x);return x

class R222(unittest.TestCase):
    def reject(self,x,rehash=True):
        if rehash and 'sha256' in x:x['sha256']=r.seal(x)
        with self.assertRaises(r.ForgeryError):r.verify_report(x)
    def test_valid(self):self.assertTrue(r.verify_report(sample()))
    def test_four_stages(self):self.assertEqual(len(r.STAGES),4)
    def test_eight_attackers(self):self.assertEqual(r.N,8)
    def test_only_disposable(self):self.assertEqual(r.LOCK['fixtureDb'],'car02_r138_qa_ci')
    def test_no_go(self):self.assertEqual(r.LOCK['release'],'NO_GO')
    def test_hold(self):self.assertEqual(r.LOCK['migration'],'HOLD')
    def test_no_production(self):self.assertFalse(r.LOCK['productionTouched'])
    def test_sha_wrong(self):
        x=sample();x['sha256']='0'*64;self.reject(x,False)
    def test_sha_missing(self):
        x=sample();del x['sha256'];self.reject(x,False)
    def test_digest_altered(self):
        x=sample();x['stages']['move']['before']['bookings']='0'*32;self.reject(x)
    def test_missing_stage(self):
        x=sample();del x['stages']['cancel'];self.reject(x)
    def test_extra_stage(self):
        x=sample();x['stages']['extra']=x['stages']['move'];self.reject(x)
    def test_missing_commit(self):
        x=sample();del x['githubCommit'];self.reject(x)
    def test_bad_commit(self):
        x=sample();x['githubCommit']='z'*40;self.reject(x)
    def test_final_not_last(self):
        x=sample();x['finalSnapshot']=snap(99);self.reject(x)
    def test_save_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            dst=Path(tmp)/'evidence.json';r.save(sample(),dst)
            self.assertTrue(r.verify_report(json.loads(dst.read_text())))
    def test_existing_file_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            dst=Path(tmp)/'evidence.json';dst.write_text('existing')
            with self.assertRaises(r.ForgeryError):r.save(sample(),dst)
            self.assertEqual(dst.read_text(),'existing')
    def test_output_parent_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(r.ForgeryError):r.save(sample(),Path(tmp)/'missing'/'f.json')
    def test_bad_destination_type(self):
        with self.assertRaises(r.ForgeryError):r.save(sample(),'evidence.json')
    def test_parallel_denied_exact_eight(self):
        with patch.object(r,'denied',side_effect=lambda cid,actor,sql,reason:{'actor':actor,'sqlstate':'42501','reason':reason}) as fn:
            rows=r.parallel_denials('f'*12,'move',lambda:'SELECT car02_r138_qa.change_booking(1);')
        self.assertEqual(len(rows),8);self.assertEqual(fn.call_count,8)
    def test_parallel_denied_rejects_unknown(self):
        with self.assertRaises(r.ForgeryError):r.parallel_denials('f'*12,'UNKNOWN',lambda:'foo')
    def test_parallel_denied_rejects_not_callable(self):
        with self.assertRaises(r.ForgeryError):r.parallel_denials('f'*12,'move','foo')
    def test_denied_must_reject_sql(self):
        with self.assertRaises(r.ForgeryError):r.denied('f'*12,'a2','DELETE FROM bookings;','R138_OWNER_DENIED')
    def test_denied_refuses_unknown_role(self):
        with self.assertRaises(r.ForgeryError):r.denied('f'*12,'admin','SELECT car02_r138_qa.change_booking(1);','R138_OWNER_DENIED')
    def test_denied_refuses_unknown_reason(self):
        with self.assertRaises(r.ForgeryError):r.denied('f'*12,'a2','SELECT car02_r138_qa.change_booking(1);','UNSAFE')
    def test_denied_exact_sqlstate(self):
        ok=Mock(returncode=1,stderr='ERROR: 42501: R138_OWNER_DENIED\n')
        with patch.object(r.subprocess,'run',return_value=ok):
            self.assertEqual(r.denied('f'*12,'a2','SELECT car02_r138_qa.change_booking(1);','R138_OWNER_DENIED')['sqlstate'],'42501')
    def test_denied_wrong_state(self):
        ok=Mock(returncode=1,stderr='ERROR: 22023: R138_OWNER_DENIED\n')
        with patch.object(r.subprocess,'run',return_value=ok):
            with self.assertRaises(r.ForgeryError):r.denied('f'*12,'a2','SELECT car02_r138_qa.change_booking(1);','R138_OWNER_DENIED')
    def test_denied_wrong_reason(self):
        ok=Mock(returncode=1,stderr='ERROR: 42501: R138_CASE_NOT_FOUND\n')
        with patch.object(r.subprocess,'run',return_value=ok):
            with self.assertRaises(r.ForgeryError):r.denied('f'*12,'a2','SELECT car02_r138_qa.change_booking(1);','R138_OWNER_DENIED')
    def test_denied_unexpected_success(self):
        ok=Mock(returncode=0,stderr='')
        with patch.object(r.subprocess,'run',return_value=ok):
            with self.assertRaises(r.ForgeryError):r.denied('f'*12,'a2','SELECT car02_r138_qa.change_booking(1);','R138_OWNER_DENIED')
    def test_env_guard_prevents_production(self):
        with patch.dict(os.environ,{},clear=True):
            with self.assertRaises(r.ForgeryError):r.probe('f'*12,'f'*40)

for stage in r.STAGES:
    for variant in range(2):
        def test(self,stage=stage,variant=variant):
            x=sample();x['stages'][stage]['attacks'][variant]['reason']='R138_BAD_COMMAND';self.reject(x)
        setattr(R222,f'test_{stage}_wrong_reason_{variant}',test)
        def test(self,stage=stage,variant=variant):
            x=sample();x['stages'][stage]['attacks'][variant]['actor']='as';self.reject(x)
        setattr(R222,f'test_{stage}_spoofed_actor_{variant}',test)
        def test(self,stage=stage,variant=variant):
            x=sample();x['stages'][stage]['attacks'][variant]['sqlstate']='22023';self.reject(x)
        setattr(R222,f'test_{stage}_wrong_state_{variant}',test)
    for field,value in [('operationRows',2),('auditRows',0),('authorizedResult','IDEMPOTENT'),('finalState','OPEN')]:
        def test(self,stage=stage,field=field,value=value):
            x=sample();x['stages'][stage][field]=value;self.reject(x)
        setattr(R222,f'test_{stage}_altered_{field}',test)
    def test(self,stage=stage):
        x=sample();x['stages'][stage]['afterDenied']=snap(98);self.reject(x)
    setattr(R222,f'test_{stage}_denied_mutation',test)
    def test(self,stage=stage):
        x=sample();x['stages'][stage]['afterAuthorized']=x['stages'][stage]['afterDenied'];self.reject(x)
    setattr(R222,f'test_{stage}_missing_authorized_write',test)

if __name__=='__main__':unittest.main()
