#!/usr/bin/env python3
"""R213: fail-closed adversarial proof and real output I/O QA, no DB access."""
from __future__ import annotations
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import car02_r212_parallel_replay_isolated as r

COMMIT='a'*40

def snap(index):
    return {name:format(index*200+j,'032x') for j,name in enumerate(r.TABLES)}

def example():
    records={}
    for i,name in enumerate(r.CASES):
        records[name]=dict(before=snap(2*i+1),afterCommit=snap(2*i+2),
            afterParallelIdentical=snap(2*i+2),afterParallelMixed=snap(2*i+2),
            identicalResults=['IDEMPOTENT']*8,
            mixedResults=['IDEMPOTENT' if n%2==0 else '22023:'+r.DENIALS[name] for n in range(8)],
            operationRows=0 if name=='booking' else 1,auditRows=1,
            firstServerCommitted=True,responseObserved=False)
        if i>0: records[name]['before']=copy.deepcopy(records[r.CASES[i-1]]['afterParallelMixed'])
    doc=dict(r.LOCK,githubCommit=COMMIT,cases=records,finalSnapshot=copy.deepcopy(records['decide']['afterParallelMixed']))
    doc['sha256']=r.seal(doc)
    return doc

class Contract(unittest.TestCase):
    def reject(self,doc,reseal=True):
        if reseal and 'sha256' in doc: doc['sha256']=r.seal(doc)
        with self.assertRaises(r.ParallelReplayError):r.validate_proof(doc)
    def test_valid(self):self.assertTrue(r.validate_proof(example()))
    def test_four_exact_cases(self):self.assertEqual(len(r.CASES),4)
    def test_8_parallel(self):self.assertEqual(r.N,8)
    def test_lock_prohibits_release(self):self.assertEqual(r.LOCK['release'],'NO_GO')
    def test_hold(self):self.assertEqual(r.LOCK['migration'],'HOLD')
    def test_no_external_witness(self):self.assertFalse(r.LOCK['externalWitnessVerified'])
    def test_no_production(self):self.assertFalse(r.LOCK['productionTouched'])
    def test_not_real_network(self):self.assertFalse(r.LOCK['realNetworkOutageVerified'])
    def test_missing_case(self):
        x=example();x['cases'].pop('quote');self.reject(x)
    def test_extra_case(self):
        x=example();x['cases']['secret']=x['cases']['booking'];self.reject(x)
    def test_wrong_case_type(self):
        x=example();x['cases']=[];self.reject(x)
    def test_missing_operation(self):
        x=example();x['cases']['quote'].pop('auditRows');self.reject(x)
    def test_extra_operation(self):
        x=example();x['cases']['quote']['fake']=True;self.reject(x)
    def test_wrong_commit(self):
        x=example();x['githubCommit']='g'*40;self.reject(x)
    def test_no_sha(self):
        x=example();x.pop('sha256');self.reject(x,False)
    def test_bad_sha(self):
        x=example();x['sha256']='f'*64;self.reject(x,False)
    def test_final_snapshot(self):
        x=example();x['finalSnapshot']=snap(100);self.reject(x)
    def test_missing_digest(self):
        x=example();x['cases']['move']['before'].pop('audit_events');self.reject(x)
    def test_hash_wrong_length(self):
        x=example();x['cases']['move']['before']['bookings']='a'*31;self.reject(x)
    def test_hash_wrong_char(self):
        x=example();x['cases']['move']['before']['bookings']='z'*32;self.reject(x)
    def test_hash_wrong_type(self):
        x=example();x['cases']['move']['before']['bookings']=None;self.reject(x)
    def test_no_mutation_for_replays(self):
        x=example();x['cases']['booking']['afterParallelIdentical']['bookings']='f'*32;self.reject(x)
    def test_no_mutation_for_conflicts(self):
        x=example();x['cases']['decide']['afterParallelMixed']['bookings']='f'*32;self.reject(x)
    def test_first_commit_is_real(self):
        x=example();x['cases']['booking']['afterCommit']=x['cases']['booking']['before'];self.reject(x)
    def test_snapshot_chain(self):
        x=example();x['cases']['quote']['before']=snap(999);self.reject(x)
    def test_correct_result_type(self):
        x=example();x['cases']['quote']['identicalResults']=[True]*8;self.reject(x)
    def test_mixed_results_exact(self):
        x=example();x['cases']['quote']['mixedResults'][1]='22023:BAD_REASON';self.reject(x)
    def test_mixed_results_count(self):
        x=example();x['cases']['quote']['mixedResults'][0]='22023:'+r.DENIALS['quote'];self.reject(x)
    def test_false_server_commit(self):
        x=example();x['cases']['quote']['firstServerCommitted']=False;self.reject(x)
    def test_false_client_observed(self):
        x=example();x['cases']['quote']['responseObserved']=True;self.reject(x)
    def test_bool_audit_cannot_pass(self):
        x=example();x['cases']['quote']['auditRows']=True;self.reject(x)
    def test_two_audits(self):
        x=example();x['cases']['quote']['auditRows']=2;self.reject(x)
    def test_two_operation_rows(self):
        x=example();x['cases']['move']['operationRows']=2;self.reject(x)
    def test_booking_has_no_op_record(self):
        x=example();x['cases']['booking']['operationRows']=1;self.reject(x)
    def test_production_ready_disallowed(self):
        x=example();x['productionReady']=True;self.reject(x)
    def test_false_real_rls(self):
        x=example();x['realRLSVerified']=True;self.reject(x)
    def test_false_real_auth(self):
        x=example();x['realAuthenticationVerified']=True;self.reject(x)
    def test_false_gates(self):
        x=example();x['realWorldGatesOpen']=0;self.reject(x)
    def test_output_str_forbidden(self):
        with self.assertRaises(r.ParallelReplayError):r.write_proof(example(),'a.json')
    def test_output_new_path_required(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'x.json';p.write_text('old')
            with self.assertRaises(r.ParallelReplayError):r.write_proof(example(),p)
    def test_output_file_roundtrip(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'x.json';r.write_proof(example(),p)
            self.assertTrue(r.validate_proof(json.loads(p.read_text('ascii'))))
    def test_output_symlink_parent_forbidden(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);folder=root/'real';folder.mkdir();(root/'link').symlink_to(folder,target_is_directory=True)
            with self.assertRaises(r.ParallelReplayError):r.write_proof(example(),root/'link'/'x.json')
    def test_parallel_eight_valid_without_database(self):
        results=r.parallel_calls('a'*12,'as',lambda:'IDEMPOTENT')
        self.assertEqual(results,['IDEMPOTENT']*8)
    def test_parallel_mixed_without_database(self):
        results=r.parallel_calls('a'*12,'as',lambda:'IDEMPOTENT',lambda:'22023:expected')
        self.assertEqual(results.count('IDEMPOTENT'),4)
        self.assertEqual(results.count('22023:expected'),4)
    def test_parallel_bad_actor(self):
        with self.assertRaises(r.ParallelReplayError):r.parallel_calls('a'*12,'postgres',lambda:'IDEMPOTENT')
    def test_parallel_bad_cid(self):
        with self.assertRaises(r.ParallelReplayError):r.parallel_calls('prod','as',lambda:'IDEMPOTENT')
    def test_parallel_not_callable(self):
        with self.assertRaises(r.ParallelReplayError):r.parallel_calls('a'*12,'as','IDEMPOTENT')
    def test_parallel_bad_incorrect(self):
        with self.assertRaises(r.ParallelReplayError):r.parallel_calls('a'*12,'as',lambda:'IDEMPOTENT','fake')
    def test_probe_environment_guard(self):
        with self.assertRaises(r.ParallelReplayError):r.probe('a'*12,COMMIT)
    def test_probe_commit_guard(self):
        with self.assertRaises(r.ParallelReplayError):r.probe('a'*12,'z'*40)
    def test_probe_cid_guard(self):
        with self.assertRaises(r.ParallelReplayError):r.probe('production',COMMIT)

# Each corrupted scenario produces a separate countable test with a precise name.
def make_variant(case,field,changed):
    def test(self):
        doc=example();doc['cases'][case][field]=changed
        self.reject(doc)
    return test
for case in r.CASES:
    for field,value in (
        ('identicalResults',['IDEMPOTENT']*7),
        ('mixedResults',['IDEMPOTENT']*8),
        ('operationRows',10),
        ('auditRows',0),
        ('firstServerCommitted',False),
        ('responseObserved',True),
    ):
        setattr(Contract,f'test_mutate_{case}_{field}',make_variant(case,field,value))

if __name__=='__main__':unittest.main()
