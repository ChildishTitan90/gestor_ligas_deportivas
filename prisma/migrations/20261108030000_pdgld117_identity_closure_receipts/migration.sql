BEGIN;
-- Sin backfill: acredita exclusivamente cierres posteriores a esta migración.
CREATE TABLE sports_management.season_identity_closures (
 season_id uuid PRIMARY KEY REFERENCES sports_management.seasons(id),
 season_version integer NOT NULL CHECK(season_version>0),
 closed_at timestamptz NOT NULL,
 captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 captured_by uuid NOT NULL REFERENCES sports_management.users(id),
 person_count integer NOT NULL CHECK(person_count>=0),
 format_version integer NOT NULL DEFAULT 1 CHECK(format_version=1)
);
CREATE TRIGGER immutable_season_identity_closure BEFORE INSERT OR UPDATE OR DELETE
 ON sports_management.season_identity_closures FOR EACH ROW
 EXECUTE FUNCTION sports_management.guard_season_identity_snapshot();
CREATE TRIGGER no_truncate_season_identity_closure BEFORE TRUNCATE
 ON sports_management.season_identity_closures FOR EACH STATEMENT
 EXECUTE FUNCTION sports_management.guard_season_identity_snapshot();
CREATE OR REPLACE FUNCTION sports_management.capture_season_identity_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.status='CLOSED' AND OLD.status<>'CLOSED' THEN
  IF NEW.closed_at IS NULL OR nullif(current_setting('app.user_id',true),'') IS NULL THEN
   RAISE EXCEPTION 'SEASON_IDENTITY_CAPTURE_CONTEXT_REQUIRED';
  END IF;
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
  INSERT INTO sports_management.season_identity_closures
   (season_id,season_version,closed_at,captured_by,person_count)
  SELECT NEW.id,NEW.version,NEW.closed_at,nullif(current_setting('app.user_id',true),'')::uuid,count(*)
  FROM sports_management.season_person_identity_snapshots WHERE season_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;

REVOKE ALL ON sports_management.season_identity_closures FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 IF to_regnamespace('auth') IS NOT NULL THEN
  ALTER TABLE sports_management.season_identity_closures ENABLE ROW LEVEL SECURITY;
 END IF;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON sports_management.season_identity_closures FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
COMMIT;
