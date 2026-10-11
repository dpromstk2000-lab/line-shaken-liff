-- DPRO CAR02 R81 temporary PostgreSQL17 constraints & privilege QA; fully rolled back.
BEGIN;
DO $$ DECLARE r record; BEGIN
 SELECT c.relrowsecurity AS rls, c.relname INTO r
 FROM pg_class c WHERE c.oid='public.ksh_car02_owner_bootstrap_audit'::regclass;
 IF NOT r.rls THEN RAISE EXCEPTION 'R81_RLS_MISSING'; END IF;
 IF has_table_privilege('anon','public.ksh_car02_owner_bootstrap_audit','SELECT') OR
    has_table_privilege('authenticated','public.ksh_car02_owner_bootstrap_audit','INSERT') OR
    has_table_privilege('service_role','public.ksh_car02_owner_bootstrap_audit','DELETE') OR
    has_table_privilege('service_role','public.ksh_car02_owner_bootstrap_audit','UPDATE') THEN
    RAISE EXCEPTION 'R81_PRIVILEGE_DRIFT'; END IF;
 IF NOT has_table_privilege('service_role','public.ksh_car02_owner_bootstrap_audit','INSERT') THEN
    RAISE EXCEPTION 'R81_SERVICE_INSERT_MISSING'; END IF;
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='ksh_car02_owner_bootstrap_audit') <> 0 THEN
    RAISE EXCEPTION 'R81_BROWSER_POLICY_EXISTS'; END IF;
END $$;
INSERT INTO public.ksh_car02_owner_bootstrap_audit
 (shop_code,candidate_user_sub,request_id,reviewer_one_sub,reviewer_two_sub,reason)
 VALUES('street_house_kitsuki','22222222-2222-4222-8222-222222222222','44444444-4444-4444-8444-444444444444',
 '11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','Double verified offline reviewer approval');
DO $$ DECLARE rejected boolean:=false; BEGIN
 BEGIN
  INSERT INTO public.ksh_car02_owner_bootstrap_audit
  (shop_code,candidate_user_sub,request_id,reviewer_one_sub,reviewer_two_sub,reason)
  VALUES('street_house_kitsuki','22222222-2222-4222-8222-222222222222',
   '55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111',
   '33333333-3333-4333-8333-333333333333','Should be blocked duplicate bootstrap');
 EXCEPTION WHEN unique_violation THEN rejected:=true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'R81_DUPLICATE_BOOTSTRAP_ALLOWED'; END IF;
 rejected:=false;
 BEGIN
  INSERT INTO public.ksh_car02_owner_bootstrap_audit
  (shop_code,candidate_user_sub,request_id,reviewer_one_sub,reviewer_two_sub,reason)
  VALUES('other_shop','22222222-2222-4222-8222-222222222222',
   '66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111','Should block identical two reviewers');
 EXCEPTION WHEN check_violation THEN rejected:=true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'R81_DUPLICATE_REVIEWERS_ALLOWED'; END IF;
END $$;
ROLLBACK;
