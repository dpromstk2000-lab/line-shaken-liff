-- DPRO CAR02 V4.39: transactionally coupled synthetic version-touch + outbox.
-- DISPOSABLE POSTGRESQL 17 ONLY. DO NOT RUN on production/shared Supabase.
\set ON_ERROR_STOP on
DO $$BEGIN IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'V439_PG17_ONLY';END IF;END$$;
CREATE ROLE v439_anon NOLOGIN;
CREATE ROLE v439_authenticated NOLOGIN;
CREATE TABLE public.v439_qa_orders(
 shop_code text NOT NULL,id uuid NOT NULL,state_version integer NOT NULL CHECK(state_version>0),
 PRIMARY KEY(shop_code,id)
);
CREATE TABLE public.v439_qa_outbox(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 shop_code text NOT NULL,actor_sub uuid NOT NULL,request_key uuid NOT NULL,
 order_id uuid NOT NULL, payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','dispatching','delivered','manual_review')),
 claim_token uuid UNIQUE, claimed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(shop_code,actor_sub,request_key),
 CHECK ((status='pending' AND claim_token IS NULL) OR (status<>'pending' AND claim_token IS NOT NULL)),
 CHECK(payload->>'eventType'='synthetic_version_touch')
);
CREATE TABLE public.v439_qa_receipts(
 shop_code text NOT NULL,actor_sub uuid NOT NULL,request_key uuid NOT NULL,
 order_id uuid NOT NULL,expected_version integer NOT NULL,new_version integer NOT NULL,
 outbox_id uuid NOT NULL UNIQUE REFERENCES public.v439_qa_outbox(id) ON DELETE RESTRICT,
 PRIMARY KEY(shop_code,actor_sub,request_key),
 CHECK(new_version=expected_version+1)
);
REVOKE ALL ON public.v439_qa_orders,public.v439_qa_outbox,public.v439_qa_receipts FROM PUBLIC,v439_anon,v439_authenticated;
CREATE FUNCTION public.v439_qa_apply_touch(p_shop text,p_actor uuid,p_key uuid,p_order uuid,p_expected integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE r public.v439_qa_receipts%ROWTYPE; new_v integer; outbox_id uuid;
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[A-Za-z0-9_-]{1,64}$' OR
    p_actor IS NULL OR p_key IS NULL OR p_order IS NULL OR
    p_expected IS NULL OR p_expected<1 OR p_expected>=2147483647
 THEN RAISE EXCEPTION 'V439_INVALID_INPUT'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_shop||'|'||p_actor::text||'|'||p_key::text,0));
 SELECT * INTO r FROM public.v439_qa_receipts
  WHERE shop_code=p_shop AND actor_sub=p_actor AND request_key=p_key FOR UPDATE;
 IF FOUND THEN
   IF r.order_id IS DISTINCT FROM p_order OR r.expected_version IS DISTINCT FROM p_expected
      THEN RAISE EXCEPTION 'V439_INTENT_CONFLICT'; END IF;
   RETURN jsonb_build_object('replayed',true,'eventId',r.outbox_id::text,'newVersion',r.new_version);
 END IF;
 UPDATE public.v439_qa_orders SET state_version=state_version+1
  WHERE shop_code=p_shop AND id=p_order AND state_version=p_expected
  RETURNING state_version INTO new_v;
 IF NOT FOUND THEN RAISE EXCEPTION 'V439_TENANT_OR_VERSION_CONFLICT'; END IF;
 INSERT INTO public.v439_qa_outbox(shop_code,actor_sub,request_key,order_id,payload)
 VALUES (p_shop,p_actor,p_key,p_order,jsonb_build_object('eventType','synthetic_version_touch','shopCode',p_shop,'orderId',p_order::text))
 RETURNING id INTO outbox_id;
 INSERT INTO public.v439_qa_receipts(shop_code,actor_sub,request_key,order_id,expected_version,new_version,outbox_id)
 VALUES (p_shop,p_actor,p_key,p_order,p_expected,new_v,outbox_id);
 RETURN jsonb_build_object('replayed',false,'eventId',outbox_id::text,'newVersion',new_v);
END$$;
CREATE FUNCTION public.v439_qa_claim_next(p_shop text,p_token uuid)
RETURNS TABLE(event_id uuid,payload jsonb) LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[A-Za-z0-9_-]{1,64}$' OR p_token IS NULL
 THEN RAISE EXCEPTION 'V439_INVALID_CLAIM'; END IF;
 RETURN QUERY
 UPDATE public.v439_qa_outbox o
 SET status='dispatching',claim_token=p_token,claimed_at=clock_timestamp(),updated_at=clock_timestamp()
 FROM (SELECT id FROM public.v439_qa_outbox WHERE shop_code=p_shop AND status='pending'
       ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) pick
 WHERE o.id=pick.id AND o.shop_code=p_shop AND o.status='pending'
 RETURNING o.id,o.payload;
END$$;
CREATE FUNCTION public.v439_qa_finish(p_shop text,p_event uuid,p_token uuid,p_outcome text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE changed integer;
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[A-Za-z0-9_-]{1,64}$' OR
    p_event IS NULL OR p_token IS NULL OR p_outcome NOT IN ('confirmed','uncertain') OR p_outcome IS NULL
 THEN RAISE EXCEPTION 'V439_INVALID_FINISH'; END IF;
 UPDATE public.v439_qa_outbox SET status=(CASE WHEN p_outcome='confirmed' THEN 'delivered' ELSE 'manual_review' END),
   updated_at=clock_timestamp()
 WHERE shop_code=p_shop AND id=p_event AND claim_token=p_token AND status='dispatching';
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN changed=1;
END$$;
REVOKE ALL ON FUNCTION public.v439_qa_apply_touch(text,uuid,uuid,uuid,integer),
 public.v439_qa_claim_next(text,uuid),
 public.v439_qa_finish(text,uuid,uuid,text) FROM PUBLIC,v439_anon,v439_authenticated;
DO $$BEGIN
 IF has_table_privilege('v439_anon','public.v439_qa_outbox','SELECT') OR
    has_table_privilege('v439_authenticated','public.v439_qa_orders','UPDATE') OR
    has_function_privilege('v439_anon','public.v439_qa_claim_next(text,uuid)','EXECUTE') OR
    has_function_privilege('v439_authenticated','public.v439_qa_finish(text,uuid,uuid,text)','EXECUTE')
 THEN RAISE EXCEPTION 'V439_UNPRIVILEGED_API_AVAILABLE'; END IF;
END$$;
\echo V439_PG17_UNPRIVILEGED_ACCESS_DENIED_PASS
INSERT INTO public.v439_qa_orders VALUES
 ('qa_shop_a','00000000-0000-0000-0000-000000004391',1),
 ('qa_shop_a','00000000-0000-0000-0000-000000004392',1),
 ('qa_shop_b','00000000-0000-0000-0000-000000004393',1);
SELECT public.v439_qa_apply_touch('qa_shop_a','00000000-0000-0000-0000-000000004394',
 '00000000-0000-0000-0000-000000004395','00000000-0000-0000-0000-000000004391',1);
DO $$DECLARE r jsonb;BEGIN
 IF (SELECT COUNT(*) FROM public.v439_qa_outbox)<>1 OR
    (SELECT COUNT(*) FROM public.v439_qa_receipts)<>1 OR
    (SELECT state_version FROM public.v439_qa_orders WHERE shop_code='qa_shop_a' AND id='00000000-0000-0000-0000-000000004391')<>2
 THEN RAISE EXCEPTION 'V439_INITIAL_ATOMICITY_FAILED'; END IF;
 r=public.v439_qa_apply_touch('qa_shop_a','00000000-0000-0000-0000-000000004394',
  '00000000-0000-0000-0000-000000004395','00000000-0000-0000-0000-000000004391',1);
 IF r->>'replayed'<>'true' OR (SELECT COUNT(*) FROM public.v439_qa_outbox)<>1
 THEN RAISE EXCEPTION 'V439_REPLAY_DUPLICATED_OUTBOX'; END IF;
END$$;
\echo V439_PG17_ATOMIC_RECEIPT_OUTBOX_REPLAY_PASS
DO $$DECLARE err text;BEGIN
 BEGIN
  PERFORM public.v439_qa_apply_touch('qa_shop_a','00000000-0000-0000-0000-000000004394',
   '00000000-0000-0000-0000-000000004395','00000000-0000-0000-0000-000000004392',1);
  RAISE EXCEPTION 'V439_UNEXPECTED_CONFLICT_ACCEPTED';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;IF err<>'V439_INTENT_CONFLICT' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.v439_qa_apply_touch('qa_shop_a','00000000-0000-0000-0000-000000004394',
   '00000000-0000-0000-0000-000000004396','00000000-0000-0000-0000-000000004393',1);
  RAISE EXCEPTION 'V439_UNEXPECTED_CROSSTENANT_ACCEPTED';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;IF err<>'V439_TENANT_OR_VERSION_CONFLICT' THEN RAISE; END IF;
 END;
 IF (SELECT COUNT(*) FROM public.v439_qa_outbox)<>1 OR
    (SELECT state_version FROM public.v439_qa_orders WHERE shop_code='qa_shop_b')<>1
 THEN RAISE EXCEPTION 'V439_TENANT_RECORD_CHANGED'; END IF;
END$$;
\echo V439_PG17_TENANT_AND_INTENT_CONFLICT_DENIED_PASS
BEGIN;
SELECT public.v439_qa_apply_touch('qa_shop_a','00000000-0000-0000-0000-000000004394',
 '00000000-0000-0000-0000-000000004397','00000000-0000-0000-0000-000000004392',1);
ROLLBACK;
DO $$BEGIN
 IF (SELECT COUNT(*) FROM public.v439_qa_outbox)<>1 OR
    (SELECT COUNT(*) FROM public.v439_qa_receipts)<>1 OR
    (SELECT state_version FROM public.v439_qa_orders WHERE shop_code='qa_shop_a' AND id='00000000-0000-0000-0000-000000004392')<>1
 THEN RAISE EXCEPTION 'V439_ROLLBACK_LEFT_SIDE_EFFECTS'; END IF;
END$$;
\echo V439_PG17_ROLLBACK_REMOVES_RECEIPT_AND_OUTBOX_PASS
-- Exactly one pending event remains for eight concurrent worker claims.
-- The workflow will run the claim race and test acknowledgement/manual-review transitions.
