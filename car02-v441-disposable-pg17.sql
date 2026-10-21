-- CAR02 V4.41: synthetic, append-only review log. Disposable PG17 only.
-- NEVER deploy to real/shared Supabase. No real login, real LINE, secrets, or customer data.
\set ON_ERROR_STOP on
DO $$BEGIN IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'V441_DISPOSABLE_PG17_REQUIRED'; END IF; END$$;
CREATE ROLE v441_anon NOLOGIN;
CREATE ROLE v441_authenticated NOLOGIN;
CREATE TABLE public.v441_qa_outbox (
 shop_code text NOT NULL CHECK(shop_code ~ '^[A-Za-z0-9_-]{1,64}$'),
 id uuid NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','dispatching','manual_review','delivered')),
 PRIMARY KEY(shop_code,id)
);
CREATE TABLE public.v441_qa_review_audit (
 shop_code text NOT NULL, event_id uuid NOT NULL, reviewer_sub uuid NOT NULL,
 evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 disposition text NOT NULL CHECK(disposition IN ('investigated','escalated')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(shop_code,event_id,reviewer_sub),
 FOREIGN KEY(shop_code,event_id) REFERENCES public.v441_qa_outbox(shop_code,id) ON DELETE RESTRICT
);
REVOKE ALL ON public.v441_qa_outbox,public.v441_qa_review_audit FROM PUBLIC,v441_anon,v441_authenticated;
CREATE FUNCTION public.v441_qa_reject_review_edit() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 BEGIN RAISE EXCEPTION 'V441_IMMUTABLE_REVIEW'; END$$;
CREATE TRIGGER v441_no_review_mutation BEFORE UPDATE OR DELETE ON public.v441_qa_review_audit
 FOR EACH ROW EXECUTE FUNCTION public.v441_qa_reject_review_edit();
-- This reviewer identity is a synthetic trusted SERVER argument in QA only; no production identity is proven.
CREATE FUNCTION public.v441_qa_record_review(
 p_shop text,p_event uuid,p_reviewer uuid,p_evidence text,p_disposition text)
RETURNS TABLE(stored boolean,review_count bigint)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE case_state text; existing bigint;
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[A-Za-z0-9_-]{1,64}$' OR p_event IS NULL OR p_reviewer IS NULL OR
    p_evidence IS NULL OR p_evidence !~ '^[a-f0-9]{64}$' OR
    p_disposition IS NULL OR p_disposition NOT IN ('investigated','escalated')
 THEN RAISE EXCEPTION 'V441_INVALID_REVIEW'; END IF;
 SELECT o.status INTO case_state FROM public.v441_qa_outbox o
  WHERE o.shop_code=p_shop AND o.id=p_event FOR UPDATE;
 IF NOT FOUND OR case_state<>'manual_review' THEN RAISE EXCEPTION 'V441_REVIEW_NOT_AVAILABLE'; END IF;
 SELECT count(*) INTO existing FROM public.v441_qa_review_audit a
  WHERE a.shop_code=p_shop AND a.event_id=p_event;
 IF EXISTS(SELECT 1 FROM public.v441_qa_review_audit a
     WHERE a.shop_code=p_shop AND a.event_id=p_event AND a.reviewer_sub=p_reviewer) THEN
   RETURN QUERY SELECT false,existing; RETURN;
 END IF;
 IF existing>=2 THEN RAISE EXCEPTION 'V441_MAX_DISTINCT_REVIEWERS'; END IF;
 INSERT INTO public.v441_qa_review_audit(shop_code,event_id,reviewer_sub,evidence_sha256,disposition)
 VALUES(p_shop,p_event,p_reviewer,p_evidence,p_disposition);
 RETURN QUERY SELECT true,(existing+1)::bigint;
END$$;
CREATE FUNCTION public.v441_qa_review_summary(p_shop text,p_event uuid)
RETURNS TABLE(review_count bigint,status text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[A-Za-z0-9_-]{1,64}$' OR p_event IS NULL
 THEN RAISE EXCEPTION 'V441_INVALID_SUMMARY'; END IF;
 RETURN QUERY SELECT count(a.reviewer_sub)::bigint,o.status FROM public.v441_qa_outbox o
  LEFT JOIN public.v441_qa_review_audit a ON a.shop_code=o.shop_code AND a.event_id=o.id
  WHERE o.shop_code=p_shop AND o.id=p_event GROUP BY o.status;
END$$;
REVOKE ALL ON FUNCTION public.v441_qa_record_review(text,uuid,uuid,text,text),
 public.v441_qa_review_summary(text,uuid), public.v441_qa_reject_review_edit() FROM PUBLIC,v441_anon,v441_authenticated;
DO $$BEGIN
 IF has_table_privilege('v441_anon','public.v441_qa_review_audit','INSERT') OR
    has_table_privilege('v441_authenticated','public.v441_qa_outbox','UPDATE') OR
    has_function_privilege('v441_anon','public.v441_qa_record_review(text,uuid,uuid,text,text)','EXECUTE') OR
    has_function_privilege('v441_authenticated','public.v441_qa_review_summary(text,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'V441_PUBLIC_REVIEW_ACCESS_OPEN'; END IF;
END$$;
\echo V441_DISPOSABLE_PG17_UNPRIVILEGED_DENY_PASS
INSERT INTO public.v441_qa_outbox VALUES
 ('qa_shop_a','00000000-0000-0000-0000-000000004401','manual_review'),
 ('qa_shop_a','00000000-0000-0000-0000-000000004402','delivered'),
 ('qa_shop_b','00000000-0000-0000-0000-000000004403','manual_review'),
 ('qa_shop_a','00000000-0000-0000-0000-000000004404','manual_review');
DO $$DECLARE r record; BEGIN
 SELECT * INTO r FROM public.v441_qa_record_review('qa_shop_a','00000000-0000-0000-0000-000000004401',
  '00000000-0000-0000-0000-000000004411',repeat('a',64),'investigated');
 IF r.stored IS DISTINCT FROM true OR r.review_count<>1 THEN RAISE EXCEPTION 'V441_FIRST_AUDIT_FAILED';END IF;
 SELECT * INTO r FROM public.v441_qa_record_review('qa_shop_a','00000000-0000-0000-0000-000000004401',
  '00000000-0000-0000-0000-000000004411',repeat('b',64),'escalated');
 IF r.stored IS DISTINCT FROM false OR r.review_count<>1 THEN RAISE EXCEPTION 'V441_SAME_REVIEWER_DUPLICATED';END IF;
 SELECT * INTO r FROM public.v441_qa_record_review('qa_shop_a','00000000-0000-0000-0000-000000004401',
  '00000000-0000-0000-0000-000000004412',repeat('c',64),'escalated');
 IF r.stored IS DISTINCT FROM true OR r.review_count<>2 THEN RAISE EXCEPTION 'V441_SECOND_AUDIT_FAILED'; END IF;
 IF (SELECT status FROM public.v441_qa_outbox WHERE id='00000000-0000-0000-0000-000000004401')<>'manual_review'
 THEN RAISE EXCEPTION 'V441_REVIEW_MARKED_DELIVERED'; END IF;
END$$;
\echo V441_DISPOSABLE_PG17_DISTINCT_REVIEWERS_APPEND_ONLY_PASS
DO $$DECLARE message text;BEGIN
 BEGIN
  PERFORM * FROM public.v441_qa_record_review('qa_shop_b','00000000-0000-0000-0000-000000004401',
   '00000000-0000-0000-0000-000000004413',repeat('d',64),'escalated');
  RAISE EXCEPTION 'UNEXPECTED_CROSS_TENANT_ACCEPTED';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
  IF message<>'V441_REVIEW_NOT_AVAILABLE' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM * FROM public.v441_qa_record_review('qa_shop_a','00000000-0000-0000-0000-000000004402',
   '00000000-0000-0000-0000-000000004413',repeat('d',64),'investigated');
  RAISE EXCEPTION 'UNEXPECTED_DELIVERED_CASE_ACCEPTED';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
  IF message<>'V441_REVIEW_NOT_AVAILABLE' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM * FROM public.v441_qa_record_review('qa_shop_a','00000000-0000-0000-0000-000000004401',
   '00000000-0000-0000-0000-000000004413',repeat('d',64),'investigated');
  RAISE EXCEPTION 'UNEXPECTED_THIRD_REVIEWER_ACCEPTED';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
  IF message<>'V441_MAX_DISTINCT_REVIEWERS' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM * FROM public.v441_qa_record_review('qa_shop_a','00000000-0000-0000-0000-000000004401',
   '00000000-0000-0000-0000-000000004413',repeat('d',64),'delivered');
  RAISE EXCEPTION 'UNEXPECTED_STATUS_CHANGE_REQUEST_ACCEPTED';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
  IF message<>'V441_INVALID_REVIEW' THEN RAISE; END IF;
 END;
 IF (SELECT count(*) FROM public.v441_qa_review_audit)<>2 THEN RAISE EXCEPTION 'V441_DENIAL_INSERTED_AUDIT';END IF;
END$$;
\echo V441_DISPOSABLE_PG17_TENANT_DELIVERED_THIRD_REJECT_PASS
DO $$DECLARE message text; BEGIN
 BEGIN
  UPDATE public.v441_qa_review_audit SET evidence_sha256=repeat('e',64);
  RAISE EXCEPTION 'UNEXPECTED_AUDIT_EDIT';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
  IF message<>'V441_IMMUTABLE_REVIEW' THEN RAISE; END IF;
 END;
 BEGIN
  DELETE FROM public.v441_qa_review_audit;
  RAISE EXCEPTION 'UNEXPECTED_AUDIT_DELETE';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
  IF message<>'V441_IMMUTABLE_REVIEW' THEN RAISE; END IF;
 END;
 IF (SELECT count(*) FROM public.v441_qa_review_audit)<>2 THEN RAISE EXCEPTION 'V441_AUDIT_MUTATED';END IF;
 IF (SELECT review_count FROM public.v441_qa_review_summary('qa_shop_a','00000000-0000-0000-0000-000000004401'))<>2
 THEN RAISE EXCEPTION 'V441_AUDIT_SUMMARY_COUNT';END IF;
END$$;
\echo V441_DISPOSABLE_PG17_IMMUTABLE_AUDIT_AND_SUMMARY_PASS
-- The GitHub Action races eight callers with the same reviewer against event 4404.
