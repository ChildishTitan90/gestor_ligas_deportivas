BEGIN;

-- Evidencia privada: nunca se copia el contenido a audit_logs ni al portal.
CREATE TABLE sports_management.player_identity_corrections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 registration_id uuid NOT NULL REFERENCES sports_management.player_registrations(id),
 person_id uuid NOT NULL REFERENCES sports_management.people(id),
 requester_id uuid NOT NULL REFERENCES sports_management.users(id),
 operation_key uuid NOT NULL, request_hash text NOT NULL,
 expected_identity_version integer NOT NULL CHECK(expected_identity_version>0),
 proposed_identity jsonb NOT NULL, previous_identity jsonb,
 reason text NOT NULL, identity_doubt boolean NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RETURNED','APPLIED')),
 reviewed_by uuid REFERENCES sports_management.users(id), decision_key uuid, decision_hash text,
 observations text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), reviewed_at timestamptz,
 CHECK((status='PENDING')=(reviewed_at IS NULL)),
 CHECK(status='PENDING' OR (reviewed_by IS NOT NULL AND reviewed_by<>requester_id AND observations IS NOT NULL AND decision_key IS NOT NULL)),
 UNIQUE(requester_id,operation_key)
);
CREATE INDEX player_identity_corrections_registration ON sports_management.player_identity_corrections(registration_id,created_at);
CREATE TABLE sports_management.player_identity_correction_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), correction_id uuid NOT NULL REFERENCES sports_management.player_identity_corrections(id),
 kind text NOT NULL CHECK(kind IN ('CURP_CERTIFICATE','CIVIL_RECORD','LINK_DOCUMENT')),
 mime_type text NOT NULL CHECK(mime_type IN ('application/pdf','image/jpeg','image/png')),
 sha256 text NOT NULL, bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 1 AND 10485760),
 UNIQUE(correction_id,kind)
);
CREATE TRIGGER immutable_evidence BEFORE UPDATE OR DELETE ON sports_management.player_identity_correction_evidence
 FOR EACH ROW EXECUTE FUNCTION sports_management.prevent_history_mutation();
CREATE TRIGGER no_truncate_evidence BEFORE TRUNCATE ON sports_management.player_identity_correction_evidence
 FOR EACH STATEMENT EXECUTE FUNCTION sports_management.prevent_history_mutation();
CREATE FUNCTION sports_management.guard_identity_correction() RETURNS trigger LANGUAGE plpgsql SET search_path=sports_management,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CORRECTION_IMMUTABLE'; END IF;
 IF OLD.status<>'PENDING' OR NEW.status='PENDING' OR
  (to_jsonb(NEW)-ARRAY['status','reviewed_by','decision_key','decision_hash','observations','reviewed_at','previous_identity']) IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['status','reviewed_by','decision_key','decision_hash','observations','reviewed_at','previous_identity']) THEN
  RAISE EXCEPTION 'CORRECTION_IMMUTABLE';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_correction BEFORE UPDATE OR DELETE ON sports_management.player_identity_corrections
 FOR EACH ROW EXECUTE FUNCTION sports_management.guard_identity_correction();
CREATE TRIGGER no_truncate_corrections BEFORE TRUNCATE ON sports_management.player_identity_corrections
 FOR EACH STATEMENT EXECUTE FUNCTION sports_management.prevent_history_mutation();
-- Defensa adicional para los consumidores históricos actuales que unen people.
-- No inventa una fotografía al cierre ni permite el antiguo bypass correction_id.
CREATE FUNCTION sports_management.protect_closed_person_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=sports_management,pg_temp AS $$
DECLARE season_row record;
BEGIN
 IF ROW(NEW.curp,NEW.first_name,NEW.paternal_surname,NEW.maternal_surname,NEW.birth_date) IS NOT DISTINCT FROM
    ROW(OLD.curp,OLD.first_name,OLD.paternal_surname,OLD.maternal_surname,OLD.birth_date) THEN RETURN NEW; END IF;
 FOR season_row IN SELECT s.status FROM sports_management.seasons s WHERE s.id IN (
   SELECT pr.season_id FROM sports_management.player_registrations pr WHERE pr.person_id=OLD.id
   UNION SELECT ca.season_id FROM sports_management.club_officers co JOIN sports_management.club_affiliations ca ON ca.id=co.affiliation_id WHERE co.person_id=OLD.id
   UNION SELECT pr.season_id FROM sports_management.guardian_consents gc JOIN sports_management.player_registrations pr ON pr.id=gc.registration_id WHERE gc.guardian_person_id=OLD.id
   UNION SELECT csr.season_id FROM sports_management.referees r JOIN sports_management.club_season_referees csr ON csr.referee_id=r.id WHERE r.person_id=OLD.id
   UNION SELECT m.season_id FROM sports_management.referees r JOIN sports_management.referee_assignments ra ON ra.referee_id=r.id JOIN sports_management.matches m ON m.id=ra.match_id WHERE r.person_id=OLD.id
 ) ORDER BY s.id FOR SHARE LOOP
  IF season_row.status='CLOSED' THEN RAISE EXCEPTION 'HISTORICAL_IDENTITY_UNAVAILABLE'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER closed_person_identity BEFORE UPDATE ON sports_management.people
 FOR EACH ROW EXECUTE FUNCTION sports_management.protect_closed_person_identity();
REVOKE ALL ON sports_management.player_identity_corrections,sports_management.player_identity_correction_evidence FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='auth') THEN
 ALTER TABLE sports_management.player_identity_corrections ENABLE ROW LEVEL SECURITY;
 ALTER TABLE sports_management.player_identity_correction_evidence ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON sports_management.player_identity_corrections,sports_management.player_identity_correction_evidence FROM anon,authenticated,service_role;
END IF; END $$;

REVOKE ALL ON FUNCTION sports_management.guard_identity_correction(),sports_management.protect_closed_person_identity() FROM PUBLIC;
COMMIT;
