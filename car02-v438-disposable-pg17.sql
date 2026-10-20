-- DPRO CAR02 V4.38 — DISPOSABLE PostgreSQL 17 only; independent synthetic QA schema.
-- NEVER RUN on production/shared Supabase/real customer data. No R13 migration.
\set ON_ERROR_STOP on
DO $$BEGIN IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'V438_PG17_ONLY'; END IF; END$$;
CREATE ROLE v438_anon NOLOGIN;
CREATE ROLE v438_authenticated NOLOGIN;
CREATE TABLE public.v438_qa_orders (
 shop_code text NOT NULL, id uuid NOT NULL, state_version integer NOT NULL CHECK (state_version >= 1),
 PRIMARY KEY(shop_code,id)
);
CREATE TABLE public.v438_qa_receipts (
 shop_code text NOT NULL, actor_sub uuid NOT NULL, request_key uuid NOT NULL, order_id uuid NOT NULL,
 expected_version integer NOT NULL CHECK (expected_version >= 1),
 new_version integer NOT NULL CHECK (new_version = expected_version + 1),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(shop_code,actor_sub,request_key)
);
REVOKE ALL ON public.v438_qa_orders,public.v438_qa_receipts FROM PUBLIC,v438_anon,v438_authenticated;
-- Server-side QA-only function. Privileges are not a replacement for identity verification.
CREATE FUNCTION public.v438_qa_apply_touch(p_shop text,p_actor uuid,p_key uuid,p_order uuid,p_expected integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER AS $$
DECLARE r public.v438_qa_receipts%ROWTYPE; new_v integer;
BEGIN
 IF p_shop IS NULL OR length(p_shop) NOT BETWEEN 1 AND 256 OR btrim(p_shop)<>p_shop OR
    p_actor IS NULL OR p_key IS NULL OR p_order IS NULL OR p_expected IS NULL OR
    p_expected<1 OR p_expected>=2147483647 THEN RAISE EXCEPTION 'V438_INVALID_INPUT'; END IF;
 -- Serialize ALL calls sharing the same tenant+actor+key (hash collisions only over-serialize).
 PERFORM pg_advisory_xact_lock(hashtextextended(p_shop||'|'||p_actor::text||'|'||p_key::text,0));
 SELECT * INTO r FROM public.v438_qa_receipts
  WHERE shop_code=p_shop AND actor_sub=p_actor AND request_key=p_key FOR UPDATE;
 IF FOUND THEN
   IF r.order_id IS DISTINCT FROM p_order OR r.expected_version IS DISTINCT FROM p_expected
     THEN RAISE EXCEPTION 'V438_IDEMPOTENCY_INTENT_CONFLICT'; END IF;
   RETURN jsonb_build_object('shopCode',p_shop,'actorSub',p_actor::text,'requestKey',p_key::text,
     'id',p_order::text,'expectedVersion',r.expected_version,'newVersion',r.new_version,'replayed',true);
 END IF;
 UPDATE public.v438_qa_orders SET state_version=state_version+1
  WHERE shop_code=p_shop AND id=p_order AND state_version=p_expected RETURNING state_version INTO new_v;
 IF NOT FOUND THEN RAISE EXCEPTION 'V438_TENANT_OR_VERSION_CONFLICT'; END IF;
 INSERT INTO public.v438_qa_receipts(shop_code,actor_sub,request_key,order_id,expected_version,new_version)
 VALUES (p_shop,p_actor,p_key,p_order,p_expected,new_v);
 RETURN jsonb_build_object('shopCode',p_shop,'actorSub',p_actor::text,'requestKey',p_key::text,
   'id',p_order::text,'expectedVersion',p_expected,'newVersion',new_v,'replayed',false);
END$$;
REVOKE ALL ON FUNCTION public.v438_qa_apply_touch(text,uuid,uuid,uuid,integer) FROM PUBLIC,v438_anon,v438_authenticated;
DO $$BEGIN
 IF has_function_privilege('v438_anon','public.v438_qa_apply_touch(text,uuid,uuid,uuid,integer)','EXECUTE') OR
    has_function_privilege('v438_authenticated','public.v438_qa_apply_touch(text,uuid,uuid,uuid,integer)','EXECUTE') OR
    has_table_privilege('v438_anon','public.v438_qa_receipts','SELECT') OR
    has_table_privilege('v438_authenticated','public.v438_qa_orders','UPDATE')
 THEN RAISE EXCEPTION 'V438_UNPRIVILEGED_ACCESS'; END IF;
END$$;
\echo V438_PG17_UNPRIVILEGED_ROLES_DENIED_PASS
INSERT INTO public.v438_qa_orders VALUES
 ('qa_shop_a','00000000-0000-0000-0000-000000004381',1),
 ('qa_shop_b','00000000-0000-0000-0000-000000004382',1),
 ('qa_shop_a','00000000-0000-0000-0000-000000004383',1);
SELECT public.v438_qa_apply_touch('qa_shop_a','00000000-0000-0000-0000-000000004391',
 '00000000-0000-0000-0000-000000004388','00000000-0000-0000-0000-000000004381',1);
DO $$BEGIN
 IF (SELECT state_version FROM public.v438_qa_orders WHERE shop_code='qa_shop_a' AND id='00000000-0000-0000-0000-000000004381')<>2 OR
    (SELECT COUNT(*) FROM public.v438_qa_receipts)<>1 THEN RAISE EXCEPTION 'V438_FIRST_COMMIT_MISSING';END IF;
END$$;
-- Reuse the exact key/intent: must return replay=true and NEVER increment the order twice.
DO $$DECLARE v jsonb;BEGIN
 v=public.v438_qa_apply_touch('qa_shop_a','00000000-0000-0000-0000-000000004391',
 '00000000-0000-0000-0000-000000004388','00000000-0000-0000-0000-000000004381',1);
 IF v->>'replayed'<>'true' OR (SELECT state_version FROM public.v438_qa_orders WHERE shop_code='qa_shop_a' AND id='00000000-0000-0000-0000-000000004381')<>2
 THEN RAISE EXCEPTION 'V438_IDEMPOTENT_REPLAY_FAILED'; END IF;
END$$;
\echo V438_PG17_DURABLE_RECEIPT_REPLAY_PASS
DO $$DECLARE err text;BEGIN
 BEGIN
  PERFORM public.v438_qa_apply_touch('qa_shop_a','00000000-0000-0000-0000-000000004391',
    '00000000-0000-0000-0000-000000004388','00000000-0000-0000-0000-000000004383',1);
  RAISE EXCEPTION 'UNEXPECTEDLY_ACCEPTED_DIFFERENT_INTENT';
 EXCEPTION WHEN raise_exception THEN
   GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
   IF err<>'V438_IDEMPOTENCY_INTENT_CONFLICT' THEN RAISE; END IF;
 END;
 IF (SELECT COUNT(*) FROM public.v438_qa_receipts)<>1 THEN RAISE EXCEPTION 'V438_CONFLICT_RECEIPT_MODIFIED'; END IF;
END$$;
\echo V438_PG17_DIFFERENT_INTENT_REJECTED_PASS
-- On version or tenant mismatch, neither receipt nor order may change.
DO $$DECLARE err text;BEGIN
 BEGIN
  PERFORM public.v438_qa_apply_touch('qa_shop_a','00000000-0000-0000-0000-000000004391',
   '00000000-0000-0000-0000-000000004389','00000000-0000-0000-0000-000000004382',1);
  RAISE EXCEPTION 'UNEXPECTEDLY_ACCEPTED_CROSS_TENANT';
 EXCEPTION WHEN raise_exception THEN
   GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
   IF err<>'V438_TENANT_OR_VERSION_CONFLICT' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.v438_qa_apply_touch('qa_shop_a','00000000-0000-0000-0000-000000004391',
   '00000000-0000-0000-0000-000000004390','00000000-0000-0000-0000-000000004381',1);
  RAISE EXCEPTION 'UNEXPECTEDLY_ACCEPTED_STALE_VERSION';
 EXCEPTION WHEN raise_exception THEN
   GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
   IF err<>'V438_TENANT_OR_VERSION_CONFLICT' THEN RAISE; END IF;
 END;
 IF (SELECT COUNT(*) FROM public.v438_qa_receipts)<>1 THEN RAISE EXCEPTION 'V438_FAILED_TOUCH_RECORDED'; END IF;
END$$;
\echo V438_PG17_TENANT_STALE_NO_RECEIPT_PASS
-- Roll back BOTH mutation and receipt, then verify neither survives.
BEGIN;
SELECT public.v438_qa_apply_touch('qa_shop_a','00000000-0000-0000-0000-000000004391',
 '00000000-0000-0000-0000-000000004387','00000000-0000-0000-0000-000000004383',1);
ROLLBACK;
DO $$BEGIN
 IF (SELECT COUNT(*) FROM public.v438_qa_receipts)<>1 OR
  (SELECT state_version FROM public.v438_qa_orders WHERE shop_code='qa_shop_a' AND id='00000000-0000-0000-0000-000000004383')<>1
 THEN RAISE EXCEPTION 'V438_ROLLBACK_LEFT_RECEIPT_OR_WRITE';END IF;
END$$;
\echo V438_PG17_RECEIPT_AND_MUTATION_ROLLBACK_PASS
-- Concurrent replay of a single fresh request key is run by GitHub Actions.
