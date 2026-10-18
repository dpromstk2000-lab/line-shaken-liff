-- DPRO CAR02 V4.1 / ISOLATED POSTGRESQL 17 MIGRATION REVIEW ONLY.
-- DO NOT RUN ON PRODUCTION, SHARED SUPABASE, WORKER OR LIVE CUSTOMERS.
-- Draft for disposable isolated DB after independently reviewed R13 and R46 setup.
-- NOT AN APPROVED MIGRATION. NOT EXECUTED OR LOCK-TESTED.
-- Crucial prerequisite: R44/R46 server-verified identity must bind its version to a
-- trusted server-side session; plain user Supabase access tokens do NOT carry this
-- custom CAR02 authorization version by default. Do not read it from client JSON.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '45s';
ALTER TABLE public.ksh_car02_staff_access
  ADD COLUMN auth_version integer NOT NULL DEFAULT 1 CHECK (auth_version >= 1);
-- All row changes rotate version. No delete/recreate reset is permitted.
CREATE FUNCTION public.ksh_car02_staff_auth_version_bump_v41()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.shop_code IS DISTINCT FROM OLD.shop_code OR NEW.user_sub IS DISTINCT FROM OLD.user_sub THEN
    RAISE EXCEPTION 'CAR02_STAFF_MEMBERSHIP_IDENTITY_IMMUTABLE';
  END IF;
  IF OLD.auth_version >= 2147483647 THEN
    RAISE EXCEPTION 'CAR02_STAFF_AUTH_VERSION_EXHAUSTED';
  END IF;
  NEW.auth_version := OLD.auth_version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER ksh_car02_staff_auth_version_bump_v41
BEFORE UPDATE ON public.ksh_car02_staff_access
FOR EACH ROW EXECUTE FUNCTION public.ksh_car02_staff_auth_version_bump_v41();
CREATE FUNCTION public.ksh_car02_staff_no_delete_v41()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CAR02_STAFF_ACCESS_DELETE_DENIED_USE_DEACTIVATION';
END;
$$;
CREATE TRIGGER ksh_car02_staff_no_delete_v41
BEFORE DELETE ON public.ksh_car02_staff_access
FOR EACH ROW EXECUTE FUNCTION public.ksh_car02_staff_no_delete_v41();
REVOKE DELETE ON public.ksh_car02_staff_access FROM service_role;
-- CREATE OR REPLACE / duplicate-trigger rollout safety, existing rows, failures and
-- rollback scripts must be independently reviewed in disposable PostgreSQL 17.
COMMIT;
-- Pending: live verified signer/session issuance, transaction-scoped SELECT FOR UPDATE,
-- JWT invalidation policy, immutable identity, SQL privileges, concurrent revoke tests.
-- NO_GO / HOLD: DO NOT SHIP, DO NOT DEPLOY, DO NOT EXECUTE ON REAL DATABASE.
