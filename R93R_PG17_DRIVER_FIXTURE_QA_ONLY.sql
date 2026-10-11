-- DPRO CAR02 R93Q. USE ONLY inside disposable PostgreSQL 17 GitHub Actions container.
-- Never execute in Supabase, a real studio, or any existing database.
-- Shows real PostgreSQL reserve -> ready and uncertain upload -> atomic tombstone+outbox.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'car02_r93q_qa_ci' OR current_setting('server_version_num')::integer<170000 OR
    to_regclass('public.ksh_car02_photos') IS NOT NULL OR to_regclass('public.ksh_car02_staff_access') IS NOT NULL OR
    to_regnamespace('car02_r93q_qa') IS NOT NULL THEN
  RAISE EXCEPTION 'R93Q_DISPOSABLE_POSTGRES17_ONLY';
 END IF;
END $$;
CREATE SCHEMA car02_r93q_qa;
REVOKE ALL ON SCHEMA car02_r93q_qa FROM PUBLIC;
CREATE TABLE car02_r93q_qa.staff(
 shop_code text NOT NULL,staff_id uuid NOT NULL,role text NOT NULL CHECK(role IN ('staff','owner')),
 active boolean NOT NULL,PRIMARY KEY(shop_code,staff_id));
CREATE TABLE car02_r93q_qa.work_orders(
 id uuid PRIMARY KEY,shop_code text NOT NULL,status text NOT NULL CHECK(status IN ('draft','completed')));
CREATE TABLE car02_r93q_qa.reports(
 id uuid PRIMARY KEY,shop_code text NOT NULL,order_id uuid NOT NULL REFERENCES car02_r93q_qa.work_orders(id));
CREATE TABLE car02_r93q_qa.photos(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),shop_code text NOT NULL,order_id uuid NOT NULL,
 report_id uuid NOT NULL REFERENCES car02_r93q_qa.reports(id),storage_bucket text NOT NULL
 CHECK(storage_bucket='ksh-car02-private-photos'),storage_path text NOT NULL UNIQUE,
 mime_type text NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp')),
 byte_size bigint NOT NULL CHECK(byte_size BETWEEN 4 AND 5242880),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 upload_state text NOT NULL DEFAULT 'pending' CHECK(upload_state IN ('pending','ready','deleted')),
 created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE car02_r93q_qa.cleanup_jobs(
 job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),photo_id uuid NOT NULL UNIQUE REFERENCES car02_r93q_qa.photos(id),
 shop_code text NOT NULL,storage_path text NOT NULL,
 state text NOT NULL CHECK(state='queued'),reason text NOT NULL CHECK(reason='UPLOAD_UNCERTAIN'));
REVOKE ALL ON ALL TABLES IN SCHEMA car02_r93q_qa FROM PUBLIC;

CREATE FUNCTION car02_r93q_qa.guard_photo() RETURNS trigger
LANGUAGE plpgsql SET search_path=car02_r93q_qa,pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'R93Q_HARD_DELETE_BLOCKED' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.upload_state<>'pending' THEN RAISE EXCEPTION 'R93Q_INSERT_MUST_BE_PENDING' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.upload_state='deleted' THEN RAISE EXCEPTION 'R93Q_TOMBSTONE_FINAL' USING ERRCODE='23514'; END IF;
 IF ROW(OLD.id,OLD.shop_code,OLD.order_id,OLD.report_id,OLD.storage_bucket,OLD.storage_path,
    OLD.mime_type,OLD.byte_size,OLD.sha256,OLD.created_at) IS DISTINCT FROM
    ROW(NEW.id,NEW.shop_code,NEW.order_id,NEW.report_id,NEW.storage_bucket,NEW.storage_path,
    NEW.mime_type,NEW.byte_size,NEW.sha256,NEW.created_at) THEN
  RAISE EXCEPTION 'R93Q_METADATA_CHANGED' USING ERRCODE='23514';
 END IF;
 IF OLD.upload_state='ready' AND NEW.upload_state<>'ready' THEN
   RAISE EXCEPTION 'R93Q_READY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER car02_r93q_guard BEFORE INSERT OR UPDATE OR DELETE ON car02_r93q_qa.photos
FOR EACH ROW EXECUTE FUNCTION car02_r93q_qa.guard_photo();


INSERT INTO car02_r93q_qa.staff VALUES
('street_house_kitsuki','11111111-1111-4111-8111-111111111111','staff',true),
('street_house_kitsuki','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','staff',false),
('other_shop','ffffffff-ffff-4fff-8fff-ffffffffffff','owner',true);
INSERT INTO car02_r93q_qa.work_orders VALUES
('22222222-2222-4222-8222-222222222222','street_house_kitsuki','draft'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','other_shop','draft');
INSERT INTO car02_r93q_qa.reports VALUES
('33333333-3333-4333-8333-333333333333','street_house_kitsuki','22222222-2222-4222-8222-222222222222'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','other_shop','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');


COMMIT;
\echo R93R_DISPOSABLE_PG17_FIXTURE_READY
