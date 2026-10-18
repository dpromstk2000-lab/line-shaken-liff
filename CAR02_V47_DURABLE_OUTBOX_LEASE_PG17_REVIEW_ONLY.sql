-- DPRO CAR02 V4.7 / PostgreSQL 17 DRAFT CONTRACT / NON-EXECUTABLE REVIEW ONLY.
-- NEVER RUN ON PRODUCTION, SHARED SUPABASE OR A CUSTOMER DATABASE.
-- Existing R13 notification_outbox has no claim_token, lease_expires_at or 'unknown' status.
-- Actual migration requires isolation, naming, privilege, backfill and lock testing.
-- Everything below is commented out intentionally to prevent accidental execution.
/*
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='45s';
ALTER TABLE public.ksh_car02_notification_outbox
  ADD COLUMN claim_token uuid,
  ADD COLUMN claim_owner text,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN provider_message_id text,
  ADD COLUMN manual_review_evidence text;
-- Verify actual constraint name with pg_constraint in a disposable PostgreSQL 17 DB.
ALTER TABLE public.ksh_car02_notification_outbox
  DROP CONSTRAINT IF EXISTS ksh_car02_notification_outbox_delivery_status_check;
ALTER TABLE public.ksh_car02_notification_outbox
  ADD CONSTRAINT ksh_car02_notification_outbox_delivery_status_check
  CHECK (delivery_status IN ('pending','sending','sent','retry','failed','cancelled','unknown'));
-- All grants, RLS, indexes and transitions must be independently reviewed.
COMMIT;

-- DRAFT CLAIM, requiring same transaction and authenticated service-side shop context.
-- DO NOT CALL FROM CLIENT. Use shop ownership JOIN before picking FOR UPDATE.
WITH eligible AS (
 SELECT o.id FROM public.ksh_car02_notification_outbox o
 JOIN public.ksh_car02_work_orders w ON w.id=o.work_order_id
 WHERE w.shop_code=$1 AND o.delivery_status='pending'
   AND (o.next_attempt_at IS NULL OR o.next_attempt_at<=now())
 ORDER BY o.created_at,o.id
 FOR UPDATE OF o SKIP LOCKED LIMIT 1
)
UPDATE public.ksh_car02_notification_outbox o
 SET delivery_status='sending',claim_token=gen_random_uuid(),
     claim_owner=$2,lease_expires_at=now()+interval '60 seconds',attempts=attempts+1
FROM eligible WHERE o.id=eligible.id AND o.delivery_status='pending'
RETURNING o.id,o.claim_token,o.lease_expires_at;

-- DRAFT COMPLETION: stale worker must not overwrite result of another worker.
UPDATE public.ksh_car02_notification_outbox o
 SET delivery_status='sent',provider_message_id=$3,sent_at=now(),
     claim_token=NULL,claim_owner=NULL,lease_expires_at=NULL
FROM public.ksh_car02_work_orders w
WHERE o.work_order_id=w.id AND w.shop_code=$1 AND o.id=$2
  AND o.delivery_status='sending' AND o.claim_token=$4
  AND o.lease_expires_at>now();
-- Affected rows MUST equal exactly 1 or FAIL CLOSED.

-- DRAFT SWEEP: NEVER auto-reclaim potentially sent but unacknowledged leases.
UPDATE public.ksh_car02_notification_outbox
 SET delivery_status='unknown',claim_token=NULL,claim_owner=NULL,lease_expires_at=NULL
 WHERE delivery_status='sending' AND lease_expires_at<=now();
-- Manual verified provider outcome is required before 'unknown' => 'pending' or 'sent'.
-- To prevent a race, lease expiry sweep and success write must be transactionally fenced.
*/
-- UNVERIFIED: no PG17 execution, RLS/privilege/constraint validation or provider tests.
-- NO_GO / HOLD. NEVER SHIP THIS SQL.
