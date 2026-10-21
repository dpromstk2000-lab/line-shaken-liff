-- DPRO CAR02 V4.46: REVIEW-ONLY synthetic post-commit generation-bound login registry.
-- DISPOSABLE PostgreSQL 17 ONLY. NO Supabase/Auth/Worker/customer/production connection.
-- These server-owned "trusted login" records are TEST FIXTURES, NOT real provider proofs.
\set ON_ERROR_STOP on
DO $$BEGIN IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'V446_DISPOSABLE_PG17_ONLY'; END IF; END$$;
CREATE ROLE v446_anon NOLOGIN;
CREATE ROLE v446_authenticated NOLOGIN;
CREATE TABLE public.v446_qa_staff (
 shop_code text NOT NULL CHECK (shop_code ~ '^[A-Za-z0-9_-]{1,64}$'),
 user_sub uuid NOT NULL, active boolean NOT NULL, staff_role text NOT NULL CHECK(staff_role IN ('staff','owner')),
 auth_version integer NOT NULL CHECK(auth_version>0), generation_nonce uuid NOT NULL,
 PRIMARY KEY(shop_code,user_sub)
);
CREATE TABLE public.v446_qa_provider_login_fixtures (
 login_id uuid PRIMARY KEY, shop_code text NOT NULL, user_sub uuid NOT NULL,
 session_id uuid NOT NULL UNIQUE, token_sha256 text NOT NULL CHECK(token_sha256 ~ '^[a-f0-9]{64}$'),
 bound_auth_version integer NOT NULL, bound_nonce uuid NOT NULL, active boolean NOT NULL,
 UNIQUE(shop_code,user_sub,session_id)
);
REVOKE ALL ON public.v446_qa_staff,public.v446_qa_provider_login_fixtures
 FROM PUBLIC,v446_anon,v446_authenticated;
-- Synthetic provider-attestation check: an OLD signed JWT by itself cannot enroll
-- in a new membership version without a matching fresh trusted login event.
CREATE FUNCTION public.v446_qa_read_bound_login(
 p_shop text,p_sub uuid,p_session uuid,p_tokenhash text)
RETURNS TABLE(staff_role text,auth_version integer,generation_nonce uuid,login_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT m.staff_role,m.auth_version,m.generation_nonce,e.login_id
 FROM public.v446_qa_staff m JOIN public.v446_qa_provider_login_fixtures e
 ON e.shop_code=m.shop_code AND e.user_sub=m.user_sub
 WHERE m.shop_code=p_shop AND m.user_sub=p_sub AND m.active=true
  AND e.active=true AND e.session_id=p_session AND e.token_sha256=p_tokenhash
  AND e.bound_auth_version=m.auth_version AND e.bound_nonce=m.generation_nonce
$$;
CREATE FUNCTION public.v446_qa_lock_bound_login(
 p_shop text,p_sub uuid,p_session uuid,p_tokenhash text)
RETURNS TABLE(staff_role text,auth_version integer,generation_nonce uuid,login_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 RETURN QUERY
 SELECT m.staff_role,m.auth_version,m.generation_nonce,e.login_id
 FROM public.v446_qa_staff m JOIN public.v446_qa_provider_login_fixtures e
 ON e.shop_code=m.shop_code AND e.user_sub=m.user_sub
 WHERE m.shop_code=p_shop AND m.user_sub=p_sub AND m.active=true
  AND e.active=true AND e.session_id=p_session AND e.token_sha256=p_tokenhash
  AND e.bound_auth_version=m.auth_version AND e.bound_nonce=m.generation_nonce
 FOR UPDATE OF m,e;
END$$;
REVOKE ALL ON FUNCTION public.v446_qa_read_bound_login(text,uuid,uuid,text),
 public.v446_qa_lock_bound_login(text,uuid,uuid,text)
 FROM PUBLIC,v446_anon,v446_authenticated;
DO $$BEGIN
 IF has_table_privilege('v446_authenticated','public.v446_qa_staff','SELECT') OR
    has_table_privilege('v446_anon','public.v446_qa_provider_login_fixtures','INSERT') OR
    has_function_privilege('v446_authenticated','public.v446_qa_read_bound_login(text,uuid,uuid,text)','EXECUTE') OR
    has_function_privilege('v446_anon','public.v446_qa_lock_bound_login(text,uuid,uuid,text)','EXECUTE')
 THEN RAISE EXCEPTION 'V446_PUBLIC_PROOF_ACCESS_OPEN'; END IF;
END$$;
\echo V446_PG17_UNPRIVILEGED_PROVIDER_PROOF_DENY_PASS
INSERT INTO public.v446_qa_staff VALUES
 ('qa_shop_a','00000000-0000-0000-0000-000000004461',true,'staff',1,'00000000-0000-0000-0000-000000004464'),
 ('qa_shop_b','00000000-0000-0000-0000-000000004461',true,'staff',1,'00000000-0000-0000-0000-000000004464');
INSERT INTO public.v446_qa_provider_login_fixtures VALUES
 ('00000000-0000-0000-0000-000000004466','qa_shop_a','00000000-0000-0000-0000-000000004461',
  '00000000-0000-0000-0000-000000004462','4c5b5bbdfdd15a4add21867c1969559183873343a77ae1a4c15327a0c3ac41c7',1,
  '00000000-0000-0000-0000-000000004464',true);
DO $$DECLARE n int;BEGIN
 SELECT COUNT(*) INTO n FROM public.v446_qa_read_bound_login('qa_shop_a','00000000-0000-0000-0000-000000004461',
  '00000000-0000-0000-0000-000000004462','4c5b5bbdfdd15a4add21867c1969559183873343a77ae1a4c15327a0c3ac41c7');
 IF n<>1 THEN RAISE EXCEPTION 'V446_INITIAL_TRUSTED_LOGIN_MISSING'; END IF;
 SELECT COUNT(*) INTO n FROM public.v446_qa_lock_bound_login('qa_shop_b','00000000-0000-0000-0000-000000004461',
  '00000000-0000-0000-0000-000000004462','4c5b5bbdfdd15a4add21867c1969559183873343a77ae1a4c15327a0c3ac41c7');
 IF n<>0 THEN RAISE EXCEPTION 'V446_CROSS_SHOP_BOUNDARY_FAILURE'; END IF;
END$$;
\echo V446_PG17_INITIAL_MATCH_AND_CROSS_TENANT_DENY_PASS
-- A rolled-back membership change does NOT revoke the old authentic session.
BEGIN;
UPDATE public.v446_qa_staff SET active=false,auth_version=2,generation_nonce='00000000-0000-0000-0000-000000004465'
 WHERE shop_code='qa_shop_a' AND user_sub='00000000-0000-0000-0000-000000004461';
ROLLBACK;
DO $$BEGIN
 IF (SELECT count(*) FROM public.v446_qa_read_bound_login('qa_shop_a',
 '00000000-0000-0000-0000-000000004461','00000000-0000-0000-0000-000000004462',
 '4c5b5bbdfdd15a4add21867c1969559183873343a77ae1a4c15327a0c3ac41c7'))<>1
 THEN RAISE EXCEPTION 'V446_ROLLBACK_INVALIDATED_LIVE_LOGIN'; END IF;
END$$;
\echo V446_PG17_ROLLBACK_PRESERVES_CURRENT_GENERATION_PASS
-- Stop staff and durably COMMIT before any new event is entered.
BEGIN;
UPDATE public.v446_qa_staff SET active=false,auth_version=2,generation_nonce='00000000-0000-0000-0000-000000004465'
 WHERE shop_code='qa_shop_a' AND user_sub='00000000-0000-0000-0000-000000004461' AND auth_version=1;
COMMIT;
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM public.v446_qa_read_bound_login('qa_shop_a',
 '00000000-0000-0000-0000-000000004461','00000000-0000-0000-0000-000000004462',
 '4c5b5bbdfdd15a4add21867c1969559183873343a77ae1a4c15327a0c3ac41c7'))
 THEN RAISE EXCEPTION 'V446_REVOKED_STAFF_STILL_VALID'; END IF;
END$$;
\echo V446_PG17_COMMITTED_REVOKE_INVALIDATES_OLD_LOGIN_PASS
BEGIN;
UPDATE public.v446_qa_staff SET active=true,auth_version=3,generation_nonce='00000000-0000-0000-0000-000000004467'
 WHERE shop_code='qa_shop_a' AND user_sub='00000000-0000-0000-0000-000000004461' AND auth_version=2;
COMMIT;
-- Old signed JWT and old login event remain intact, but MUST still be rejected.
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM public.v446_qa_read_bound_login('qa_shop_a',
 '00000000-0000-0000-0000-000000004461','00000000-0000-0000-0000-000000004462',
 '4c5b5bbdfdd15a4add21867c1969559183873343a77ae1a4c15327a0c3ac41c7'))
 THEN RAISE EXCEPTION 'V446_OLD_SIGNIN_RESURRECTED_AFTER_REACTIVATE'; END IF;
END$$;
\echo V446_PG17_REACTIVATION_REJECTS_OLD_PROVIDER_LOGIN_PASS
-- Synthetic trusted new-login fixture is inserted AFTER both membership commits.
INSERT INTO public.v446_qa_provider_login_fixtures VALUES
 ('00000000-0000-0000-0000-000000004468','qa_shop_a','00000000-0000-0000-0000-000000004461',
  '00000000-0000-0000-0000-000000004463','e0fbf939a45f888617cf4c26986609c5424068257b125c9ea15106869120bacb',3,
  '00000000-0000-0000-0000-000000004467',true);
DO $$DECLARE n int;BEGIN
 SELECT count(*) INTO n FROM public.v446_qa_lock_bound_login('qa_shop_a',
 '00000000-0000-0000-0000-000000004461','00000000-0000-0000-0000-000000004463',
 'e0fbf939a45f888617cf4c26986609c5424068257b125c9ea15106869120bacb');
 IF n<>1 THEN RAISE EXCEPTION 'V446_FRESH_LOGIN_NOT_BOUND_TO_COMMITTED_GENERATION'; END IF;
 SELECT count(*) INTO n FROM public.v446_qa_read_bound_login('qa_shop_a',
 '00000000-0000-0000-0000-000000004461','00000000-0000-0000-0000-000000004463',
 '4c5b5bbdfdd15a4add21867c1969559183873343a77ae1a4c15327a0c3ac41c7');
 IF n<>0 THEN RAISE EXCEPTION 'V446_WRONG_TOKEN_HASH_ACCEPTED'; END IF;
 IF (SELECT auth_version FROM public.v446_qa_staff WHERE shop_code='qa_shop_b')<>1
 THEN RAISE EXCEPTION 'V446_NEIGHBOR_SHOP_MUTATED'; END IF;
END$$;
\echo V446_PG17_FRESH_FIXTURE_AUTHENTICATED_ONLY_AFTER_COMMIT_PASS
-- End-user provider session proof remains a required UNIMPLEMENTED adapter.
