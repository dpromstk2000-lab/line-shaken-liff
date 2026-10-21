-- DPRO CAR02 V4.45: OFFLINE mock independent-witness CAS test.
-- Run ONLY on disposable Postgres 17 witness database. This is NOT an external
-- immutable archive. SQL stores synthetic signature placeholders and DOES NOT
-- verify Ed25519. Node tests validate signatures against pinned ephemeral keys.
\set ON_ERROR_STOP on
DO $$BEGIN IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'V445_DISPOSABLE_PG17_ONLY'; END IF; END$$;
CREATE ROLE v445_anon NOLOGIN;
CREATE ROLE v445_authenticated NOLOGIN;
CREATE TABLE public.v445_qa_witness_current (
 shop_code text NOT NULL CHECK(shop_code ~ '^[A-Za-z0-9_-]{1,64}$'),
 event_id uuid NOT NULL, revision bigint NOT NULL CHECK(revision>0),
 review_count integer NOT NULL CHECK(review_count BETWEEN 1 AND 2),
 head_hash text NOT NULL CHECK(head_hash ~ '^[a-f0-9]{64}$'),
 key_epoch integer NOT NULL CHECK(key_epoch BETWEEN 1 AND 1000),
 issued_at_ms bigint NOT NULL CHECK(issued_at_ms>0),
 signature text NOT NULL CHECK(length(signature)=86),
 PRIMARY KEY(shop_code,event_id)
);
CREATE TABLE public.v445_qa_witness_history (
 shop_code text NOT NULL,event_id uuid NOT NULL,revision bigint NOT NULL,
 review_count integer NOT NULL,head_hash text NOT NULL,key_epoch integer NOT NULL,
 issued_at_ms bigint NOT NULL,signature text NOT NULL,
 PRIMARY KEY(shop_code,event_id,revision)
);
REVOKE ALL ON public.v445_qa_witness_current,public.v445_qa_witness_history FROM PUBLIC,v445_anon,v445_authenticated;
CREATE FUNCTION public.v445_qa_block_history_edit() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'V445_AUDIT_IMMUTABLE'; END$$;
CREATE TRIGGER v445_audit_write_once BEFORE UPDATE OR DELETE ON public.v445_qa_witness_history
FOR EACH ROW EXECUTE FUNCTION public.v445_qa_block_history_edit();
CREATE FUNCTION public.v445_qa_cas(
 p_shop text,p_event uuid,p_revision bigint,p_count integer,p_head text,p_epoch integer,
 p_issued bigint,p_signature text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE prior public.v445_qa_witness_current%ROWTYPE;
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[A-Za-z0-9_-]{1,64}$' OR p_event IS NULL OR
  p_revision IS NULL OR p_revision<0 OR p_revision>=9223372036854775807 OR
  p_count IS NULL OR p_count NOT BETWEEN 1 AND 2 OR p_head IS NULL OR
  p_head !~ '^[a-f0-9]{64}$' OR p_epoch IS NULL OR p_epoch NOT BETWEEN 1 AND 1000 OR
  p_issued IS NULL OR p_issued<=0 OR p_signature IS NULL OR length(p_signature)<>86
 THEN RAISE EXCEPTION 'V445_INPUT_REJECTED';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_shop||'|'||p_event::text,0));
 SELECT * INTO prior FROM public.v445_qa_witness_current
 WHERE shop_code=p_shop AND event_id=p_event FOR UPDATE;
 IF FOUND THEN
  IF prior.revision<>p_revision OR prior.review_count>=p_count OR
     prior.key_epoch>p_epoch OR prior.issued_at_ms>=p_issued THEN RETURN false; END IF;
 ELSE
  IF p_revision<>0 THEN RETURN false; END IF;
 END IF;
 INSERT INTO public.v445_qa_witness_history(shop_code,event_id,revision,review_count,head_hash,key_epoch,issued_at_ms,signature)
 VALUES(p_shop,p_event,p_revision+1,p_count,p_head,p_epoch,p_issued,p_signature);
 INSERT INTO public.v445_qa_witness_current(shop_code,event_id,revision,review_count,head_hash,key_epoch,issued_at_ms,signature)
 VALUES(p_shop,p_event,p_revision+1,p_count,p_head,p_epoch,p_issued,p_signature)
 ON CONFLICT (shop_code,event_id) DO UPDATE SET
 revision=EXCLUDED.revision,review_count=EXCLUDED.review_count,head_hash=EXCLUDED.head_hash,
 key_epoch=EXCLUDED.key_epoch,issued_at_ms=EXCLUDED.issued_at_ms,signature=EXCLUDED.signature;
 RETURN true;
END$$;
REVOKE ALL ON FUNCTION public.v445_qa_cas(text,uuid,bigint,integer,text,integer,bigint,text),
 public.v445_qa_block_history_edit() FROM PUBLIC,v445_anon,v445_authenticated;
DO $$BEGIN
 IF has_table_privilege('v445_anon','public.v445_qa_witness_history','INSERT') OR
  has_table_privilege('v445_authenticated','public.v445_qa_witness_current','SELECT') OR
  has_function_privilege('v445_authenticated','public.v445_qa_cas(text,uuid,bigint,integer,text,integer,bigint,text)','EXECUTE')
 THEN RAISE EXCEPTION 'V445_UNPRIVILEGED_ACCESS_AVAILABLE'; END IF;
END$$;
\echo V445_PG17_PUBLIC_ROLES_DENIED_PASS
DO $$DECLARE b boolean;BEGIN
 b=public.v445_qa_cas('qa_shop_a','00000000-0000-0000-0000-000000004451',0,1,repeat('a',64),1,2000000000000,repeat('x',86));
 IF b IS DISTINCT FROM true THEN RAISE EXCEPTION 'V445_FIRST_INSERT_FAILED';END IF;
 b=public.v445_qa_cas('qa_shop_a','00000000-0000-0000-0000-000000004451',0,1,repeat('a',64),1,2000000000000,repeat('x',86));
 IF b IS DISTINCT FROM false THEN RAISE EXCEPTION 'V445_DUPLICATE_ACCEPTED';END IF;
 b=public.v445_qa_cas('qa_shop_a','00000000-0000-0000-0000-000000004451',1,2,repeat('b',64),2,2000000001000,repeat('y',86));
 IF b IS DISTINCT FROM true THEN RAISE EXCEPTION 'V445_ROTATION_REJECTED'; END IF;
 b=public.v445_qa_cas('qa_shop_a','00000000-0000-0000-0000-000000004451',2,2,repeat('b',64),1,2000000002000,repeat('y',86));
 IF b IS DISTINCT FROM false THEN RAISE EXCEPTION 'V445_OLD_KEY_ACCEPTED';END IF;
 IF (SELECT count(*) FROM public.v445_qa_witness_history)<>2 THEN RAISE EXCEPTION 'V445_HISTORY_DUPLICATED'; END IF;
END$$;
\echo V445_PG17_MONOTONIC_REVISION_AND_ROTATION_PASS
DO $$DECLARE m text;BEGIN
 BEGIN
  UPDATE public.v445_qa_witness_history SET head_hash=repeat('z',64);
  RAISE EXCEPTION 'UNEXPECTED_UPDATE';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS m=MESSAGE_TEXT;
  IF m<>'V445_AUDIT_IMMUTABLE' THEN RAISE;END IF;
 END;
 BEGIN
  DELETE FROM public.v445_qa_witness_history;
  RAISE EXCEPTION 'UNEXPECTED_DELETE';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS m=MESSAGE_TEXT;
  IF m<>'V445_AUDIT_IMMUTABLE' THEN RAISE;END IF;
 END;
 IF (SELECT count(*) FROM public.v445_qa_witness_history)<>2 THEN RAISE EXCEPTION 'V445_HISTORY_CHANGED';END IF;
END$$;
\echo V445_PG17_WITNESS_HISTORY_APPEND_ONLY_PASS
-- Eight parallel write attempts to an unrelated event run in GitHub Actions.
