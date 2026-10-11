-- DPRO CAR02 R93M. USE ONLY inside disposable PostgreSQL 17 GitHub Actions container.
-- Never execute in Supabase, a real studio, or any existing database.
-- Shows real PostgreSQL reserve -> ready and uncertain upload -> atomic tombstone+outbox.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'car02_r93m_qa_ci' OR current_setting('server_version_num')::integer<170000 OR
    to_regclass('public.ksh_car02_photos') IS NOT NULL OR to_regclass('public.ksh_car02_staff_access') IS NOT NULL OR
    to_regnamespace('car02_r93m_qa') IS NOT NULL THEN
  RAISE EXCEPTION 'R93M_DISPOSABLE_POSTGRES17_ONLY';
 END IF;
END $$;
CREATE SCHEMA car02_r93m_qa;
REVOKE ALL ON SCHEMA car02_r93m_qa FROM PUBLIC;
CREATE TABLE car02_r93m_qa.staff(
 shop_code text NOT NULL,staff_id uuid NOT NULL,role text NOT NULL CHECK(role IN ('staff','owner')),
 active boolean NOT NULL,PRIMARY KEY(shop_code,staff_id));
CREATE TABLE car02_r93m_qa.work_orders(
 id uuid PRIMARY KEY,shop_code text NOT NULL,status text NOT NULL CHECK(status IN ('draft','completed')));
CREATE TABLE car02_r93m_qa.reports(
 id uuid PRIMARY KEY,shop_code text NOT NULL,order_id uuid NOT NULL REFERENCES car02_r93m_qa.work_orders(id));
CREATE TABLE car02_r93m_qa.photos(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),shop_code text NOT NULL,order_id uuid NOT NULL,
 report_id uuid NOT NULL REFERENCES car02_r93m_qa.reports(id),storage_bucket text NOT NULL
 CHECK(storage_bucket='ksh-car02-private-photos'),storage_path text NOT NULL UNIQUE,
 mime_type text NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp')),
 byte_size bigint NOT NULL CHECK(byte_size BETWEEN 4 AND 5242880),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 upload_state text NOT NULL DEFAULT 'pending' CHECK(upload_state IN ('pending','ready','deleted')),
 created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE car02_r93m_qa.cleanup_jobs(
 job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),photo_id uuid NOT NULL UNIQUE REFERENCES car02_r93m_qa.photos(id),
 shop_code text NOT NULL,storage_path text NOT NULL,
 state text NOT NULL CHECK(state='queued'),reason text NOT NULL CHECK(reason='UPLOAD_UNCERTAIN'));
REVOKE ALL ON ALL TABLES IN SCHEMA car02_r93m_qa FROM PUBLIC;

CREATE FUNCTION car02_r93m_qa.guard_photo() RETURNS trigger
LANGUAGE plpgsql SET search_path=car02_r93m_qa,pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'R93M_HARD_DELETE_BLOCKED' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.upload_state<>'pending' THEN RAISE EXCEPTION 'R93M_INSERT_MUST_BE_PENDING' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.upload_state='deleted' THEN RAISE EXCEPTION 'R93M_TOMBSTONE_FINAL' USING ERRCODE='23514'; END IF;
 IF ROW(OLD.id,OLD.shop_code,OLD.order_id,OLD.report_id,OLD.storage_bucket,OLD.storage_path,
    OLD.mime_type,OLD.byte_size,OLD.sha256,OLD.created_at) IS DISTINCT FROM
    ROW(NEW.id,NEW.shop_code,NEW.order_id,NEW.report_id,NEW.storage_bucket,NEW.storage_path,
    NEW.mime_type,NEW.byte_size,NEW.sha256,NEW.created_at) THEN
  RAISE EXCEPTION 'R93M_METADATA_CHANGED' USING ERRCODE='23514';
 END IF;
 IF OLD.upload_state='ready' AND NEW.upload_state<>'ready' THEN
   RAISE EXCEPTION 'R93M_READY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER car02_r93m_guard BEFORE INSERT OR UPDATE OR DELETE ON car02_r93m_qa.photos
FOR EACH ROW EXECUTE FUNCTION car02_r93m_qa.guard_photo();

-- These QA-only functions execute the SQL statements the R93M port uses, as real PG transactions.
CREATE FUNCTION car02_r93m_qa.qa_reserve(s text,u uuid,role_name text,o uuid,r uuid,p text,h text)
RETURNS uuid LANGUAGE plpgsql SET search_path=car02_r93m_qa,pg_catalog AS $$
DECLARE member record;scope record;n integer;v uuid;
BEGIN
 SELECT role,active INTO member FROM car02_r93m_qa.staff WHERE shop_code=s AND staff_id=u FOR UPDATE;
 IF NOT FOUND OR member.active IS DISTINCT FROM true OR member.role<>role_name THEN
  RAISE EXCEPTION 'R93M_STAFF_DENIED'; END IF;
 SELECT wo.id AS order_id,rep.id AS report_id,wo.status AS order_status INTO scope
 FROM car02_r93m_qa.work_orders wo JOIN car02_r93m_qa.reports rep ON rep.order_id=wo.id
 WHERE wo.id=o AND wo.shop_code=s AND rep.id=r AND rep.shop_code=s FOR UPDATE OF wo,rep;
 IF NOT FOUND OR scope.order_status<>'draft' THEN RAISE EXCEPTION 'R93M_DRAFT_SCOPE_REQUIRED'; END IF;
 SELECT count(*) INTO n FROM car02_r93m_qa.photos
  WHERE shop_code=s AND report_id=r AND upload_state IN ('pending','ready');
 IF n>=3 THEN RAISE EXCEPTION 'R93M_THREE_PHOTO_LIMIT'; END IF;
 IF left(p,length(s||'/'||o::text||'/'||r::text||'/')) <> s||'/'||o::text||'/'||r::text||'/' OR
    substring(p FROM length(s||'/'||o::text||'/'||r::text||'/')+1) !~
    '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}\.jpg$' THEN
   RAISE EXCEPTION 'R93M_BAD_PATH';
 END IF;
 INSERT INTO car02_r93m_qa.photos(shop_code,order_id,report_id,storage_bucket,storage_path,
 mime_type,byte_size,sha256,upload_state) VALUES(s,o,r,'ksh-car02-private-photos',p,
 'image/jpeg',200,h,'pending') RETURNING id INTO v;
 RETURN v;
END $$;
CREATE FUNCTION car02_r93m_qa.qa_set_state(s text,u uuid,role_name text,o uuid,r uuid,id_photo uuid,p text,do_compensate boolean)
RETURNS uuid LANGUAGE plpgsql SET search_path=car02_r93m_qa,pg_catalog AS $$
DECLARE member record;photo record;changed uuid;job uuid;
BEGIN
 SELECT role,active INTO member FROM car02_r93m_qa.staff WHERE shop_code=s AND staff_id=u FOR UPDATE;
 IF NOT FOUND OR member.active IS DISTINCT FROM true OR member.role<>role_name THEN
  RAISE EXCEPTION 'R93M_STAFF_DENIED'; END IF;
 SELECT ph.id,ph.upload_state,ph.storage_path,ph.storage_bucket,wo.status AS order_status INTO photo
 FROM car02_r93m_qa.photos ph
 JOIN car02_r93m_qa.reports rep ON rep.id=ph.report_id AND rep.shop_code=ph.shop_code
 JOIN car02_r93m_qa.work_orders wo ON wo.id=rep.order_id AND wo.shop_code=ph.shop_code
 WHERE ph.id=id_photo AND ph.shop_code=s AND ph.order_id=o AND ph.report_id=r AND wo.id=o
 FOR UPDATE OF ph,rep,wo;
 IF NOT FOUND OR photo.upload_state<>'pending' OR photo.storage_path<>p OR
   photo.storage_bucket<>'ksh-car02-private-photos' THEN
  RAISE EXCEPTION 'R93M_PENDING_SCOPE_MISMATCH'; END IF;
 IF NOT do_compensate AND photo.order_status<>'draft' THEN RAISE EXCEPTION 'R93M_ORDER_NOT_DRAFT'; END IF;
 UPDATE car02_r93m_qa.photos SET upload_state=CASE WHEN do_compensate THEN 'deleted' ELSE 'ready' END
 WHERE id=id_photo AND shop_code=s AND order_id=o AND report_id=r AND storage_path=p AND upload_state='pending'
 RETURNING id INTO changed;
 IF changed IS DISTINCT FROM id_photo THEN RAISE EXCEPTION 'R93M_STATE_CONFLICT'; END IF;
 IF do_compensate THEN
  INSERT INTO car02_r93m_qa.cleanup_jobs(photo_id,shop_code,storage_path,state,reason)
  VALUES(id_photo,s,p,'queued','UPLOAD_UNCERTAIN') RETURNING job_id INTO job;
  RETURN job;
 END IF;
 RETURN id_photo;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA car02_r93m_qa FROM PUBLIC;

INSERT INTO car02_r93m_qa.staff VALUES
('street_house_kitsuki','11111111-1111-4111-8111-111111111111','staff',true),
('street_house_kitsuki','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','staff',false),
('other_shop','ffffffff-ffff-4fff-8fff-ffffffffffff','owner',true);
INSERT INTO car02_r93m_qa.work_orders VALUES
('22222222-2222-4222-8222-222222222222','street_house_kitsuki','draft'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','other_shop','draft');
INSERT INTO car02_r93m_qa.reports VALUES
('33333333-3333-4333-8333-333333333333','street_house_kitsuki','22222222-2222-4222-8222-222222222222'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','other_shop','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

-- Real PG success path: R83-style pending reservation -> verified ready, no outbox.
DO $$ DECLARE photo_id uuid;no_jobs integer; s text:='street_house_kitsuki';
 o uuid:='22222222-2222-4222-8222-222222222222';r uuid:='33333333-3333-4333-8333-333333333333';
 u uuid:='11111111-1111-4111-8111-111111111111';
 p text:= 'street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/77777777-7777-4777-8777-777777777777.jpg';
BEGIN
 photo_id:=car02_r93m_qa.qa_reserve(s,u,'staff',o,r,p,repeat('a',64));
 PERFORM car02_r93m_qa.qa_set_state(s,u,'staff',o,r,photo_id,p,false);
 IF (SELECT upload_state FROM car02_r93m_qa.photos WHERE id=photo_id)<>'ready' THEN
  RAISE EXCEPTION 'R93M_READY_MISSING'; END IF;
 SELECT count(*) INTO no_jobs FROM car02_r93m_qa.cleanup_jobs;
 IF no_jobs<>0 THEN RAISE EXCEPTION 'R93M_READY_ENQUEUED_CLEANUP'; END IF;
 -- Simulate lost ACK after commit: never tombstone ready evidence.
 BEGIN
  PERFORM car02_r93m_qa.qa_set_state(s,u,'staff',o,r,photo_id,p,true);
  RAISE EXCEPTION 'R93M_READY_TOMBSTONED';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='R93M_READY_TOMBSTONED' THEN RAISE; END IF;
 END;
END $$;
-- Missing role/wrong tenant are rejected without reserving a record.
DO $$ DECLARE v text;rejected boolean;BEGIN
 FOREACH v IN ARRAY ARRAY['inactive','foreign','wrong_role','wrong_path'] LOOP
 rejected:=false;
 BEGIN
  PERFORM car02_r93m_qa.qa_reserve('street_house_kitsuki',
   CASE WHEN v='inactive' THEN 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid
        WHEN v='foreign' THEN 'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid
        ELSE '11111111-1111-4111-8111-111111111111'::uuid END,
   CASE WHEN v='wrong_role' THEN 'owner' ELSE 'staff' END,
   '22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
   CASE WHEN v='wrong_path' THEN 'bad/path.jpg' ELSE 'street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/88888888-8888-4888-8888-888888888888.jpg' END,
   repeat('a',64));
 EXCEPTION WHEN raise_exception THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'R93M_SCOPE_DENIAL_FAILED_%',v; END IF;
 END LOOP;
END $$;
-- Pending upload with lost response, tombstone + durable outbox in one transaction.
DO $$ DECLARE pid uuid;jid uuid; s text:='street_house_kitsuki';
 o uuid:='22222222-2222-4222-8222-222222222222';r uuid:='33333333-3333-4333-8333-333333333333';
 u uuid:='11111111-1111-4111-8111-111111111111';
 p text:='street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/99999999-9999-4999-8999-999999999999.jpg';
BEGIN
 pid:=car02_r93m_qa.qa_reserve(s,u,'staff',o,r,p,repeat('b',64));
 jid:=car02_r93m_qa.qa_set_state(s,u,'staff',o,r,pid,p,true);
 IF jid IS NULL OR (SELECT count(*) FROM car02_r93m_qa.cleanup_jobs
  WHERE job_id=jid AND photo_id=pid AND storage_path=p AND state='queued')<>1
 THEN RAISE EXCEPTION 'R93M_ATOMIC_OUTBOX_MISSING'; END IF;
 IF (SELECT upload_state FROM car02_r93m_qa.photos WHERE id=pid)<>'deleted'
 THEN RAISE EXCEPTION 'R93M_TOMBSTONE_MISSING'; END IF;
 BEGIN
  PERFORM car02_r93m_qa.qa_set_state(s,u,'staff',o,r,pid,p,true);
  RAISE EXCEPTION 'R93M_DUPLICATE_TOMBSTONE_ALLOWED';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='R93M_DUPLICATE_TOMBSTONE_ALLOWED' THEN RAISE; END IF;
 END;
END $$;
-- A queued-job unique collision rolls back the attempted photo state transition.
DO $$ DECLARE pid uuid; s text:='street_house_kitsuki';
 o uuid:='22222222-2222-4222-8222-222222222222';r uuid:='33333333-3333-4333-8333-333333333333';
 u uuid:='11111111-1111-4111-8111-111111111111';
 p text:='street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg';
 rejected boolean:=false;
BEGIN
 pid:=car02_r93m_qa.qa_reserve(s,u,'staff',o,r,p,repeat('c',64));
 INSERT INTO car02_r93m_qa.cleanup_jobs(photo_id,shop_code,storage_path,state,reason)
 VALUES(pid,s,p,'queued','UPLOAD_UNCERTAIN');
 BEGIN
  PERFORM car02_r93m_qa.qa_set_state(s,u,'staff',o,r,pid,p,true);
 EXCEPTION WHEN unique_violation THEN rejected:=true; END;
 IF NOT rejected OR (SELECT upload_state FROM car02_r93m_qa.photos WHERE id=pid)<>'pending'
 THEN RAISE EXCEPTION 'R93M_OUTBOX_FAILURE_PARTIAL_TOMBSTONE'; END IF;
END $$;
-- Four active photos are never allowed. The row locks guard this count transactionally.
DO $$ DECLARE rejected boolean:=false;BEGIN
 BEGIN
  PERFORM car02_r93m_qa.qa_reserve('street_house_kitsuki','11111111-1111-4111-8111-111111111111','staff',
   '22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
   'street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg',repeat('d',64));
 EXCEPTION WHEN raise_exception THEN rejected:=true; END;
 -- At this point only two are active (one READY and one PENDING). The third may be reserved.
 IF rejected THEN RAISE EXCEPTION 'R93M_PREMATURE_LIMIT'; END IF;
 BEGIN
  PERFORM car02_r93m_qa.qa_reserve('street_house_kitsuki','11111111-1111-4111-8111-111111111111','staff',
   '22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
   'street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg',repeat('e',64));
  RAISE EXCEPTION 'R93M_LIMIT_NOT_ENFORCED';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='R93M_LIMIT_NOT_ENFORCED' THEN RAISE; END IF;
 END;
END $$;
-- No changes persist; schema must disappear after outer rollback.
ROLLBACK;
\echo R93M_PG17_UNIFIED_LIFECYCLE_AND_ROLLBACK_PASS
