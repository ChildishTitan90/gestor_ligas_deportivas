BEGIN;

-- Denegar destinos ambiguos antes de crear objetos. Docker conserva su RLS actual.
DO $target$
DECLARE markers integer;
BEGIN
  SELECT (SELECT count(*) FROM pg_namespace WHERE nspname IN ('auth', 'storage'))
    + (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) INTO markers;
  IF markers NOT IN (0, 5) THEN RAISE EXCEPTION 'Marcadores parciales de Supabase'; END IF;
END $target$;

CREATE TABLE sports_management.team_enrollment_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES sports_management.users(id),
  enrollment_key uuid NOT NULL,
  club_id uuid NOT NULL REFERENCES sports_management.clubs(id),
  fingerprint varchar(64) CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  outcome text NOT NULL CHECK (outcome IN ('CONFIRMED', 'CANCELLED')),
  enrollment_id uuid UNIQUE REFERENCES sports_management.season_teams(id),
  finalized_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_id, enrollment_key),
  CHECK ((outcome = 'CONFIRMED') = (enrollment_id IS NOT NULL)),
  CHECK (outcome <> 'CONFIRMED' OR fingerprint IS NOT NULL)
);
CREATE INDEX team_enrollment_operations_club_id_idx ON sports_management.team_enrollment_operations(club_id);
REVOKE ALL ON sports_management.team_enrollment_operations FROM PUBLIC;

DO $security$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    ALTER TABLE sports_management.team_enrollment_operations ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON sports_management.team_enrollment_operations FROM anon, authenticated, service_role;
    -- Sin políticas de API. NextAuth/RBAC siguen en el servidor de aplicación.
  END IF;
END $security$;

-- Preservar la recuperación de claves confirmadas antes de esta migración.
-- No modifica afiliaciones, categorías, equipos ni inscripciones existentes.
INSERT INTO sports_management.team_enrollment_operations
  (actor_id, enrollment_key, club_id, fingerprint, outcome, enrollment_id, finalized_at)
SELECT enrolled_by, enrollment_key, club_id, enrollment_hash, 'CONFIRMED', id, enrolled_at
FROM sports_management.season_teams WHERE enrolled_by IS NOT NULL;

CREATE FUNCTION sports_management.guard_team_enrollment_operation() RETURNS trigger
LANGUAGE plpgsql SET search_path = sports_management, pg_temp AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'El resultado de una operación es definitivo'; END IF;
  IF NEW.outcome = 'CONFIRMED' AND NOT EXISTS (
    SELECT 1 FROM sports_management.season_teams e WHERE e.id = NEW.enrollment_id
      AND e.club_id = NEW.club_id AND e.enrolled_by = NEW.actor_id
      AND e.enrollment_key = NEW.enrollment_key AND e.enrollment_hash = NEW.fingerprint
  ) THEN RAISE EXCEPTION 'La operación no coincide con su inscripción'; END IF;
  IF NEW.outcome = 'CANCELLED' THEN
    IF nullif(current_setting('app.user_id', true), '')::uuid IS DISTINCT FROM NEW.actor_id
      OR nullif(current_setting('app.reason', true), '') IS NULL THEN
      RAISE EXCEPTION 'La cancelación exige contexto de auditoría';
    END IF;
    INSERT INTO sports_management.audit_logs(user_id, action, table_name, entity_id, new_data, reason)
      VALUES (NEW.actor_id, 'TEAM_ENROLLMENT_CANCEL', 'team_enrollment_operations', NEW.id,
        jsonb_build_object('club_id', NEW.club_id, 'outcome', NEW.outcome), current_setting('app.reason'));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION sports_management.guard_team_enrollment_operation() FROM PUBLIC;
CREATE TRIGGER guard_enrollment_operation BEFORE INSERT OR UPDATE OR DELETE
  ON sports_management.team_enrollment_operations FOR EACH ROW
  EXECUTE FUNCTION sports_management.guard_team_enrollment_operation();

COMMIT;
