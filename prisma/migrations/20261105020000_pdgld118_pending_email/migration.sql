-- El correo histórico no se declara verificado. El login conserva users.email hasta confirmar.
ALTER TABLE sports_management.users ADD COLUMN email_verified_at timestamptz;
CREATE TABLE sports_management.account_email_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES sports_management.users(id),
  actor_id uuid NOT NULL REFERENCES sports_management.users(id),
  operation_key uuid NOT NULL,
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  old_email text NOT NULL,
  new_email text NOT NULL CHECK (length(new_email) BETWEEN 3 AND 254 AND new_email=lower(btrim(new_email))),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  expected_revision integer NOT NULL CHECK (expected_revision > 0),
  user_version integer NOT NULL CHECK (user_version > 0),
  reason text NOT NULL CHECK (length(reason) BETWEEN 10 AND 300),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  used_at timestamptz,
  status text NOT NULL CHECK (status IN ('PENDING','CONFIRMED','SUPERSEDED')),
  confirmation_delivery text NOT NULL CHECK (confirmation_delivery IN ('NOT_CONFIGURED','PENDING','ACCEPTED','FAILED','UNKNOWN')),
  previous_notice_delivery text NOT NULL CHECK (previous_notice_delivery IN ('NOT_CONFIGURED','PENDING','ACCEPTED','FAILED','UNKNOWN')),
  completion_notice_delivery text NOT NULL CHECK (completion_notice_delivery IN ('NOT_CONFIGURED','PENDING','ACCEPTED','FAILED','UNKNOWN')),
  UNIQUE(actor_id,operation_key),
  CHECK ((status='CONFIRMED')=(used_at IS NOT NULL))
);
CREATE UNIQUE INDEX account_email_changes_one_pending ON sports_management.account_email_changes(user_id) WHERE status='PENDING';
CREATE INDEX account_email_changes_recent ON sports_management.account_email_changes(user_id,created_at DESC);
REVOKE ALL ON sports_management.account_email_changes FROM PUBLIC;
-- Conservar la decisión de entorno: Docker sin RLS; Supabase/Preview con RLS y
-- sin acceso hasta provisionar explícitamente el backend privado con su plan.
DO $$ BEGIN
  IF (SELECT relrowsecurity FROM pg_class WHERE oid='sports_management.users'::regclass) THEN
    ALTER TABLE sports_management.account_email_changes ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;
