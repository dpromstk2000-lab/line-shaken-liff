-- CAR02 R122: synthetic PostgreSQL 17 CI FIXTURE ONLY; NEVER execute in Supabase.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database() <> 'car02_r122_qa_ci'
    OR current_setting('server_version_num')::int < 170000
    OR current_setting('server_version_num')::int >= 180000
    OR to_regclass('public.ksh_car02_photos') IS NOT NULL
    OR to_regclass('car02_r122_qa.photo_intents') IS NOT NULL
    OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('car02_r122_a_ci','car02_r122_b_ci'))
 THEN RAISE EXCEPTION 'R122_DISPOSABLE_PG17_ONLY' USING ERRCODE='42501'; END IF;
END $$;
CREATE ROLE car02_r122_a_ci LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'r122-ci-disposable-only';
CREATE ROLE car02_r122_b_ci LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'r122-ci-disposable-only';
CREATE SCHEMA car02_r122_qa;
REVOKE ALL ON SCHEMA car02_r122_qa FROM PUBLIC;
GRANT USAGE ON SCHEMA car02_r122_qa TO car02_r122_a_ci, car02_r122_b_ci;
CREATE TABLE car02_r122_qa.report_scope (
 shop_code text NOT NULL CHECK (shop_code IN ('street_house_demo','other_demo')),
 report_id uuid NOT NULL,
 order_id uuid NOT NULL,
 PRIMARY KEY(shop_code,report_id),
 UNIQUE(shop_code,order_id,report_id)
);
INSERT INTO car02_r122_qa.report_scope VALUES
 ('street_house_demo','22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111'),
 ('other_demo','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
GRANT SELECT ON car02_r122_qa.report_scope TO car02_r122_a_ci,car02_r122_b_ci;
ALTER TABLE car02_r122_qa.report_scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE car02_r122_qa.report_scope FORCE ROW LEVEL SECURITY;
CREATE POLICY r122_scope_select ON car02_r122_qa.report_scope FOR SELECT TO car02_r122_a_ci,car02_r122_b_ci
 USING (shop_code=CASE session_user WHEN 'car02_r122_a_ci' THEN 'street_house_demo' WHEN 'car02_r122_b_ci' THEN 'other_demo' ELSE NULL END);
CREATE TABLE car02_r122_qa.photo_intents (
 shop_code text NOT NULL CHECK (shop_code IN ('street_house_demo','other_demo')),
 intent_key uuid NOT NULL,
 order_id uuid NOT NULL,
 report_id uuid NOT NULL,
 staff_subject text NOT NULL CHECK(staff_subject ~ '^staff:[a-f0-9-]{36}$'),
 staff_role text NOT NULL CHECK(staff_role IN ('staff','owner')),
 bucket text NOT NULL CHECK(bucket='ksh-car02-private-photos'),
 storage_path text NOT NULL UNIQUE,
 mime_type text NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp')),
 byte_size integer NOT NULL CHECK(byte_size BETWEEN 4 AND 5242880),
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','READY','QUARANTINED')),
 quarantine_reason text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(shop_code,intent_key),
 FOREIGN KEY(shop_code,order_id,report_id) REFERENCES car02_r122_qa.report_scope(shop_code,order_id,report_id),
 CHECK(storage_path = shop_code || '/' || order_id::text || '/' || report_id::text || '/' || intent_key::text || '.' ||
       CASE mime_type WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp' ELSE 'invalid' END),
 CHECK ((state='QUARANTINED' AND quarantine_reason IS NOT NULL) OR
        (state<>'QUARANTINED' AND quarantine_reason IS NULL))
);
-- Capacity is enforced in the DB as well as the adapter; raw SQL cannot bypass it.
CREATE FUNCTION car02_r122_qa.enforce_three_photo_cap() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.shop_code || '/' || NEW.report_id::text,0));
 SELECT count(*)::integer INTO n FROM car02_r122_qa.photo_intents
 WHERE shop_code=NEW.shop_code AND report_id=NEW.report_id;
 IF n>=3 THEN RAISE EXCEPTION 'R122_THREE_PHOTO_LIMIT' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER r122_report_cap BEFORE INSERT ON car02_r122_qa.photo_intents
 FOR EACH ROW EXECUTE FUNCTION car02_r122_qa.enforce_three_photo_cap();
CREATE TABLE car02_r122_qa.audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 shop_code text NOT NULL,
 intent_key uuid NOT NULL,
 event_state text NOT NULL CHECK(event_state IN ('PENDING','READY','QUARANTINED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(shop_code,intent_key) REFERENCES car02_r122_qa.photo_intents(shop_code,intent_key)
);
-- Audit is generated on the database side, in the same transaction as state changes.
CREATE FUNCTION car02_r122_qa.guard_photo_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'R122_PHOTO_DELETE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (OLD.shop_code,OLD.intent_key,OLD.order_id,OLD.report_id,OLD.staff_subject,OLD.staff_role,
      OLD.bucket,OLD.storage_path,OLD.mime_type,OLD.byte_size,OLD.sha256,OLD.created_at)
      IS DISTINCT FROM
     (NEW.shop_code,NEW.intent_key,NEW.order_id,NEW.report_id,NEW.staff_subject,NEW.staff_role,
      NEW.bucket,NEW.storage_path,NEW.mime_type,NEW.byte_size,NEW.sha256,NEW.created_at)
     OR OLD.state <> 'PENDING' OR NEW.state NOT IN ('READY','QUARANTINED')
     OR (NEW.state='QUARANTINED' AND NEW.quarantine_reason NOT IN
         ('UPLOAD_ACK_OR_READBACK_UNCERTAIN','READBACK_MISMATCH','READY_ACK_UNCERTAIN','RETRY_UNCERTAIN'))
  THEN RAISE EXCEPTION 'R122_PHOTO_TERMINAL_OR_REBIND_DENIED' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER r122_state_guard BEFORE UPDATE OR DELETE ON car02_r122_qa.photo_intents
 FOR EACH ROW EXECUTE FUNCTION car02_r122_qa.guard_photo_state();
CREATE FUNCTION car02_r122_qa.audit_state() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,car02_r122_qa AS $$
BEGIN
 INSERT INTO car02_r122_qa.audit_events(shop_code,intent_key,event_state)
 VALUES(NEW.shop_code,NEW.intent_key,NEW.state);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION car02_r122_qa.audit_state() FROM PUBLIC;
CREATE TRIGGER r122_audit_insert AFTER INSERT ON car02_r122_qa.photo_intents
 FOR EACH ROW EXECUTE FUNCTION car02_r122_qa.audit_state();
CREATE TRIGGER r122_audit_update AFTER UPDATE OF state ON car02_r122_qa.photo_intents
 FOR EACH ROW EXECUTE FUNCTION car02_r122_qa.audit_state();
CREATE FUNCTION car02_r122_qa.refuse_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'R122_AUDIT_IMMUTABLE' USING ERRCODE='42501'; RETURN NULL; END $$;
CREATE TRIGGER r122_refuse_audit_update_delete BEFORE UPDATE OR DELETE ON car02_r122_qa.audit_events
 FOR EACH ROW EXECUTE FUNCTION car02_r122_qa.refuse_audit_change();
CREATE TRIGGER r122_refuse_audit_truncate BEFORE TRUNCATE ON car02_r122_qa.audit_events
 FOR EACH STATEMENT EXECUTE FUNCTION car02_r122_qa.refuse_audit_change();
GRANT SELECT,INSERT,UPDATE(state,quarantine_reason) ON car02_r122_qa.photo_intents TO car02_r122_a_ci,car02_r122_b_ci;
GRANT SELECT ON car02_r122_qa.audit_events TO car02_r122_a_ci,car02_r122_b_ci;
ALTER TABLE car02_r122_qa.photo_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE car02_r122_qa.photo_intents FORCE ROW LEVEL SECURITY;
ALTER TABLE car02_r122_qa.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE car02_r122_qa.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY r122_photo_read ON car02_r122_qa.photo_intents FOR SELECT TO car02_r122_a_ci,car02_r122_b_ci
 USING(shop_code=CASE session_user WHEN 'car02_r122_a_ci' THEN 'street_house_demo' WHEN 'car02_r122_b_ci' THEN 'other_demo' ELSE NULL END);
CREATE POLICY r122_photo_insert ON car02_r122_qa.photo_intents FOR INSERT TO car02_r122_a_ci,car02_r122_b_ci
 WITH CHECK(shop_code=CASE session_user WHEN 'car02_r122_a_ci' THEN 'street_house_demo' WHEN 'car02_r122_b_ci' THEN 'other_demo' ELSE NULL END);
CREATE POLICY r122_photo_update ON car02_r122_qa.photo_intents FOR UPDATE TO car02_r122_a_ci,car02_r122_b_ci
 USING(shop_code=CASE session_user WHEN 'car02_r122_a_ci' THEN 'street_house_demo' WHEN 'car02_r122_b_ci' THEN 'other_demo' ELSE NULL END)
 WITH CHECK(shop_code=CASE session_user WHEN 'car02_r122_a_ci' THEN 'street_house_demo' WHEN 'car02_r122_b_ci' THEN 'other_demo' ELSE NULL END);
CREATE POLICY r122_audit_read ON car02_r122_qa.audit_events FOR SELECT TO car02_r122_a_ci,car02_r122_b_ci
 USING(shop_code=CASE session_user WHEN 'car02_r122_a_ci' THEN 'street_house_demo' WHEN 'car02_r122_b_ci' THEN 'other_demo' ELSE NULL END);
COMMIT;
\echo R122_DISPOSABLE_PG17_LEDGER_SCHEMA_READY
