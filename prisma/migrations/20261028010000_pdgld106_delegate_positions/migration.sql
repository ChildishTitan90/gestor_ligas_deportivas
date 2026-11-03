-- PDGLD-106: additive schema; no backfill, inferred positions or permission changes.
BEGIN;
SET LOCAL search_path = sports_management, public, extensions;
-- Installation only: ordinary writers continue using the existing authorization protocol.
SELECT pg_advisory_xact_lock(54, 2026);
LOCK TABLE sports_management.roles IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE sports_management.user_roles IN ACCESS EXCLUSIVE MODE;

ALTER TABLE sports_management.user_roles
  ADD COLUMN delegate_position text,
  ADD CONSTRAINT user_roles_delegate_position_value
    CHECK (delegate_position IS NULL OR delegate_position IN ('PRIMARY', 'DEPUTY')),
  ADD CONSTRAINT user_roles_delegate_position_scope
    CHECK (delegate_position IS NULL OR (club_id IS NOT NULL AND league_id IS NOT NULL)),
  ADD CONSTRAINT user_roles_delegate_position_overlap
    EXCLUDE USING gist (club_id WITH =, delegate_position WITH =,
      tstzrange(starts_at, ends_at, '[)') WITH &&)
    WHERE (delegate_position IS NOT NULL),
  ADD CONSTRAINT user_roles_delegate_account_overlap
    EXCLUDE USING gist (club_id WITH =, user_id WITH =,
      tstzrange(starts_at, ends_at, '[)') WITH &&)
    WHERE (delegate_position IS NOT NULL);

COMMENT ON COLUMN sports_management.user_roles.delegate_position IS
  'PRIMARY=Titular; DEPUTY=Subdelegado. NULL on preexisting CLUB_DELEGATE means unknown, never inferred.';

-- No table lookups, security-definer function, advisory lock or isolation requirement.
-- The catalog UUID is supplied as a constant trigger argument below.
CREATE FUNCTION sports_management.guard_delegate_assignment()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, sports_management, pg_temp AS $$
DECLARE delegate_id uuid := TG_ARGV[0]::uuid;
        effective_at timestamptz := transaction_timestamp();
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.role_id = delegate_id THEN
    IF TG_OP = 'DELETE' THEN
      IF OLD.starts_at <= effective_at THEN
        RAISE EXCEPTION 'user_roles_delegate_history'
          USING ERRCODE = '23514', CONSTRAINT = 'user_roles_delegate_history';
      END IF;
      RETURN OLD; -- A planned designation may be cancelled; record_audit preserves it.
    END IF;
    IF OLD.starts_at <= effective_at THEN
      -- Once effective, replacement is a new row. Explicit NULL classification
      -- is allowed, but a known historical position cannot be rewritten.
      IF ROW(NEW.id, NEW.user_id, NEW.role_id, NEW.league_id, NEW.club_id, NEW.starts_at)
          IS DISTINCT FROM ROW(OLD.id, OLD.user_id, OLD.role_id, OLD.league_id, OLD.club_id, OLD.starts_at)
        OR (OLD.delegate_position IS NOT NULL AND NEW.delegate_position IS DISTINCT FROM OLD.delegate_position)
        OR (NEW.ends_at IS DISTINCT FROM OLD.ends_at AND
          ((OLD.ends_at IS NOT NULL AND OLD.ends_at <= effective_at)
            OR (NEW.ends_at IS NOT NULL AND NEW.ends_at < effective_at))) THEN
        RAISE EXCEPTION 'user_roles_delegate_history'
          USING ERRCODE = '23514', CONSTRAINT = 'user_roles_delegate_history';
      END IF;
    ELSIF NEW.starts_at <= effective_at THEN
      RAISE EXCEPTION 'user_roles_delegate_history'
        USING ERRCODE = '23514', CONSTRAINT = 'user_roles_delegate_history';
    END IF;
    -- Even future known designations cannot become ambiguous.
    IF OLD.delegate_position IS NOT NULL AND NEW.role_id = delegate_id AND NEW.delegate_position IS NULL THEN
      RAISE EXCEPTION 'user_roles_delegate_position_required'
        USING ERRCODE = '23514', CONSTRAINT = 'user_roles_delegate_position_required';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.role_id = delegate_id AND NEW.delegate_position IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'user_roles_delegate_position_required'
        USING ERRCODE = '23514', CONSTRAINT = 'user_roles_delegate_position_required';
    END IF;
    -- Legacy ambiguity may be retained only on the same assignment and within
    -- its original period. This is not a way to create or expand ambiguity.
    IF OLD.role_id <> delegate_id OR OLD.delegate_position IS NOT NULL
      OR ROW(NEW.id, NEW.user_id, NEW.role_id, NEW.league_id, NEW.club_id, NEW.starts_at)
        IS DISTINCT FROM ROW(OLD.id, OLD.user_id, OLD.role_id, OLD.league_id, OLD.club_id, OLD.starts_at)
      OR (OLD.ends_at IS NOT NULL AND (NEW.ends_at IS NULL OR NEW.ends_at > OLD.ends_at)) THEN
      RAISE EXCEPTION 'user_roles_delegate_position_required'
        USING ERRCODE = '23514', CONSTRAINT = 'user_roles_delegate_position_required';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Partial predicates embed the actual UUID, not a function reading mutable roles.
-- Protect that exact catalog identity even when no assignments reference it.
CREATE FUNCTION sports_management.protect_delegate_role_identity()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, sports_management, pg_temp AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'roles_delegate_identity_stable'
      USING ERRCODE = '23514', CONSTRAINT = 'roles_delegate_identity_stable';
  END IF;
  IF OLD.id = TG_ARGV[0]::uuid THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'roles_delegate_identity_stable'
        USING ERRCODE = '23514', CONSTRAINT = 'roles_delegate_identity_stable';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.code IS DISTINCT FROM OLD.code THEN
      RAISE EXCEPTION 'roles_delegate_identity_stable'
        USING ERRCODE = '23514', CONSTRAINT = 'roles_delegate_identity_stable';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DO $install$
DECLARE delegate_id uuid;
BEGIN
  SELECT id INTO STRICT delegate_id FROM sports_management.roles WHERE code = 'CLUB_DELEGATE';
  EXECUTE format('ALTER TABLE sports_management.user_roles
    ADD CONSTRAINT user_roles_delegate_role CHECK (delegate_position IS NULL OR role_id = %L::uuid),
    ADD CONSTRAINT user_roles_delegate_legacy_overlap EXCLUDE USING gist (
      club_id WITH =,
      (CASE WHEN delegate_position IS NULL THEN 0 ELSE 1 END) WITH <>,
      tstzrange(starts_at, ends_at, ''[)'') WITH &&
    ) WHERE (role_id = %L::uuid)', delegate_id, delegate_id);
  EXECUTE format('CREATE TRIGGER guard_delegate_assignment BEFORE INSERT OR UPDATE OR DELETE
    ON sports_management.user_roles FOR EACH ROW
    EXECUTE FUNCTION sports_management.guard_delegate_assignment(%L)', delegate_id);
  EXECUTE format('CREATE TRIGGER protect_delegate_role_identity BEFORE UPDATE OR DELETE
    ON sports_management.roles FOR EACH ROW
    EXECUTE FUNCTION sports_management.protect_delegate_role_identity(%L)', delegate_id);
  EXECUTE format('CREATE TRIGGER protect_delegate_role_truncate BEFORE TRUNCATE
    ON sports_management.roles FOR EACH STATEMENT
    EXECUTE FUNCTION sports_management.protect_delegate_role_identity(%L)', delegate_id);
END $install$;

REVOKE ALL ON FUNCTION sports_management.guard_delegate_assignment() FROM PUBLIC;
REVOKE ALL ON FUNCTION sports_management.protect_delegate_role_identity() FROM PUBLIC;
-- No extra audit trigger: baseline record_audit requires actor/reason and records once.
COMMIT;
