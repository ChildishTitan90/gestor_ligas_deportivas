BEGIN;
CREATE TABLE sports_management.password_recovery_budgets (
  bucket_key varchar(64) PRIMARY KEY CHECK (bucket_key ~ '^[a-f0-9]{64}$'),
  window_start timestamptz NOT NULL,
  hits integer NOT NULL CHECK (hits > 0)
);
CREATE INDEX password_recovery_budgets_window_start_idx ON sports_management.password_recovery_budgets(window_start);
REVOKE ALL ON sports_management.password_recovery_budgets FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='auth') THEN
    ALTER TABLE sports_management.password_recovery_budgets ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON sports_management.password_recovery_budgets FROM anon, authenticated, service_role;
  END IF;
END $$;
COMMIT;
