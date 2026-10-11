-- DPRO CAR02 R70 STAFF AUDIT REVIEW SCHEMA — DO NOT APPLY TO PRODUCTION.
-- Run only in isolated PostgreSQL 17 AFTER R13 and R46 QA schemas, and never
-- until a verified, restorable production backup and formal release approval.
-- No actual user identity or permission is provisioned by this SQL.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '45s';
CREATE TABLE public.ksh_car02_staff_access_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shop_code text NOT NULL REFERENCES public.ksh_demo_shop_settings(shop_code) ON DELETE RESTRICT,
  target_user_sub uuid NOT NULL,
  actor_user_sub uuid NOT NULL,
  before_role text NOT NULL CHECK (before_role IN ('owner','staff')),
  before_active boolean NOT NULL,
  after_role text NOT NULL CHECK (after_role IN ('owner','staff')),
  after_active boolean NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 8 AND 512),
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ksh_car02_staff_access_audit_shop_changed
  ON public.ksh_car02_staff_access_audit(shop_code,changed_at DESC,id DESC);
ALTER TABLE public.ksh_car02_staff_access_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ksh_car02_staff_access_audit FROM PUBLIC, anon, authenticated;
-- A privileged server-side role alone can insert and inspect its audit records.
-- Updates and deletes are not granted to ordinary clients.
GRANT SELECT,INSERT ON public.ksh_car02_staff_access_audit TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.ksh_car02_staff_access_audit_id_seq TO service_role;
COMMIT;
