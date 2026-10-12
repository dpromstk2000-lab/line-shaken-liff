-- DPRO CAR02 R100 - ISOLATED CI PostgreSQL 17 ONLY. Do not run in Supabase or any existing database.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database() <> 'car02_r93q_qa_ci'
 OR current_setting('server_version_num')::int < 170000
 OR current_setting('server_version_num')::int >= 180000
 OR to_regclass('public.ksh_car02_photos') IS NOT NULL
 OR to_regclass('car02_r93q_qa.photos') IS NULL
 OR to_regclass('car02_r93q_qa.upload_intents') IS NULL
 OR to_regclass('car02_r93q_qa.r100_tenant_probe') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('car02_r100_a_ci','car02_r100_b_ci'))
 THEN RAISE EXCEPTION 'R100_DISPOSABLE_PG17_ONLY'; END IF;
END $$;
CREATE ROLE car02_r100_a_ci LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'r100-local-test-role-only';
CREATE ROLE car02_r100_b_ci LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'r100-local-test-role-only';

-- Synthetic two-tenant data. No real customer or Supabase storage objects.
INSERT INTO car02_r93q_qa.photos(id,shop_code,order_id,report_id,storage_bucket,storage_path,mime_type,byte_size,sha256)
VALUES
('44444444-4444-4444-8444-444444444444','street_house_kitsuki','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','ksh-car02-private-photos','street_house_kitsuki/fixture-r100-a.jpg','image/jpeg',10,repeat('a',64)),
('55555555-5555-4555-8555-555555555555','other_shop','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ksh-car02-private-photos','other_shop/fixture-r100-b.jpg','image/jpeg',10,repeat('b',64));
UPDATE car02_r93q_qa.photos SET upload_state='deleted' WHERE id IN ('44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555');
INSERT INTO car02_r93q_qa.upload_intents(shop_code,intent_key,photo_id,order_id,report_id,staff_id,role,storage_bucket,storage_path,mime_type,byte_size,sha256)
VALUES
('street_house_kitsuki','88888888-8888-4888-8888-000000000100','44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','staff','ksh-car02-private-photos','street_house_kitsuki/fixture-r100-a.jpg','image/jpeg',10,repeat('a',64)),
('other_shop','88888888-8888-4888-8888-000000000101','55555555-5555-4555-8555-555555555555','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ffffffff-ffff-4fff-8fff-ffffffffffff','owner','ksh-car02-private-photos','other_shop/fixture-r100-b.jpg','image/jpeg',10,repeat('b',64));
INSERT INTO car02_r93q_qa.cleanup_jobs(photo_id,shop_code,storage_path,state,reason)
VALUES ('44444444-4444-4444-8444-444444444444','street_house_kitsuki','street_house_kitsuki/fixture-r100-a.jpg','queued','UPLOAD_UNCERTAIN'),
       ('55555555-5555-4555-8555-555555555555','other_shop','other_shop/fixture-r100-b.jpg','queued','UPLOAD_UNCERTAIN');
CREATE TABLE car02_r93q_qa.r100_tenant_probe(id text PRIMARY KEY,shop_code text NOT NULL,payload text NOT NULL);
INSERT INTO car02_r93q_qa.r100_tenant_probe VALUES
('a_original','street_house_kitsuki','a_secret'),('b_original','other_shop','b_secret');
REVOKE ALL ON car02_r93q_qa.r100_tenant_probe FROM PUBLIC;
GRANT USAGE ON SCHEMA car02_r93q_qa TO car02_r100_a_ci,car02_r100_b_ci;
GRANT SELECT ON car02_r93q_qa.staff,car02_r93q_qa.work_orders,car02_r93q_qa.reports,
 car02_r93q_qa.photos,car02_r93q_qa.upload_intents,car02_r93q_qa.cleanup_jobs,
 car02_r93q_qa.r100_tenant_probe TO car02_r100_a_ci,car02_r100_b_ci;
GRANT INSERT,UPDATE,DELETE ON car02_r93q_qa.r100_tenant_probe TO car02_r100_a_ci,car02_r100_b_ci;

-- Identity derived from the authenticated low-privilege database login role, NOT caller-settable GUCs.
-- Future production auth/RLS may need another trusted binding; this is a disposable candidate only.
DO $$
DECLARE tbl text;
BEGIN
 FOREACH tbl IN ARRAY ARRAY['staff','work_orders','reports','photos','upload_intents','cleanup_jobs','r100_tenant_probe'] LOOP
  EXECUTE format('ALTER TABLE car02_r93q_qa.%I ENABLE ROW LEVEL SECURITY',tbl);
  EXECUTE format('ALTER TABLE car02_r93q_qa.%I FORCE ROW LEVEL SECURITY',tbl);
  EXECUTE format($p$CREATE POLICY r100_role_tenant_only ON car02_r93q_qa.%I FOR ALL
    TO car02_r100_a_ci,car02_r100_b_ci
    USING (shop_code=CASE current_user
     WHEN 'car02_r100_a_ci' THEN 'street_house_kitsuki'
     WHEN 'car02_r100_b_ci' THEN 'other_shop' ELSE NULL END)
    WITH CHECK (shop_code=CASE current_user
     WHEN 'car02_r100_a_ci' THEN 'street_house_kitsuki'
     WHEN 'car02_r100_b_ci' THEN 'other_shop' ELSE NULL END)$p$,tbl);
 END LOOP;
END $$;
COMMIT;
\echo R100_DISPOSABLE_RLS_FIXTURE_READY
