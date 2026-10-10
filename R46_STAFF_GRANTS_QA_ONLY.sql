-- DPRO CAR02 R46 staff membership: QA/REVIEW ONLY, not for production execution.
-- Must run after R13 schema in disposable PostgreSQL 17. Do not seed real user IDs.
-- Never infer staff privileges from dashboard demo tokens or client supplied roles.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '45s';
CREATE TABLE public.ksh_car02_staff_access (
  shop_code text NOT NULL REFERENCES public.ksh_demo_shop_settings(shop_code) ON DELETE RESTRICT,
  user_sub uuid NOT NULL,
  staff_role text NOT NULL CHECK (staff_role IN ('owner','staff')),
  active boolean NOT NULL DEFAULT false,
  grant_source text NOT NULL DEFAULT 'manual-reviewed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_code,user_sub)
);
ALTER TABLE public.ksh_car02_staff_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ksh_car02_staff_access FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ksh_car02_staff_access TO service_role;
COMMIT;
-- No RLS policies are created. Frontend roles are always denied direct table access.
-- Production deployment must be separately reviewed and approved after all gates.
