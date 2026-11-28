BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM sports_management.users WHERE encrypted_mfa_secret IS NOT NULL)
 THEN RAISE EXCEPTION 'MFA_LEGACY_SECRET_REQUIRES_RECONCILIATION'; END IF;
END $$;
CREATE TABLE sports_management.mfa_factors (
 user_id uuid PRIMARY KEY REFERENCES sports_management.users(id),
 encrypted_secret text, last_step bigint,
 pending_secret text, pending_id uuid, pending_expires_at timestamptz, pending_session_hash text,
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 failed_attempts integer NOT NULL DEFAULT 0 CHECK(failed_attempts>=0), blocked_until timestamptz,
 CHECK ((pending_secret IS NULL AND pending_id IS NULL AND pending_expires_at IS NULL AND pending_session_hash IS NULL)
 OR (pending_secret IS NOT NULL AND pending_id IS NOT NULL AND pending_expires_at IS NOT NULL AND pending_session_hash IS NOT NULL)),
 CHECK(encrypted_secret IS NOT NULL OR last_step IS NULL)
);
CREATE TABLE sports_management.mfa_recovery_codes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES sports_management.users(id),
 code_hash text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), consumed_at timestamptz
);
CREATE INDEX mfa_recovery_codes_user_id_idx ON sports_management.mfa_recovery_codes(user_id);
ALTER TABLE sports_management.sessions ADD COLUMN mfa_state text NOT NULL DEFAULT 'VERIFIED'
 CHECK(mfa_state IN ('VERIFIED','PENDING','RECOVERY')), ADD COLUMN mfa_expires_at timestamptz;
ALTER TABLE sports_management.sessions ADD CONSTRAINT sessions_mfa_pending_deadline
 CHECK(mfa_state = 'VERIFIED' OR mfa_expires_at IS NOT NULL);
-- Los secretos nunca pasan al trigger audit_change (que serializa la fila).
-- Eventos mínimos reutilizan la bitácora inmutable de autenticación.
ALTER TABLE sports_management.authentication_events DROP CONSTRAINT authentication_events_action_check;
ALTER TABLE sports_management.authentication_events ADD CONSTRAINT authentication_events_action_check CHECK(action IN
 ('LOGIN_OK','LOGIN_FAILED','LOGOUT','PASSWORD_CHANGED','BLOCK','MFA_ENABLED','MFA_CHANGED','MFA_DISABLED','MFA_VERIFIED','MFA_FAILED','MFA_BLOCKED','MFA_RECOVERY_STARTED','MFA_RECOVERED'));
REVOKE ALL ON sports_management.mfa_factors,sports_management.mfa_recovery_codes FROM PUBLIC;
-- Producción: acceso solo al backend privado mediante plan explícito del repositorio.
-- Sin políticas para anon/authenticated ni API pública de Supabase.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    ALTER TABLE sports_management.mfa_factors ENABLE ROW LEVEL SECURITY;
    ALTER TABLE sports_management.mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON sports_management.mfa_factors, sports_management.mfa_recovery_codes
      FROM anon, authenticated, service_role;
  END IF;
END $$;
COMMIT;
