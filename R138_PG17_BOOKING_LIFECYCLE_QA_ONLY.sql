-- DPRO CAR02 R138: disposable PostgreSQL 17 fixture ONLY; not a migration.
-- NEVER execute in Supabase, staging, production, or any retained database.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'car02_r138_qa_ci'
     OR current_setting('server_version_num')::integer < 170000
     OR current_setting('server_version_num')::integer >= 180000
     OR to_regnamespace('car02_r138_qa') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname LIKE 'car02_r138_%_ci')
  THEN RAISE EXCEPTION 'R138_EXACT_DISPOSABLE_PG17_ONLY' USING ERRCODE='42501'; END IF;
END $$;
CREATE ROLE car02_r138_a_staff_ci LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'r138-throwaway-only';
CREATE ROLE car02_r138_a_one_ci LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'r138-throwaway-only';
CREATE ROLE car02_r138_a_two_ci LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'r138-throwaway-only';
CREATE ROLE car02_r138_b_staff_ci LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'r138-throwaway-only';
CREATE ROLE car02_r138_b_one_ci LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'r138-throwaway-only';
CREATE SCHEMA car02_r138_qa;
REVOKE ALL ON SCHEMA car02_r138_qa FROM PUBLIC;
GRANT USAGE ON SCHEMA car02_r138_qa TO car02_r138_a_staff_ci,car02_r138_a_one_ci,car02_r138_a_two_ci,car02_r138_b_staff_ci,car02_r138_b_one_ci;

CREATE TABLE car02_r138_qa.bookings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shop_code text NOT NULL CHECK(shop_code IN ('street_house_demo','other_demo')),
  owner_login text NOT NULL CHECK(owner_login IN ('car02_r138_a_one_ci','car02_r138_a_two_ci','car02_r138_b_one_ci')),
  CONSTRAINT r138_owner_shop_pair CHECK (
   (shop_code='street_house_demo' AND owner_login IN ('car02_r138_a_one_ci','car02_r138_a_two_ci'))
   OR (shop_code='other_demo' AND owner_login='car02_r138_b_one_ci')),
  request_key text NOT NULL CHECK(request_key ~ '^[a-zA-Z0-9_-]{12,64}$'),
  booking_day date NOT NULL, begins_at time(0) NOT NULL,
  state text NOT NULL DEFAULT 'ACTIVE' CHECK(state IN ('ACTIVE','CANCELLED')),
  version integer NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 100000),
  UNIQUE(shop_code,request_key), UNIQUE(id,shop_code,owner_login),
  CHECK(extract(second from begins_at)=0 AND extract(minute from begins_at) IN (0,30))
);
CREATE UNIQUE INDEX r138_active_slot ON car02_r138_qa.bookings(shop_code,booking_day,begins_at) WHERE state='ACTIVE';
CREATE TABLE car02_r138_qa.service_cases (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id bigint NOT NULL UNIQUE,
  shop_code text NOT NULL, owner_login text NOT NULL,
  request_key text NOT NULL,
  state text NOT NULL DEFAULT 'OPEN' CHECK(state IN('OPEN','REPORTED','QUOTED','APPROVED','DECLINED','COMPLETED')),
  version integer NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 6),
  report text, part_yen integer, labor_yen integer, total_yen integer,
  UNIQUE(shop_code,request_key), UNIQUE(id,shop_code,owner_login),
  FOREIGN KEY(booking_id,shop_code,owner_login) REFERENCES car02_r138_qa.bookings(id,shop_code,owner_login)
);
CREATE TABLE car02_r138_qa.case_operations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id bigint NOT NULL, shop_code text NOT NULL, owner_login text NOT NULL,
  actor_login text NOT NULL,
  request_key text NOT NULL, request_hash text NOT NULL,
  op text NOT NULL CHECK(op IN('REPORT','QUOTE','DECIDE','COMPLETE')),
  UNIQUE(shop_code,request_key),
  FOREIGN KEY(case_id,shop_code,owner_login) REFERENCES car02_r138_qa.service_cases(id,shop_code,owner_login)
);
CREATE TABLE car02_r138_qa.booking_operations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id bigint NOT NULL, shop_code text NOT NULL, owner_login text NOT NULL,
  actor_login text NOT NULL, request_key text NOT NULL, request_hash text NOT NULL,
  op text NOT NULL CHECK(op IN ('CANCEL','MOVE')),
  UNIQUE(shop_code,request_key),
  FOREIGN KEY(booking_id,shop_code,owner_login) REFERENCES car02_r138_qa.bookings(id,shop_code,owner_login)
);
CREATE TABLE car02_r138_qa.audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shop_code text NOT NULL, owner_login text NOT NULL,
  entity_id bigint NOT NULL, action text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON car02_r138_qa.bookings,car02_r138_qa.service_cases,car02_r138_qa.case_operations,car02_r138_qa.booking_operations,car02_r138_qa.audit_events FROM PUBLIC;
GRANT SELECT ON car02_r138_qa.bookings,car02_r138_qa.service_cases,car02_r138_qa.case_operations,car02_r138_qa.booking_operations,car02_r138_qa.audit_events TO
 car02_r138_a_staff_ci,car02_r138_a_one_ci,car02_r138_a_two_ci,car02_r138_b_staff_ci,car02_r138_b_one_ci;
ALTER TABLE car02_r138_qa.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE car02_r138_qa.bookings FORCE ROW LEVEL SECURITY;
ALTER TABLE car02_r138_qa.service_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE car02_r138_qa.service_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE car02_r138_qa.case_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE car02_r138_qa.case_operations FORCE ROW LEVEL SECURITY;
ALTER TABLE car02_r138_qa.booking_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE car02_r138_qa.booking_operations FORCE ROW LEVEL SECURITY;
ALTER TABLE car02_r138_qa.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE car02_r138_qa.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY r138_bookings_read ON car02_r138_qa.bookings FOR SELECT USING (
 shop_code=CASE session_user WHEN 'car02_r138_a_staff_ci' THEN 'street_house_demo' WHEN 'car02_r138_a_one_ci' THEN 'street_house_demo' WHEN 'car02_r138_a_two_ci' THEN 'street_house_demo'
 WHEN 'car02_r138_b_staff_ci' THEN 'other_demo' WHEN 'car02_r138_b_one_ci' THEN 'other_demo' ELSE NULL END
 AND (session_user IN ('car02_r138_a_staff_ci','car02_r138_b_staff_ci') OR owner_login=session_user));
CREATE POLICY r138_cases_read ON car02_r138_qa.service_cases FOR SELECT USING (
 shop_code=CASE session_user WHEN 'car02_r138_a_staff_ci' THEN 'street_house_demo' WHEN 'car02_r138_a_one_ci' THEN 'street_house_demo' WHEN 'car02_r138_a_two_ci' THEN 'street_house_demo'
 WHEN 'car02_r138_b_staff_ci' THEN 'other_demo' WHEN 'car02_r138_b_one_ci' THEN 'other_demo' ELSE NULL END
 AND (session_user IN ('car02_r138_a_staff_ci','car02_r138_b_staff_ci') OR owner_login=session_user));
CREATE POLICY r138_operations_read ON car02_r138_qa.case_operations FOR SELECT USING (
 shop_code=CASE session_user WHEN 'car02_r138_a_staff_ci' THEN 'street_house_demo' WHEN 'car02_r138_a_one_ci' THEN 'street_house_demo' WHEN 'car02_r138_a_two_ci' THEN 'street_house_demo'
 WHEN 'car02_r138_b_staff_ci' THEN 'other_demo' WHEN 'car02_r138_b_one_ci' THEN 'other_demo' ELSE NULL END
 AND (session_user IN ('car02_r138_a_staff_ci','car02_r138_b_staff_ci') OR owner_login=session_user));
CREATE POLICY r138_audit_read ON car02_r138_qa.audit_events FOR SELECT USING (
 shop_code=CASE session_user WHEN 'car02_r138_a_staff_ci' THEN 'street_house_demo' WHEN 'car02_r138_a_one_ci' THEN 'street_house_demo' WHEN 'car02_r138_a_two_ci' THEN 'street_house_demo'
 WHEN 'car02_r138_b_staff_ci' THEN 'other_demo' WHEN 'car02_r138_b_one_ci' THEN 'other_demo' ELSE NULL END
 AND (session_user IN ('car02_r138_a_staff_ci','car02_r138_b_staff_ci') OR owner_login=session_user));

CREATE POLICY r138_booking_ops_read ON car02_r138_qa.booking_operations FOR SELECT USING (
 shop_code=CASE session_user WHEN 'car02_r138_a_staff_ci' THEN 'street_house_demo' WHEN 'car02_r138_a_one_ci' THEN 'street_house_demo' WHEN 'car02_r138_a_two_ci' THEN 'street_house_demo'
 WHEN 'car02_r138_b_staff_ci' THEN 'other_demo' WHEN 'car02_r138_b_one_ci' THEN 'other_demo' ELSE NULL END
 AND (session_user IN ('car02_r138_a_staff_ci','car02_r138_b_staff_ci') OR owner_login=session_user));

-- Synthetic role login maps to a synthetic identity; no real customer authentication.
CREATE FUNCTION car02_r138_qa.claim_booking(p_key text,p_owner text,p_day date,p_time time)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_shop text; v_id bigint; v_old car02_r138_qa.bookings%ROWTYPE; v_now timestamp;
BEGIN
 v_shop:=CASE session_user WHEN 'car02_r138_a_staff_ci' THEN 'street_house_demo' WHEN 'car02_r138_b_staff_ci' THEN 'other_demo' ELSE NULL END;
 IF v_shop IS NULL THEN RAISE EXCEPTION 'R138_STAFF_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_owner IS NULL OR NOT (
  (v_shop='street_house_demo' AND p_owner IN('car02_r138_a_one_ci','car02_r138_a_two_ci')) OR
  (v_shop='other_demo' AND p_owner='car02_r138_b_one_ci'))
 THEN RAISE EXCEPTION 'R138_OWNER_SHOP_MISMATCH' USING ERRCODE='42501'; END IF;
 v_now:=now() AT TIME ZONE 'Asia/Tokyo';
 IF p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{12,64}$' OR p_day IS NULL OR p_day<v_now::date OR p_day>v_now::date+60
 OR extract(isodow from p_day)=7 OR p_time IS NULL OR extract(second from p_time)<>0
 OR extract(minute from p_time) NOT IN(0,30) OR p_time<'09:00'::time OR p_time>'17:30'::time
 OR (p_day=v_now::date AND p_time<=v_now::time)
 THEN RAISE EXCEPTION 'R138_INVALID_BOOKING' USING ERRCODE='22023'; END IF;
 INSERT INTO car02_r138_qa.bookings(shop_code,owner_login,request_key,booking_day,begins_at)
 VALUES (v_shop,p_owner,p_key,p_day,p_time) ON CONFLICT DO NOTHING RETURNING id INTO v_id;
 IF v_id IS NOT NULL THEN
  INSERT INTO car02_r138_qa.audit_events(shop_code,owner_login,entity_id,action) VALUES(v_shop,p_owner,v_id,'BOOKED');
  RETURN 'CREATED';
 END IF;
 SELECT * INTO v_old FROM car02_r138_qa.bookings WHERE shop_code=v_shop AND request_key=p_key;
 IF FOUND THEN
  IF v_old.owner_login<>p_owner OR v_old.booking_day<>p_day OR v_old.begins_at<>p_time
  THEN RAISE EXCEPTION 'R138_BOOKING_REPLAY_CONFLICT' USING ERRCODE='22023'; END IF;
  IF v_old.state='CANCELLED' THEN RETURN 'CANCELLED_ALREADY'; END IF;
  RETURN 'IDEMPOTENT';
 END IF;
 RETURN 'SLOT_TAKEN';
END $$;
CREATE FUNCTION car02_r138_qa.open_case(p_key text,p_booking_id bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_shop text; v_book car02_r138_qa.bookings%ROWTYPE; v_old car02_r138_qa.service_cases%ROWTYPE; v_id bigint;
BEGIN
 v_shop:=CASE session_user WHEN 'car02_r138_a_staff_ci' THEN 'street_house_demo' WHEN 'car02_r138_b_staff_ci' THEN 'other_demo' ELSE NULL END;
 IF v_shop IS NULL THEN RAISE EXCEPTION 'R138_STAFF_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{12,64}$' OR p_booking_id IS NULL
 THEN RAISE EXCEPTION 'R138_INVALID_CASE' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_book FROM car02_r138_qa.bookings WHERE id=p_booking_id AND shop_code=v_shop AND state='ACTIVE' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'R138_BOOKING_NOT_FOUND' USING ERRCODE='42501'; END IF;
 INSERT INTO car02_r138_qa.service_cases(shop_code,owner_login,booking_id,request_key)
 VALUES(v_shop,v_book.owner_login,p_booking_id,p_key) ON CONFLICT DO NOTHING RETURNING id INTO v_id;
 IF v_id IS NOT NULL THEN
  INSERT INTO car02_r138_qa.audit_events(shop_code,owner_login,entity_id,action) VALUES(v_shop,v_book.owner_login,v_id,'CASE_OPENED');
  RETURN 'OPENED';
 END IF;
 SELECT * INTO v_old FROM car02_r138_qa.service_cases WHERE shop_code=v_shop AND (booking_id=p_booking_id OR request_key=p_key);
 IF FOUND AND v_old.booking_id=p_booking_id AND v_old.request_key=p_key AND v_old.owner_login=v_book.owner_login
 THEN RETURN 'IDEMPOTENT'; END IF;
 RAISE EXCEPTION 'R138_CASE_CONFLICT' USING ERRCODE='23505';
END $$;
CREATE FUNCTION car02_r138_qa.case_step(p_key text,p_case bigint,p_op text,p_version integer,
 p_note text DEFAULT NULL,p_part integer DEFAULT NULL,p_labor integer DEFAULT NULL,p_choice text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_shop text; v_staff boolean; v_case car02_r138_qa.service_cases%ROWTYPE; v_old car02_r138_qa.case_operations%ROWTYPE;
 v_fingerprint text; v_total bigint; v_result text;
BEGIN
 v_shop:=CASE session_user WHEN 'car02_r138_a_staff_ci' THEN 'street_house_demo' WHEN 'car02_r138_a_one_ci' THEN 'street_house_demo' WHEN 'car02_r138_a_two_ci' THEN 'street_house_demo'
  WHEN 'car02_r138_b_staff_ci' THEN 'other_demo' WHEN 'car02_r138_b_one_ci' THEN 'other_demo' ELSE NULL END;
 v_staff:=session_user IN('car02_r138_a_staff_ci','car02_r138_b_staff_ci');
 IF v_shop IS NULL THEN RAISE EXCEPTION 'R138_IDENTITY_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{12,64}$' OR p_case IS NULL OR p_version IS NULL OR p_version<1
 OR p_op IS NULL OR p_op NOT IN ('REPORT','QUOTE','DECIDE','COMPLETE')
 THEN RAISE EXCEPTION 'R138_BAD_COMMAND' USING ERRCODE='22023'; END IF;
 IF (p_op='DECIDE' AND v_staff) OR (p_op<>'DECIDE' AND NOT v_staff)
 THEN RAISE EXCEPTION 'R138_ROLE_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_case FROM car02_r138_qa.service_cases WHERE id=p_case AND shop_code=v_shop FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'R138_CASE_NOT_FOUND' USING ERRCODE='42501'; END IF;
 -- SECURITY DEFINER bypasses the caller's RLS: enforce *per customer* ownership here as well.
 IF NOT v_staff AND v_case.owner_login<>session_user
 THEN RAISE EXCEPTION 'R138_OWNER_DENIED' USING ERRCODE='42501'; END IF;
 v_fingerprint:=md5(jsonb_build_object('case',p_case,'op',p_op,'version',p_version,'actor',session_user,
 'note',p_note,'part',p_part,'labor',p_labor,'choice',p_choice)::text);
 SELECT * INTO v_old FROM car02_r138_qa.case_operations WHERE shop_code=v_shop AND request_key=p_key;
 IF FOUND THEN
  IF v_old.case_id<>p_case OR v_old.op<>p_op OR v_old.actor_login<>session_user OR v_old.request_hash<>v_fingerprint
  THEN RAISE EXCEPTION 'R138_REPLAY_MISMATCH' USING ERRCODE='22023'; END IF;
  RETURN 'IDEMPOTENT';
 END IF;
 IF v_case.version<>p_version THEN RAISE EXCEPTION 'R138_STALE_VERSION' USING ERRCODE='40001'; END IF;
 IF p_op='REPORT' THEN
  IF v_case.state<>'OPEN' OR p_note IS NULL OR length(p_note) NOT BETWEEN 8 AND 512
   OR p_part IS NOT NULL OR p_labor IS NOT NULL OR p_choice IS NOT NULL
  THEN RAISE EXCEPTION 'R138_REPORT_RULE' USING ERRCODE='22023'; END IF;
  UPDATE car02_r138_qa.service_cases SET state='REPORTED',report=p_note,version=version+1 WHERE id=p_case;
  v_result:='REPORT_SAVED';
 ELSIF p_op='QUOTE' THEN
  v_total:=p_part::bigint+p_labor::bigint;
  IF v_case.state<>'REPORTED' OR p_part IS NULL OR p_labor IS NULL OR p_part<0 OR p_labor<0
   OR v_total<=0 OR v_total>100000000 OR p_note IS NOT NULL OR p_choice IS NOT NULL
  THEN RAISE EXCEPTION 'R138_QUOTE_RULE' USING ERRCODE='22023'; END IF;
  UPDATE car02_r138_qa.service_cases SET state='QUOTED',part_yen=p_part,labor_yen=p_labor,
   total_yen=(v_total+((v_total+5)/10))::integer,version=version+1 WHERE id=p_case;
  v_result:='QUOTE_PRESENTED';
 ELSIF p_op='DECIDE' THEN
  IF v_case.state<>'QUOTED' OR p_choice NOT IN ('APPROVE','DECLINE') OR p_choice IS NULL OR p_note IS NOT NULL
   OR p_part IS NOT NULL OR p_labor IS NOT NULL
  THEN RAISE EXCEPTION 'R138_DECISION_RULE' USING ERRCODE='22023'; END IF;
  UPDATE car02_r138_qa.service_cases SET state=CASE p_choice WHEN 'APPROVE' THEN 'APPROVED' ELSE 'DECLINED' END,
   version=version+1 WHERE id=p_case;
  v_result:=CASE p_choice WHEN 'APPROVE' THEN 'APPROVED' ELSE 'DECLINED' END;
 ELSE
  IF v_case.state<>'APPROVED' OR p_note IS NOT NULL OR p_part IS NOT NULL OR p_labor IS NOT NULL OR p_choice IS NOT NULL
  THEN RAISE EXCEPTION 'R138_APPROVAL_REQUIRED' USING ERRCODE='42501'; END IF;
  UPDATE car02_r138_qa.service_cases SET state='COMPLETED',version=version+1 WHERE id=p_case;
  v_result:='COMPLETED';
 END IF;
 INSERT INTO car02_r138_qa.case_operations(shop_code,owner_login,case_id,actor_login,request_key,request_hash,op)
 VALUES(v_shop,v_case.owner_login,p_case,session_user,p_key,v_fingerprint,p_op);
 INSERT INTO car02_r138_qa.audit_events(shop_code,owner_login,entity_id,action)
 VALUES(v_shop,v_case.owner_login,p_case,p_op);
 RETURN v_result;
END $$;

-- Guarded, immutable-key change journal. The only mutator; no direct caller DML.
-- ROW LOCK serializes changes against open_case (which locks the same booking first).
CREATE FUNCTION car02_r138_qa.change_booking(p_key text,p_booking_id bigint,p_op text,
 p_expected_version integer,p_new_day date DEFAULT NULL,p_new_time time DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_shop text; v_staff boolean; v_booking car02_r138_qa.bookings%ROWTYPE;
 v_old car02_r138_qa.booking_operations%ROWTYPE; v_hash text; v_now timestamp; v_result text;
BEGIN
 v_shop:=CASE session_user WHEN 'car02_r138_a_staff_ci' THEN 'street_house_demo' WHEN 'car02_r138_a_one_ci' THEN 'street_house_demo' WHEN 'car02_r138_a_two_ci' THEN 'street_house_demo'
 WHEN 'car02_r138_b_staff_ci' THEN 'other_demo' WHEN 'car02_r138_b_one_ci' THEN 'other_demo' ELSE NULL END;
 v_staff:=session_user IN ('car02_r138_a_staff_ci','car02_r138_b_staff_ci');
 IF v_shop IS NULL THEN RAISE EXCEPTION 'R138_IDENTITY_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR p_key !~ '^[a-zA-Z0-9_-]{12,64}$' OR p_booking_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1
 OR p_op IS NULL OR p_op NOT IN ('CANCEL','MOVE')
 THEN RAISE EXCEPTION 'R138_BAD_BOOKING_COMMAND' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_booking FROM car02_r138_qa.bookings WHERE id=p_booking_id AND shop_code=v_shop FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'R138_BOOKING_NOT_FOUND' USING ERRCODE='42501'; END IF;
 -- SECURITY DEFINER bypasses caller RLS. Explicitly enforce *per-customer* ownership.
 IF NOT v_staff AND v_booking.owner_login<>session_user THEN RAISE EXCEPTION 'R138_OWNER_DENIED' USING ERRCODE='42501'; END IF;
 v_hash:=md5(jsonb_build_object('booking',p_booking_id,'actor',session_user,'op',p_op,
  'expected_version',p_expected_version,'day',p_new_day,'clock',p_new_time)::text);
 SELECT * INTO v_old FROM car02_r138_qa.booking_operations WHERE shop_code=v_shop AND request_key=p_key;
 IF FOUND THEN
  IF v_old.booking_id<>p_booking_id OR v_old.op<>p_op OR v_old.actor_login<>session_user OR v_old.request_hash<>v_hash
  THEN RAISE EXCEPTION 'R138_REPLAY_CONFLICT' USING ERRCODE='22023'; END IF;
  RETURN 'IDEMPOTENT';
 END IF;
 IF v_booking.version<>p_expected_version THEN RAISE EXCEPTION 'R138_STALE_BOOKING' USING ERRCODE='40001'; END IF;
 IF v_booking.state<>'ACTIVE' THEN RAISE EXCEPTION 'R138_CANCELLED_IMMUTABLE' USING ERRCODE='42501'; END IF;
 IF EXISTS (SELECT 1 FROM car02_r138_qa.service_cases WHERE booking_id=p_booking_id AND shop_code=v_shop)
 THEN RAISE EXCEPTION 'R138_CASE_ALREADY_OPEN' USING ERRCODE='42501'; END IF;
 IF p_op='CANCEL' THEN
  IF p_new_day IS NOT NULL OR p_new_time IS NOT NULL
  THEN RAISE EXCEPTION 'R138_CANCEL_PAYLOAD' USING ERRCODE='22023'; END IF;
  UPDATE car02_r138_qa.bookings SET state='CANCELLED',version=version+1 WHERE id=p_booking_id;
  v_result:='CANCELLED';
 ELSE
  v_now:=now() AT TIME ZONE 'Asia/Tokyo';
  IF p_new_day IS NULL OR p_new_day<v_now::date OR p_new_day>v_now::date+60
   OR extract(isodow from p_new_day)=7 OR p_new_time IS NULL OR extract(second from p_new_time)<>0
   OR extract(minute from p_new_time) NOT IN(0,30) OR p_new_time<'09:00'::time OR p_new_time>'17:30'::time
   OR (p_new_day=v_now::date AND p_new_time<=v_now::time)
  THEN RAISE EXCEPTION 'R138_INVALID_MOVE_SLOT' USING ERRCODE='22023'; END IF;
  IF v_booking.booking_day=p_new_day AND v_booking.begins_at=p_new_time
  THEN RAISE EXCEPTION 'R138_NOOP_MOVE' USING ERRCODE='22023'; END IF;
  UPDATE car02_r138_qa.bookings SET booking_day=p_new_day,begins_at=p_new_time,version=version+1 WHERE id=p_booking_id;
  v_result:='MOVED';
 END IF;
 INSERT INTO car02_r138_qa.booking_operations(booking_id,shop_code,owner_login,actor_login,request_key,request_hash,op)
 VALUES(p_booking_id,v_shop,v_booking.owner_login,session_user,p_key,v_hash,p_op);
 INSERT INTO car02_r138_qa.audit_events(shop_code,owner_login,entity_id,action)
 VALUES(v_shop,v_booking.owner_login,p_booking_id,p_op);
 RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION car02_r138_qa.claim_booking(text,text,date,time) FROM PUBLIC;
REVOKE ALL ON FUNCTION car02_r138_qa.open_case(text,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION car02_r138_qa.case_step(text,bigint,text,integer,text,integer,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION car02_r138_qa.claim_booking(text,text,date,time),car02_r138_qa.open_case(text,bigint)
 TO car02_r138_a_staff_ci,car02_r138_b_staff_ci;
REVOKE ALL ON FUNCTION car02_r138_qa.change_booking(text,bigint,text,integer,date,time) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION car02_r138_qa.change_booking(text,bigint,text,integer,date,time)
 TO car02_r138_a_staff_ci,car02_r138_a_one_ci,car02_r138_a_two_ci,car02_r138_b_staff_ci,car02_r138_b_one_ci;
GRANT EXECUTE ON FUNCTION car02_r138_qa.case_step(text,bigint,text,integer,text,integer,integer,text)
 TO car02_r138_a_staff_ci,car02_r138_a_one_ci,car02_r138_a_two_ci,car02_r138_b_staff_ci,car02_r138_b_one_ci;
COMMIT;
\echo R138_DISPOSABLE_PG17_SCHEMA_READY
