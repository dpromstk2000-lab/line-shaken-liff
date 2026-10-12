-- CAR02 R110 - GITHUB DISPOSABLE POSTGRES 17 FIXTURE ONLY.
-- REQUIRES R109 FIXTURE. NEVER APPLY TO PRODUCTION SUPABASE.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'car02_r109_qa_ci'
  OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
  OR to_regclass('public.ksh_car02_photos') IS NOT NULL
  OR to_regclass('car02_r109_qa.quarantine_ledger') IS NULL
  OR to_regclass('car02_r109_qa.quarantine_review_events') IS NOT NULL
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('car02_r110_a_ci','car02_r110_b_ci'))
 THEN RAISE EXCEPTION 'R110_DISPOSABLE_PG17_ONLY'; END IF;
END $$;
CREATE ROLE car02_r110_a_ci LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'r110-ci-review-only';
CREATE ROLE car02_r110_b_ci LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'r110-ci-review-only';
GRANT USAGE ON SCHEMA car02_r109_qa TO car02_r110_a_ci,car02_r110_b_ci;
-- R109 PK on job_id is retained; this unique index makes cross-tenant linkage enforceable by composite FK.
CREATE UNIQUE INDEX r110_ledger_shop_job_unique ON car02_r109_qa.quarantine_ledger(shop_code,job_id);
CREATE TABLE car02_r109_qa.quarantine_review_events(
 event_id uuid PRIMARY KEY,
 shop_code text NOT NULL CHECK(shop_code ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
 job_id uuid NOT NULL,
 event_kind text NOT NULL CHECK(event_kind IN ('EVIDENCE_HASH_RECORDED','ESCALATED_FOR_REVIEW')),
 proof_sha256 text NOT NULL CHECK(proof_sha256 ~ '^[0-9a-f]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(shop_code,job_id) REFERENCES car02_r109_qa.quarantine_ledger(shop_code,job_id)
);
REVOKE ALL ON car02_r109_qa.quarantine_review_events FROM PUBLIC;
GRANT SELECT,INSERT ON car02_r109_qa.quarantine_review_events TO car02_r110_a_ci,car02_r110_b_ci;
ALTER TABLE car02_r109_qa.quarantine_review_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE car02_r109_qa.quarantine_review_events FORCE ROW LEVEL SECURITY;
CREATE POLICY r110_read_tenant ON car02_r109_qa.quarantine_review_events FOR SELECT
 TO car02_r110_a_ci,car02_r110_b_ci USING(
  shop_code=CASE current_user WHEN 'car02_r110_a_ci' THEN 'street_house_kitsuki'
   WHEN 'car02_r110_b_ci' THEN 'other_shop' ELSE NULL END);
CREATE POLICY r110_insert_tenant ON car02_r109_qa.quarantine_review_events FOR INSERT
 TO car02_r110_a_ci,car02_r110_b_ci WITH CHECK(
  shop_code=CASE current_user WHEN 'car02_r110_a_ci' THEN 'street_house_kitsuki'
   WHEN 'car02_r110_b_ci' THEN 'other_shop' ELSE NULL END);
-- Append only, including table-owner ordinary DML. NOT protection against superuser DDL.
CREATE TRIGGER r110_refuse_update_delete BEFORE UPDATE OR DELETE
 ON car02_r109_qa.quarantine_review_events FOR EACH ROW
 EXECUTE FUNCTION car02_r109_qa.refuse_ledger_mutation();
CREATE TRIGGER r110_refuse_truncate BEFORE TRUNCATE
 ON car02_r109_qa.quarantine_review_events FOR EACH STATEMENT
 EXECUTE FUNCTION car02_r109_qa.refuse_ledger_mutation();
COMMIT;
\echo R110_DISPOSABLE_REVIEW_SCHEMA_READY
