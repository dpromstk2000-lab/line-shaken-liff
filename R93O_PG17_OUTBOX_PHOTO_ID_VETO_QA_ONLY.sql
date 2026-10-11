-- CAR02 R93O: disposable PostgreSQL 17 QA ONLY; no Supabase changes.
-- Conflicting cleanup rows must block ready-proof on PHOTO ID, regardless of
-- misleading shop/path values on the cleanup row. Everything rolls back.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'car02_r93o_qa_ci' OR current_setting('server_version_num')::int<170000 OR
    to_regnamespace('car02_r93o_qa') IS NOT NULL OR
    to_regclass('public.ksh_car02_photos') IS NOT NULL OR
    to_regclass('public.ksh_car02_staff_access') IS NOT NULL THEN
  RAISE EXCEPTION 'R93O_DISPOSABLE_POSTGRES_17_ONLY';
 END IF;
END $$;
CREATE SCHEMA car02_r93o_qa;
REVOKE ALL ON SCHEMA car02_r93o_qa FROM PUBLIC;
CREATE TABLE car02_r93o_qa.staff(shop_code text,staff_id uuid,role text,active boolean,
 PRIMARY KEY(shop_code,staff_id));
CREATE TABLE car02_r93o_qa.photos(id uuid PRIMARY KEY,shop_code text NOT NULL,
 storage_path text NOT NULL,upload_state text NOT NULL);
-- Intentionally allow inconsistent shop/path in a legacy/corrupt outbox row.
-- The reconciliation query must deny ready irrespective of those values.
CREATE TABLE car02_r93o_qa.cleanup_jobs(photo_id uuid NOT NULL,shop_code text,storage_path text);
REVOKE ALL ON ALL TABLES IN SCHEMA car02_r93o_qa FROM PUBLIC;
INSERT INTO car02_r93o_qa.staff VALUES
 ('street_house_kitsuki','11111111-1111-4111-8111-111111111111','staff',true),
 ('street_house_kitsuki','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','staff',false);
INSERT INTO car02_r93o_qa.photos VALUES
 ('44444444-4444-4444-8444-444444444444','street_house_kitsuki','correct/path.jpg','ready'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','street_house_kitsuki','unrelated/path.jpg','ready');
CREATE FUNCTION car02_r93o_qa.qa_prove(photo uuid,shop text,actor uuid,expected_path text)
RETURNS boolean LANGUAGE sql STABLE SET search_path=car02_r93o_qa,pg_catalog AS $$
 SELECT EXISTS (
  SELECT 1 FROM car02_r93o_qa.photos p
  JOIN car02_r93o_qa.staff s ON s.shop_code=p.shop_code AND s.staff_id=$3
  WHERE p.id=$1 AND p.shop_code=$2 AND p.storage_path=$4 AND p.upload_state='ready'
    AND s.active IS TRUE AND s.role='staff'
    -- Critical: photo_id is the sole outbox conflict identity, never compare
    -- outbox shop/path because corrupted values must not bypass the veto.
    AND NOT EXISTS (SELECT 1 FROM car02_r93o_qa.cleanup_jobs j WHERE j.photo_id=p.id)
 );
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA car02_r93o_qa FROM PUBLIC;
DO $$ DECLARE
 p uuid:='44444444-4444-4444-8444-444444444444';
 actor uuid:='11111111-1111-4111-8111-111111111111';
BEGIN
 IF NOT car02_r93o_qa.qa_prove(p,'street_house_kitsuki',actor,'correct/path.jpg') THEN
  RAISE EXCEPTION 'R93O_VALID_READY_REJECTED'; END IF;
 IF car02_r93o_qa.qa_prove(p,'other_shop',actor,'correct/path.jpg') THEN
  RAISE EXCEPTION 'R93O_CROSS_TENANT_ACCEPTED'; END IF;
 IF car02_r93o_qa.qa_prove(p,'street_house_kitsuki',actor,'wrong/path.jpg') THEN
  RAISE EXCEPTION 'R93O_WRONG_PHOTO_PATH_ACCEPTED'; END IF;
 IF car02_r93o_qa.qa_prove(p,'street_house_kitsuki',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','correct/path.jpg') THEN
  RAISE EXCEPTION 'R93O_REVOKED_STAFF_ACCEPTED'; END IF;
END $$;
-- Existing cleanup row for another photo is harmless.
INSERT INTO car02_r93o_qa.cleanup_jobs VALUES
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','street_house_kitsuki','unrelated/path.jpg');
DO $$ BEGIN
 IF NOT car02_r93o_qa.qa_prove('44444444-4444-4444-8444-444444444444',
  'street_house_kitsuki','11111111-1111-4111-8111-111111111111','correct/path.jpg') THEN
  RAISE EXCEPTION 'R93O_UNRELATED_OUTBOX_BLOCKED'; END IF;
END $$;
-- Conflicting outbox row has SAME photo ID but WRONG shop AND path.
INSERT INTO car02_r93o_qa.cleanup_jobs VALUES
 ('44444444-4444-4444-8444-444444444444','other_shop','unrelated/wrong.jpg');
DO $$ BEGIN
 IF car02_r93o_qa.qa_prove('44444444-4444-4444-8444-444444444444',
  'street_house_kitsuki','11111111-1111-4111-8111-111111111111','correct/path.jpg') THEN
  RAISE EXCEPTION 'R93O_MISLABELED_OUTBOX_ACCEPTED'; END IF;
END $$;
-- Also refuse even if only path is inconsistent.
DELETE FROM car02_r93o_qa.cleanup_jobs
 WHERE photo_id='44444444-4444-4444-8444-444444444444';
INSERT INTO car02_r93o_qa.cleanup_jobs VALUES
 ('44444444-4444-4444-8444-444444444444','street_house_kitsuki','wrong/path.jpg');
DO $$ BEGIN
 IF car02_r93o_qa.qa_prove('44444444-4444-4444-8444-444444444444',
  'street_house_kitsuki','11111111-1111-4111-8111-111111111111','correct/path.jpg') THEN
  RAISE EXCEPTION 'R93O_WRONG_OUTBOX_PATH_ACCEPTED'; END IF;
END $$;
ROLLBACK;
DO $$ BEGIN IF to_regnamespace('car02_r93o_qa') IS NOT NULL THEN
 RAISE EXCEPTION 'R93O_SCHEMA_LEAK'; END IF; END $$;
\echo R93O_PG17_OUTBOX_PHOTO_ID_VETO_AND_ROLLBACK_PASS
