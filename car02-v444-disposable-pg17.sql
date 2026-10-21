-- DPRO CAR02 V4.44: synthetic monotonic witness ledger; disposable PostgreSQL 17 ONLY.
-- SQL cannot verify Ed25519; signatures MUST be authenticated against pinned keys
-- BEFORE this routine. The CI DB is NOT an external immutable/WORM archive.
\set ON_ERROR_STOP on
DO $$BEGIN IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'V444_DISPOSABLE_PG17_ONLY'; END IF; END$$;
CREATE ROLE v444_anon NOLOGIN;
CREATE ROLE v444_authenticated NOLOGIN;
CREATE TABLE public.v444_qa_anchor_current (
 shop_code text NOT NULL, event_id uuid NOT NULL,
 count integer NOT NULL CHECK (count BETWEEN 1 AND 2),
 head_hash text NOT NULL CHECK(head_hash ~ '^[a-f0-9]{64}$'),
 issued_at_ms bigint NOT NULL CHECK(issued_at_ms>0),
 key_id text NOT NULL CHECK(key_id ~ '^[A-Za-z][A-Za-z0-9_-]{0,39}$'),
 key_epoch integer NOT NULL CHECK(key_epoch BETWEEN 1 AND 1000),
 signature text NOT NULL,
 PRIMARY KEY(shop_code,event_id)
);
CREATE TABLE public.v444_qa_anchor_history (
 shop_code text NOT NULL, event_id uuid NOT NULL,
 count integer NOT NULL, head_hash text NOT NULL,
 issued_at_ms bigint NOT NULL,key_id text NOT NULL,key_epoch integer NOT NULL,
 signature text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(shop_code,event_id,count),
 CHECK(count BETWEEN 1 AND 2),CHECK(head_hash ~ '^[a-f0-9]{64}$')
);
REVOKE ALL ON public.v444_qa_anchor_current,public.v444_qa_anchor_history FROM PUBLIC,v444_anon,v444_authenticated;
CREATE FUNCTION public.v444_qa_reject_mutation() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'V444_HISTORY_IMMUTABLE'; END$$;
CREATE TRIGGER v444_history_immutable BEFORE UPDATE OR DELETE ON public.v444_qa_anchor_history
 FOR EACH ROW EXECUTE FUNCTION public.v444_qa_reject_mutation();
CREATE FUNCTION public.v444_qa_append_anchor(p_shop text,p_event uuid,p_count integer,p_head text,
 p_issued_ms bigint,p_key_id text,p_key_epoch integer,p_signature text,p_prev_count integer,p_prev_head text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE old public.v444_qa_anchor_current%ROWTYPE; had boolean;
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[A-Za-z0-9_-]{1,64}$' OR p_event IS NULL OR
    p_count IS NULL OR p_count NOT BETWEEN 1 AND 2 OR p_head IS NULL OR p_head !~ '^[a-f0-9]{64}$' OR
    p_issued_ms IS NULL OR p_issued_ms<=0 OR p_key_id IS NULL OR p_key_id !~ '^[A-Za-z][A-Za-z0-9_-]{0,39}$' OR
    p_key_epoch IS NULL OR p_key_epoch NOT BETWEEN 1 AND 1000 OR
    p_signature IS NULL OR length(p_signature)<>86 OR p_signature !~ '^[A-Za-z0-9_-]+$' OR
    p_prev_count IS NULL OR p_prev_count<0 OR p_prev_head IS NULL OR p_prev_head !~ '^[a-f0-9]{64}$'
 THEN RAISE EXCEPTION 'V444_INVALID_INPUT'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_shop||'|'||p_event::text,0));
 SELECT * INTO old FROM public.v444_qa_anchor_current
 WHERE shop_code=p_shop AND event_id=p_event FOR UPDATE;
 had=FOUND;
 IF had THEN
  IF old.count<>p_prev_count OR old.head_hash<>p_prev_head OR
     p_count<=old.count OR p_issued_ms<=old.issued_at_ms OR p_key_epoch<old.key_epoch
  THEN RETURN false; END IF;
 ELSE
  IF p_prev_count<>0 OR p_prev_head<>repeat('0',64) THEN RETURN false; END IF;
 END IF;
 INSERT INTO public.v444_qa_anchor_history(shop_code,event_id,count,head_hash,issued_at_ms,key_id,key_epoch,signature)
 VALUES(p_shop,p_event,p_count,p_head,p_issued_ms,p_key_id,p_key_epoch,p_signature);
 INSERT INTO public.v444_qa_anchor_current(shop_code,event_id,count,head_hash,issued_at_ms,key_id,key_epoch,signature)
 VALUES(p_shop,p_event,p_count,p_head,p_issued_ms,p_key_id,p_key_epoch,p_signature)
 ON CONFLICT(shop_code,event_id) DO UPDATE SET
 count=EXCLUDED.count,head_hash=EXCLUDED.head_hash,issued_at_ms=EXCLUDED.issued_at_ms,
 key_id=EXCLUDED.key_id,key_epoch=EXCLUDED.key_epoch,signature=EXCLUDED.signature;
 RETURN true;
END$$;
REVOKE ALL ON FUNCTION public.v444_qa_append_anchor(text,uuid,integer,text,bigint,text,integer,text,integer,text),
 public.v444_qa_reject_mutation() FROM PUBLIC,v444_anon,v444_authenticated;
DO $$BEGIN
 IF has_table_privilege('v444_anon','public.v444_qa_anchor_history','INSERT') OR
    has_table_privilege('v444_authenticated','public.v444_qa_anchor_current','SELECT') OR
    has_function_privilege('v444_authenticated','public.v444_qa_append_anchor(text,uuid,integer,text,bigint,text,integer,text,integer,text)','EXECUTE')
 THEN RAISE EXCEPTION 'V444_UNPRIVILEGED_ANCHOR_ACCESS'; END IF;
END$$;
\echo V444_DISPOSABLE_PG17_PUBLIC_ROLES_DENIED_PASS
-- Synthetic values only; Node tests separately verify real Ed25519 signatures.
DO $$DECLARE accepted boolean; BEGIN
 accepted=public.v444_qa_append_anchor('qa_shop_a','00000000-0000-0000-0000-000000004441',1,repeat('a',64),
 2000000000000,'K1',1,repeat('x',86),0,repeat('0',64));
 IF accepted IS NOT TRUE THEN RAISE EXCEPTION 'V444_FIRST_CAS_MISSING'; END IF;
 accepted=public.v444_qa_append_anchor('qa_shop_a','00000000-0000-0000-0000-000000004441',1,repeat('a',64),
 2000000000000,'K1',1,repeat('x',86),0,repeat('0',64));
 IF accepted IS NOT FALSE THEN RAISE EXCEPTION 'V444_REPLAY_ACCEPTED'; END IF;
 accepted=public.v444_qa_append_anchor('qa_shop_a','00000000-0000-0000-0000-000000004441',2,repeat('b',64),
 2000000001000,'K2',2,repeat('y',86),1,repeat('a',64));
 IF accepted IS NOT TRUE THEN RAISE EXCEPTION 'V444_FORWARD_KEY_EPOCH_REJECTED'; END IF;
 accepted=public.v444_qa_append_anchor('qa_shop_a','00000000-0000-0000-0000-000000004441',2,repeat('b',64),
 2000000001001,'K1',1,repeat('y',86),1,repeat('a',64));
 IF accepted IS NOT FALSE THEN RAISE EXCEPTION 'V444_KEY_EPOCH_DOWNGRADE'; END IF;
 accepted=public.v444_qa_append_anchor('qa_shop_a','00000000-0000-0000-0000-000000004441',2,repeat('b',64),
 2000000001001,'K2',2,repeat('y',86),1,repeat('a',64));
 IF accepted IS NOT FALSE THEN RAISE EXCEPTION 'V444_PREV_HEAD_REPLAY'; END IF;
 IF (SELECT count(*) FROM public.v444_qa_anchor_history WHERE shop_code='qa_shop_a')<>2 OR
    (SELECT count FROM public.v444_qa_anchor_current WHERE event_id='00000000-0000-0000-0000-000000004441')<>2
 THEN RAISE EXCEPTION 'V444_ANCHOR_COUNT_CHANGED'; END IF;
END$$;
\echo V444_DISPOSABLE_PG17_MONOTONIC_KEY_ROTATION_PASS
DO $$DECLARE message text; BEGIN
 BEGIN
  UPDATE public.v444_qa_anchor_history SET head_hash=repeat('c',64);
  RAISE EXCEPTION 'UNEXPECTED_HISTORY_UPDATE';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
  IF message<>'V444_HISTORY_IMMUTABLE' THEN RAISE; END IF;
 END;
 BEGIN
  DELETE FROM public.v444_qa_anchor_history;
  RAISE EXCEPTION 'UNEXPECTED_HISTORY_DELETE';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
  IF message<>'V444_HISTORY_IMMUTABLE' THEN RAISE; END IF;
 END;
 IF (SELECT COUNT(*) FROM public.v444_qa_anchor_history)<>2 THEN RAISE EXCEPTION 'V444_HISTORY_MODIFIED'; END IF;
END$$;
\echo V444_DISPOSABLE_PG17_APPEND_ONLY_HISTORY_PASS
-- CI checks eight independent writers for same new event; only one can win.
