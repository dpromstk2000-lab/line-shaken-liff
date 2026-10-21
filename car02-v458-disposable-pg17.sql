-- CAR02 V4.58 — disposable PostgreSQL 17 synthetic INDEPENDENT WITNESS CURSOR.
-- NOT REAL independent storage, WORM, provider sessions, LINE or production IAM.
-- Digest inputs are synthetic; database function NEVER checks a real signature.
-- Both trusted checkpoint adapter and actual custody/independence remain NO_GO.
\set ON_ERROR_STOP on
DO $$BEGIN IF current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'V458_DISPOSABLE_PG17_ONLY'; END IF; END$$;
CREATE ROLE v458_anon NOLOGIN;
CREATE ROLE v458_authenticated NOLOGIN;
CREATE SCHEMA v458_private;
REVOKE ALL ON SCHEMA v458_private FROM PUBLIC,v458_anon,v458_authenticated;
CREATE TABLE v458_private.qa_cursors(
  shop_code text PRIMARY KEY CHECK(shop_code ~ '^[A-Za-z0-9_-]{1,64}$'),
  latest_sequence bigint NOT NULL CHECK(latest_sequence>=0),
  latest_digest text NOT NULL CHECK(latest_digest ~ '^[0-9a-f]{64}$')
);
CREATE TABLE v458_private.qa_witness_anchors(
  shop_code text NOT NULL REFERENCES v458_private.qa_cursors(shop_code),
  anchor_sequence bigint NOT NULL CHECK(anchor_sequence>0),
  event_id uuid NOT NULL,
  envelope_digest text NOT NULL CHECK(envelope_digest ~ '^[0-9a-f]{64}$'),
  previous_digest text NOT NULL CHECK(previous_digest ~ '^[0-9a-f]{64}$'),
  checkpoint_digest text NOT NULL CHECK(checkpoint_digest ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY(shop_code,anchor_sequence),
  UNIQUE(shop_code,event_id)
);
REVOKE ALL ON v458_private.qa_cursors,v458_private.qa_witness_anchors FROM PUBLIC,v458_anon,v458_authenticated;
CREATE FUNCTION v458_private.qa_no_rewrite() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,v458_private AS $$
BEGIN RAISE EXCEPTION 'V458_ANCHOR_APPEND_ONLY'; END $$;
CREATE TRIGGER qa_no_anchor_rewrite BEFORE UPDATE OR DELETE ON v458_private.qa_witness_anchors
 FOR EACH ROW EXECUTE FUNCTION v458_private.qa_no_rewrite();
CREATE FUNCTION v458_private.qa_append_witness(
 p_shop text,p_event uuid,p_expected bigint,p_prev text,p_envelope text,p_checkpoint text)
RETURNS TABLE(accepted boolean,anchor_sequence bigint)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,v458_private AS $$
DECLARE next_seq bigint;
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[A-Za-z0-9_-]{1,64}$' OR p_event IS NULL OR
    p_expected IS NULL OR p_expected<0 OR p_expected>=2147483647 OR
    p_prev IS NULL OR p_prev !~ '^[0-9a-f]{64}$' OR
    p_envelope IS NULL OR p_envelope !~ '^[0-9a-f]{64}$' OR
    p_checkpoint IS NULL OR p_checkpoint !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'V458_INVALID_ANCHOR_INPUT'; END IF;
 UPDATE v458_private.qa_cursors AS a
 SET latest_sequence=p_expected+1,latest_digest=p_checkpoint
 WHERE a.shop_code=p_shop AND a.latest_sequence=p_expected AND a.latest_digest=p_prev
 RETURNING a.latest_sequence INTO next_seq;
 IF NOT FOUND THEN RAISE EXCEPTION 'V458_STALE_OR_FORGED_CURSOR'; END IF;
 -- Same transaction: if immutable append fails, the cursor UPDATE rolls back.
 INSERT INTO v458_private.qa_witness_anchors
 (shop_code,anchor_sequence,event_id,envelope_digest,previous_digest,checkpoint_digest)
 VALUES(p_shop,next_seq,p_event,p_envelope,p_prev,p_checkpoint);
 RETURN QUERY SELECT true,next_seq;
END $$;
REVOKE ALL ON FUNCTION v458_private.qa_no_rewrite(),
 v458_private.qa_append_witness(text,uuid,bigint,text,text,text)
 FROM PUBLIC,v458_anon,v458_authenticated;
DO $$BEGIN
 IF has_schema_privilege('v458_authenticated','v458_private','USAGE') OR
  has_table_privilege('v458_anon','v458_private.qa_cursors','UPDATE') OR
  has_table_privilege('v458_authenticated','v458_private.qa_witness_anchors','SELECT') OR
  has_function_privilege('v458_authenticated',
   'v458_private.qa_append_witness(text,uuid,bigint,text,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'V458_UNPRIVILEGED_WITNESS_OPEN';END IF;
END $$;
\echo V458_PG17_PRIVATE_WITNESS_ROLE_DENY_PASS
INSERT INTO v458_private.qa_cursors VALUES
 ('qa_shop_a',0,repeat('0',64)),('qa_shop_b',0,repeat('0',64));
DO $$DECLARE a record;BEGIN
 SELECT * INTO a FROM v458_private.qa_append_witness('qa_shop_a',
 '00000000-0000-0000-0000-000000004581',0,repeat('0',64),repeat('a',64),repeat('b',64));
 IF a.accepted IS DISTINCT FROM true OR a.anchor_sequence<>1 THEN
  RAISE EXCEPTION 'V458_FIRST_CHECKPOINT_FAILED'; END IF;
 IF (SELECT latest_sequence FROM v458_private.qa_cursors WHERE shop_code='qa_shop_b')<>0
 THEN RAISE EXCEPTION 'V458_OTHER_TENANT_CHANGED'; END IF;
END$$;
\echo V458_PG17_ATOMIC_FIRST_CHECKPOINT_AND_TENANT_ISOLATION_PASS
DO $$DECLARE msg text;BEGIN
 BEGIN
  PERFORM * FROM v458_private.qa_append_witness('qa_shop_a',
   '00000000-0000-0000-0000-000000004582',0,repeat('0',64),repeat('a',64),repeat('c',64));
  RAISE EXCEPTION 'V458_STALE_ACCEPTED';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'V458_STALE_OR_FORGED_CURSOR' THEN RAISE;END IF;
 END;
 BEGIN
  PERFORM * FROM v458_private.qa_append_witness('qa_shop_a',
   '00000000-0000-0000-0000-000000004582',1,repeat('0',64),repeat('a',64),repeat('c',64));
  RAISE EXCEPTION 'V458_FAKE_PREVIOUS_DIGEST_ACCEPTED';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'V458_STALE_OR_FORGED_CURSOR' THEN RAISE;END IF;
 END;
 IF (SELECT latest_digest FROM v458_private.qa_cursors WHERE shop_code='qa_shop_a')<>repeat('b',64)
 THEN RAISE EXCEPTION 'V458_CURSOR_WAS_REWRITTEN';END IF;
END$$;
\echo V458_PG17_OLD_CURSOR_AND_FORGED_PREVIOUS_DIGEST_DENIED_PASS
DO $$DECLARE msg text;BEGIN
 BEGIN
  UPDATE v458_private.qa_witness_anchors SET checkpoint_digest=repeat('f',64)
  WHERE shop_code='qa_shop_a';
  RAISE EXCEPTION 'V458_ANCHOR_UPDATED';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'V458_ANCHOR_APPEND_ONLY' THEN RAISE;END IF;
 END;
 BEGIN
  DELETE FROM v458_private.qa_witness_anchors WHERE shop_code='qa_shop_a';
  RAISE EXCEPTION 'V458_ANCHOR_DELETED';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS msg=MESSAGE_TEXT;
  IF msg<>'V458_ANCHOR_APPEND_ONLY' THEN RAISE;END IF;
 END;
END$$;
\echo V458_PG17_APPEND_ONLY_ANCHOR_EDIT_DELETE_DENIED_PASS
-- Eight independent clients race expected=1 to append sequence=2, exactly one succeeds.
-- This table is a SYNTHETIC trust domain in the SAME disposable PostgreSQL server.
