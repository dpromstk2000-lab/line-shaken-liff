-- DPRO CAR02 V2.8 / aggregate-only pre-migration duplicate inventory, READ ONLY.
-- Prerequisite: 01 confirms both tables and all expected columns.
-- NEVER paste/run if car02_orders_table_exists is false.
-- Output contains aggregate counts only, no shop codes, IDs, customer details or tokens.
WITH
  duplicates AS (
    SELECT shop_code, reservation_id, count(*)::bigint AS number_of_orders
    FROM public.ksh_car02_work_orders
    WHERE reservation_id IS NOT NULL
    GROUP BY shop_code, reservation_id
    HAVING count(*) > 1
  ),
  duplicate_totals AS (
    SELECT count(*)::bigint AS duplicate_booking_groups,
           coalesce(sum(number_of_orders), 0)::bigint AS orders_in_duplicate_groups,
           coalesce(max(number_of_orders), 0)::bigint AS largest_group
    FROM duplicates
  ),
  order_totals AS (
    SELECT count(*)::bigint AS total_orders,
           count(*) FILTER (WHERE reservation_id IS NULL)::bigint AS orders_without_reservation
    FROM public.ksh_car02_work_orders
  )
SELECT o.total_orders, o.orders_without_reservation,
       d.duplicate_booking_groups, d.orders_in_duplicate_groups, d.largest_group,
       CASE WHEN d.duplicate_booking_groups > 0 THEN 'HOLD_MANUAL_RECONCILIATION_REQUIRED'
            ELSE 'HOLD_OTHER_RELEASE_GATES_STILL_REQUIRED'
       END AS review_gate
FROM order_totals o CROSS JOIN duplicate_totals d;
