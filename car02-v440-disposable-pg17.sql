-- DPRO CAR02 V4.40: offline lost-ACK/stuck dispatching quarantine test.
-- ONLY PostgreSQL 17 disposable CI database. NEVER execute in real/shared Supabase.
-- This is independent from V4.39; it does not upgrade any real outbox.
\set ON_ERROR_STOP on
DO $$BEGIN IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'V440_PG17_ONLY'; END IF; END$$;
CREATE ROLE v440_anon NOLOGIN;
CREATE ROLE v440_authenticated NOLOGIN;
CREATE TABLE public.v440_qa_outbox (
 id uuid PRIMARY KEY,
 shop_code text NOT NULL CHECK(shop_code ~ '^[A-Za-z0-9_-]{1,64}$'),
 status text NOT NULL CHECK(status IN ('pending','dispatching','manual_review','delivered')),
 claim_token uuid UNIQUE,
 claimed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK ((status='pending' AND claim_token IS NULL AND claimed_at IS NULL)
     OR (status<>'pending' AND claim_token IS NOT NULL AND claimed_at IS NOT NULL))
);
REVOKE ALL ON public.v440_qa_outbox FROM PUBLIC,v440_anon,v440_authenticated;
CREATE FUNCTION public.v440_qa_claim_next(p_shop text,p_token uuid)
RETURNS TABLE(event_id uuid) LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[A-Za-z0-9_-]{1,64}$' OR p_token IS NULL
 THEN RAISE EXCEPTION 'V440_INVALID_CLAIM'; END IF;
 RETURN QUERY
 UPDATE public.v440_qa_outbox o SET status='dispatching',claim_token=p_token,
   claimed_at=clock_timestamp(),updated_at=clock_timestamp()
 FROM (SELECT id FROM public.v440_qa_outbox WHERE shop_code=p_shop AND status='pending'
       ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) pick
 WHERE o.id=pick.id AND o.shop_code=p_shop AND o.status='pending'
 RETURNING o.id;
END$$;
CREATE FUNCTION public.v440_qa_finish(p_shop text,p_event uuid,p_token uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE n integer;
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[A-Za-z0-9_-]{1,64}$' OR p_event IS NULL OR p_token IS NULL
 THEN RAISE EXCEPTION 'V440_INVALID_FINISH'; END IF;
 -- This is only a QA stand-in for an independently provider-verified ACK.
 -- NEVER connect directly to external provider without authenticated evidence.
 UPDATE public.v440_qa_outbox SET status='delivered',updated_at=clock_timestamp()
 WHERE shop_code=p_shop AND id=p_event AND claim_token=p_token AND status='dispatching'
 AND claimed_at > clock_timestamp()-interval '10 minutes'
 AND claimed_at <= clock_timestamp();
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN n=1;
END$$;
CREATE FUNCTION public.v440_qa_quarantine_next(p_shop text)
RETURNS TABLE(event_id uuid,review_state text) LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[A-Za-z0-9_-]{1,64}$'
 THEN RAISE EXCEPTION 'V440_INVALID_TENANT'; END IF;
 RETURN QUERY
 UPDATE public.v440_qa_outbox o SET status='manual_review',updated_at=clock_timestamp()
 FROM (SELECT id FROM public.v440_qa_outbox WHERE shop_code=p_shop AND status='dispatching'
   AND claimed_at <= clock_timestamp()-interval '10 minutes'
   ORDER BY claimed_at,id FOR UPDATE SKIP LOCKED LIMIT 1) pick
 WHERE o.id=pick.id AND o.shop_code=p_shop AND o.status='dispatching'
   AND o.claimed_at <= clock_timestamp()-interval '10 minutes'
 RETURNING o.id,o.status;
END$$;
CREATE FUNCTION public.v440_qa_status_counts(p_shop text)
RETURNS TABLE(status text,total bigint) LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[A-Za-z0-9_-]{1,64}$'
 THEN RAISE EXCEPTION 'V440_INVALID_TENANT'; END IF;
 RETURN QUERY SELECT all_states.state,COUNT(o.id)::bigint FROM
  (VALUES ('pending'),('dispatching'),('manual_review'),('delivered')) all_states(state)
 LEFT JOIN public.v440_qa_outbox o ON o.status=all_states.state AND o.shop_code=p_shop
 GROUP BY all_states.state ORDER BY all_states.state;
END$$;
REVOKE ALL ON FUNCTION public.v440_qa_claim_next(text,uuid),
 public.v440_qa_finish(text,uuid,uuid),public.v440_qa_quarantine_next(text),
 public.v440_qa_status_counts(text) FROM PUBLIC,v440_anon,v440_authenticated;
DO $$BEGIN
 IF has_table_privilege('v440_anon','public.v440_qa_outbox','SELECT') OR
  has_function_privilege('v440_anon','public.v440_qa_quarantine_next(text)','EXECUTE') OR
  has_function_privilege('v440_authenticated','public.v440_qa_finish(text,uuid,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'V440_PUBLIC_ACCESS_OPEN'; END IF;
END$$;
\echo V440_PG17_UNPRIVILEGED_DENY_PASS
INSERT INTO public.v440_qa_outbox(id,shop_code,status,claim_token,claimed_at) VALUES
 ('00000000-0000-0000-0000-000000004401','qa_shop_a','dispatching','00000000-0000-0000-0000-000000004411',clock_timestamp()-interval '15 minutes'),
 ('00000000-0000-0000-0000-000000004402','qa_shop_a','dispatching','00000000-0000-0000-0000-000000004412',clock_timestamp()-interval '2 minutes'),
 ('00000000-0000-0000-0000-000000004403','qa_shop_a','pending',NULL,NULL),
 ('00000000-0000-0000-0000-000000004404','qa_shop_b','dispatching','00000000-0000-0000-0000-000000004414',clock_timestamp()-interval '20 minutes');
DO $$DECLARE result text; BEGIN
 SELECT review_state INTO result FROM public.v440_qa_quarantine_next('qa_shop_a');
 IF result IS DISTINCT FROM 'manual_review' THEN RAISE EXCEPTION 'V440_EXPECTED_QUARANTINE'; END IF;
 IF (SELECT status FROM public.v440_qa_outbox WHERE id='00000000-0000-0000-0000-000000004401')<>'manual_review'
 THEN RAISE EXCEPTION 'V440_STALE_NOT_QUARANTINED'; END IF;
 IF (SELECT status FROM public.v440_qa_outbox WHERE id='00000000-0000-0000-0000-000000004402')<>'dispatching'
 THEN RAISE EXCEPTION 'V440_FRESH_CLAIM_QUARANTINED'; END IF;
 IF (SELECT status FROM public.v440_qa_outbox WHERE id='00000000-0000-0000-0000-000000004404')<>'dispatching'
 THEN RAISE EXCEPTION 'V440_OTHER_TENANT_CHANGED'; END IF;
END$$;
\echo V440_PG17_STALE_QUARANTINE_TENANT_ISOLATION_PASS
DO $$BEGIN
 IF public.v440_qa_finish('qa_shop_a','00000000-0000-0000-0000-000000004401',
 '00000000-0000-0000-0000-000000004411')
 THEN RAISE EXCEPTION 'V440_LATE_ACK_FLIPPED_MANUAL_REVIEW'; END IF;
 IF NOT public.v440_qa_finish('qa_shop_a','00000000-0000-0000-0000-000000004402',
 '00000000-0000-0000-0000-000000004412')
 THEN RAISE EXCEPTION 'V440_VALID_ACK_REJECTED'; END IF;
 IF public.v440_qa_finish('qa_shop_a','00000000-0000-0000-0000-000000004402',
 '00000000-0000-0000-0000-000000004412')
 THEN RAISE EXCEPTION 'V440_DUPLICATE_ACK_ACCEPTED'; END IF;
 IF public.v440_qa_finish('qa_shop_b','00000000-0000-0000-0000-000000004403',
 '00000000-0000-0000-0000-000000004413')
 THEN RAISE EXCEPTION 'V440_CROSS_TENANT_ACK'; END IF;
END$$;
\echo V440_PG17_LATE_ACK_NO_RESURRECTION_PASS
DO $$DECLARE r record; BEGIN
 SELECT * INTO r FROM public.v440_qa_status_counts('qa_shop_a') WHERE status='manual_review';
 IF r.total<>1 THEN RAISE EXCEPTION 'V440_MANUAL_REVIEW_COUNT'; END IF;
 SELECT * INTO r FROM public.v440_qa_status_counts('qa_shop_a') WHERE status='delivered';
 IF r.total<>1 THEN RAISE EXCEPTION 'V440_DELIVERED_COUNT'; END IF;
 IF (SELECT count(*) FROM public.v440_qa_status_counts('qa_shop_a'))<>4
 THEN RAISE EXCEPTION 'V440_COUNTS_INCOMPLETE'; END IF;
END$$;
\echo V440_PG17_TENANT_ONLY_STATE_COUNTS_PASS
-- Final concurrent quarantine verification is performed by Actions after inserting a new stale row.
