-- DPRO CAR02 R93H. DISPOSABLE PostgreSQL 17 GitHub Actions QA ONLY.
-- NEVER use on shared Supabase, production, staging or customer DB.
-- Demonstrates pending->deleted AND cleanup outbox row in one transaction.
-- No network, no Storage delete. A failed/unknown POST MUST be treated as potentially committed.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'postgres' OR current_setting('server_version_num')::int<170000
 OR to_regclass('public.ksh_car02_photos') IS NOT NULL OR
 to_regclass('public.ksh_demo_reservations') IS NOT NULL
 THEN RAISE EXCEPTION 'R93H_EPHEMERAL_POSTGRES17_REQUIRED'; END IF;
END $$;
CREATE SCHEMA car02_r93h_qa;
REVOKE ALL ON SCHEMA car02_r93h_qa FROM PUBLIC;
CREATE TABLE car02_r93h_qa.photos (
 id uuid PRIMARY KEY, shop_code text NOT NULL, order_id uuid NOT NULL,
 report_id uuid NOT NULL, storage_bucket text NOT NULL CHECK(storage_bucket='ksh-car02-private-photos'),
 storage_path text NOT NULL UNIQUE, upload_state text NOT NULL DEFAULT 'pending'
 CHECK(upload_state IN ('pending','ready','deleted')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE car02_r93h_qa.cleanup_jobs (
 job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 shop_code text NOT NULL, photo_id uuid NOT NULL UNIQUE REFERENCES car02_r93h_qa.photos(id),
 storage_path text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 state text NOT NULL DEFAULT 'queued' CHECK(state='queued')
);
REVOKE ALL ON ALL TABLES IN SCHEMA car02_r93h_qa FROM PUBLIC;
CREATE FUNCTION car02_r93h_qa.guard_photo() RETURNS trigger
LANGUAGE plpgsql SET search_path=car02_r93h_qa,pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'R93H_PHOTO_HARD_DELETE_REFUSED' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.upload_state<>'pending' THEN RAISE EXCEPTION 'R93H_NOT_PENDING' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.id,NEW.shop_code,NEW.order_id,NEW.report_id,NEW.storage_bucket,NEW.storage_path,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.shop_code,OLD.order_id,OLD.report_id,OLD.storage_bucket,OLD.storage_path,OLD.created_at)
 THEN RAISE EXCEPTION 'R93H_METADATA_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF OLD.upload_state<>'pending' AND NEW.upload_state IS DISTINCT FROM OLD.upload_state
 THEN RAISE EXCEPTION 'R93H_TERMINAL_STATE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_photo BEFORE INSERT OR UPDATE OR DELETE ON car02_r93h_qa.photos
FOR EACH ROW EXECUTE FUNCTION car02_r93h_qa.guard_photo();
CREATE FUNCTION car02_r93h_qa.enqueue_on_tombstone() RETURNS trigger
LANGUAGE plpgsql SET search_path=car02_r93h_qa,pg_catalog AS $$
BEGIN
 IF OLD.upload_state='pending' AND NEW.upload_state='deleted' THEN
   INSERT INTO car02_r93h_qa.cleanup_jobs(shop_code,photo_id,storage_path)
   VALUES(NEW.shop_code,NEW.id,NEW.storage_path);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER create_cleanup_outbox AFTER UPDATE OF upload_state ON car02_r93h_qa.photos
FOR EACH ROW EXECUTE FUNCTION car02_r93h_qa.enqueue_on_tombstone();
-- Simulates the narrowly-scoped repository.tombstoneAndEnqueue adapter.
CREATE FUNCTION car02_r93h_qa.compensate_pending(p_photo uuid,p_shop text,p_order uuid,p_report uuid,p_path text)
RETURNS boolean LANGUAGE sql SET search_path=car02_r93h_qa,pg_catalog AS $$
 WITH changed AS (
  UPDATE car02_r93h_qa.photos SET upload_state='deleted'
  WHERE id=p_photo AND shop_code=p_shop AND order_id=p_order AND report_id=p_report
    AND storage_path=p_path AND storage_bucket='ksh-car02-private-photos'
    AND upload_state='pending'
  RETURNING id
 ) SELECT EXISTS(SELECT 1 FROM changed)
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA car02_r93h_qa FROM PUBLIC;
INSERT INTO car02_r93h_qa.photos(id,shop_code,order_id,report_id,storage_bucket,storage_path)
VALUES
 ('44444444-4444-4444-8444-444444444444','street_house_kitsuki',
  '22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
  'ksh-car02-private-photos',
  'street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/77777777-7777-4777-8777-777777777777.jpg'),
 ('88888888-8888-4888-8888-888888888888','street_house_kitsuki',
  '22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
  'ksh-car02-private-photos',
  'street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/99999999-9999-4999-8999-999999999999.jpg');
-- First uncertain-upload compensation succeeds and creates exactly one durable job.
DO $$ DECLARE accepted boolean; count_jobs int; BEGIN
 SELECT car02_r93h_qa.compensate_pending('44444444-4444-4444-8444-444444444444',
 'street_house_kitsuki','22222222-2222-4222-8222-222222222222',
 '33333333-3333-4333-8333-333333333333',
 'street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/77777777-7777-4777-8777-777777777777.jpg') INTO accepted;
 IF NOT accepted THEN RAISE EXCEPTION 'R93H_VALID_COMPENSATION_FAILED'; END IF;
 SELECT count(*) INTO count_jobs FROM car02_r93h_qa.cleanup_jobs;
 IF count_jobs<>1 THEN RAISE EXCEPTION 'R93H_DURABLE_OUTBOX_NOT_INSERTED'; END IF;
 -- Second compensation is idempotent and cannot enqueue a second job.
 SELECT car02_r93h_qa.compensate_pending('44444444-4444-4444-8444-444444444444',
 'street_house_kitsuki','22222222-2222-4222-8222-222222222222',
 '33333333-3333-4333-8333-333333333333',
 'street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/77777777-7777-4777-8777-777777777777.jpg') INTO accepted;
 IF accepted THEN RAISE EXCEPTION 'R93H_DUPLICATE_COMPENSATION_ACCEPTED'; END IF;
END $$;
-- Fail-closed: cannot compensate another tenant, another photo or another blob path.
DO $$ DECLARE accepted boolean; BEGIN
 SELECT car02_r93h_qa.compensate_pending('88888888-8888-4888-8888-888888888888','other_shop',
 '22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
 'foreign/path.jpg') INTO accepted;
 IF accepted THEN RAISE EXCEPTION 'R93H_TENANT_SCOPE_FAILURE'; END IF;
END $$;
-- Inject a queue collision. The photo must remain pending when job insert fails.
INSERT INTO car02_r93h_qa.cleanup_jobs(photo_id,shop_code,storage_path)
SELECT id,shop_code,storage_path FROM car02_r93h_qa.photos
WHERE id='88888888-8888-4888-8888-888888888888';
DO $$ DECLARE accepted boolean; BEGIN
 BEGIN
  SELECT car02_r93h_qa.compensate_pending('88888888-8888-4888-8888-888888888888',
  'street_house_kitsuki','22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  'street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/99999999-9999-4999-8999-999999999999.jpg') INTO accepted;
  RAISE EXCEPTION 'R93H_OUTBOX_FAILURE_NOT_PROPAGATED';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 IF (SELECT upload_state FROM car02_r93h_qa.photos WHERE id='88888888-8888-4888-8888-888888888888')<>'pending'
 THEN RAISE EXCEPTION 'R93H_PARTIAL_TOMBSTONE'; END IF;
END $$;
DO $$ BEGIN
 IF (SELECT count(*) FROM car02_r93h_qa.cleanup_jobs)<>2 THEN RAISE EXCEPTION 'R93H_UNEXPECTED_JOB_COUNT'; END IF;
END $$;
ROLLBACK;
\echo R93H_PG17_ATOMIC_COMPENSATION_PASS
