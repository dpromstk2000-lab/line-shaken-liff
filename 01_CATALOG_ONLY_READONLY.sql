-- DPRO CAR02 V2.8 / catalog-only preflight, READ ONLY.
-- No DDL, writes, credentials, or row-level business data.
-- Gate 1 only: do not run 02 if car02_orders_table_exists is false.
SELECT
  to_regclass('public.ksh_demo_reservations') IS NOT NULL AS legacy_reservations_table_exists,
  to_regclass('public.ksh_car02_work_orders') IS NOT NULL AS car02_orders_table_exists,
  (
    SELECT count(*) = 4
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'ksh_car02_work_orders'
      AND c.column_name IN ('shop_code', 'reservation_id', 'status', 'id')
  ) AS expected_order_columns_present,
  (
    SELECT count(*) = 4
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'ksh_demo_reservations'
      AND c.column_name IN ('id', 'shop_code', 'customer_id', 'vehicle_id')
  ) AS expected_reservation_columns_present,
  EXISTS (
    SELECT 1
    FROM pg_indexes pi
    WHERE pi.schemaname = 'public'
      AND pi.tablename = 'ksh_car02_work_orders'
      AND pi.indexdef ILIKE '%UNIQUE INDEX%'
      AND pi.indexdef LIKE '%reservation_id%'
  ) AS some_reservation_unique_index_exists;
