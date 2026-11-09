BEGIN;

-- Deliberadamente no hay backfill: people vigente no acredita un cierre pasado.
CREATE TABLE sports_management.season_person_identity_snapshots (
 season_id uuid NOT NULL REFERENCES sports_management.seasons(id),
 person_id uuid NOT NULL REFERENCES sports_management.people(id),
 first_name text NOT NULL,
 paternal_surname text NOT NULL,
 maternal_surname text,
 identity_version integer NOT NULL CHECK(identity_version > 0),
 season_version integer NOT NULL CHECK(season_version > 0),
 captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 source text NOT NULL DEFAULT 'SEASON_CLOSURE_V1' CHECK(source='SEASON_CLOSURE_V1'),
 PRIMARY KEY(season_id,person_id)
);
CREATE INDEX season_person_identity_person_idx ON sports_management.season_person_identity_snapshots(person_id);

-- Un único orden previo a las filas para UPDATE directos. Los servicios que ya
-- tengan bloqueos de filas deben adquirir esta misma llave ANTES de ellos.
CREATE FUNCTION sports_management.lock_season_identity_history() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(117,20261108);
 RETURN NULL;
END $$;
CREATE TRIGGER lock_season_identity_history BEFORE UPDATE OF status ON sports_management.seasons
 FOR EACH STATEMENT EXECUTE FUNCTION sports_management.lock_season_identity_history();
CREATE TRIGGER lock_person_identity_history BEFORE UPDATE OF curp,first_name,paternal_surname,maternal_surname,birth_date ON sports_management.people
 FOR EACH STATEMENT EXECUTE FUNCTION sports_management.lock_season_identity_history();

CREATE FUNCTION sports_management.guard_season_identity_snapshot() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 -- Solo el trigger de cierre puede insertar. Ni importaciones ni runtime pueden
 -- fabricar procedencia con INSERT directo, incluso con privilegios de tabla.
 IF TG_OP<>'INSERT' OR pg_trigger_depth()<>2 THEN
  RAISE EXCEPTION 'SEASON_IDENTITY_SNAPSHOT_IMMUTABLE';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_season_identity_snapshot BEFORE INSERT OR UPDATE OR DELETE
 ON sports_management.season_person_identity_snapshots
 FOR EACH ROW EXECUTE FUNCTION sports_management.guard_season_identity_snapshot();
CREATE TRIGGER no_truncate_season_identity_snapshot BEFORE TRUNCATE
 ON sports_management.season_person_identity_snapshots
 FOR EACH STATEMENT EXECUTE FUNCTION sports_management.guard_season_identity_snapshot();

CREATE FUNCTION sports_management.capture_season_identity_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.status='CLOSED' AND OLD.status<>'CLOSED' THEN
  INSERT INTO sports_management.season_person_identity_snapshots
   (season_id,person_id,first_name,paternal_surname,maternal_surname,identity_version,season_version)
  SELECT NEW.id,p.id,p.first_name,p.paternal_surname,p.maternal_surname,p.identity_version,NEW.version
  FROM sports_management.people p WHERE p.id IN (
   SELECT pr.person_id FROM sports_management.player_registrations pr WHERE pr.season_id=NEW.id
   UNION SELECT co.person_id FROM sports_management.club_officers co
    JOIN sports_management.club_affiliations ca ON ca.id=co.affiliation_id WHERE ca.season_id=NEW.id
   UNION SELECT gc.guardian_person_id FROM sports_management.guardian_consents gc
    JOIN sports_management.player_registrations pr ON pr.id=gc.registration_id WHERE pr.season_id=NEW.id
   UNION SELECT r.person_id FROM sports_management.referees r
    JOIN sports_management.club_season_referees csr ON csr.referee_id=r.id WHERE csr.season_id=NEW.id
   UNION SELECT r.person_id FROM sports_management.referees r
    JOIN sports_management.referee_assignments ra ON ra.referee_id=r.id
    JOIN sports_management.matches m ON m.id=ra.match_id WHERE m.season_id=NEW.id
  ) ORDER BY p.id FOR SHARE OF p;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER capture_season_identity_history AFTER UPDATE ON sports_management.seasons
 FOR EACH ROW EXECUTE FUNCTION sports_management.capture_season_identity_history();

REVOKE ALL ON sports_management.season_person_identity_snapshots FROM PUBLIC;
REVOKE ALL ON FUNCTION sports_management.capture_season_identity_history(),
 sports_management.guard_season_identity_snapshot(),sports_management.lock_season_identity_history() FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='auth') THEN
  ALTER TABLE sports_management.season_person_identity_snapshots ENABLE ROW LEVEL SECURITY;
 END IF;
 -- No asumir que los tres roles existen juntos en un entorno de prueba.
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON sports_management.season_person_identity_snapshots FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON sports_management.season_person_identity_snapshots FROM authenticated;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  REVOKE ALL ON sports_management.season_person_identity_snapshots FROM service_role;
 END IF;
END $$;
COMMIT;
