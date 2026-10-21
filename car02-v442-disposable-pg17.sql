-- CAR02 V4.42: Synthetic tamper-evident chain model. PostgreSQL 17 DISPOSABLE CI ONLY.
-- NEVER use on shared Supabase/production. Hash chaining is NOT externally anchored.
\set ON_ERROR_STOP on
DO $$BEGIN IF current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'V442_DISPOSABLE_PG17_ONLY'; END IF; END$$;
CREATE ROLE v442_anon NOLOGIN;
CREATE ROLE v442_authenticated NOLOGIN;
CREATE TABLE public.v442_qa_cases(
 shop_code text NOT NULL CHECK(shop_code ~ '^[A-Za-z0-9_-]{1,64}$'),
 id uuid NOT NULL,
 status text NOT NULL CHECK(status IN ('manual_review','delivered')),
 PRIMARY KEY(shop_code,id)
);
CREATE TABLE public.v442_qa_chain(
 shop_code text NOT NULL,
 event_id uuid NOT NULL,
 seq integer NOT NULL CHECK(seq BETWEEN 1 AND 2),
 reviewer_sub uuid NOT NULL,
 evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 disposition text NOT NULL CHECK(disposition IN ('investigated','escalated')),
 previous_hash text NOT NULL CHECK(previous_hash ~ '^[a-f0-9]{64}$'),
 entry_hash text NOT NULL CHECK(entry_hash ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(shop_code,event_id,seq),
 UNIQUE(shop_code,event_id,reviewer_sub),
 UNIQUE(shop_code,event_id,evidence_sha256),
 FOREIGN KEY(shop_code,event_id) REFERENCES public.v442_qa_cases(shop_code,id) ON DELETE RESTRICT
);
REVOKE ALL ON public.v442_qa_cases, public.v442_qa_chain FROM PUBLIC,v442_anon,v442_authenticated;
CREATE FUNCTION public.v442_qa_immutable() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'V442_APPEND_ONLY'; END$$;
CREATE TRIGGER v442_no_edit BEFORE UPDATE OR DELETE ON public.v442_qa_chain
 FOR EACH ROW EXECUTE FUNCTION public.v442_qa_immutable();
-- The reviewer argument is synthetic CI-only: this is NOT real owner authentication.
CREATE FUNCTION public.v442_qa_append_review(
 p_shop text,p_event uuid,p_reviewer uuid,p_evidence text,p_disposition text)
RETURNS TABLE(stored boolean,entry_count bigint,entry_hash text)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE case_status text; existing_seq integer; existing_hash text; n bigint; prev text; new_hash text;
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[A-Za-z0-9_-]{1,64}$' OR
 p_event IS NULL OR p_reviewer IS NULL OR p_evidence IS NULL OR p_evidence !~ '^[a-f0-9]{64}$' OR
 p_disposition IS NULL OR p_disposition NOT IN ('investigated','escalated')
 THEN RAISE EXCEPTION 'V442_INVALID_INPUT'; END IF;
 SELECT c.status INTO case_status FROM public.v442_qa_cases c
 WHERE c.shop_code=p_shop AND c.id=p_event FOR UPDATE;
 IF NOT FOUND OR case_status<>'manual_review' THEN RAISE EXCEPTION 'V442_CASE_NOT_REVIEWABLE'; END IF;
 -- Owning case-row lock serializes all reviewers in this case, including race/replay.
 SELECT c.seq,c.entry_hash INTO existing_seq,existing_hash FROM public.v442_qa_chain c
 WHERE c.shop_code=p_shop AND c.event_id=p_event AND c.reviewer_sub=p_reviewer;
 SELECT count(*) INTO n FROM public.v442_qa_chain c WHERE c.shop_code=p_shop AND c.event_id=p_event;
 IF existing_seq IS NOT NULL THEN
  RETURN QUERY SELECT false,n,existing_hash; RETURN;
 END IF;
 IF EXISTS(SELECT 1 FROM public.v442_qa_chain c WHERE c.shop_code=p_shop AND c.event_id=p_event
  AND c.evidence_sha256=p_evidence) THEN RAISE EXCEPTION 'V442_EVIDENCE_REUSE_DENIED'; END IF;
 IF n>=2 THEN RAISE EXCEPTION 'V442_MAX_REVIEWERS'; END IF;
 prev=repeat('0',64);
 IF n>0 THEN
  SELECT c.entry_hash INTO prev FROM public.v442_qa_chain c
  WHERE c.shop_code=p_shop AND c.event_id=p_event AND c.seq=n;
 END IF;
 new_hash=encode(sha256(convert_to(concat_ws('|','v442',p_shop,p_event::text,(n+1)::text,
 p_reviewer::text,p_evidence,p_disposition,prev),'UTF8')),'hex');
 INSERT INTO public.v442_qa_chain(shop_code,event_id,seq,reviewer_sub,evidence_sha256,disposition,previous_hash,entry_hash)
 VALUES(p_shop,p_event,n+1,p_reviewer,p_evidence,p_disposition,prev,new_hash);
 RETURN QUERY SELECT true,n+1,new_hash;
END$$;
CREATE FUNCTION public.v442_qa_read_chain(p_shop text,p_event uuid)
RETURNS TABLE(snapshot jsonb) LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[A-Za-z0-9_-]{1,64}$' OR p_event IS NULL
 THEN RAISE EXCEPTION 'V442_INVALID_READ'; END IF;
 RETURN QUERY SELECT jsonb_build_object('shopCode',c.shop_code,'eventId',c.id::text,'status',c.status,
 'entries',coalesce((SELECT jsonb_agg(jsonb_build_object('seq',x.seq,'reviewerSub',x.reviewer_sub::text,
 'evidenceSha256',x.evidence_sha256,'disposition',x.disposition,'previousHash',x.previous_hash,
 'entryHash',x.entry_hash) ORDER BY x.seq)
 FROM public.v442_qa_chain x WHERE x.shop_code=c.shop_code AND x.event_id=c.id),'[]'::jsonb))
 FROM public.v442_qa_cases c WHERE c.shop_code=p_shop AND c.id=p_event;
END$$;
REVOKE ALL ON FUNCTION public.v442_qa_immutable(),
 public.v442_qa_append_review(text,uuid,uuid,text,text),
 public.v442_qa_read_chain(text,uuid) FROM PUBLIC,v442_anon,v442_authenticated;
DO $$BEGIN
 IF has_table_privilege('v442_anon','public.v442_qa_chain','INSERT') OR
 has_table_privilege('v442_authenticated','public.v442_qa_chain','SELECT') OR
 has_function_privilege('v442_anon','public.v442_qa_append_review(text,uuid,uuid,text,text)','EXECUTE') OR
 has_function_privilege('v442_authenticated','public.v442_qa_read_chain(text,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'V442_PUBLIC_PRIVILEGE_OPEN'; END IF;
END$$;
\echo V442_PG17_PRIVILEGES_FAIL_CLOSED_PASS
INSERT INTO public.v442_qa_cases VALUES
 ('qa_shop_a','00000000-0000-0000-0000-000000004421','manual_review'),
 ('qa_shop_a','00000000-0000-0000-0000-000000004429','manual_review'),
 ('qa_shop_b','00000000-0000-0000-0000-000000004428','manual_review'),
 ('qa_shop_a','00000000-0000-0000-0000-000000004427','delivered');
DO $$DECLARE r record; snap jsonb; BEGIN
 SELECT * INTO r FROM public.v442_qa_append_review('qa_shop_a','00000000-0000-0000-0000-000000004421',
 '00000000-0000-0000-0000-000000004422',repeat('a',64),'investigated');
 IF r.stored IS DISTINCT FROM true OR r.entry_count<>1 OR length(r.entry_hash)<>64
 THEN RAISE EXCEPTION 'V442_FIRST_APPEND_FAILED'; END IF;
 SELECT * INTO r FROM public.v442_qa_append_review('qa_shop_a','00000000-0000-0000-0000-000000004421',
 '00000000-0000-0000-0000-000000004422',repeat('a',64),'investigated');
 IF r.stored IS DISTINCT FROM false OR r.entry_count<>1 THEN RAISE EXCEPTION 'V442_REPLAY_FAILED'; END IF;
 SELECT * INTO r FROM public.v442_qa_append_review('qa_shop_a','00000000-0000-0000-0000-000000004421',
 '00000000-0000-0000-0000-000000004423',repeat('b',64),'escalated');
 IF r.stored IS DISTINCT FROM true OR r.entry_count<>2 THEN RAISE EXCEPTION 'V442_SECOND_APPEND_FAILED'; END IF;
 SELECT snapshot INTO snap FROM public.v442_qa_read_chain('qa_shop_a','00000000-0000-0000-0000-000000004421');
 IF snap->>'status'<>'manual_review' OR jsonb_array_length(snap->'entries')<>2 OR
   snap->'entries'->1->>'previousHash' IS DISTINCT FROM snap->'entries'->0->>'entryHash'
 THEN RAISE EXCEPTION 'V442_CHAIN_READ_BAD'; END IF;
END$$;
\echo V442_PG17_APPEND_REPLAY_AND_CHAIN_PASS
DO $$DECLARE message text; BEGIN
 BEGIN
 PERFORM * FROM public.v442_qa_append_review('qa_shop_a','00000000-0000-0000-0000-000000004421',
 '00000000-0000-0000-0000-000000004424',repeat('a',64),'investigated');
 RAISE EXCEPTION 'UNEXPECTED_EVIDENCE_REUSE';
 EXCEPTION WHEN raise_exception THEN
 GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
 IF message<>'V442_EVIDENCE_REUSE_DENIED' THEN RAISE;END IF;
 END;
 BEGIN
 PERFORM * FROM public.v442_qa_append_review('qa_shop_a','00000000-0000-0000-0000-000000004421',
 '00000000-0000-0000-0000-000000004424',repeat('c',64),'investigated');
 RAISE EXCEPTION 'UNEXPECTED_THIRD_REVIEWER';
 EXCEPTION WHEN raise_exception THEN
 GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
 IF message<>'V442_MAX_REVIEWERS' THEN RAISE;END IF;
 END;
 BEGIN
 PERFORM * FROM public.v442_qa_append_review('qa_shop_b','00000000-0000-0000-0000-000000004421',
 '00000000-0000-0000-0000-000000004424',repeat('c',64),'investigated');
 RAISE EXCEPTION 'UNEXPECTED_CROSS_TENANT';
 EXCEPTION WHEN raise_exception THEN
 GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
 IF message<>'V442_CASE_NOT_REVIEWABLE' THEN RAISE;END IF;
 END;
 BEGIN
 PERFORM * FROM public.v442_qa_append_review('qa_shop_a','00000000-0000-0000-0000-000000004427',
 '00000000-0000-0000-0000-000000004424',repeat('c',64),'investigated');
 RAISE EXCEPTION 'UNEXPECTED_DELIVERED_REVIEW';
 EXCEPTION WHEN raise_exception THEN
 GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
 IF message<>'V442_CASE_NOT_REVIEWABLE' THEN RAISE;END IF;
 END;
 IF (SELECT count(*) FROM public.v442_qa_chain)<>2 THEN RAISE EXCEPTION 'V442_REJECTED_WRITE_PERSISTED'; END IF;
END$$;
\echo V442_PG17_EVIDENCE_TENANT_AND_DELIVERED_DENY_PASS
DO $$DECLARE message text;BEGIN
 BEGIN
 UPDATE public.v442_qa_chain SET evidence_sha256=repeat('c',64);
 RAISE EXCEPTION 'UNEXPECTED_UPDATE_ALLOWED';
 EXCEPTION WHEN raise_exception THEN
 GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
 IF message<>'V442_APPEND_ONLY' THEN RAISE; END IF;
 END;
 BEGIN
 DELETE FROM public.v442_qa_chain;
 RAISE EXCEPTION 'UNEXPECTED_DELETE_ALLOWED';
 EXCEPTION WHEN raise_exception THEN
 GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
 IF message<>'V442_APPEND_ONLY' THEN RAISE; END IF;
 END;
 IF (SELECT count(*) FROM public.v442_qa_chain)<>2 OR
  (SELECT status FROM public.v442_qa_cases WHERE id='00000000-0000-0000-0000-000000004421')<>'manual_review'
 THEN RAISE EXCEPTION 'V442_CHAIN_OR_CASE_MUTATED'; END IF;
END$$;
\echo V442_PG17_APPEND_ONLY_AND_NO_DELIVERY_PASS
-- Eight concurrent same-reviewer append attempts against case 4429 are executed by CI.
