BEGIN;

DO $target$
DECLARE markers integer;
BEGIN
  SELECT (SELECT count(*) FROM pg_namespace WHERE nspname IN ('auth','storage')) +
    (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) INTO markers;
  IF markers NOT IN (0,5) THEN RAISE EXCEPTION 'Marcadores parciales de Supabase'; END IF;
END $target$;

ALTER TABLE sports_management.people ADD COLUMN identity_version integer NOT NULL DEFAULT 1 CHECK(identity_version > 0);
CREATE FUNCTION sports_management.version_player_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = sports_management, pg_temp AS $$
BEGIN
  IF ROW(NEW.curp,NEW.first_name,NEW.paternal_surname,NEW.maternal_surname,NEW.birth_date)
    IS DISTINCT FROM ROW(OLD.curp,OLD.first_name,OLD.paternal_surname,OLD.maternal_surname,OLD.birth_date) THEN
    NEW.identity_version := OLD.identity_version + 1;
  ELSE NEW.identity_version := OLD.identity_version;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION sports_management.version_player_identity() FROM PUBLIC;
CREATE TRIGGER version_identity BEFORE UPDATE ON sports_management.people
  FOR EACH ROW EXECUTE FUNCTION sports_management.version_player_identity();

CREATE TABLE sports_management.player_curp_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_key uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES sports_management.users(id),
  person_id uuid NOT NULL REFERENCES sports_management.people(id),
  registration_id uuid NOT NULL REFERENCES sports_management.player_registrations(id),
  identity_version integer NOT NULL CHECK(identity_version > 0),
  fingerprint varchar(64) NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','VERIFIED','NOT_FOUND','DISCREPANCY',
    'INVALID_CREDENTIALS','INSUFFICIENT_BALANCE','UNAVAILABLE','UNEXPECTED_RESPONSE','UNCERTAIN','STALE')),
  mismatched_fields text[] NOT NULL DEFAULT '{}'
    CHECK(mismatched_fields <@ ARRAY['curp','firstName','paternalSurname','maternalSurname','birthDate']::text[]),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  UNIQUE(actor_id,operation_key),
  CHECK((status='PENDING')=(finished_at IS NULL)),
  CHECK((status='DISCREPANCY')=(cardinality(mismatched_fields)>0))
);
CREATE INDEX player_curp_checks_person_version ON sports_management.player_curp_checks(person_id,identity_version,created_at DESC);
CREATE INDEX player_curp_checks_actor_date ON sports_management.player_curp_checks(actor_id,created_at DESC);
CREATE INDEX player_curp_checks_date ON sports_management.player_curp_checks(created_at DESC);
CREATE INDEX player_curp_checks_registration ON sports_management.player_curp_checks(registration_id);
REVOKE ALL ON sports_management.player_curp_checks FROM PUBLIC;
DO $security$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='auth') THEN
    ALTER TABLE sports_management.player_curp_checks ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON sports_management.player_curp_checks FROM anon,authenticated,service_role;
  END IF;
END $security$;

CREATE FUNCTION sports_management.guard_player_curp_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = sports_management, pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'No se eliminan intentos de verificación'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'PENDING' OR NOT EXISTS (SELECT 1 FROM sports_management.player_registrations
      WHERE id=NEW.registration_id AND person_id=NEW.person_id) THEN
      RAISE EXCEPTION 'El intento debe iniciar pendiente para la identidad de la inscripción';
    END IF;
  ELSIF OLD.status<>'PENDING' OR NEW.status='PENDING' OR
    ROW(NEW.id,NEW.actor_id,NEW.operation_key,NEW.person_id,NEW.registration_id,NEW.identity_version,NEW.fingerprint,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.actor_id,OLD.operation_key,OLD.person_id,OLD.registration_id,OLD.identity_version,OLD.fingerprint,OLD.created_at) THEN
    RAISE EXCEPTION 'El resultado y el contrato del intento son definitivos';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION sports_management.guard_player_curp_check() FROM PUBLIC;
CREATE TRIGGER guard_curp_check BEFORE INSERT OR UPDATE OR DELETE ON sports_management.player_curp_checks
  FOR EACH ROW EXECUTE FUNCTION sports_management.guard_player_curp_check();
CREATE TRIGGER record_audit AFTER INSERT OR UPDATE ON sports_management.player_curp_checks
  FOR EACH ROW EXECUTE FUNCTION sports_management.audit_change();
CREATE TRIGGER no_truncate_curp_checks BEFORE TRUNCATE ON sports_management.player_curp_checks
  FOR EACH STATEMENT EXECUTE FUNCTION sports_management.prevent_history_mutation();

-- Docker sigue sin RLS. El CD conserva el bloqueo de tablas nuevas hasta revisar su plan exacto.
COMMIT;
