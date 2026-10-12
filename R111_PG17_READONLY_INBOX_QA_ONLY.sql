-- DPRO CAR02 R111 disposable PG17 only. Never apply to Supabase or production.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'car02_r109_qa_ci'
 OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
 OR to_regclass('public.ksh_car02_photos') IS NOT NULL
 OR to_regclass('car02_r109_qa.quarantine_ledger') IS NULL
 OR to_regclass('car02_r109_qa.quarantine_review_events') IS NULL
 OR to_regclass('car02_r109_qa.r111_review_inbox') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('car02_r111_a_ci','car02_r111_b_ci'))
 THEN RAISE EXCEPTION 'R111_DISPOSABLE_PG17_ONLY'; END IF;
END $$;
CREATE ROLE car02_r111_a_ci LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'r111-ci-inbox-only';
CREATE ROLE car02_r111_b_ci LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'r111-ci-inbox-only';
GRANT USAGE ON SCHEMA car02_r109_qa TO car02_r111_a_ci,car02_r111_b_ci;
-- A PostgreSQL security-invoker view uses the viewer's RLS policies and table privileges.
-- Never use a definer view for cross-tenant data here.
CREATE POLICY r111_ledger_viewer ON car02_r109_qa.quarantine_ledger FOR SELECT
 TO car02_r111_a_ci,car02_r111_b_ci
 USING (shop_code=CASE current_user
   WHEN 'car02_r111_a_ci' THEN 'street_house_kitsuki'
   WHEN 'car02_r111_b_ci' THEN 'other_shop' ELSE NULL END);
CREATE POLICY r111_events_viewer ON car02_r109_qa.quarantine_review_events FOR SELECT
 TO car02_r111_a_ci,car02_r111_b_ci
 USING (shop_code=CASE current_user
   WHEN 'car02_r111_a_ci' THEN 'street_house_kitsuki'
   WHEN 'car02_r111_b_ci' THEN 'other_shop' ELSE NULL END);
GRANT SELECT (shop_code,job_id,state,reason,created_at)
 ON car02_r109_qa.quarantine_ledger TO car02_r111_a_ci,car02_r111_b_ci;
GRANT SELECT (shop_code,job_id,event_kind,recorded_at,event_id)
 ON car02_r109_qa.quarantine_review_events TO car02_r111_a_ci,car02_r111_b_ci;
CREATE INDEX r111_review_lookup ON car02_r109_qa.quarantine_review_events
 (shop_code,job_id,recorded_at DESC,event_id DESC);
CREATE VIEW car02_r109_qa.r111_review_inbox WITH (security_invoker=true,security_barrier=true) AS
 SELECT l.shop_code,l.job_id,l.state,l.reason,
   date_trunc('milliseconds',l.created_at) AS created_at,
   COALESCE(agg.review_count,0)::int AS review_count,
   COALESCE(agg.escalated,false) AS escalated,
   latest.event_kind AS latest_event_kind,
   latest.recorded_at AS latest_recorded_at
 FROM car02_r109_qa.quarantine_ledger l
 LEFT JOIN LATERAL (
   SELECT count(*)::int AS review_count,
    coalesce(bool_or(e.event_kind='ESCALATED_FOR_REVIEW'),false) AS escalated
   FROM car02_r109_qa.quarantine_review_events e
   WHERE e.shop_code=l.shop_code AND e.job_id=l.job_id
 ) agg ON true
 LEFT JOIN LATERAL (
   SELECT e.event_kind,e.recorded_at
   FROM car02_r109_qa.quarantine_review_events e
   WHERE e.shop_code=l.shop_code AND e.job_id=l.job_id
   ORDER BY e.recorded_at DESC,e.event_id DESC LIMIT 1
 ) latest ON true;
REVOKE ALL ON car02_r109_qa.r111_review_inbox FROM PUBLIC;
GRANT SELECT ON car02_r109_qa.r111_review_inbox TO car02_r111_a_ci,car02_r111_b_ci;
COMMIT;
\echo R111_DISPOSABLE_READONLY_INBOX_SCHEMA_READY
