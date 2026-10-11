-- DPRO CAR02 R81. ISOLATED POSTGRES QA ONLY. NEVER EXECUTE ON SHARED PRODUCTION.
-- Requires R13 shop and R46 staff_access QA schemas to already exist in a disposable DB.
-- Database must be explicitly named car02_r81_qa_*, not the production database.
-- Production migration remains HOLD, and Edge release remains NO_GO.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';
DO $$ BEGIN
 IF current_database() !~ '^car02_r81_qa_[a-z0-9_]{1,48}$' THEN
  RAISE EXCEPTION 'CAR02_R81_ISOLATION_REQUIRED';
 END IF;
END $$;
CREATE TABLE public.ksh_car02_owner_bootstrap_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 shop_code text NOT NULL REFERENCES public.ksh_demo_shop_settings(shop_code) ON DELETE RESTRICT,
 candidate_user_sub uuid NOT NULL,
 request_id uuid NOT NULL,
 reviewer_one_sub uuid NOT NULL,
 reviewer_two_sub uuid NOT NULL,
 reason text NOT NULL CHECK (char_length(reason) BETWEEN 12 AND 512),
 granted_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT car02_r81_two_distinct_reviewers CHECK (reviewer_one_sub <> reviewer_two_sub),
 CONSTRAINT car02_r81_not_candidate_reviewer_one CHECK (candidate_user_sub <> reviewer_one_sub),
 CONSTRAINT car02_r81_not_candidate_reviewer_two CHECK (candidate_user_sub <> reviewer_two_sub),
 CONSTRAINT car02_r81_one_bootstrap_per_shop UNIQUE (shop_code),
 CONSTRAINT car02_r81_unique_request UNIQUE (request_id)
);
ALTER TABLE public.ksh_car02_owner_bootstrap_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ksh_car02_owner_bootstrap_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.ksh_car02_owner_bootstrap_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ksh_car02_owner_bootstrap_audit_id_seq TO service_role;
-- No client-accessible RLS policy, no UPDATE/DELETE grant, no browser endpoint.
COMMIT;
