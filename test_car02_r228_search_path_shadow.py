"""R228 negative evidence tests and isolated DB command shape (no DB connections)."""
from __future__ import annotations
import copy,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch,Mock
import car02_r227_search_path_shadow_isolated as r

COMMIT='a'*40
def snap(i):return {t:format(1000*i+k,'032x') for k,t in enumerate(r.TABLES)}
def example():
    records=[]
    for i in range(6):
        profile,actor=r.PROFILES[i//2],r.SHOPS[i%2]
        records.append({'profile':profile,'actor':actor,'key':'r227_shadow_'+profile+'_'+actor,
            'before':snap(i+1),'afterWrite':snap(i+2),'afterReplay':snap(i+2),
            'afterForeignDenial':snap(i+2),'firstResult':'CREATED','repeatResult':'IDEMPOTENT',
            'foreignSqlstate':'42501','foreignReason':'R138_OWNER_SHOP_MISMATCH','bookingRows':1,'auditRows':1})
    d=dict(r.LOCK,githubCommit=COMMIT,catalog=r.expected_catalog(),scenarios=records,finalSnapshot=snap(7))
    d['sha256']=r.seal(d);return d

class R228Tests(unittest.TestCase):
    def reject(self,d,reseal=True):
        if reseal and 'sha256' in d:d['sha256']=r.seal(d)
        with self.assertRaises(r.ShadowError):r.verify_report(d)
    def test_good(self):self.assertTrue(r.verify_report(example()))
    def test_profiles(self):self.assertEqual(len(r.PROFILES),3)
    def test_actor_count(self):self.assertEqual(r.SHOPS,('as','bs'))
    def test_function_count(self):self.assertEqual(len(r.EXPECTED_FUNCS),4)
    def test_no_production(self):self.assertEqual(r.LOCK['release'],'NO_GO')
    def test_hold(self):self.assertEqual(r.LOCK['migration'],'HOLD')
    def test_gates(self):self.assertEqual(r.LOCK['realWorldGatesOpen'],12)
    def test_extra_field(self):
        d=example();d['isAdmin']=True;self.reject(d)
    def test_missing_hash(self):
        d=example();del d['sha256'];self.reject(d,False)
    def test_corrupt_digest(self):
        d=example();d['sha256']='f'*64;self.reject(d,False)
    def test_snapshot_chain(self):
        d=example();d['scenarios'][3]['before']=snap(90);self.reject(d)
    def test_snapshot_bypass(self):
        d=example();d['scenarios'][0]['afterReplay']=snap(90);self.reject(d)
    def test_final_mismatch(self):
        d=example();d['finalSnapshot']=snap(50);self.reject(d)
    def test_strict_digest(self):
        d=example();d['sha256']=0;self.reject(d,False)
    def test_catalog_owner(self):
        d=example();d['catalog'][0]['owner']='attacker';self.reject(d)
    def test_catalog_definer(self):
        d=example();d['catalog'][1]['definer']=False;self.reject(d)
    def test_catalog_search_path(self):
        d=example();d['catalog'][2]['config']=['search_path=public'];self.reject(d)
    def test_catalog_overload(self):
        d=example();d['catalog'].append(copy.deepcopy(d['catalog'][0]));self.reject(d)
    def test_output_new_file(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'proof.json';self.assertEqual(r.save(example(),p),p)
            self.assertEqual(json.loads(p.read_text()),example())
            with self.assertRaises(r.ShadowError):r.save(example(),p)
    def test_no_output_parent(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(r.ShadowError):r.save(example(),Path(td)/'missing'/'proof.json')
    def test_temp_shadow_names(self):
        for profile in r.PROFILES:
            x=r.profile_prefix(profile)
            self.assertIn('CREATE TEMP TABLE bookings',x)
            self.assertIn('CREATE TEMP TABLE audit_events',x)
            self.assertIn('SET search_path',x)
    def test_pg_temp_profile(self):self.assertIn('pg_temp,public,pg_catalog',r.profile_prefix('temp_shadow'))
    def test_jwt_spoof_profile(self):self.assertIn('request.jwt.claims',r.profile_prefix('jwt_spoof'))
    def test_unknown_profile_denied(self):
        with self.assertRaises(r.ShadowError):r.profile_prefix('production')
    def test_shell_user_is_disposable(self):
        with patch.object(r.subprocess,'run',return_value=Mock(returncode=0,stdout='CREATED\n',stderr='')) as run:
            self.assertEqual(r.strict_sql('a'*16,'as','SELECT car02_r138_qa.claim_booking(1,2,3,4);'),'CREATED')
            cmd=run.call_args.args[0]
            self.assertIn(r.DB,cmd);self.assertIn(r.ROLES['as'],cmd)
            self.assertNotIn('postgres',cmd)
    def test_bad_container(self):
        with self.assertRaises(r.ShadowError):r.strict_sql('not-a-container','as','SELECT car02_r138_qa.claim_booking(1);')
    def test_bad_actor(self):
        with self.assertRaises(r.ShadowError):r.strict_sql('a'*16,'super','SELECT car02_r138_qa.claim_booking(1);')
    def test_probe_mocked_complete_flow(self):
        import hashlib,os
        empty=dict.fromkeys(r.TABLES,hashlib.md5(b'[]').hexdigest())
        chain=[snap(i) for i in range(2,8)]
        snapshots=[empty]
        for i in range(6): snapshots.extend([empty if i==0 else chain[i-1],chain[i],chain[i],chain[i]])
        snapshots.append(chain[-1])
        calls=[]
        def fake_call(cid,actor,sql,expect='CREATED'):
            calls.append((actor,sql,expect))
            return {'CREATED':'CREATED','IDEMPOTENT':'IDEMPOTENT','DENIED':'42501'}[expect]
        with tempfile.TemporaryDirectory() as td:
            folder=Path(td)/'qa-evidence-r227';folder.mkdir()
            cwd=os.getcwd()
            env={'GITHUB_SHA':COMMIT,'CAR02_RELEASE_LOCK':'true','R227_DISPOSABLE_QA':'yes'}
            try:
                os.chdir(td)
                with patch.dict(os.environ,env),patch.object(r,'snapshot',side_effect=snapshots) as sn,\
                     patch.object(r,'pg_catalog',return_value=r.expected_catalog()),\
                     patch.object(r,'strict_sql',side_effect=fake_call),\
                     patch.object(r,'next_business_days',return_value=['2026-11-02']),\
                     patch.object(r,'integer',return_value=1):
                    doc=r.probe('a'*16,COMMIT)
                    self.assertTrue(r.verify_report(doc))
                    self.assertEqual(sn.call_count,len(snapshots))
                    self.assertEqual(len(calls),18)
                    self.assertTrue((folder/'r227-shadow-proof.json').exists())
            finally:os.chdir(cwd)
    def test_no_admin_role(self):self.assertNotIn('postgres',r.ROLES.values())
    def test_no_executable_production_url(self):self.assertNotIn('SUPABASE_URL',Path(r.__file__).read_text())

# Generate strictly negative tests against every proof cell, not just digest checks.
for _i in range(6):
    for _field,_wrong in [
        ('profile','different'),('actor','postgres'),('key','replayed_key'),
        ('firstResult','SLOT_TAKEN'),('repeatResult','CREATED'),
        ('foreignSqlstate','00000'),('foreignReason','IDEMPOTENT'),
        ('bookingRows',2),('auditRows',2),('afterWrite',snap(100+_i)),
        ('afterForeignDenial',snap(200+_i))]:
        def gen(i=_i,field=_field,wrong=_wrong):
            def check(self):
                d=example();d['scenarios'][i][field]=wrong;self.reject(d)
            return check
        setattr(R228Tests,f'test_mutation_{_i}_{_field}',gen())
for _field,_wrong in [('realAuthenticationVerified',True),('productionTouched',True),
                      ('productionAuthorized',True),('realSqlInjectionVerified',True),
                      ('functionsCatalogChecked',False),('shadowProfiles',4),('expectedScenarios',5),
                      ('syntheticOnly',False),('realWorldGatesOpen',0),('productionReady',True)]:
    def gen(field=_field,wrong=_wrong):
        def check(self):
            d=example();d[field]=wrong;self.reject(d)
        return check
    setattr(R228Tests,'test_lock_mutation_'+_field,gen())
if __name__=='__main__':unittest.main()
