#!/usr/bin/env python3
"""R186: adversarial R185 proof, GUC, role, count and output tests; no database."""
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import car02_r185_rls_session_spoof_isolated as r

COMMIT='f'*40

def sample():
    counts={a:dict.fromkeys(r.TABLES,0) for a in r.ACTORS}
    for a in ('a1','a2','b1'):
        counts[a]={t:(2 if t=='bookings' else 3 if t=='audit_events' else 1) for t in r.TABLES}
    for table in r.TABLES:
        counts['as'][table]=counts['a1'][table]+counts['a2'][table]
        counts['bs'][table]=counts['b1'][table]
    spoof={a+':'+p:{'currentUser':r.ROLES[a], 'sessionUser':r.ROLES[a],
           'tables':counts[a].copy()} for a in r.ACTORS for p in r.PROFILES}
    snap={t:'a'*32 for t in r.TABLES}
    doc=dict(r.LOCK,githubCommit=COMMIT,baseline=counts,spoofReadbacks=spoof,
             fiveTableBefore=snap,fiveTableAfter=snap.copy())
    doc['sha256']=r.seal(doc)
    return doc

def reseal(doc):
    doc['sha256']=r.seal({k:v for k,v in doc.items() if k!='sha256'})
    return doc

class R186Proof(unittest.TestCase):
    def reject(self, doc):
        with self.assertRaises(r.R185Error):r.verify_report(reseal(doc))
    def test_good(self):self.assertTrue(r.verify_report(sample()))
    def test_roundtrip(self):self.assertTrue(r.verify_report(json.loads(json.dumps(sample()))))
    def test_bad_sha_without_reseal(self):
        d=sample();d['sha256']='0'*64
        with self.assertRaises(r.R185Error):r.verify_report(d)
    def test_sha_missing(self):
        d=sample();del d['sha256']
        with self.assertRaises(r.R185Error):r.verify_report(d)
    def test_new_field(self):d=sample();d['productionReady']=True;self.reject(d)
    def test_missing_field(self):d=sample();del d['fixtureRoles'];self.reject(d)
    def test_commit_wrong(self):d=sample();d['githubCommit']='A'*40;self.reject(d)
    def test_commit_short(self):d=sample();d['githubCommit']='f'*39;self.reject(d)
    def test_baseline_missing_role(self):d=sample();del d['baseline']['a2'];self.reject(d)
    def test_baseline_extra_role(self):d=sample();d['baseline']['postgres']=d['baseline']['a1'];self.reject(d)
    def test_baseline_missing_table(self):d=sample();del d['baseline']['a2']['bookings'];self.reject(d)
    def test_baseline_unknown_table(self):d=sample();d['baseline']['a2']['secrets']=1;self.reject(d)
    def test_baseline_bool(self):d=sample();d['baseline']['b1']['bookings']=True;self.reject(d)
    def test_baseline_negative(self):d=sample();d['baseline']['a1']['bookings']=-1;self.reject(d)
    def test_baseline_empty(self):d=sample();d['baseline']['a1']['bookings']=0;self.reject(d)
    def test_staff_parity_wrong(self):d=sample();d['baseline']['as']['bookings']+=1;self.reject(d)
    def test_b_shop_parity_wrong(self):d=sample();d['baseline']['bs']['service_cases']+=1;self.reject(d)
    def test_spoof_missing(self):d=sample();del d['spoofReadbacks']['a1:jwt_admin'];self.reject(d)
    def test_spoof_extra(self):d=sample();d['spoofReadbacks']['a1:new']={};self.reject(d)
    def test_spoof_wrong_shape(self):d=sample();d['spoofReadbacks']['a1:jwt_admin']['bad']=1;self.reject(d)
    def test_spoof_missing_table(self):d=sample();del d['spoofReadbacks']['a1:jwt_admin']['tables']['audit_events'];self.reject(d)
    def test_spoof_wrong_current_user(self):d=sample();d['spoofReadbacks']['a1:jwt_admin']['currentUser']='postgres';self.reject(d)
    def test_spoof_wrong_session_user(self):d=sample();d['spoofReadbacks']['a1:jwt_admin']['sessionUser']=r.ROLES['as'];self.reject(d)
    def test_fake_pg_proof(self):d=sample();d['fixtureDb']='production';self.reject(d)
    def test_snapshot_missing(self):d=sample();del d['fiveTableAfter']['audit_events'];self.reject(d)
    def test_snapshot_drift(self):d=sample();d['fiveTableAfter']['audit_events']='b'*32;self.reject(d)
    def test_snapshot_fake(self):d=sample();d['fiveTableAfter']['audit_events']='x'*32;self.reject(d)
    def test_snapshot_bool(self):d=sample();d['fiveTableAfter']['audit_events']=True;self.reject(d)
    def test_file_roundtrip(self):
        with tempfile.TemporaryDirectory() as td:
            dest=Path(td)/'proof.json';r.safe_write(sample(),dest)
            self.assertTrue(r.verify_report(json.loads(dest.read_text(encoding='ascii'))))
    def test_file_exists(self):
        with tempfile.TemporaryDirectory() as td:
            dest=Path(td)/'proof.json';r.safe_write(sample(),dest)
            with self.assertRaises(r.R185Error):r.safe_write(sample(),dest)
    def test_file_missing_parent(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(r.R185Error):r.safe_write(sample(),Path(td)/'missing'/'proof.json')
    def test_file_symlink(self):
        with tempfile.TemporaryDirectory() as td:
            target=Path(td)/'real.json';target.write_text('preserved')
            link=Path(td)/'link.json';link.symlink_to(target)
            with self.assertRaises(r.R185Error):r.safe_write(sample(),link)
            self.assertEqual(target.read_text(),'preserved')
    def test_bad_probe_output_blocks_db(self):
        with self.assertRaises(r.R185Error):r.probe('a'*12,COMMIT,'/tmp/real.json')
    def test_bad_probe_cid_blocks_db(self):
        with self.assertRaises(r.R185Error):r.probe('production',COMMIT)
    def test_bad_probe_env_blocks_db(self):
        with patch.dict(os.environ,{'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'false','R185_DISPOSABLE_QA':'yes'}):
            with self.assertRaises(r.R185Error):r.probe('a'*12,COMMIT)
    def test_unknown_actor_blocks_sql(self):
        with self.assertRaises(r.R185Error):r.session_read('a'*12,'postgres','jwt_admin','bookings')
    def test_unknown_profile_blocks_sql(self):
        with self.assertRaises(r.R185Error):r.session_read('a'*12,'a1','production','bookings')
    def test_unknown_table_blocks_sql(self):
        with self.assertRaises(r.R185Error):r.session_read('a'*12,'a1','jwt_admin','private')
    def test_session_sql_good(self):
        mock=Mock(returncode=0,stdout='BEGIN\nSET\nR185_ROW|'+r.ROLES['a1']+'|'+r.ROLES['a1']+'|1\nCOMMIT\n',stderr='')
        with patch.object(r.subprocess,'run',return_value=mock) as patched:
            result=r.session_read('a'*12,'a1','other_shop','bookings')
            self.assertEqual(result['value'],1)
            self.assertIn('car02_r138_qa.bookings',patched.call_args.args[0][-1])
            self.assertIn('set_config',patched.call_args.args[0][-1])
    def test_session_sql_two_records(self):
        line='R185_ROW|'+r.ROLES['a1']+'|'+r.ROLES['a1']+'|1\n'
        with patch.object(r.subprocess,'run',return_value=Mock(returncode=0,stdout=line*2,stderr='')):
            with self.assertRaises(r.R185Error):r.session_read('a'*12,'a1','jwt_admin','bookings')
    def test_session_sql_wrong_role(self):
        line='R185_ROW|postgres|postgres|1\n'
        with patch.object(r.subprocess,'run',return_value=Mock(returncode=0,stdout=line,stderr='')):
            with self.assertRaises(r.R185Error):r.session_read('a'*12,'a1','jwt_admin','bookings')
    def test_session_sql_command_failure(self):
        with patch.object(r.subprocess,'run',return_value=Mock(returncode=1,stdout='',stderr='permission denied')):
            with self.assertRaises(r.R185Error):r.session_read('a'*12,'a1','jwt_admin','bookings')
    def test_session_sql_noninteger(self):
        line='R185_ROW|'+r.ROLES['a1']+'|'+r.ROLES['a1']+'|nan\n'
        with patch.object(r.subprocess,'run',return_value=Mock(returncode=0,stdout=line,stderr='')):
            with self.assertRaises(r.R185Error):r.session_read('a'*12,'a1','jwt_admin','bookings')

def gate_case(k):
    def run(self):
        d=sample();d[k]= (not d[k] if type(d[k]) is bool else 'GO');self.reject(d)
    return run
for key in sorted(r.LOCK):
    setattr(R186Proof,'test_release_gate_'+key,gate_case(key))

def spoof_case(actor,profile,table):
    def run(self):
        d=sample();d['spoofReadbacks'][actor+':'+profile]['tables'][table]+=1;self.reject(d)
    return run
for actor in r.ACTORS:
    for profile in r.PROFILES:
        for table in r.TABLES:
            setattr(R186Proof,'test_spoof_tamper_'+actor+'_'+profile+'_'+table,
                    spoof_case(actor,profile,table))

if __name__=='__main__':unittest.main()
