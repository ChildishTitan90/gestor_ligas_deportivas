BEGIN;
-- Solo cierres futuros. No se copian bytes/documentos ni se reconstruyen cierres.
CREATE TABLE sports_management.season_registration_history (
 registration_id uuid PRIMARY KEY REFERENCES sports_management.player_registrations(id),
 season_id uuid NOT NULL REFERENCES sports_management.seasons(id),
 person_id uuid NOT NULL REFERENCES sports_management.people(id),
 identity_version integer NOT NULL CHECK(identity_version>0), birth_date date,
 reference_year integer, policy_fingerprint text,
 rule_id uuid NOT NULL REFERENCES sports_management.competition_rules(id), rule_version integer NOT NULL,
 registration_status text NOT NULL, identity_review_status text,
 document_refs jsonb NOT NULL, verification_refs jsonb NOT NULL, participation_refs jsonb NOT NULL,
 captured_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER immutable_registration_history BEFORE INSERT OR UPDATE OR DELETE
 ON sports_management.season_registration_history FOR EACH ROW
 EXECUTE FUNCTION sports_management.guard_season_identity_snapshot();
CREATE TRIGGER no_truncate_registration_history BEFORE TRUNCATE
 ON sports_management.season_registration_history FOR EACH STATEMENT
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
  INSERT INTO sports_management.season_registration_history
   (registration_id,season_id,person_id,identity_version,birth_date,reference_year,
    policy_fingerprint,rule_id,rule_version,registration_status,identity_review_status,
    document_refs,verification_refs,participation_refs)
  SELECT pr.id,NEW.id,pr.person_id,p.identity_version,p.birth_date,
   CASE WHEN jsonb_typeof(sc.player_policy->'referenceYear')='number' THEN (sc.player_policy->>'referenceYear')::integer END,
   CASE WHEN sc.player_policy IS NOT NULL THEN encode(sha256(convert_to(sc.player_policy::text,'UTF8')),'hex') END,
   cr.id,cr.version_number,pr.status,pr.identity_review_status,
   COALESCE((SELECT jsonb_agg(jsonb_build_object('documentId',d.id,'fileId',d.file_id,'typeId',d.document_type_id,'status',d.status,'sha256',f.sha256) ORDER BY d.id)
      FROM sports_management.player_documents d JOIN sports_management.files f ON f.id=d.file_id WHERE d.registration_id=pr.id),'[]'::jsonb),
   jsonb_build_object('curpCheckId',(SELECT c.id FROM sports_management.player_curp_checks c WHERE c.person_id=p.id AND c.identity_version=p.identity_version ORDER BY c.created_at DESC,c.id DESC LIMIT 1),
     'inePreparedEventId',(SELECT al.id FROM sports_management.audit_logs al WHERE al.entity_id=pr.id AND al.action='PLAYER_INE_PREPARED' ORDER BY al.occurred_at DESC,al.id DESC LIMIT 1)),
   COALESCE((SELECT jsonb_agg(jsonb_build_object('id',pc.id,'version',pc.version,'status',pc.status,'reviewEventId',pc.review_event_id,'fingerprint',pc.eligibility_fingerprint) ORDER BY pc.id)
      FROM sports_management.player_category_participations pc WHERE pc.origin_registration_id=pr.id),'[]'::jsonb)
  FROM sports_management.player_registrations pr
   JOIN sports_management.people p ON p.id=pr.person_id
   JOIN sports_management.season_teams st ON st.id=pr.season_team_id
   JOIN sports_management.season_categories sc ON sc.id=st.season_category_id
   JOIN sports_management.competition_rules cr ON cr.id=sc.competition_rule_id
  WHERE pr.season_id=NEW.id ORDER BY pr.id;
 END IF;
 RETURN NEW;
END $$;

-- El inventario de lectores protege jugadores/directiva/tutor. Árbitros siguen
-- bloqueados específicamente hasta acreditar todos sus consumidores históricos.
CREATE FUNCTION sports_management.closed_identity_reader_block(person uuid) RETURNS text
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT CASE WHEN EXISTS(
  SELECT 1 FROM sports_management.referees r
  WHERE r.person_id=person AND (
   EXISTS(SELECT 1 FROM sports_management.club_season_referees c JOIN sports_management.seasons s ON s.id=c.season_id WHERE c.referee_id=r.id AND s.status='CLOSED') OR
   EXISTS(SELECT 1 FROM sports_management.referee_assignments ra JOIN sports_management.matches m ON m.id=ra.match_id JOIN sports_management.seasons s ON s.id=m.season_id WHERE ra.referee_id=r.id AND s.status='CLOSED')))
 THEN 'HISTORICAL_REFEREE_UNPROTECTED' END
$$;
COMMENT ON FUNCTION sports_management.closed_identity_reader_block(uuid) IS 'PDGLD117_READERS_V2';
CREATE OR REPLACE FUNCTION sports_management.protect_closed_person_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE block text; request_id uuid;
BEGIN
 IF ROW(NEW.curp,NEW.first_name,NEW.paternal_surname,NEW.maternal_surname,NEW.birth_date) IS NOT DISTINCT FROM
    ROW(OLD.curp,OLD.first_name,OLD.paternal_surname,OLD.maternal_surname,OLD.birth_date) THEN RETURN NEW; END IF;
 block:=sports_management.closed_identity_reader_block(OLD.id);
 IF block IS NOT NULL THEN RAISE EXCEPTION '%',block; END IF;
 IF EXISTS(SELECT 1 FROM sports_management.seasons s WHERE s.status='CLOSED' AND s.id IN (
  SELECT season_id FROM sports_management.player_registrations WHERE person_id=OLD.id
  UNION SELECT ca.season_id FROM sports_management.club_officers co JOIN sports_management.club_affiliations ca ON ca.id=co.affiliation_id WHERE co.person_id=OLD.id
  UNION SELECT pr.season_id FROM sports_management.guardian_consents gc JOIN sports_management.player_registrations pr ON pr.id=gc.registration_id WHERE gc.guardian_person_id=OLD.id)) THEN
  request_id:=nullif(current_setting('app.identity_correction_id',true),'')::uuid;
  IF NOT EXISTS(SELECT 1 FROM sports_management.player_identity_corrections c
   WHERE c.id=request_id AND c.person_id=OLD.id AND c.status='PENDING'
    AND c.expected_identity_version=OLD.identity_version
    AND c.requester_id<>nullif(current_setting('app.user_id',true),'')::uuid
    AND c.proposed_identity->>'curp'=NEW.curp AND c.proposed_identity->>'firstName'=NEW.first_name
    AND c.proposed_identity->>'paternalSurname'=NEW.paternal_surname
    AND (c.proposed_identity->>'maternalSurname') IS NOT DISTINCT FROM NEW.maternal_surname
    AND (c.proposed_identity->>'birthDate')::date=NEW.birth_date)
   THEN RAISE EXCEPTION 'HISTORICAL_CORRECTION_REQUIRED'; END IF;
 END IF;
 RETURN NEW;
END $$;
-- Un GUC o solicitud pendiente no basta: el trámite debe quedar aplicado por
-- otro actor y auditado en LA MISMA transacción; de lo contrario rollback.
CREATE FUNCTION sports_management.verify_historical_correction_commit() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF ROW(NEW.curp,NEW.first_name,NEW.paternal_surname,NEW.maternal_surname,NEW.birth_date) IS NOT DISTINCT FROM
    ROW(OLD.curp,OLD.first_name,OLD.paternal_surname,OLD.maternal_surname,OLD.birth_date) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM sports_management.seasons s WHERE s.status='CLOSED' AND s.id IN (
  SELECT season_id FROM sports_management.player_registrations WHERE person_id=NEW.id
  UNION SELECT ca.season_id FROM sports_management.club_officers co JOIN sports_management.club_affiliations ca ON ca.id=co.affiliation_id WHERE co.person_id=NEW.id
  UNION SELECT pr.season_id FROM sports_management.guardian_consents gc JOIN sports_management.player_registrations pr ON pr.id=gc.registration_id WHERE gc.guardian_person_id=NEW.id)) THEN
  IF NOT EXISTS(SELECT 1 FROM sports_management.player_identity_corrections c
   JOIN sports_management.audit_logs a ON a.entity_id=c.id AND a.action='PLAYER_CORRECTION_APPLIED'
   WHERE c.id=nullif(current_setting('app.identity_correction_id',true),'')::uuid
    AND c.person_id=NEW.id AND c.status='APPLIED' AND c.expected_identity_version=OLD.identity_version
    AND c.reviewed_by=nullif(current_setting('app.user_id',true),'')::uuid AND a.user_id=c.reviewed_by)
  THEN RAISE EXCEPTION 'HISTORICAL_CORRECTION_NOT_COMMITTED'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER historical_correction_committed AFTER UPDATE ON sports_management.people
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sports_management.verify_historical_correction_commit();
REVOKE ALL ON sports_management.season_registration_history FROM PUBLIC;
REVOKE ALL ON FUNCTION sports_management.closed_identity_reader_block(uuid),sports_management.verify_historical_correction_commit() FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 IF to_regnamespace('auth') IS NOT NULL THEN ALTER TABLE sports_management.season_registration_history ENABLE ROW LEVEL SECURITY; END IF;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON sports_management.season_registration_history FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
COMMIT;
