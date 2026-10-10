-- DPRO CAR / CAR-02 R13 SHARED SUPABASE ADDITIVE MIGRATION / 2026-10-09
-- HOLD / NOT EXECUTED / DO NOT RUN WITHOUT VERIFIED RECOVERABLE BACKUP AND QA. After backup and security gate, apply in confirmed shared Supabase only.
-- Purpose: additive CAR-02 tables, no ALTER/DROP to existing ksh_demo_* tables.
-- Target verified: ksh-line-demo-api -> cbknucemarcpbscirzyv via Cloudflare Settings.
-- CAR02 HTTP endpoints remain disabled until verified staff + LINE auth is shipped.
-- Share existing Supabase safely; do not modify current ksh_demo_* tables.
-- Signed storage URL issuance and idempotent mutation RPCs MUST be implemented
-- server-side before activation. No client is granted direct table privileges.
-- Gate: schema preflight, backup/restore readiness and migration rollback plan.
-- No stage/live operations may be activated by this schema alone.
-- Shared Free plan: manual recoverable backup must be confirmed before apply.
-- Current SQL grants only service_role, but service_role can bypass RLS.
-- Never accept client-supplied staff role / LINE subject; dedicated secure Worker API required.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '45s';
-- R13 SHARED DATABASE: ADDITIVE ONLY. Run after reviewing the preflight and backup status.
-- This is intended for the confirmed liff-salon-reserve project (cbknucemarcpbscirzyv).
-- PostgreSQL cannot prove a Supabase project-ref from SQL alone: operator MUST verify target URL.
DO $verify$
DECLARE n integer;
BEGIN
  IF to_regclass('public.ksh_demo_customers') IS NULL OR
     to_regclass('public.ksh_demo_vehicles') IS NULL OR
     to_regclass('public.ksh_demo_reservations') IS NULL OR
     to_regclass('public.ksh_demo_shop_settings') IS NULL THEN
    RAISE EXCEPTION 'R13_BASELINE_SCHEMA_NOT_FOUND';
  END IF;
  SELECT count(*) INTO n FROM public.ksh_demo_shop_settings
   WHERE shop_code='street_house_kitsuki';
  IF n<>1 THEN RAISE EXCEPTION 'R13_EXPECTED_STORE_MISSING'; END IF;
  SELECT count(*) INTO n FROM pg_catalog.pg_tables
  WHERE schemaname='public' AND tablename LIKE 'ksh_car02_%';
  IF n<>0 THEN RAISE EXCEPTION 'R13_CAR02_ALREADY_EXISTS_STOP_NO_OVERWRITE'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='service_role') THEN
    RAISE EXCEPTION 'R13_SERVICE_ROLE_MISSING';
  END IF;
END $verify$;

CREATE TABLE public.ksh_car02_work_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 shop_code text NOT NULL,
 customer_id uuid,
 vehicle_id uuid,
 reservation_id uuid,
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','approved','declined','completed')),
 state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
 customer_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(customer_snapshot)='object'),
 vehicle_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(vehicle_snapshot)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ksh_car02_work_orders_shop_status_idx ON public.ksh_car02_work_orders(shop_code,status,updated_at DESC);
CREATE INDEX ksh_car02_work_orders_vehicle_idx ON public.ksh_car02_work_orders(vehicle_id,created_at DESC);
CREATE INDEX ksh_car02_work_orders_reservation_idx ON public.ksh_car02_work_orders(reservation_id);

-- Cross-tenant and cross-customer associations cannot be authorized by uuid FKs alone.
CREATE FUNCTION public.ksh_car02_assert_order_scope() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.ksh_demo_shop_settings s WHERE s.shop_code=NEW.shop_code) THEN
   RAISE EXCEPTION 'CAR02_SHOP_SCOPE_MISMATCH' USING ERRCODE='23514';
 END IF;
 IF NEW.customer_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM public.ksh_demo_customers c
   WHERE c.id=NEW.customer_id AND c.shop_code=NEW.shop_code) THEN
   RAISE EXCEPTION 'CAR02_CUSTOMER_SCOPE_MISMATCH' USING ERRCODE='23514';
 END IF;
 IF NEW.vehicle_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM public.ksh_demo_vehicles v
   WHERE v.id=NEW.vehicle_id AND v.shop_code=NEW.shop_code
     AND (NEW.customer_id IS NULL OR v.customer_id=NEW.customer_id)) THEN
   RAISE EXCEPTION 'CAR02_VEHICLE_SCOPE_MISMATCH' USING ERRCODE='23514';
 END IF;
 IF NEW.reservation_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM public.ksh_demo_reservations r
   WHERE r.id=NEW.reservation_id AND r.shop_code=NEW.shop_code
     AND (NEW.customer_id IS NULL OR r.customer_id=NEW.customer_id)
     AND (NEW.vehicle_id IS NULL OR r.vehicle_id=NEW.vehicle_id)) THEN
   RAISE EXCEPTION 'CAR02_RESERVATION_SCOPE_MISMATCH' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ksh_car02_assert_order_scope_t BEFORE INSERT OR UPDATE OF shop_code,customer_id,vehicle_id,reservation_id
 ON public.ksh_car02_work_orders FOR EACH ROW EXECUTE FUNCTION public.ksh_car02_assert_order_scope();
REVOKE ALL ON FUNCTION public.ksh_car02_assert_order_scope() FROM PUBLIC,anon,authenticated;

CREATE TABLE public.ksh_car02_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 work_order_id uuid NOT NULL REFERENCES public.ksh_car02_work_orders(id) ON DELETE CASCADE,
 observation text NOT NULL DEFAULT '',
 revised_by text,
 report_version integer NOT NULL DEFAULT 1 CHECK(report_version>=1),
 UNIQUE(work_order_id,report_version),
 updated_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ksh_car02_photos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 report_id uuid NOT NULL REFERENCES public.ksh_car02_reports(id) ON DELETE CASCADE,
 storage_bucket text NOT NULL DEFAULT 'ksh-car02-private-photos'
   CHECK(storage_bucket = 'ksh-car02-private-photos'),
 storage_path text NOT NULL UNIQUE CHECK(storage_path <> ''),
 mime_type text NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp')),
 byte_size bigint NOT NULL CHECK(byte_size > 0 AND byte_size <= 5242880),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 upload_state text NOT NULL DEFAULT 'pending' CHECK(upload_state IN ('pending','ready','deleted')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ksh_car02_photos_report_idx ON public.ksh_car02_photos(report_id,created_at);

CREATE TABLE public.ksh_car02_quotes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 work_order_id uuid NOT NULL REFERENCES public.ksh_car02_work_orders(id) ON DELETE CASCADE,
 report_id uuid NOT NULL REFERENCES public.ksh_car02_reports(id) ON DELETE RESTRICT,
 revision integer NOT NULL CHECK(revision >= 1),
 quote_state text NOT NULL DEFAULT 'draft'
   CHECK(quote_state IN ('draft','pending','approved','declined','superseded')),
 items_snapshot jsonb NOT NULL CHECK(jsonb_typeof(items_snapshot) = 'array'),
 report_snapshot text NOT NULL,
 photos_snapshot jsonb NOT NULL CHECK(jsonb_typeof(photos_snapshot) = 'array'),
 subtotal_yen bigint NOT NULL CHECK(subtotal_yen >= 0),
 tax_yen bigint NOT NULL CHECK(tax_yen >= 0),
 total_yen bigint NOT NULL CHECK(total_yen >= 0),
 tax_basis_points integer NOT NULL CHECK(tax_basis_points BETWEEN 0 AND 10000),
 customer_explanation text NOT NULL DEFAULT '',
 presented_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(work_order_id,revision),
 CHECK(total_yen = subtotal_yen + tax_yen)
);
CREATE UNIQUE INDEX ksh_car02_quotes_one_pending_idx ON public.ksh_car02_quotes(work_order_id)
 WHERE quote_state='pending';
CREATE INDEX ksh_car02_quotes_work_idx ON public.ksh_car02_quotes(work_order_id,revision DESC);

-- A presented quote must never have its monetary/content/photo snapshot silently mutated.
CREATE FUNCTION public.ksh_car02_protect_presented_quote() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.presented_at IS NOT NULL AND
  (NEW.items_snapshot IS DISTINCT FROM OLD.items_snapshot OR
   NEW.report_snapshot IS DISTINCT FROM OLD.report_snapshot OR
   NEW.photos_snapshot IS DISTINCT FROM OLD.photos_snapshot OR
   NEW.subtotal_yen IS DISTINCT FROM OLD.subtotal_yen OR
   NEW.tax_yen IS DISTINCT FROM OLD.tax_yen OR
   NEW.total_yen IS DISTINCT FROM OLD.total_yen OR
   NEW.tax_basis_points IS DISTINCT FROM OLD.tax_basis_points OR
   NEW.customer_explanation IS DISTINCT FROM OLD.customer_explanation OR
   NEW.work_order_id IS DISTINCT FROM OLD.work_order_id OR
   NEW.revision IS DISTINCT FROM OLD.revision OR
   NEW.presented_at IS DISTINCT FROM OLD.presented_at) THEN
    RAISE EXCEPTION 'CAR02_PRESENTED_QUOTE_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ksh_car02_protect_presented_quote_t BEFORE UPDATE ON public.ksh_car02_quotes
 FOR EACH ROW EXECUTE FUNCTION public.ksh_car02_protect_presented_quote();
REVOKE ALL ON FUNCTION public.ksh_car02_protect_presented_quote() FROM PUBLIC,anon,authenticated;

CREATE TABLE public.ksh_car02_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 work_order_id uuid NOT NULL REFERENCES public.ksh_car02_work_orders(id) ON DELETE CASCADE,
 quote_id uuid NOT NULL UNIQUE REFERENCES public.ksh_car02_quotes(id) ON DELETE CASCADE,
 customer_id uuid,
 actor_line_subject_hash text NOT NULL CHECK(length(actor_line_subject_hash) = 64),
 decision text NOT NULL CHECK(decision IN ('approved','declined')),
 decline_reason text NOT NULL DEFAULT '',
 verified_at timestamptz NOT NULL,
 decided_at timestamptz NOT NULL DEFAULT now(),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 12 AND 150),
 UNIQUE(work_order_id,idempotency_key)
);

CREATE TABLE public.ksh_car02_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 work_order_id uuid NOT NULL REFERENCES public.ksh_car02_work_orders(id) ON DELETE CASCADE,
 actor_role text NOT NULL CHECK(actor_role IN ('staff','owner','customer','system')),
 actor_fingerprint text NOT NULL,
 event_type text NOT NULL,
 event_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ksh_car02_events_work_time_idx ON public.ksh_car02_events(work_order_id,created_at DESC);

CREATE TABLE public.ksh_car02_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 shop_code text NOT NULL,
 actor_scope text NOT NULL,
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 12 AND 150),
 request_digest text NOT NULL CHECK(length(request_digest)=64),
 response_snapshot jsonb,
 completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(shop_code,actor_scope,idempotency_key)
);

CREATE TABLE public.ksh_car02_notification_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 work_order_id uuid NOT NULL REFERENCES public.ksh_car02_work_orders(id) ON DELETE CASCADE,
 quote_id uuid REFERENCES public.ksh_car02_quotes(id) ON DELETE CASCADE,
 event_type text NOT NULL,
 channel text NOT NULL DEFAULT 'LINE' CHECK(channel IN ('LINE','EMAIL')),
 delivery_status text NOT NULL DEFAULT 'pending'
   CHECK(delivery_status IN ('pending','sending','sent','retry','failed','cancelled')),
 dedupe_key text NOT NULL UNIQUE,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
 next_attempt_at timestamptz,
 sent_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ksh_car02_outbox_ready_idx ON public.ksh_car02_notification_outbox(delivery_status,next_attempt_at);

-- Private-by-default. Supabase service role only, behind a verified Worker.
-- No direct authenticated/anon user grants, and no PUBLIC policies are created.
ALTER TABLE public.ksh_car02_work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ksh_car02_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ksh_car02_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ksh_car02_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ksh_car02_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ksh_car02_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ksh_car02_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ksh_car02_notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ksh_car02_work_orders,public.ksh_car02_reports,public.ksh_car02_photos,
 public.ksh_car02_quotes,public.ksh_car02_decisions,public.ksh_car02_events,
 public.ksh_car02_operations,public.ksh_car02_notification_outbox FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ksh_car02_work_orders,public.ksh_car02_reports,
 public.ksh_car02_photos,public.ksh_car02_quotes,public.ksh_car02_decisions,
 public.ksh_car02_operations,public.ksh_car02_notification_outbox TO service_role;
GRANT SELECT,INSERT ON public.ksh_car02_events TO service_role;
-- SQL does not provision a storage bucket: separate review required for strict private upload policy.


-- R10 protections consolidated into the same atomic additive transaction.

-- 1. Quote state changes must be constrained even if the API is wrong.
CREATE FUNCTION public.ksh_car02_guard_quote_lifecycle()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CAR02_QUOTE_DELETE_FORBIDDEN' USING ERRCODE = '23514';
  END IF;
  IF OLD.quote_state IN ('approved','declined','superseded')
     AND NEW.quote_state IS DISTINCT FROM OLD.quote_state THEN
    RAISE EXCEPTION 'CAR02_FINAL_QUOTE_STATE_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF OLD.quote_state = 'draft'
     AND NEW.quote_state NOT IN ('draft','pending') THEN
    RAISE EXCEPTION 'CAR02_QUOTE_INVALID_TRANSITION' USING ERRCODE = '23514';
  END IF;
  IF OLD.quote_state = 'pending'
     AND NEW.quote_state NOT IN ('pending','approved','declined','superseded') THEN
    RAISE EXCEPTION 'CAR02_QUOTE_INVALID_TRANSITION' USING ERRCODE = '23514';
  END IF;
  IF NEW.quote_state IN ('pending','approved','declined','superseded')
     AND NEW.presented_at IS NULL THEN
    RAISE EXCEPTION 'CAR02_PRESENTED_AT_REQUIRED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ksh_car02_guard_quote_lifecycle_t
 BEFORE UPDATE OR DELETE ON public.ksh_car02_quotes
 FOR EACH ROW EXECUTE FUNCTION public.ksh_car02_guard_quote_lifecycle();

-- 2. A decision must be for the CURRENTLY pending quote belonging to the order.
--    The server must lock work_order first, quote second and atomically update both.
CREATE FUNCTION public.ksh_car02_guard_decision()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE q record; o record;
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CAR02_DECISIONS_APPEND_ONLY' USING ERRCODE = '23514';
  END IF;
  SELECT work_order_id, quote_state INTO q
    FROM public.ksh_car02_quotes WHERE id = NEW.quote_id FOR UPDATE;
  IF NOT FOUND OR q.work_order_id IS DISTINCT FROM NEW.work_order_id THEN
    RAISE EXCEPTION 'CAR02_QUOTE_ORDER_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF q.quote_state <> 'pending' THEN
    RAISE EXCEPTION 'CAR02_QUOTE_NOT_PENDING' USING ERRCODE = '23514';
  END IF;
  SELECT customer_id INTO o
    FROM public.ksh_car02_work_orders WHERE id = NEW.work_order_id;
  IF NOT FOUND OR o.customer_id IS NULL
     OR NEW.customer_id IS DISTINCT FROM o.customer_id THEN
    RAISE EXCEPTION 'CAR02_CUSTOMER_ORDER_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF NEW.actor_line_subject_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'CAR02_SUBJECT_HASH_INVALID' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ksh_car02_guard_decision_t
 BEFORE INSERT OR UPDATE OR DELETE ON public.ksh_car02_decisions
 FOR EACH ROW EXECUTE FUNCTION public.ksh_car02_guard_decision();

-- 3. Work-order and event history cannot be silently erased.
CREATE FUNCTION public.ksh_car02_guard_work_order()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CAR02_WORK_ORDER_DELETE_FORBIDDEN' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'completed' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'CAR02_COMPLETED_ORDER_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'completed' AND OLD.status <> 'completed'
     AND NOT EXISTS (
       SELECT 1 FROM public.ksh_car02_quotes q
       WHERE q.work_order_id = NEW.id AND q.quote_state = 'approved'
     ) THEN
    RAISE EXCEPTION 'CAR02_COMPLETION_WITHOUT_APPROVAL' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ksh_car02_guard_work_order_t
 BEFORE UPDATE OR DELETE ON public.ksh_car02_work_orders
 FOR EACH ROW EXECUTE FUNCTION public.ksh_car02_guard_work_order();

CREATE FUNCTION public.ksh_car02_guard_event()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'CAR02_AUDIT_EVENT_APPEND_ONLY' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER ksh_car02_guard_event_t
 BEFORE UPDATE OR DELETE ON public.ksh_car02_events
 FOR EACH ROW EXECUTE FUNCTION public.ksh_car02_guard_event();

-- 4. Server-only execution: no public function execution grants.
REVOKE ALL ON FUNCTION public.ksh_car02_guard_quote_lifecycle() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ksh_car02_guard_decision() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ksh_car02_guard_work_order() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ksh_car02_guard_event() FROM PUBLIC, anon, authenticated;
-- NOTE: Service-role SQL privileges can bypass RLS, so external calls MUST be authenticated
-- at the server. DB triggers are defense-in-depth and NOT a replacement for auth.
-- NOTE: No CREATE BUCKET / signed-upload endpoint / LINE API / transaction RPC is included.

-- R11: quote/report must reference the same order, with scope checked at DB level.
CREATE FUNCTION public.ksh_car02_guard_quote_scope() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $quotescope$
DECLARE r record;
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.quote_state<>'draft' OR NEW.presented_at IS NOT NULL THEN
     RAISE EXCEPTION 'CAR02_QUOTE_MUST_START_DRAFT' USING ERRCODE='23514';
   END IF;
 END IF;
 SELECT work_order_id INTO r FROM public.ksh_car02_reports WHERE id=NEW.report_id;
 IF NOT FOUND OR r.work_order_id IS DISTINCT FROM NEW.work_order_id THEN
  RAISE EXCEPTION 'CAR02_QUOTE_REPORT_ORDER_MISMATCH' USING ERRCODE='23514';
 END IF;
 IF NEW.quote_state IN ('pending','approved','declined','superseded') AND NEW.presented_at IS NULL THEN
  RAISE EXCEPTION 'CAR02_QUOTE_PRESENTED_AT_MISSING' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $quotescope$;
CREATE TRIGGER ksh_car02_guard_quote_scope_t BEFORE INSERT OR UPDATE OF report_id, work_order_id, quote_state, presented_at
 ON public.ksh_car02_quotes FOR EACH ROW EXECUTE FUNCTION public.ksh_car02_guard_quote_scope();
REVOKE ALL ON FUNCTION public.ksh_car02_guard_quote_scope() FROM PUBLIC,anon,authenticated;

-- R11: decision can never approve an old/superseded version: exact quote must be current pending.
-- Completion requires a matching decision record, not merely a modifiable quote state.
CREATE OR REPLACE FUNCTION public.ksh_car02_guard_work_order()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  RAISE EXCEPTION 'CAR02_WORK_ORDER_DELETE_FORBIDDEN' USING ERRCODE='23514';
 END IF;
 IF OLD.status = 'completed' AND NEW IS DISTINCT FROM OLD THEN
  RAISE EXCEPTION 'CAR02_COMPLETED_ORDER_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF NEW.status='completed' AND OLD.status<>'completed' AND NOT EXISTS (
  SELECT 1 FROM public.ksh_car02_quotes q JOIN public.ksh_car02_decisions d
  ON d.quote_id=q.id AND d.work_order_id=q.work_order_id
  WHERE q.work_order_id=NEW.id AND q.quote_state='approved'
    AND d.decision='approved'
 ) THEN
  RAISE EXCEPTION 'CAR02_COMPLETION_REQUIRES_CUSTOMER_DECISION' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

-- Once a report is used in a presented quote, keep its evidence immutable.
-- A re-inspection creates a new report_version and a new quote revision.
CREATE FUNCTION public.ksh_car02_report_locked(p_report uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.ksh_car02_quotes q
               WHERE q.report_id=p_report AND q.presented_at IS NOT NULL);
$$;
REVOKE ALL ON FUNCTION public.ksh_car02_report_locked(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ksh_car02_report_locked(uuid) TO service_role;
CREATE FUNCTION public.ksh_car02_guard_report_evidence() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF public.ksh_car02_report_locked(NEW.report_id) THEN
   RAISE EXCEPTION 'CAR02_REPORT_EVIDENCE_LOCKED' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' OR TG_OP='DELETE' THEN
  IF public.ksh_car02_report_locked(OLD.report_id) THEN
   RAISE EXCEPTION 'CAR02_REPORT_EVIDENCE_LOCKED' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER ksh_car02_guard_photo_t BEFORE INSERT OR UPDATE OR DELETE
 ON public.ksh_car02_photos FOR EACH ROW EXECUTE FUNCTION public.ksh_car02_guard_report_evidence();
REVOKE ALL ON FUNCTION public.ksh_car02_guard_report_evidence() FROM PUBLIC,anon,authenticated;

-- Presented report metadata cannot be silently edited or deleted.
CREATE FUNCTION public.ksh_car02_guard_report() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='UPDATE' OR TG_OP='DELETE' THEN
  IF public.ksh_car02_report_locked(OLD.id) THEN
   RAISE EXCEPTION 'CAR02_REPORT_LOCKED' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER ksh_car02_guard_report_t BEFORE UPDATE OR DELETE
 ON public.ksh_car02_reports FOR EACH ROW EXECUTE FUNCTION public.ksh_car02_guard_report();
REVOKE ALL ON FUNCTION public.ksh_car02_guard_report() FROM PUBLIC,anon,authenticated;

-- Final quote status requires a corresponding immutable decision row.
CREATE FUNCTION public.ksh_car02_guard_final_quote() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $finalquote$
DECLARE entering_final boolean := false;
BEGIN
 IF TG_OP='INSERT' THEN
   entering_final := NEW.quote_state IN ('approved','declined');
 ELSIF TG_OP='UPDATE' THEN
   entering_final := NEW.quote_state IN ('approved','declined')
      AND NEW.quote_state IS DISTINCT FROM OLD.quote_state;
 END IF;
 IF entering_final AND NOT EXISTS (
     SELECT 1 FROM public.ksh_car02_decisions d
     WHERE d.quote_id=NEW.id AND d.work_order_id=NEW.work_order_id
       AND d.decision=NEW.quote_state) THEN
    RAISE EXCEPTION 'CAR02_QUOTE_DECISION_REQUIRED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $finalquote$;
CREATE TRIGGER ksh_car02_guard_final_quote_t BEFORE INSERT OR UPDATE OF quote_state
 ON public.ksh_car02_quotes FOR EACH ROW EXECUTE FUNCTION public.ksh_car02_guard_final_quote();
REVOKE ALL ON FUNCTION public.ksh_car02_guard_final_quote() FROM PUBLIC,anon,authenticated;

-- No status movement bypasses server verified LINE identity or a single transaction.
-- Worker must lock work-order first, enforce state_version compare-and-swap,
-- insert decision then set quote_state, work_order status and outbox in one transaction.


-- R12 hardening: do not modify immutable audit identity or append-only data.
-- Before enabling API, service-role inserts must be constrained to authenticated Worker actions.
CREATE FUNCTION public.ksh_car02_photos_capacity_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $photocap$
DECLARE active_count integer;
DECLARE enforce_capacity boolean := false;
BEGIN
 IF TG_OP='INSERT' THEN
   enforce_capacity := NEW.upload_state<>'deleted';
 ELSIF TG_OP='UPDATE' THEN
   enforce_capacity := NEW.upload_state<>'deleted' AND (
     NEW.report_id IS DISTINCT FROM OLD.report_id OR
     OLD.upload_state='deleted');
 END IF;
 IF enforce_capacity THEN
   -- Serialize photo registrations for this report.
   PERFORM id FROM public.ksh_car02_reports WHERE id=NEW.report_id FOR UPDATE;
   IF TG_OP='INSERT' THEN
     SELECT count(*) INTO active_count FROM public.ksh_car02_photos p
      WHERE p.report_id=NEW.report_id AND p.upload_state<>'deleted';
   ELSE
     SELECT count(*) INTO active_count FROM public.ksh_car02_photos p
      WHERE p.report_id=NEW.report_id AND p.upload_state<>'deleted' AND p.id<>NEW.id;
   END IF;
   IF active_count>=3 THEN
     RAISE EXCEPTION 'CAR02_MAX_THREE_ACTIVE_PHOTOS' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END $photocap$;
CREATE TRIGGER ksh_car02_photos_capacity_t BEFORE INSERT OR UPDATE OF report_id,upload_state
 ON public.ksh_car02_photos FOR EACH ROW EXECUTE FUNCTION public.ksh_car02_photos_capacity_guard();
REVOKE ALL ON FUNCTION public.ksh_car02_photos_capacity_guard() FROM PUBLIC,anon,authenticated;

-- Lock order identity and state transitions after the initial draft.
CREATE FUNCTION public.ksh_car02_guard_order_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $identity$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.status<>'draft' OR NEW.state_version<>1 THEN
     RAISE EXCEPTION 'CAR02_ORDER_MUST_START_DRAFT_V1' USING ERRCODE='23514';
   END IF;
   RETURN NEW;
 END IF;
 IF OLD.status<>'draft' AND (
    NEW.shop_code IS DISTINCT FROM OLD.shop_code OR
    NEW.customer_id IS DISTINCT FROM OLD.customer_id OR
    NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id OR
    NEW.reservation_id IS DISTINCT FROM OLD.reservation_id) THEN
  RAISE EXCEPTION 'CAR02_ORDER_IDENTITY_LOCKED' USING ERRCODE='23514';
 END IF;
 IF NEW.status IN ('pending','approved','declined','completed') AND
    (NEW.customer_id IS NULL OR NEW.vehicle_id IS NULL) THEN
  RAISE EXCEPTION 'CAR02_CUSTOMER_VEHICLE_REQUIRED' USING ERRCODE='23514';
 END IF;
 IF OLD.status<>NEW.status AND NOT (
    (OLD.status='draft' AND NEW.status='pending') OR
    (OLD.status='pending' AND NEW.status IN ('approved','declined')) OR
    (OLD.status='approved' AND NEW.status='completed') OR
    (OLD.status='declined' AND NEW.status='pending')) THEN
  RAISE EXCEPTION 'CAR02_WORK_ORDER_INVALID_TRANSITION' USING ERRCODE='23514';
 END IF;
 IF OLD.status<>NEW.status AND NEW.state_version<>OLD.state_version+1 THEN
  RAISE EXCEPTION 'CAR02_STATE_VERSION_REQUIRED' USING ERRCODE='23514';
 END IF;
 IF NEW.status='approved' AND OLD.status<>'approved' AND NOT EXISTS (
    SELECT 1 FROM public.ksh_car02_quotes q JOIN public.ksh_car02_decisions d
      ON d.quote_id=q.id AND d.work_order_id=q.work_order_id
    WHERE q.work_order_id=NEW.id AND q.quote_state='approved' AND d.decision='approved'
 ) THEN RAISE EXCEPTION 'CAR02_APPROVAL_REQUIRES_DECISION' USING ERRCODE='23514'; END IF;
 IF NEW.status='declined' AND OLD.status<>'declined' AND NOT EXISTS (
    SELECT 1 FROM public.ksh_car02_quotes q JOIN public.ksh_car02_decisions d
      ON d.quote_id=q.id AND d.work_order_id=q.work_order_id
    WHERE q.work_order_id=NEW.id AND q.quote_state='declined' AND d.decision='declined'
 ) THEN RAISE EXCEPTION 'CAR02_DECLINE_REQUIRES_DECISION' USING ERRCODE='23514'; END IF;
 IF NEW.status='pending' AND OLD.status<>'pending' AND NOT EXISTS (
    SELECT 1 FROM public.ksh_car02_quotes q WHERE q.work_order_id=NEW.id AND q.quote_state='pending'
 ) THEN RAISE EXCEPTION 'CAR02_PENDING_REQUIRES_QUOTE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $identity$;
CREATE TRIGGER ksh_car02_guard_order_identity_t
 BEFORE INSERT OR UPDATE ON public.ksh_car02_work_orders
 FOR EACH ROW EXECUTE FUNCTION public.ksh_car02_guard_order_identity();
REVOKE ALL ON FUNCTION public.ksh_car02_guard_order_identity() FROM PUBLIC,anon,authenticated;

 -- R12: read-only API users get no CRUD grants or policies on CAR02 tables.
-- JWT auth alone must NOT permit use of service_role endpoints.

COMMIT;
