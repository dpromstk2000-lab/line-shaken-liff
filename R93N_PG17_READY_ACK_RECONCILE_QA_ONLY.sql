-- CAR02 R93N disposable PostgreSQL 17 QA only. Not a Supabase migration.
-- Proves a FRESH SQL transaction can read the committed ready photo, and that
-- tenant / staff / immutable file identity / outbox conflicts fail closed.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'car02_r93n_qa_ci' OR current_setting('server_version_num')::int<170000 OR
  to_regnamespace('car02_r93n_qa') IS NOT NULL OR
  to_regclass('public.ksh_car02_photos') IS NOT NULL OR
  to_regclass('public.ksh_car02_staff_access') IS NOT NULL
 THEN RAISE EXCEPTION 'R93N_DISPOSABLE_PG17_ONLY'; END IF;
END $$;
CREATE SCHEMA car02_r93n_qa;
REVOKE ALL ON SCHEMA car02_r93n_qa FROM PUBLIC;
CREATE TABLE car02_r93n_qa.staff (shop_code text NOT NULL, staff_id uuid NOT NULL,
 role text NOT NULL CHECK(role IN('staff','owner')), active boolean NOT NULL,
 PRIMARY KEY(shop_code,staff_id));
CREATE TABLE car02_r93n_qa.work_orders(id uuid PRIMARY KEY,shop_code text NOT NULL,status text NOT NULL);
CREATE TABLE car02_r93n_qa.reports(id uuid PRIMARY KEY,shop_code text NOT NULL,
 order_id uuid NOT NULL REFERENCES car02_r93n_qa.work_orders(id));
CREATE TABLE car02_r93n_qa.photos (id uuid PRIMARY KEY,
 shop_code text NOT NULL,order_id uuid NOT NULL,report_id uuid NOT NULL,
 storage_bucket text NOT NULL,storage_path text NOT NULL,mime_type text NOT NULL,
 byte_size bigint NOT NULL,sha256 text NOT NULL,upload_state text NOT NULL);
CREATE TABLE car02_r93n_qa.cleanup_jobs(photo_id uuid NOT NULL,shop_code text NOT NULL,
 storage_path text NOT NULL);
REVOKE ALL ON ALL TABLES IN SCHEMA car02_r93n_qa FROM PUBLIC;
INSERT INTO car02_r93n_qa.staff VALUES
 ('street_house_kitsuki','11111111-1111-4111-8111-111111111111','staff',true),
 ('street_house_kitsuki','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','staff',false),
 ('other_shop','ffffffff-ffff-4fff-8fff-ffffffffffff','owner',true);
INSERT INTO car02_r93n_qa.work_orders VALUES
 ('22222222-2222-4222-8222-222222222222','street_house_kitsuki','draft'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','other_shop','draft');
INSERT INTO car02_r93n_qa.reports VALUES
 ('33333333-3333-4333-8333-333333333333','street_house_kitsuki','22222222-2222-4222-8222-222222222222'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','other_shop','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
INSERT INTO car02_r93n_qa.photos VALUES
 ('44444444-4444-4444-8444-444444444444','street_house_kitsuki',
  '22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
  'ksh-car02-private-photos',
  'street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/77777777-7777-4777-8777-777777777777.jpg',
  'image/jpeg',777,repeat('a',64),'ready'),
 ('88888888-8888-4888-8888-888888888888','street_house_kitsuki',
  '22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
  'ksh-car02-private-photos',
  'street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/99999999-9999-4999-8999-999999999999.jpg',
  'image/jpeg',777,repeat('b',64),'pending'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','street_house_kitsuki',
  '22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
  'ksh-car02-private-photos',
  'street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg',
  'image/jpeg',777,repeat('c',64),'ready');
INSERT INTO car02_r93n_qa.cleanup_jobs SELECT id,shop_code,storage_path
 FROM car02_r93n_qa.photos WHERE id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
-- This function is TEST-ONLY; production DB access policies are not implemented here.
CREATE FUNCTION car02_r93n_qa.qa_prove_ready(
 photo uuid,shop text,ord uuid,report uuid,actor uuid,role_name text,
 bucket text,storage_path text,mime text,nbytes bigint,digest text)
RETURNS boolean LANGUAGE sql STABLE SET search_path=car02_r93n_qa,pg_catalog AS $$
 SELECT EXISTS(
 SELECT 1 FROM car02_r93n_qa.photos p
 JOIN car02_r93n_qa.reports r ON r.id=p.report_id AND r.shop_code=p.shop_code
 JOIN car02_r93n_qa.work_orders o ON o.id=r.order_id AND o.shop_code=p.shop_code
 JOIN car02_r93n_qa.staff s ON s.shop_code=p.shop_code AND s.staff_id=actor
 WHERE p.id=photo AND p.shop_code=shop AND p.order_id=ord AND p.report_id=report
 AND o.id=ord AND o.status='draft' AND s.role=role_name AND s.active IS TRUE
 AND p.storage_bucket=bucket AND p.storage_path=storage_path
 AND p.mime_type=mime AND p.byte_size=nbytes AND p.sha256=digest AND p.upload_state='ready'
 AND NOT EXISTS (SELECT 1 FROM car02_r93n_qa.cleanup_jobs j WHERE j.photo_id=p.id)
 );
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA car02_r93n_qa FROM PUBLIC;
COMMIT;
-- The next BEGIN is a genuinely separate read transaction after the committed data.
BEGIN;
DO $$ DECLARE p uuid:='44444444-4444-4444-8444-444444444444';
 s text:='street_house_kitsuki';o uuid:='22222222-2222-4222-8222-222222222222';
 r uuid:='33333333-3333-4333-8333-333333333333';
 a uuid:='11111111-1111-4111-8111-111111111111';
 path text:='street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/77777777-7777-4777-8777-777777777777.jpg';
BEGIN
 IF NOT car02_r93n_qa.qa_prove_ready(p,s,o,r,a,'staff',
 'ksh-car02-private-photos',path,'image/jpeg',777,repeat('a',64))
 THEN RAISE EXCEPTION 'R93N_VALID_COMMITTED_READY_NOT_VERIFIED'; END IF;
 IF car02_r93n_qa.qa_prove_ready(p,'other_shop',o,r,a,'staff',
 'ksh-car02-private-photos',path,'image/jpeg',777,repeat('a',64))
 THEN RAISE EXCEPTION 'R93N_CROSS_SHOP_ACCEPTED'; END IF;
 IF car02_r93n_qa.qa_prove_ready(p,s,o,r,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','staff',
 'ksh-car02-private-photos',path,'image/jpeg',777,repeat('a',64))
 THEN RAISE EXCEPTION 'R93N_INACTIVE_STAFF_ACCEPTED'; END IF;
 IF car02_r93n_qa.qa_prove_ready(p,s,o,r,a,'owner',
 'ksh-car02-private-photos',path,'image/jpeg',777,repeat('a',64))
 THEN RAISE EXCEPTION 'R93N_WRONG_ROLE_ACCEPTED'; END IF;
 IF car02_r93n_qa.qa_prove_ready(p,s,o,r,a,'staff',
 'public',path,'image/jpeg',777,repeat('a',64))
 THEN RAISE EXCEPTION 'R93N_PUBLIC_BUCKET_ACCEPTED'; END IF;
 IF car02_r93n_qa.qa_prove_ready(p,s,o,r,a,'staff',
 'ksh-car02-private-photos','different/path.jpg','image/jpeg',777,repeat('a',64))
 THEN RAISE EXCEPTION 'R93N_PATH_MISMATCH_ACCEPTED'; END IF;
 IF car02_r93n_qa.qa_prove_ready(p,s,o,r,a,'staff',
 'ksh-car02-private-photos',path,'image/jpeg',999,repeat('a',64))
 THEN RAISE EXCEPTION 'R93N_BYTES_MISMATCH_ACCEPTED'; END IF;
 IF car02_r93n_qa.qa_prove_ready(p,s,o,r,a,'staff',
 'ksh-car02-private-photos',path,'image/jpeg',777,repeat('b',64))
 THEN RAISE EXCEPTION 'R93N_HASH_MISMATCH_ACCEPTED'; END IF;
 IF car02_r93n_qa.qa_prove_ready('88888888-8888-4888-8888-888888888888',s,o,r,a,'staff',
 'ksh-car02-private-photos',replace(path,'77777777-7777-4777-8777-777777777777','99999999-9999-4999-8999-999999999999'),
 'image/jpeg',777,repeat('b',64))
 THEN RAISE EXCEPTION 'R93N_PENDING_ACCEPTED'; END IF;
 IF car02_r93n_qa.qa_prove_ready('cccccccc-cccc-4ccc-8ccc-cccccccccccc',s,o,r,a,'staff',
 'ksh-car02-private-photos',replace(path,'77777777-7777-4777-8777-777777777777','cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
 'image/jpeg',777,repeat('c',64))
 THEN RAISE EXCEPTION 'R93N_QUEUED_CLEANUP_ACCEPTED'; END IF;
END $$;
ROLLBACK;
DROP SCHEMA car02_r93n_qa CASCADE;
DO $$ BEGIN IF to_regnamespace('car02_r93n_qa') IS NOT NULL THEN
 RAISE EXCEPTION 'R93N_SCHEMA_NOT_CLEANED'; END IF; END $$;
\echo R93N_PG17_FRESH_COMMIT_ACK_RECONCILIATION_PASS
