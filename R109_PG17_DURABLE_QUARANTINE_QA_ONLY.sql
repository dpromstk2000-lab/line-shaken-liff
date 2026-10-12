-- CAR02 R109 CI FIXTURE ONLY. NEVER APPLY TO SUPABASE OR LIVE DB.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database() <> 'car02_r109_qa_ci'
  OR current_setting('server_version_num')::integer < 170000
  OR current_setting('server_version_num')::integer >= 180000
  OR to_regclass('public.ksh_car02_photos') IS NOT NULL
  OR to_regclass('car02_r109_qa.quarantine_ledger') IS NOT NULL
  OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('car02_r109_a_ci','car02_r109_b_ci'))
 THEN RAISE EXCEPTION 'R109_DISPOSABLE_PG17_ONLY'; END IF;
END $$;
CREATE ROLE car02_r109_a_ci LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'r109-ci-tenant-local-only';
CREATE ROLE car02_r109_b_ci LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'r109-ci-tenant-local-only';
CREATE SCHEMA car02_r109_qa;
REVOKE ALL ON SCHEMA car02_r109_qa FROM PUBLIC;
GRANT USAGE ON SCHEMA car02_r109_qa TO car02_r109_a_ci,car02_r109_b_ci;
CREATE TABLE car02_r109_qa.photo_scope (
 shop_code text NOT NULL,
 photo_id uuid NOT NULL,
 PRIMARY KEY(shop_code,photo_id)
);
-- Synthetic photo scope: cannot reference someone else's photo under a different tenant.
INSERT INTO car02_r109_qa.photo_scope(shop_code,photo_id) VALUES
 ('street_house_kitsuki','11111111-1111-4111-8111-111111111109'),
 ('street_house_kitsuki','11111111-1111-4111-8111-111111111110'),
 ('other_shop','22222222-2222-4222-8222-222222222109');
CREATE TABLE car02_r109_qa.quarantine_ledger (
 job_id uuid PRIMARY KEY,
 shop_code text NOT NULL,
 photo_id uuid NOT NULL,
 bucket text NOT NULL DEFAULT 'ksh-car02-private-photos'
   CHECK(bucket='ksh-car02-private-photos'),
 storage_path text NOT NULL UNIQUE,
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 reason text NOT NULL CHECK(reason IN ('UPLOAD_UNCERTAIN','STORAGE_DELETE_UNVERIFIED','ACK_LOST')),
 state text NOT NULL DEFAULT 'QUARANTINED' CHECK(state='QUARANTINED'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY (shop_code,photo_id) REFERENCES car02_r109_qa.photo_scope(shop_code,photo_id),
 CHECK(shop_code ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
 CHECK(left(storage_path,char_length(shop_code)+1)=shop_code || '/'),
 CHECK(storage_path ~ '^[a-z0-9][a-z0-9_-]{1,63}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$')
);
REVOKE ALL ON car02_r109_qa.quarantine_ledger FROM PUBLIC;
GRANT SELECT,INSERT ON car02_r109_qa.quarantine_ledger TO car02_r109_a_ci,car02_r109_b_ci;
ALTER TABLE car02_r109_qa.quarantine_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE car02_r109_qa.quarantine_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY r109_read_tenant ON car02_r109_qa.quarantine_ledger FOR SELECT
 TO car02_r109_a_ci,car02_r109_b_ci
 USING (shop_code=CASE current_user
  WHEN 'car02_r109_a_ci' THEN 'street_house_kitsuki'
  WHEN 'car02_r109_b_ci' THEN 'other_shop' ELSE NULL END);
CREATE POLICY r109_insert_tenant ON car02_r109_qa.quarantine_ledger FOR INSERT
 TO car02_r109_a_ci,car02_r109_b_ci
 WITH CHECK(shop_code=CASE current_user
  WHEN 'car02_r109_a_ci' THEN 'street_house_kitsuki'
  WHEN 'car02_r109_b_ci' THEN 'other_shop' ELSE NULL END);
-- Immutable even for ordinary table owner actions. Superuser/DDL remains a separate, unproved admin risk.
CREATE FUNCTION car02_r109_qa.refuse_ledger_mutation() RETURNS trigger
 LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'R109_LEDGER_IMMUTABLE' USING ERRCODE='42501';
 RETURN NULL;
END $$;
CREATE TRIGGER r109_refuse_update_delete BEFORE UPDATE OR DELETE
 ON car02_r109_qa.quarantine_ledger FOR EACH ROW
 EXECUTE FUNCTION car02_r109_qa.refuse_ledger_mutation();
CREATE TRIGGER r109_refuse_truncate BEFORE TRUNCATE
 ON car02_r109_qa.quarantine_ledger FOR EACH STATEMENT
 EXECUTE FUNCTION car02_r109_qa.refuse_ledger_mutation();
COMMIT;
\echo R109_DISPOSABLE_QUARANTINE_SCHEMA_READY
