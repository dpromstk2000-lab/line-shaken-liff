-- R93D PostgreSQL17 QA assertions, disposable 'postgres' DB only. NO customer DB.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE n integer;
BEGIN
 IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'QA_DATABASE_REQUIRED'; END IF;
 SELECT count(*) INTO n FROM information_schema.tables
 WHERE table_schema='car02_r93d_qa' AND table_name='cleanup_jobs';
 IF n<>1 THEN RAISE EXCEPTION 'R93D_QA_TABLE_NOT_FOUND'; END IF;
END $$;
INSERT INTO car02_r93d_qa.cleanup_jobs(shop_code,photo_id,order_id,report_id,storage_path,photo_state,photo_created_at,run_after)
VALUES ('street_house_kitsuki', '44444444-4444-4444-8444-444444444444',
 '22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
 'street_house_kitsuki/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/77777777-7777-4777-8777-777777777777.jpg',
 'deleted',now()-interval '2 hours',now()-interval '5 minutes');
DO $$ DECLARE n integer; BEGIN
 BEGIN
  INSERT INTO car02_r93d_qa.cleanup_jobs(shop_code,photo_id,order_id,report_id,storage_path,photo_state,photo_created_at)
  SELECT shop_code,photo_id,order_id,report_id,storage_path,photo_state,photo_created_at FROM car02_r93d_qa.cleanup_jobs LIMIT 1;
  RAISE EXCEPTION 'DUPLICATE_ALLOWED';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN
  UPDATE car02_r93d_qa.cleanup_jobs SET photo_state='ready';
  RAISE EXCEPTION 'READY_STATE_ALLOWED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  UPDATE car02_r93d_qa.cleanup_jobs SET storage_path='../foreign.jpg';
  RAISE EXCEPTION 'OTHER_SCOPE_ALLOWED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 SELECT count(*) INTO n FROM car02_r93d_qa.cleanup_jobs;
 IF n<>1 THEN RAISE EXCEPTION 'ROWS_CHANGED_UNEXPECTEDLY'; END IF;
END $$;
CREATE TEMP TABLE qa_lease AS SELECT * FROM car02_r93d_qa.claim_one(now());
DO $$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM qa_lease;
 IF n<>1 THEN RAISE EXCEPTION 'CLAIM_ONE_FAILED'; END IF;
 SELECT count(*) INTO n FROM car02_r93d_qa.claim_one(now());
 IF n<>0 THEN RAISE EXCEPTION 'DUPLICATE_LEASE_ALLOWED'; END IF;
END $$;
DO $$ DECLARE ok boolean; BEGIN
 SELECT car02_r93d_qa.defer_one(job_id,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now(),now()+interval '5 minutes','RETRY') INTO ok FROM qa_lease;
 IF ok THEN RAISE EXCEPTION 'FORGED_LEASE_ACCEPTED'; END IF;
 SELECT car02_r93d_qa.finish_one(job_id,lease_token,now(),'verified','PROBE_404') INTO ok FROM qa_lease;
 IF NOT ok THEN RAISE EXCEPTION 'FINISH_FAILED'; END IF;
 SELECT car02_r93d_qa.finish_one(job_id,lease_token,now(),'verified','PROBE_404') INTO ok FROM qa_lease;
 IF ok THEN RAISE EXCEPTION 'DUPLICATE_FINISH_ALLOWED'; END IF;
END $$;
DO $$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM car02_r93d_qa.cleanup_jobs WHERE state='verified' AND lease_id IS NULL AND lease_expires IS NULL;
 IF n<>1 THEN RAISE EXCEPTION 'TERMINAL_STATE_WRONG'; END IF;
 SELECT count(*) INTO n FROM car02_r93d_qa.claim_one(now());
 IF n<>0 THEN RAISE EXCEPTION 'VERIFIED_ROW_RECLAIMED'; END IF;
END $$;
ROLLBACK;
\echo R93D_PG17_ISOLATED_QA_PASS
