-- DPRO CAR02 R136 isolated transaction fixture ONLY; NOT a production migration.
-- NEVER run against Supabase, staging, a retained database, or customer records.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database() <> 'car02_r136_qa_ci' OR current_setting('server_version_num')::int < 170000
    OR current_setting('server_version_num')::int >= 180000
    OR to_regnamespace('car02_r136_qa') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname LIKE 'car02_r136_%_ci')
 THEN RAISE EXCEPTION 'R136_DISPOSABLE_PG17_ONLY' USING ERRCODE='42501'; END IF;
END $$;
CREATE ROLE car02_r136_a_staff_ci LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'r136-throwaway-only';
CREATE ROLE car02_r136_a_customer_ci LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'r136-throwaway-only';
CREATE ROLE car02_r136_b_staff_ci LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'r136-throwaway-only';
CREATE ROLE car02_r136_b_customer_ci LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'r136-throwaway-only';
CREATE SCHEMA car02_r136_qa;
REVOKE ALL ON SCHEMA car02_r136_qa FROM PUBLIC;
GRANT USAGE ON SCHEMA car02_r136_qa TO car02_r136_a_staff_ci,car02_r136_a_customer_ci,car02_r136_b_staff_ci,car02_r136_b_customer_ci;
CREATE TABLE car02_r136_qa.bookings (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 shop_code text NOT NULL CHECK (shop_code IN ('street_house_demo','other_demo')),
 request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{12,64}$'),
 booking_day date NOT NULL, begins_at time(0) NOT NULL,
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','CANCELLED')),
 CONSTRAINT r136_request_unique UNIQUE(shop_code,request_key),
 CONSTRAINT r136_halfhour CHECK(extract(minute from begins_at) IN(0,30) AND extract(second from begins_at)=0)
);
CREATE UNIQUE INDEX r136_active_slot ON car02_r136_qa.bookings(shop_code,booking_day,begins_at) WHERE status='ACTIVE';
CREATE TABLE car02_r136_qa.service_cases (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 shop_code text NOT NULL CHECK(shop_code IN('street_house_demo','other_demo')),
 booking_id bigint NOT NULL UNIQUE REFERENCES car02_r136_qa.bookings(id),
 request_key text NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 6),
 state text NOT NULL DEFAULT 'OPEN' CHECK(state IN('OPEN','REPORTED','QUOTED','APPROVED','DECLINED','COMPLETED')),
 report text, part_yen integer, labor_yen integer, total_yen integer,
 CONSTRAINT r136_case_key UNIQUE(shop_code,request_key)
);
CREATE TABLE car02_r136_qa.case_operations (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 shop_code text NOT NULL,
 case_id bigint NOT NULL REFERENCES car02_r136_qa.service_cases(id),
 request_key text NOT NULL, request_hash text NOT NULL,
 op text NOT NULL CHECK(op IN('REPORT','QUOTE','DECIDE','COMPLETE')),
 CONSTRAINT r136_case_operation_idempotent UNIQUE(shop_code,request_key)
);
CREATE TABLE car02_r136_qa.audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 shop_code text NOT NULL,
 entity_id bigint NOT NULL, action text NOT NULL,
 event_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON car02_r136_qa.bookings,car02_r136_qa.service_cases,car02_r136_qa.case_operations,car02_r136_qa.audit_events FROM PUBLIC;
GRANT SELECT ON car02_r136_qa.bookings,car02_r136_qa.service_cases,car02_r136_qa.case_operations,car02_r136_qa.audit_events
 TO car02_r136_a_staff_ci,car02_r136_a_customer_ci,car02_r136_b_staff_ci,car02_r136_b_customer_ci;
ALTER TABLE car02_r136_qa.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE car02_r136_qa.bookings FORCE ROW LEVEL SECURITY;
ALTER TABLE car02_r136_qa.service_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE car02_r136_qa.service_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE car02_r136_qa.case_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE car02_r136_qa.case_operations FORCE ROW LEVEL SECURITY;
ALTER TABLE car02_r136_qa.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE car02_r136_qa.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY r136_b_r ON car02_r136_qa.bookings FOR SELECT USING (
 shop_code=CASE session_user WHEN 'car02_r136_a_staff_ci' THEN 'street_house_demo' WHEN 'car02_r136_a_customer_ci' THEN 'street_house_demo'
 WHEN 'car02_r136_b_staff_ci' THEN 'other_demo' WHEN 'car02_r136_b_customer_ci' THEN 'other_demo' ELSE NULL END);
CREATE POLICY r136_c_r ON car02_r136_qa.service_cases FOR SELECT USING (
 shop_code=CASE session_user WHEN 'car02_r136_a_staff_ci' THEN 'street_house_demo' WHEN 'car02_r136_a_customer_ci' THEN 'street_house_demo'
 WHEN 'car02_r136_b_staff_ci' THEN 'other_demo' WHEN 'car02_r136_b_customer_ci' THEN 'other_demo' ELSE NULL END);
CREATE POLICY r136_o_r ON car02_r136_qa.case_operations FOR SELECT USING (
 shop_code=CASE session_user WHEN 'car02_r136_a_staff_ci' THEN 'street_house_demo' WHEN 'car02_r136_a_customer_ci' THEN 'street_house_demo'
 WHEN 'car02_r136_b_staff_ci' THEN 'other_demo' WHEN 'car02_r136_b_customer_ci' THEN 'other_demo' ELSE NULL END);
CREATE POLICY r136_a_r ON car02_r136_qa.audit_events FOR SELECT USING (
 shop_code=CASE session_user WHEN 'car02_r136_a_staff_ci' THEN 'street_house_demo' WHEN 'car02_r136_a_customer_ci' THEN 'street_house_demo'
 WHEN 'car02_r136_b_staff_ci' THEN 'other_demo' WHEN 'car02_r136_b_customer_ci' THEN 'other_demo' ELSE NULL END);
-- Exact session_user maps to a synthetic tenant. These logins are fixtures, not real authentication.
CREATE FUNCTION car02_r136_qa.claim_booking(p_key text,p_day date,p_time time)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_shop text; v_id bigint; v_prev car02_r136_qa.bookings%ROWTYPE; v_now timestamp;
BEGIN
 v_shop:=CASE session_user WHEN 'car02_r136_a_staff_ci' THEN 'street_house_demo' WHEN 'car02_r136_b_staff_ci' THEN 'other_demo' ELSE NULL END;
 IF v_shop IS NULL THEN RAISE EXCEPTION 'R136_STAFF_REQUIRED' USING ERRCODE='42501'; END IF;
 v_now:=now() AT TIME ZONE 'Asia/Tokyo';
 IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{12,64}$' OR p_day IS NULL OR p_day<v_now::date OR p_day>v_now::date+60
 OR extract(isodow from p_day)=7 OR p_time IS NULL OR extract(second from p_time)<>0
 OR extract(minute from p_time) NOT IN(0,30) OR p_time<'09:00'::time OR p_time>'17:30'::time
 OR (p_day=v_now::date AND p_time<=v_now::time) THEN RAISE EXCEPTION 'R136_INVALID_SLOT' USING ERRCODE='22023'; END IF;
 INSERT INTO car02_r136_qa.bookings(shop_code,request_key,booking_day,begins_at) VALUES(v_shop,p_key,p_day,p_time)
 ON CONFLICT DO NOTHING RETURNING id INTO v_id;
 IF v_id IS NOT NULL THEN
  INSERT INTO car02_r136_qa.audit_events(shop_code,entity_id,action) VALUES(v_shop,v_id,'BOOKED');
  RETURN 'CREATED';
 END IF;
 SELECT * INTO v_prev FROM car02_r136_qa.bookings WHERE shop_code=v_shop AND request_key=p_key;
 IF FOUND THEN
  IF v_prev.booking_day<>p_day OR v_prev.begins_at<>p_time THEN RAISE EXCEPTION 'R136_REPLAY_CONFLICT' USING ERRCODE='22023'; END IF;
  RETURN 'IDEMPOTENT';
 END IF;
 RETURN 'SLOT_TAKEN';
END $$;
CREATE FUNCTION car02_r136_qa.open_case(p_key text,p_booking_id bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_shop text; v_book car02_r136_qa.bookings%ROWTYPE; v_prev car02_r136_qa.service_cases%ROWTYPE; v_id bigint;
BEGIN
 v_shop:=CASE session_user WHEN 'car02_r136_a_staff_ci' THEN 'street_house_demo' WHEN 'car02_r136_b_staff_ci' THEN 'other_demo' ELSE NULL END;
 IF v_shop IS NULL THEN RAISE EXCEPTION 'R136_STAFF_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{12,64}$' OR p_booking_id IS NULL THEN RAISE EXCEPTION 'R136_INVALID_CASE' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_book FROM car02_r136_qa.bookings WHERE id=p_booking_id AND shop_code=v_shop AND status='ACTIVE' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'R136_BOOKING_NOT_FOUND' USING ERRCODE='42501'; END IF;
 INSERT INTO car02_r136_qa.service_cases(shop_code,booking_id,request_key) VALUES(v_shop,p_booking_id,p_key)
 ON CONFLICT DO NOTHING RETURNING id INTO v_id;
 IF v_id IS NOT NULL THEN
  INSERT INTO car02_r136_qa.audit_events(shop_code,entity_id,action) VALUES(v_shop,v_id,'CASE_OPENED');
  RETURN 'OPENED';
 END IF;
 SELECT * INTO v_prev FROM car02_r136_qa.service_cases WHERE shop_code=v_shop AND (booking_id=p_booking_id OR request_key=p_key);
 IF v_prev.booking_id=p_booking_id AND v_prev.request_key=p_key THEN RETURN 'IDEMPOTENT'; END IF;
 RAISE EXCEPTION 'R136_CASE_OR_KEY_CONFLICT' USING ERRCODE='23505';
END $$;
CREATE FUNCTION car02_r136_qa.case_step(p_key text,p_case_id bigint,p_op text,p_expected_version integer,
 p_note text DEFAULT NULL,p_part integer DEFAULT NULL,p_labor integer DEFAULT NULL,p_choice text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_shop text; v_staff boolean; v_case car02_r136_qa.service_cases%ROWTYPE; v_hash text; v_prev car02_r136_qa.case_operations%ROWTYPE; v_total bigint; v_result text;
BEGIN
 v_shop:=CASE session_user WHEN 'car02_r136_a_staff_ci' THEN 'street_house_demo' WHEN 'car02_r136_a_customer_ci' THEN 'street_house_demo'
 WHEN 'car02_r136_b_staff_ci' THEN 'other_demo' WHEN 'car02_r136_b_customer_ci' THEN 'other_demo' ELSE NULL END;
 v_staff:=session_user IN ('car02_r136_a_staff_ci','car02_r136_b_staff_ci');
 IF v_shop IS NULL THEN RAISE EXCEPTION 'R136_IDENTITY_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{12,64}$' OR p_case_id IS NULL
 OR p_op IS NULL OR p_op NOT IN('REPORT','QUOTE','DECIDE','COMPLETE')
 OR p_expected_version IS NULL OR p_expected_version<1 THEN RAISE EXCEPTION 'R136_INVALID_COMMAND' USING ERRCODE='22023'; END IF;
 IF (p_op='DECIDE' AND v_staff) OR (p_op<>'DECIDE' AND NOT v_staff) THEN RAISE EXCEPTION 'R136_ROLE_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_case FROM car02_r136_qa.service_cases WHERE id=p_case_id AND shop_code=v_shop FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'R136_CASE_NOT_FOUND' USING ERRCODE='42501'; END IF;
 v_hash:=md5(jsonb_build_object('case',p_case_id,'op',p_op,'note',p_note,'part',p_part,'labor',p_labor,'choice',p_choice)::text);
 SELECT * INTO v_prev FROM car02_r136_qa.case_operations WHERE shop_code=v_shop AND request_key=p_key;
 IF FOUND THEN
   IF v_prev.case_id<>p_case_id OR v_prev.op<>p_op OR v_prev.request_hash<>v_hash THEN
    RAISE EXCEPTION 'R136_COMMAND_REUSE_MISMATCH' USING ERRCODE='22023'; END IF;
   RETURN 'IDEMPOTENT';
 END IF;
 IF v_case.version<>p_expected_version THEN RAISE EXCEPTION 'R136_STALE_VERSION' USING ERRCODE='40001'; END IF;
 IF p_op='REPORT' THEN
  IF v_case.state<>'OPEN' OR p_note IS NULL OR length(p_note) NOT BETWEEN 8 AND 512
  OR p_part IS NOT NULL OR p_labor IS NOT NULL OR p_choice IS NOT NULL THEN RAISE EXCEPTION 'R136_REPORT_RULE' USING ERRCODE='22023'; END IF;
  UPDATE car02_r136_qa.service_cases SET report=p_note,state='REPORTED',version=version+1 WHERE id=p_case_id;
  v_result:='REPORT_SAVED';
 ELSIF p_op='QUOTE' THEN
  v_total:=p_part::bigint+p_labor::bigint;
  IF v_case.state<>'REPORTED' OR p_part IS NULL OR p_labor IS NULL OR p_part<0 OR p_labor<0
   OR v_total<=0 OR v_total>100000000 OR p_note IS NOT NULL OR p_choice IS NOT NULL THEN RAISE EXCEPTION 'R136_QUOTE_RULE' USING ERRCODE='22023'; END IF;
  UPDATE car02_r136_qa.service_cases SET part_yen=p_part,labor_yen=p_labor,total_yen=(v_total+((v_total+5)/10))::integer,
   state='QUOTED',version=version+1 WHERE id=p_case_id;
  v_result:='QUOTE_PRESENTED';
 ELSIF p_op='DECIDE' THEN
  IF v_case.state<>'QUOTED' OR p_choice IS NULL OR p_choice NOT IN('APPROVE','DECLINE') OR p_note IS NOT NULL OR p_part IS NOT NULL OR p_labor IS NOT NULL
  THEN RAISE EXCEPTION 'R136_DECISION_RULE' USING ERRCODE='22023'; END IF;
  UPDATE car02_r136_qa.service_cases SET state=CASE p_choice WHEN 'APPROVE' THEN 'APPROVED' ELSE 'DECLINED' END,version=version+1 WHERE id=p_case_id;
  v_result:=CASE p_choice WHEN 'APPROVE' THEN 'APPROVED' ELSE 'DECLINED' END;
 ELSE
  IF v_case.state<>'APPROVED' OR p_note IS NOT NULL OR p_part IS NOT NULL OR p_labor IS NOT NULL OR p_choice IS NOT NULL
  THEN RAISE EXCEPTION 'R136_APPROVAL_REQUIRED' USING ERRCODE='42501'; END IF;
  UPDATE car02_r136_qa.service_cases SET state='COMPLETED',version=version+1 WHERE id=p_case_id;
  v_result:='COMPLETED';
 END IF;
 INSERT INTO car02_r136_qa.case_operations(shop_code,case_id,request_key,request_hash,op) VALUES(v_shop,p_case_id,p_key,v_hash,p_op);
 INSERT INTO car02_r136_qa.audit_events(shop_code,entity_id,action) VALUES(v_shop,p_case_id,p_op);
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION car02_r136_qa.claim_booking(text,date,time) FROM PUBLIC;
REVOKE ALL ON FUNCTION car02_r136_qa.open_case(text,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION car02_r136_qa.case_step(text,bigint,text,integer,text,integer,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION car02_r136_qa.claim_booking(text,date,time),car02_r136_qa.open_case(text,bigint) TO car02_r136_a_staff_ci,car02_r136_b_staff_ci;
GRANT EXECUTE ON FUNCTION car02_r136_qa.case_step(text,bigint,text,integer,text,integer,integer,text) TO car02_r136_a_staff_ci,car02_r136_a_customer_ci,car02_r136_b_staff_ci,car02_r136_b_customer_ci;
COMMIT;
\echo R136_DISPOSABLE_PG17_SCHEMA_READY
