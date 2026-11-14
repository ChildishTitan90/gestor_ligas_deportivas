BEGIN;
ALTER TABLE sports_management.referees ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE sports_management.referee_assignments
 ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0),
 ADD COLUMN approved_identity_version integer,
 ADD COLUMN identity_snapshot jsonb;
-- No backfill: una aprobación legada no acredita su identidad ni se vuelve efectiva.
CREATE UNIQUE INDEX approved_referee_slot ON sports_management.referee_assignments(match_id,assignment_role) WHERE status='APPROVED';
CREATE TABLE sports_management.referee_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES sports_management.users,
 operation_key uuid NOT NULL, input_hash text NOT NULL, league_id uuid NOT NULL REFERENCES sports_management.leagues,
 season_id uuid NOT NULL REFERENCES sports_management.seasons, action text NOT NULL,
 referee_id uuid NOT NULL REFERENCES sports_management.referees, assignment_id uuid REFERENCES sports_management.referee_assignments,
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 5 AND 500), result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(actor_id,operation_key)
);
CREATE TRIGGER immutable_referee_operation BEFORE UPDATE OR DELETE ON sports_management.referee_operations
 FOR EACH ROW EXECUTE FUNCTION sports_management.prevent_history_mutation();
CREATE TRIGGER no_truncate_referee_operation BEFORE TRUNCATE ON sports_management.referee_operations
 FOR EACH STATEMENT EXECUTE FUNCTION sports_management.prevent_history_mutation();

-- Orden común con RF22, cierre/corrección 117 y SQL directo. Las sentencias que
-- cambian horarios/grupos también participan: no basta bloquear la propuesta.
CREATE FUNCTION sports_management.lock_refereeing() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 PERFORM pg_advisory_xact_lock_shared(54,2026);
 PERFORM pg_advisory_xact_lock(117,20261108);
 PERFORM pg_advisory_xact_lock(86,141);
 RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['referees','referee_assignments','referee_availability','club_season_referees','matches','season_teams','groups','season_categories','seasons','people','clubs','club_affiliations','teams'] LOOP
 EXECUTE format('CREATE TRIGGER a_refereeing_lock BEFORE INSERT OR UPDATE OR DELETE ON sports_management.%I FOR EACH STATEMENT EXECUTE FUNCTION sports_management.lock_refereeing()',t);
 END LOOP;
END $$;

-- Única evaluación compartida por propuesta, aprobación, lecturas e integridad SQL.
CREATE FUNCTION sports_management.referee_assignment_blockers(mid uuid,rid uuid,aid uuid DEFAULT NULL)
 RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE m record; r record; c record; codes text[]:='{}';
BEGIN
 SELECT ma.*,s.league_id,s.status AS season_status,s.start_date AS season_start,s.end_date AS season_end,l.timezone,g.season_category_id,sc.category_id,
  ms.code AS match_status INTO m FROM sports_management.matches ma
 JOIN sports_management.seasons s ON s.id=ma.season_id JOIN sports_management.leagues l ON l.id=s.league_id JOIN sports_management.groups g ON g.id=ma.group_id AND g.season_id=ma.season_id
 JOIN sports_management.season_categories sc ON sc.id=g.season_category_id AND sc.season_id=ma.season_id
 JOIN sports_management.match_statuses ms ON ms.id=ma.status_id WHERE ma.id=mid;
 SELECT * INTO r FROM sports_management.referees WHERE id=rid;
 IF m.id IS NULL OR r.id IS NULL THEN RETURN ARRAY['INVALID_CONTEXT']; END IF;
 IF m.season_status='CLOSED' OR m.match_status IN ('FINISHED','NO_SHOW','ADMINISTRATIVELY_RESOLVED') THEN codes:=array_append(codes,'CLOSED_CONTEXT'); END IF;
 IF m.deleted_at IS NOT NULL OR m.match_status IN ('CANCELED','UNSCHEDULED','DRAFT') THEN codes:=array_append(codes,'MATCH_NOT_SCHEDULED'); END IF;
 IF NOT r.is_active THEN codes:=array_append(codes,'INACTIVE'); END IF;
 IF NOT EXISTS(SELECT 1 FROM sports_management.leagues WHERE id=m.league_id AND is_active) THEN codes:=array_append(codes,'INACTIVE_LEAGUE'); END IF;
 SELECT csr.*,ca.status AS affiliation_status,cl.status AS club_status,cl.league_id INTO c
 FROM sports_management.club_season_referees csr JOIN sports_management.club_affiliations ca ON ca.club_id=csr.club_id AND ca.season_id=csr.season_id
 JOIN sports_management.clubs cl ON cl.id=csr.club_id WHERE csr.referee_id=rid AND csr.season_id=m.season_id;
 IF c.id IS NULL OR c.affiliation_status<>'APPROVED' OR c.club_status<>'ACTIVE' OR c.league_id<>m.league_id THEN codes:=array_append(codes,'INVALID_PRESENTATION'); END IF;
 IF EXISTS(SELECT 1 FROM sports_management.season_teams WHERE group_id=m.group_id AND season_id=m.season_id AND club_id=c.club_id) THEN codes:=array_append(codes,'CLUB_IN_GROUP'); END IF;
 IF (SELECT count(*) FROM sports_management.season_teams st JOIN sports_management.teams t ON t.id=st.team_id
  JOIN sports_management.club_affiliations ca ON ca.club_id=st.club_id AND ca.season_id=st.season_id
  JOIN sports_management.clubs tc ON tc.id=st.club_id
  WHERE st.id IN (m.home_team_id,m.away_team_id) AND st.season_id=m.season_id AND st.group_id=m.group_id
   AND st.season_category_id=m.season_category_id AND st.status IN ('REGISTERED','ACTIVE') AND t.status='ACTIVE' AND tc.status='ACTIVE' AND ca.status='APPROVED')<>2
 THEN codes:=array_append(codes,'INVALID_TEAMS'); END IF;
 IF m.starts_at IS NULL OR m.ends_at IS NULL OR m.ends_at<=m.starts_at THEN codes:=array_append(codes,'INVALID_TIME');
 ELSE
  IF (m.starts_at AT TIME ZONE m.timezone)::date NOT BETWEEN m.season_start AND m.season_end OR (m.ends_at AT TIME ZONE m.timezone)::date NOT BETWEEN m.season_start AND m.season_end THEN codes:=array_append(codes,'INVALID_TIME'); END IF;
  IF EXISTS(SELECT 1 FROM sports_management.referee_availability WHERE referee_id=rid AND NOT is_available AND starts_at<m.ends_at AND ends_at>m.starts_at) THEN codes:=array_append(codes,'UNAVAILABLE');
  ELSIF NOT coalesce((SELECT range_agg(tstzrange(starts_at,ends_at,'[)')) @> tstzrange(m.starts_at,m.ends_at,'[)') FROM sports_management.referee_availability WHERE referee_id=rid AND is_available),false) THEN codes:=array_append(codes,'UNKNOWN_AVAILABILITY'); END IF;
  IF EXISTS(SELECT 1 FROM sports_management.referee_assignments a JOIN sports_management.matches om ON om.id=a.match_id
   JOIN sports_management.match_statuses os ON os.id=om.status_id
   WHERE a.referee_id=rid AND a.status='APPROVED' AND a.id IS DISTINCT FROM aid AND om.deleted_at IS NULL
   AND os.code<>'CANCELED' AND om.starts_at<m.ends_at AND om.ends_at>m.starts_at) THEN codes:=array_append(codes,'OVERLAP'); END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM sports_management.referee_assignments WHERE match_id=mid AND referee_id=rid AND status<>'REVOKED' AND id IS DISTINCT FROM aid) THEN codes:=array_append(codes,'DUPLICATE'); END IF;
 IF EXISTS(SELECT 1 FROM sports_management.referee_assignments WHERE match_id=mid AND assignment_role='MAIN' AND status='APPROVED' AND id IS DISTINCT FROM aid) THEN codes:=array_append(codes,'SLOT_TAKEN'); END IF;
 RETURN codes;
END $$;

CREATE FUNCTION sports_management.guard_referee_assignment() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE codes text[]; iv integer; BEGIN
 IF TG_OP='UPDATE' AND pg_trigger_depth()>1 AND OLD.identity_snapshot IS NULL AND NEW.identity_snapshot IS NOT NULL
  AND (to_jsonb(NEW)-'identity_snapshot')=(to_jsonb(OLD)-'identity_snapshot') THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' AND NEW.identity_snapshot IS NOT NULL OR TG_OP='UPDATE' AND NEW.identity_snapshot IS DISTINCT FROM OLD.identity_snapshot THEN RAISE EXCEPTION 'HISTORICAL_REFEREE_UNPROTECTED'; END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.match_id,NEW.referee_id,NEW.assignment_role) IS DISTINCT FROM ROW(OLD.match_id,OLD.referee_id,OLD.assignment_role) OR OLD.status='REVOKED'
   THEN RAISE EXCEPTION 'ASSIGNMENT_IMMUTABLE'; END IF;
  NEW.version:=OLD.version+1;
 END IF;
 IF NEW.status IN ('PROPOSED','APPROVED') THEN
  codes:=sports_management.referee_assignment_blockers(NEW.match_id,NEW.referee_id,NEW.id);
  IF cardinality(codes)>0 THEN RAISE EXCEPTION 'REFEREE_BLOCKED:%',array_to_string(codes,','); END IF;
 END IF;
 IF NEW.status='APPROVED' THEN
  SELECT p.identity_version INTO iv FROM sports_management.referees r JOIN sports_management.people p ON p.id=r.person_id WHERE r.id=NEW.referee_id;
  IF NEW.approved_identity_version IS DISTINCT FROM iv THEN RAISE EXCEPTION 'IDENTITY_CHANGED'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_referee_assignment BEFORE INSERT OR UPDATE ON sports_management.referee_assignments
 FOR EACH ROW EXECUTE FUNCTION sports_management.guard_referee_assignment();

-- Los cambios que invalidarían una aprobación deben revocarla primero. La
-- corrección de identidad NO reescribe designaciones: su versión deja de ser efectiva.
CREATE FUNCTION sports_management.check_referee_dependencies() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a record; codes text[]; BEGIN
 FOR a IN SELECT ra.* FROM sports_management.referee_assignments ra JOIN sports_management.matches m ON m.id=ra.match_id
  JOIN sports_management.seasons s ON s.id=m.season_id JOIN sports_management.match_statuses st ON st.id=m.status_id
  WHERE ra.status='APPROVED' AND s.status<>'CLOSED' AND m.deleted_at IS NULL AND st.code NOT IN ('FINISHED','NO_SHOW','ADMINISTRATIVELY_RESOLVED','CANCELED') LOOP
  codes:=sports_management.referee_assignment_blockers(a.match_id,a.referee_id,a.id);
  IF cardinality(codes)>0 THEN RAISE EXCEPTION 'APPROVED_ASSIGNMENT_CONFLICT:%',array_to_string(codes,','); END IF;
 END LOOP;
 RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['matches','season_teams','groups','season_categories','club_affiliations','clubs','teams','referees','referee_availability','club_season_referees'] LOOP
 EXECUTE format('CREATE TRIGGER check_referee_dependencies AFTER INSERT OR UPDATE OR DELETE ON sports_management.%I FOR EACH STATEMENT EXECUTE FUNCTION sports_management.check_referee_dependencies()',t);
 END LOOP;
END $$;
CREATE FUNCTION sports_management.referee_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$ BEGIN IF NEW.person_id<>OLD.person_id THEN RAISE EXCEPTION 'REFEREE_PERSON_IMMUTABLE'; END IF; NEW.version:=OLD.version+1; RETURN NEW; END $$;
CREATE TRIGGER referee_revision BEFORE UPDATE ON sports_management.referees FOR EACH ROW EXECUTE FUNCTION sports_management.referee_revision();
CREATE FUNCTION sports_management.touch_referee_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 UPDATE sports_management.referees SET version=version+1 WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.referee_id ELSE NEW.referee_id END;
 RETURN NULL;
END $$;
CREATE TRIGGER touch_referee_revision AFTER INSERT OR UPDATE OR DELETE ON sports_management.referee_availability FOR EACH ROW EXECUTE FUNCTION sports_management.touch_referee_revision();
CREATE TRIGGER touch_referee_revision AFTER INSERT OR UPDATE OR DELETE ON sports_management.club_season_referees FOR EACH ROW EXECUTE FUNCTION sports_management.touch_referee_revision();

-- Identidad al cierre del partido. Solo transiciones futuras, sin reconstruir legado.
CREATE FUNCTION sports_management.capture_match_referee_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.status_id IS DISTINCT FROM OLD.status_id AND sports_management.get_match_status_code(NEW.status_id) IN ('FINISHED','NO_SHOW','ADMINISTRATIVELY_RESOLVED') THEN
  UPDATE sports_management.referee_assignments a SET identity_snapshot=jsonb_build_object('label',concat_ws(' ',p.first_name,p.paternal_surname,p.maternal_surname),'identityVersion',p.identity_version,'capturedAt',clock_timestamp(),'source','MATCH_CLOSURE_V1')
  FROM sports_management.referees r JOIN sports_management.people p ON p.id=r.person_id
  WHERE a.match_id=NEW.id AND a.referee_id=r.id AND a.identity_snapshot IS NULL
   AND (a.status<>'APPROVED' OR a.approved_identity_version=p.identity_version);
 END IF;
 RETURN NEW;
END $$;
-- Captura antes de que AFTER UPDATE intente evaluar el contexto ya cerrado.
CREATE TRIGGER capture_match_referee_identity BEFORE UPDATE ON sports_management.matches FOR EACH ROW EXECUTE FUNCTION sports_management.capture_match_referee_identity();

CREATE OR REPLACE FUNCTION sports_management.closed_identity_reader_block(person uuid) RETURNS text
 LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT CASE WHEN EXISTS(
 SELECT 1 FROM (SELECT c.season_id FROM sports_management.referees r JOIN sports_management.club_season_referees c ON c.referee_id=r.id WHERE r.person_id=person
 UNION SELECT m.season_id FROM sports_management.referees r JOIN sports_management.referee_assignments a ON a.referee_id=r.id JOIN sports_management.matches m ON m.id=a.match_id WHERE r.person_id=person) refs
 JOIN sports_management.seasons s ON s.id=refs.season_id AND s.status='CLOSED'
 WHERE NOT EXISTS(SELECT 1 FROM sports_management.season_person_identity_snapshots h WHERE h.person_id=person AND h.season_id=s.id AND h.source='SEASON_CLOSURE_V1'))
 OR EXISTS(SELECT 1 FROM sports_management.referees r JOIN sports_management.referee_assignments a ON a.referee_id=r.id
 JOIN sports_management.matches m ON m.id=a.match_id JOIN sports_management.seasons s ON s.id=m.season_id
 WHERE r.person_id=person AND sports_management.get_match_status_code(m.status_id) IN ('FINISHED','NO_SHOW','ADMINISTRATIVELY_RESOLVED') AND (a.identity_snapshot IS NULL OR a.identity_snapshot->>'source' IS DISTINCT FROM 'MATCH_CLOSURE_V1'))
 THEN 'HISTORICAL_REFEREE_UNPROTECTED' END
$$;
COMMENT ON FUNCTION sports_management.closed_identity_reader_block(uuid) IS 'PDGLD117_READERS_V2';

CREATE FUNCTION sports_management.referee_assignment_effective(aid uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM sports_management.referee_assignments a JOIN sports_management.referees r ON r.id=a.referee_id
 JOIN sports_management.people p ON p.id=r.person_id JOIN sports_management.matches m ON m.id=a.match_id
 JOIN sports_management.seasons s ON s.id=m.season_id
 WHERE a.id=aid AND a.status='APPROVED' AND r.is_active AND m.deleted_at IS NULL
 AND CASE WHEN sports_management.get_match_status_code(m.status_id) IN ('FINISHED','NO_SHOW','ADMINISTRATIVELY_RESOLVED') THEN a.identity_snapshot->>'source'='MATCH_CLOSURE_V1'
 WHEN s.status='CLOSED' THEN EXISTS(SELECT 1 FROM sports_management.season_person_identity_snapshots h WHERE h.season_id=s.id AND h.person_id=p.id AND h.source='SEASON_CLOSURE_V1')
 ELSE a.approved_identity_version=p.identity_version AND cardinality(sports_management.referee_assignment_blockers(m.id,r.id,a.id))=0 END)
$$;

-- Correcciones de árbitros con historia también requieren el trámite existente
-- de 117 y su acuse APPLIED; ni el GUC ni añadir snapshots bastan por sí solos.
CREATE FUNCTION sports_management.guard_referee_identity_correction() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE historic boolean; cid uuid; BEGIN
 IF ROW(NEW.curp,NEW.first_name,NEW.paternal_surname,NEW.maternal_surname,NEW.birth_date) IS NOT DISTINCT FROM ROW(OLD.curp,OLD.first_name,OLD.paternal_surname,OLD.maternal_surname,OLD.birth_date) THEN RETURN NEW; END IF;
 SELECT EXISTS(SELECT 1 FROM sports_management.referees r WHERE r.person_id=OLD.id AND (
  EXISTS(SELECT 1 FROM sports_management.club_season_referees c JOIN sports_management.seasons s ON s.id=c.season_id WHERE c.referee_id=r.id AND s.status='CLOSED') OR
  EXISTS(SELECT 1 FROM sports_management.referee_assignments a JOIN sports_management.matches m ON m.id=a.match_id JOIN sports_management.seasons s ON s.id=m.season_id WHERE a.referee_id=r.id AND (s.status='CLOSED' OR sports_management.get_match_status_code(m.status_id) IN ('FINISHED','NO_SHOW','ADMINISTRATIVELY_RESOLVED'))))) INTO historic;
 IF NOT historic THEN RETURN NEW; END IF;
 cid:=nullif(current_setting('app.identity_correction_id',true),'')::uuid;
 IF TG_NAME='referee_identity_correction_committed' THEN
  IF NOT EXISTS(SELECT 1 FROM sports_management.player_identity_corrections c JOIN sports_management.audit_logs a ON a.entity_id=c.id AND a.action='PLAYER_CORRECTION_APPLIED'
   WHERE c.id=cid AND c.person_id=NEW.id AND c.status='APPLIED' AND c.expected_identity_version=OLD.identity_version AND c.requester_id<>c.reviewed_by AND c.reviewed_by=nullif(current_setting('app.user_id',true),'')::uuid AND a.user_id=c.reviewed_by)
   THEN RAISE EXCEPTION 'HISTORICAL_CORRECTION_NOT_COMMITTED'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM sports_management.player_identity_corrections c WHERE c.id=cid AND c.person_id=OLD.id AND c.status='PENDING' AND c.expected_identity_version=OLD.identity_version
   AND c.requester_id<>nullif(current_setting('app.user_id',true),'')::uuid
   AND c.proposed_identity->>'curp'=NEW.curp AND c.proposed_identity->>'firstName'=NEW.first_name AND c.proposed_identity->>'paternalSurname'=NEW.paternal_surname
   AND (c.proposed_identity->>'maternalSurname') IS NOT DISTINCT FROM NEW.maternal_surname AND (c.proposed_identity->>'birthDate')::date=NEW.birth_date)
   THEN RAISE EXCEPTION 'HISTORICAL_CORRECTION_REQUIRED'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER referee_identity_correction BEFORE UPDATE ON sports_management.people FOR EACH ROW EXECUTE FUNCTION sports_management.guard_referee_identity_correction();
CREATE CONSTRAINT TRIGGER referee_identity_correction_committed AFTER UPDATE ON sports_management.people DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sports_management.guard_referee_identity_correction();
-- Auditar SQL operativo además del acuse de aplicación, sin duplicar INSERT
-- manuales de audit_logs para estas mismas filas.
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['referees','club_season_referees','referee_assignments','referee_availability'] LOOP
 EXECUTE format('CREATE TRIGGER record_audit AFTER INSERT OR UPDATE OR DELETE ON sports_management.%I FOR EACH ROW EXECUTE FUNCTION sports_management.audit_change()',t);
END LOOP; END $$;

REVOKE ALL ON sports_management.referee_operations FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='auth') THEN ALTER TABLE sports_management.referee_operations ENABLE ROW LEVEL SECURITY; END IF;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON sports_management.referee_operations FROM %I',role_name); END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION sports_management.referee_assignment_blockers(uuid,uuid,uuid),sports_management.referee_assignment_effective(uuid),sports_management.guard_referee_identity_correction(),sports_management.lock_refereeing(),sports_management.guard_referee_assignment(),sports_management.check_referee_dependencies(),sports_management.referee_revision(),sports_management.capture_match_referee_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION sports_management.touch_referee_revision() FROM PUBLIC;
COMMIT;
