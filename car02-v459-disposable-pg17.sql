-- CAR02 V4.59 FAIL-CLOSED RELEASE BLOCKER INVENTORY (DISPOSABLE PostgreSQL 17 ONLY)
-- NO LIVE SUPABASE, NO LINE DISPATCH, NO WORKER, NO COMMERCIAL RELEASE.
-- These rows are synthetic fixtures and CANNOT attest completion of controls.
\set ON_ERROR_STOP on
DO $$BEGIN
 IF current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'V459_PG17_DISPOSABLE_ONLY'; END IF;
END$$;
CREATE ROLE v459_anon NOLOGIN;
CREATE ROLE v459_authenticated NOLOGIN;
CREATE SCHEMA v459_private;
REVOKE ALL ON SCHEMA v459_private FROM PUBLIC,v459_anon,v459_authenticated;
CREATE TABLE v459_private.qa_control_ledger(
 shop_code text NOT NULL CHECK(shop_code ~ '^[A-Za-z0-9_-]{1,64}$'),
 control_code text NOT NULL CHECK(control_code IN (
  'actual_supabase_auth_sessions',
  'trusted_operator_and_worker_iam',
  'postcommit_auth_generation_fence',
  'real_line_delivery_ambiguity',
  'external_immutable_evidence_store',
  'independent_signing_key_custody',
  'staging_end_to_end_integration')),
 evidence_source text NOT NULL CHECK(evidence_source IN ('synthetic_fixture','external_claim')),
 review_state text NOT NULL CHECK(review_state IN ('pending','observed')),
 PRIMARY KEY(shop_code,control_code)
);
REVOKE ALL ON v459_private.qa_control_ledger FROM PUBLIC,v459_anon,v459_authenticated;
CREATE FUNCTION v459_private.qa_immutable_ledger() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,v459_private AS $$
BEGIN RAISE EXCEPTION 'V459_EVIDENCE_APPEND_ONLY'; END$$;
CREATE TRIGGER v459_no_row_edit BEFORE UPDATE OR DELETE ON v459_private.qa_control_ledger
 FOR EACH ROW EXECUTE FUNCTION v459_private.qa_immutable_ledger();
CREATE FUNCTION v459_private.qa_release_controls(p_shop text)
 RETURNS TABLE(control_code text,evidence_source text,review_state text)
 LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,v459_private AS $$
BEGIN
 IF p_shop IS NULL OR p_shop !~ '^[A-Za-z0-9_-]{1,64}$'
 THEN RAISE EXCEPTION 'V459_INVALID_TENANT'; END IF;
 RETURN QUERY SELECT x.control_code,x.evidence_source,x.review_state
  FROM v459_private.qa_control_ledger x
  WHERE x.shop_code=p_shop ORDER BY x.control_code;
END$$;
REVOKE ALL ON FUNCTION v459_private.qa_release_controls(text),
 v459_private.qa_immutable_ledger() FROM PUBLIC,v459_anon,v459_authenticated;
DO $$BEGIN
 IF has_schema_privilege('v459_anon','v459_private','USAGE') OR
 has_table_privilege('v459_authenticated','v459_private.qa_control_ledger','SELECT') OR
 has_function_privilege('v459_authenticated','v459_private.qa_release_controls(text)','EXECUTE')
 THEN RAISE EXCEPTION 'V459_UNPRIVILEGED_RELEASE_AUDIT_AVAILABLE'; END IF;
END$$;
\echo V459_PG17_PRIVATE_AUDIT_ROLES_DENIED_PASS
INSERT INTO v459_private.qa_control_ledger(shop_code,control_code,evidence_source,review_state)
SELECT 'qa_shop_a',c,'synthetic_fixture','pending'
FROM unnest(ARRAY[
 'actual_supabase_auth_sessions',
 'trusted_operator_and_worker_iam',
 'postcommit_auth_generation_fence',
 'real_line_delivery_ambiguity',
 'external_immutable_evidence_store',
 'independent_signing_key_custody',
 'staging_end_to_end_integration']) AS c;
INSERT INTO v459_private.qa_control_ledger(shop_code,control_code,evidence_source,review_state)
SELECT 'qa_shop_b',c,'synthetic_fixture','pending'
FROM unnest(ARRAY[
 'actual_supabase_auth_sessions',
 'trusted_operator_and_worker_iam',
 'postcommit_auth_generation_fence',
 'real_line_delivery_ambiguity',
 'external_immutable_evidence_store',
 'independent_signing_key_custody',
 'staging_end_to_end_integration']) AS c;
DO $$BEGIN
 IF (SELECT count(*) FROM v459_private.qa_release_controls('qa_shop_a'))<>7 OR
    (SELECT count(*) FROM v459_private.qa_release_controls('qa_shop_b'))<>7 OR
    EXISTS(SELECT 1 FROM v459_private.qa_release_controls('qa_shop_a') x
      WHERE x.evidence_source<>'synthetic_fixture' OR x.review_state<>'pending')
 THEN RAISE EXCEPTION 'V459_REQUIRED_CONTROLS_NOT_ALL_PENDING'; END IF;
END$$;
\echo V459_PG17_ALL_SEVEN_COMMERCIAL_BLOCKERS_PENDING_PASS
DO $$DECLARE e text;BEGIN
 BEGIN
   UPDATE v459_private.qa_control_ledger SET review_state='observed' WHERE shop_code='qa_shop_a';
   RAISE EXCEPTION 'V459_FORGED_RELEASE_MARKED';
 EXCEPTION WHEN raise_exception THEN
   GET STACKED DIAGNOSTICS e=MESSAGE_TEXT;
   IF e<>'V459_EVIDENCE_APPEND_ONLY' THEN RAISE; END IF;
 END;
 BEGIN
   DELETE FROM v459_private.qa_control_ledger WHERE shop_code='qa_shop_a';
   RAISE EXCEPTION 'V459_BLOCKERS_DELETED';
 EXCEPTION WHEN raise_exception THEN
   GET STACKED DIAGNOSTICS e=MESSAGE_TEXT;
   IF e<>'V459_EVIDENCE_APPEND_ONLY' THEN RAISE; END IF;
 END;
 IF (SELECT count(*) FROM v459_private.qa_release_controls('qa_shop_a'))<>7
 THEN RAISE EXCEPTION 'V459_FAKE_COMPLETION_CORRUPTED_AUDIT'; END IF;
END$$;
\echo V459_PG17_IMMUTABLE_SYNTHETIC_EVIDENCE_GUARD_PASS
DO $$BEGIN
 IF (SELECT count(*) FROM v459_private.qa_release_controls('qa_shop_b'))<>7 OR
 (SELECT count(*) FROM v459_private.qa_release_controls('qa_shop_x'))<>0
 THEN RAISE EXCEPTION 'V459_CROSS_TENANT_AUDIT_LEAK'; END IF;
END$$;
\echo V459_PG17_TENANT_SCOPED_READ_ONLY_REPORT_PASS
-- GitHub Actions will issue eight independent read-only queries on shop A.
-- Fixture status is NOT a substitute for independent evidence or commercial GO.
