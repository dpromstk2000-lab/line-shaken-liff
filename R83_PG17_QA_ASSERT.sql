-- R83 disposable PostgreSQL 17 semantic assertions; ALL mutations below ROLLBACK.
DO $$
DECLARE v integer; t record;
BEGIN
 IF current_database() !~ '^car02_r83_qa_[a-z0-9_]{1,48}$' THEN
   RAISE EXCEPTION 'CAR02_R83_ISOLATION_REQUIRED'; END IF;
 SELECT c.relrowsecurity AS rls INTO t FROM pg_class c WHERE c.oid='public.ksh_car02_photos'::regclass;
 IF NOT t.rls THEN RAISE EXCEPTION 'R83_RLS_MISSING'; END IF;
 SELECT c.relrowsecurity AS rls INTO t FROM pg_class c WHERE c.oid='public.ksh_car02_staff_access'::regclass;
 IF NOT t.rls THEN RAISE EXCEPTION 'R83_STAFF_RLS_MISSING'; END IF;
 IF has_table_privilege('anon','public.ksh_car02_photos','SELECT') OR
    has_table_privilege('authenticated','public.ksh_car02_photos','INSERT') OR
    has_table_privilege('anon','public.ksh_car02_staff_access','SELECT') OR
    NOT has_table_privilege('service_role','public.ksh_car02_photos','INSERT') THEN
   RAISE EXCEPTION 'R83_PRIVILEGE_DRIFT'; END IF;
 IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename IN
   ('ksh_car02_photos','ksh_car02_staff_access')) THEN
   RAISE EXCEPTION 'R83_BROWSER_RLS_POLICY_EXISTS'; END IF;
 SELECT count(*) INTO v FROM public.ksh_car02_work_orders o
   JOIN public.ksh_car02_reports r ON r.work_order_id=o.id
   WHERE o.id='11111111-1111-4111-8111-111111111111'
     AND o.shop_code='street_house_kitsuki'
     AND r.id='22222222-2222-4222-8222-222222222222';
 IF v<>1 THEN RAISE EXCEPTION 'R83_SCOPE_SELECT_MISSING'; END IF;
 SELECT count(*) INTO v FROM public.ksh_car02_work_orders o
   JOIN public.ksh_car02_reports r ON r.work_order_id=o.id
   WHERE o.id='11111111-1111-4111-8111-111111111111'
     AND o.shop_code='other_shop'
     AND r.id='22222222-2222-4222-8222-222222222222';
 IF v<>0 THEN RAISE EXCEPTION 'R83_CROSS_TENANT_SCOPE_BROKEN'; END IF;
 SELECT count(*) INTO v FROM public.ksh_car02_photos p
   JOIN public.ksh_car02_reports r ON r.id=p.report_id
   JOIN public.ksh_car02_work_orders o ON o.id=r.work_order_id
   WHERE p.id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     AND o.shop_code='street_house_kitsuki';
 IF v<>0 THEN RAISE EXCEPTION 'R83_CROSS_TENANT_PHOTO_VISIBLE'; END IF;
 SELECT count(*) INTO v FROM public.ksh_car02_photos
   WHERE report_id='22222222-2222-4222-8222-222222222222'
     AND upload_state IN ('pending','ready');
 IF v<>2 THEN RAISE EXCEPTION 'R83_ACTIVE_QUOTA_COUNT_WRONG'; END IF;
 SELECT count(*) INTO v FROM public.ksh_car02_staff_access
   WHERE shop_code='street_house_kitsuki' AND
     user_sub='33333333-3333-4333-8333-333333333333' AND active AND staff_role='staff';
 IF v<>1 THEN RAISE EXCEPTION 'R83_STAFF_MEMBERSHIP_UNVERIFIED'; END IF;
 -- Check real PostgreSQL 17 FOR UPDATE syntax used by the R83 code.
 PERFORM o.id FROM public.ksh_car02_work_orders o
   JOIN public.ksh_car02_reports r ON r.work_order_id=o.id
   WHERE o.id='11111111-1111-4111-8111-111111111111'
     AND o.shop_code='street_house_kitsuki'
     AND r.id='22222222-2222-4222-8222-222222222222'
   FOR UPDATE OF o,r;
 PERFORM p.id FROM public.ksh_car02_work_orders o
   JOIN public.ksh_car02_reports r ON r.work_order_id=o.id
   JOIN public.ksh_car02_photos p ON p.report_id=r.id
   WHERE p.id='44444444-4444-4444-8444-444444444444'
     AND o.shop_code='street_house_kitsuki' FOR UPDATE OF o,r,p;
END $$;

BEGIN;
DO $$ DECLARE rejected boolean:=false; changed integer;
BEGIN
 BEGIN
  INSERT INTO public.ksh_car02_photos(report_id,storage_bucket,storage_path,mime_type,byte_size,sha256)
    VALUES('22222222-2222-4222-8222-222222222222','ksh-car02-private-photos',
      'street_house_kitsuki/order/report/photo1.png','image/png',100,repeat('f',64));
 EXCEPTION WHEN unique_violation THEN rejected:=true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'R83_DUPLICATE_STORAGE_PATH_ALLOWED'; END IF;
 rejected:=false;
 BEGIN
  INSERT INTO public.ksh_car02_photos(report_id,storage_bucket,storage_path,mime_type,byte_size,sha256)
    VALUES('22222222-2222-4222-8222-222222222222','public',
      'street_house_kitsuki/order/report/forbidden.png','image/png',100,repeat('f',64));
 EXCEPTION WHEN check_violation THEN rejected:=true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'R83_PUBLIC_BUCKET_ALLOWED'; END IF;
 rejected:=false;
 BEGIN
  INSERT INTO public.ksh_car02_photos(report_id,storage_bucket,storage_path,mime_type,byte_size,sha256)
    VALUES('22222222-2222-4222-8222-222222222222','ksh-car02-private-photos',
      'street_house_kitsuki/order/report/oversize.png','image/png',5242881,repeat('f',64));
 EXCEPTION WHEN check_violation THEN rejected:=true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'R83_OVERSIZE_ALLOWED'; END IF;
 UPDATE public.ksh_car02_photos SET upload_state='ready'
   WHERE id='44444444-4444-4444-8444-444444444444' AND upload_state='pending';
 GET DIAGNOSTICS changed = ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'R83_READY_TRANSITION_FAILED'; END IF;
 UPDATE public.ksh_car02_photos SET upload_state='ready'
   WHERE id='44444444-4444-4444-8444-444444444444' AND upload_state='pending';
 GET DIAGNOSTICS changed = ROW_COUNT;
 IF changed<>0 THEN RAISE EXCEPTION 'R83_SECOND_READY_TRANSITION_NOT_IDEMPOTENT'; END IF;
END $$;
ROLLBACK;
DO $$ BEGIN
 IF (SELECT upload_state FROM public.ksh_car02_photos
     WHERE id='44444444-4444-4444-8444-444444444444')<>'pending' THEN
   RAISE EXCEPTION 'R83_TEST_MUTATION_NOT_ROLLED_BACK'; END IF;
END $$;
\echo 'R83_PG17_ISOLATED_QA_PASS: RLS, privileges, tenant scope, locks, quota, constraints, rollback'
