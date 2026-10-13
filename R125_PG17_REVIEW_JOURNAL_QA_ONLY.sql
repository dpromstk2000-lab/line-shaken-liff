-- DPRO CAR02 R125: PostgreSQL 17 DISPOSABLE CI ONLY. NEVER execute in Supabase or existing DB.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'car02_r125_qa_ci'
    OR current_setting('server_version_num')::integer < 170000
    OR current_setting('server_version_num')::integer >= 180000
    OR to_regclass('public.ksh_car02_photos') IS NOT NULL
    OR to_regclass('car02_r125_qa.review_journal') IS NOT NULL
    OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('car02_r125_a_ci','car02_r125_b_ci'))
 THEN RAISE EXCEPTION 'R125_DISPOSABLE_PG17_ONLY' USING ERRCODE='42501'; END IF;
END $$;
CREATE SCHEMA extensions;
REVOKE ALL ON SCHEMA extensions FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE ROLE car02_r125_a_ci LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'r125-disposable-only';
CREATE ROLE car02_r125_b_ci LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'r125-disposable-only';
CREATE SCHEMA car02_r125_qa;
REVOKE ALL ON SCHEMA car02_r125_qa FROM PUBLIC;
GRANT USAGE ON SCHEMA car02_r125_qa TO car02_r125_a_ci,car02_r125_b_ci;
CREATE TABLE car02_r125_qa.review_journal (
 seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 shop_code text NOT NULL CHECK(shop_code IN ('shop_a','shop_b')),
 intent_key uuid NOT NULL,
 revision integer NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
 evidence_id uuid NOT NULL,
 record_hash text NOT NULL CHECK(record_hash ~ '^[0-9a-f]{64}$'),
 payload text NOT NULL,
 previous_hash text NOT NULL CHECK(previous_hash ~ '^[0-9a-f]{64}$'),
 event_hash text NOT NULL UNIQUE CHECK(event_hash ~ '^[0-9a-f]{64}$'),
 UNIQUE(shop_code,intent_key,revision),
 UNIQUE(shop_code,evidence_id)
);
CREATE TABLE car02_r125_qa.reviewer_index (
 shop_code text NOT NULL CHECK(shop_code IN ('shop_a','shop_b')),
 review_id uuid NOT NULL,
 journal_seq bigint NOT NULL REFERENCES car02_r125_qa.review_journal(seq),
 PRIMARY KEY(shop_code,review_id)
);
CREATE TABLE car02_r125_qa.audit_events (
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 shop_code text NOT NULL CHECK(shop_code IN ('shop_a','shop_b')),
 journal_seq bigint NOT NULL REFERENCES car02_r125_qa.review_journal(seq),
 action text NOT NULL CHECK(action='MANUAL_STAGING_VALIDATION_PENDING')
);
CREATE FUNCTION car02_r125_qa.no_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'R125_IMMUTABLE_JOURNAL' USING ERRCODE='42501'; END $$;
CREATE TRIGGER journal_no_update BEFORE UPDATE OR DELETE ON car02_r125_qa.review_journal
 FOR EACH ROW EXECUTE FUNCTION car02_r125_qa.no_mutation();
CREATE TRIGGER reviewer_no_update BEFORE UPDATE OR DELETE ON car02_r125_qa.reviewer_index
 FOR EACH ROW EXECUTE FUNCTION car02_r125_qa.no_mutation();
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON car02_r125_qa.audit_events
 FOR EACH ROW EXECUTE FUNCTION car02_r125_qa.no_mutation();
REVOKE ALL ON car02_r125_qa.review_journal,car02_r125_qa.reviewer_index,car02_r125_qa.audit_events FROM PUBLIC;
GRANT SELECT ON car02_r125_qa.review_journal,car02_r125_qa.reviewer_index,car02_r125_qa.audit_events
 TO car02_r125_a_ci,car02_r125_b_ci;
ALTER TABLE car02_r125_qa.review_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE car02_r125_qa.review_journal FORCE ROW LEVEL SECURITY;
ALTER TABLE car02_r125_qa.reviewer_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE car02_r125_qa.reviewer_index FORCE ROW LEVEL SECURITY;
ALTER TABLE car02_r125_qa.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE car02_r125_qa.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY journal_tenant_read ON car02_r125_qa.review_journal FOR SELECT TO car02_r125_a_ci,car02_r125_b_ci
 USING(shop_code=CASE session_user WHEN 'car02_r125_a_ci' THEN 'shop_a' WHEN 'car02_r125_b_ci' THEN 'shop_b' ELSE NULL END);
CREATE POLICY reviewer_tenant_read ON car02_r125_qa.reviewer_index FOR SELECT TO car02_r125_a_ci,car02_r125_b_ci
 USING(shop_code=CASE session_user WHEN 'car02_r125_a_ci' THEN 'shop_a' WHEN 'car02_r125_b_ci' THEN 'shop_b' ELSE NULL END);
CREATE POLICY audit_tenant_read ON car02_r125_qa.audit_events FOR SELECT TO car02_r125_a_ci,car02_r125_b_ci
 USING(shop_code=CASE session_user WHEN 'car02_r125_a_ci' THEN 'shop_a' WHEN 'car02_r125_b_ci' THEN 'shop_b' ELSE NULL END);

-- SECURITY DEFINER exists ONLY in synthetic disposable CI database, not a suggested production migration.
-- DB auth is hardcoded for two disposable accounts. No tenant claim is accepted from caller.
CREATE FUNCTION car02_r125_qa.record_review(p_payload text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,car02_r125_qa AS $$
DECLARE
 v_shop text; v_doc jsonb; v_body text; v_hash text; v_prev text; v_event text;
 v_prior car02_r125_qa.review_journal%ROWTYPE; v_id bigint; v_r jsonb;
BEGIN
 v_shop:=CASE session_user WHEN 'car02_r125_a_ci' THEN 'shop_a' WHEN 'car02_r125_b_ci' THEN 'shop_b' ELSE NULL END;
 IF v_shop IS NULL THEN RAISE EXCEPTION 'R125_IDENTITY_DENIED' USING ERRCODE='42501'; END IF;
 IF p_payload IS NULL OR length(p_payload)>16000 OR
    left(p_payload,18)<>'{"version":"R123",' THEN
  RAISE EXCEPTION 'R125_NONCANONICAL_PAYLOAD' USING ERRCODE='22023'; END IF;
 -- R123 appends recordHash last to JSON.stringify(record). Hash covers exact prior bytes.
 v_body:=regexp_replace(p_payload, ',"recordHash":"[0-9a-f]{64}"[}]$', '}');
 IF v_body=p_payload THEN RAISE EXCEPTION 'R125_TRAILING_DIGEST_REQUIRED' USING ERRCODE='22023'; END IF;
 BEGIN v_doc:=p_payload::jsonb;
 EXCEPTION WHEN others THEN RAISE EXCEPTION 'R125_JSON_REJECTED' USING ERRCODE='22023'; END;
 v_hash:=v_doc->>'recordHash';
 IF v_hash IS DISTINCT FROM encode(extensions.digest(convert_to(v_body,'UTF8'),'sha256'),'hex') THEN
  RAISE EXCEPTION 'R125_RECORD_HASH_MISMATCH' USING ERRCODE='42501'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(v_doc))<>20
    OR v_doc->>'version'<>'R123' OR v_doc->>'shop'<>v_shop
    OR v_doc->>'quarantineState'<>'QUARANTINED'
    OR v_doc->>'decision'<>'MANUAL_STAGING_VALIDATION_PENDING'
    OR v_doc->>'release'<>'NO_GO' OR v_doc->>'migration'<>'HOLD'
    OR coalesce(v_doc->>'mutationAllowed','')<>'false'
    OR coalesce(v_doc->>'deleteAllowed','')<>'false'
    OR coalesce(v_doc->>'markReadyAllowed','')<>'false'
    OR coalesce(v_doc->>'realStorageTested','')<>'false'
    OR coalesce(v_doc->>'realAuthTested','')<>'false'
    OR coalesce(v_doc->>'quarantineRevision','') !~ '^[1-9][0-9]{0,9}$'
    OR jsonb_typeof(v_doc->'reviewers') IS DISTINCT FROM 'array'
    OR jsonb_array_length(v_doc->'reviewers')<>2
 THEN RAISE EXCEPTION 'R125_SCOPE_AND_REVIEW_DENIED' USING ERRCODE='42501'; END IF;
 IF (v_doc->'reviewers'->0->>'subject') IS NOT DISTINCT FROM (v_doc->'reviewers'->1->>'subject')
 OR (v_doc->'reviewers'->0->>'reviewId') IS NOT DISTINCT FROM (v_doc->'reviewers'->1->>'reviewId')
 OR (v_doc->'reviewers'->0->>'role'<>'owner' AND v_doc->'reviewers'->1->>'role'<>'owner')
 THEN RAISE EXCEPTION 'R125_REVIEW_INDEPENDENCE' USING ERRCODE='42501'; END IF;
 -- Advisory lock serializes a deterministic global audit hash chain and conflicting inserts.
 PERFORM pg_advisory_xact_lock(1250001);
 SELECT * INTO v_prior FROM car02_r125_qa.review_journal
 WHERE shop_code=v_shop AND intent_key=(v_doc->>'intentKey')::uuid
   AND revision=(v_doc->>'quarantineRevision')::integer;
 IF FOUND THEN
  IF v_prior.record_hash<>v_hash OR v_prior.payload<>p_payload THEN
   RAISE EXCEPTION 'R125_CONFLICTING_REPLAY' USING ERRCODE='42501'; END IF;
  RETURN 'EXISTING';
 END IF;
 SELECT event_hash INTO v_prev FROM car02_r125_qa.review_journal ORDER BY seq DESC LIMIT 1;
 v_prev:=coalesce(v_prev,repeat('0',64));
 v_event:=encode(extensions.digest(convert_to(v_prev||':'||v_hash||':'||v_shop||':'||(v_doc->>'intentKey')||':'||(v_doc->>'quarantineRevision'),'UTF8'),'sha256'),'hex');
 INSERT INTO car02_r125_qa.review_journal(shop_code,intent_key,revision,evidence_id,record_hash,payload,previous_hash,event_hash)
 VALUES(v_shop,(v_doc->>'intentKey')::uuid,(v_doc->>'quarantineRevision')::integer,
  (v_doc->>'evidenceId')::uuid,v_hash,p_payload,v_prev,v_event) RETURNING seq INTO v_id;
 FOR v_r IN SELECT value FROM jsonb_array_elements(v_doc->'reviewers') LOOP
  INSERT INTO car02_r125_qa.reviewer_index(shop_code,review_id,journal_seq)
  VALUES(v_shop,(v_r->>'reviewId')::uuid,v_id);
 END LOOP;
 INSERT INTO car02_r125_qa.audit_events(shop_code,journal_seq,action)
 VALUES(v_shop,v_id,'MANUAL_STAGING_VALIDATION_PENDING');
 RETURN 'NEW';
END $$;
-- search_path uses extensions namespace for digest; trusted extension schema is created for CI.
REVOKE ALL ON FUNCTION car02_r125_qa.record_review(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION car02_r125_qa.record_review(text) TO car02_r125_a_ci,car02_r125_b_ci;
COMMIT;
SELECT 'R125_PG17_DISPOSABLE_SCHEMA_READY';
