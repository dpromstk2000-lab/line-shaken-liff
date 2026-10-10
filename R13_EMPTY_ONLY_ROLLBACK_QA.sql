-- RECOVERY ONLY: KSH CAR-02 ONLY. NEVER use if CAR02 contains data, or any dependent objects exist.
-- This is not a substitute for a complete database backup. Manual review before use.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='45s';
DO $rollback$
DECLARE t text; n bigint;
BEGIN
 FOR t IN SELECT unnest(ARRAY['ksh_car02_work_orders','ksh_car02_reports','ksh_car02_photos',
   'ksh_car02_quotes','ksh_car02_decisions','ksh_car02_events',
   'ksh_car02_operations','ksh_car02_notification_outbox']) LOOP
  IF to_regclass('public.'||t) IS NULL THEN
   RAISE EXCEPTION 'CAR02_ROLLBACK_INCOMPLETE_SCHEMA_STOP';
  END IF;
  EXECUTE format('SELECT count(*) FROM public.%I',t) INTO n;
  IF n<>0 THEN RAISE EXCEPTION 'CAR02_ROLLBACK_TABLE_NOT_EMPTY %',t; END IF;
 END LOOP;
END $rollback$;
-- DROP TABLE defaults to RESTRICT; never CASCADE into other systems.
DROP TABLE public.ksh_car02_notification_outbox;
DROP TABLE public.ksh_car02_operations;
DROP TABLE public.ksh_car02_events;
DROP TABLE public.ksh_car02_decisions;
DROP TABLE public.ksh_car02_quotes;
DROP TABLE public.ksh_car02_photos;
DROP TABLE public.ksh_car02_reports;
DROP TABLE public.ksh_car02_work_orders;
DROP FUNCTION public.ksh_car02_guard_quote_lifecycle();
DROP FUNCTION public.ksh_car02_guard_decision();
DROP FUNCTION public.ksh_car02_guard_work_order();
DROP FUNCTION public.ksh_car02_guard_event();
DROP FUNCTION public.ksh_car02_guard_quote_scope();
DROP FUNCTION public.ksh_car02_report_locked(uuid);
DROP FUNCTION public.ksh_car02_guard_report_evidence();
DROP FUNCTION public.ksh_car02_guard_report();
DROP FUNCTION public.ksh_car02_guard_final_quote();
DROP FUNCTION public.ksh_car02_photos_capacity_guard();
DROP FUNCTION public.ksh_car02_guard_order_identity();
DROP FUNCTION public.ksh_car02_assert_order_scope();
COMMIT;
-- PHOTO BUCKET: do not delete bucket without verifying storage.objects is empty and
-- downloading all needed photo files. Bucket cleanup must be separate and approved.
