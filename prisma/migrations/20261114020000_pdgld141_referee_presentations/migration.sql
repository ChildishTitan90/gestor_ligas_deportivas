BEGIN;
-- Una presentación es un trámite del club, no un árbitro efectivo ni una cuenta.
CREATE TABLE sports_management.referee_presentations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), season_id uuid NOT NULL, club_id uuid NOT NULL,
 requester_id uuid NOT NULL REFERENCES sports_management.users, operation_key uuid NOT NULL, input_hash text NOT NULL,
 person_id uuid REFERENCES sports_management.people,
 first_name text NOT NULL CHECK(length(trim(first_name)) BETWEEN 1 AND 80), paternal_surname text NOT NULL CHECK(length(trim(paternal_surname)) BETWEEN 1 AND 80), maternal_surname text CHECK(length(maternal_surname)<=80),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 5 AND 500),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reviewed_by uuid REFERENCES sports_management.users, reviewed_at timestamptz, review_reason text,
 review_key uuid, review_hash text, approved_person_id uuid REFERENCES sports_management.people,
 referee_id uuid REFERENCES sports_management.referees, approved_identity jsonb,
 FOREIGN KEY(club_id,season_id) REFERENCES sports_management.club_affiliations(club_id,season_id),
 UNIQUE(requester_id,operation_key), UNIQUE(reviewed_by,review_key),
 CHECK((status='PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_key IS NULL AND review_hash IS NULL AND review_reason IS NULL)
  OR (status<>'PENDING' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND review_key IS NOT NULL AND review_hash IS NOT NULL AND length(trim(review_reason)) BETWEEN 5 AND 500)),
 CHECK((status='APPROVED' AND approved_person_id IS NOT NULL AND referee_id IS NOT NULL AND approved_identity IS NOT NULL)
  OR (status<>'APPROVED' AND approved_person_id IS NULL AND referee_id IS NULL AND approved_identity IS NULL))
);
CREATE INDEX referee_presentations_inbox ON sports_management.referee_presentations(season_id,club_id,status);
CREATE UNIQUE INDEX pending_referee_person_season ON sports_management.referee_presentations(person_id,season_id) WHERE status='PENDING' AND person_id IS NOT NULL;
CREATE TRIGGER a_refereeing_lock BEFORE INSERT OR UPDATE OR DELETE ON sports_management.referee_presentations
 FOR EACH STATEMENT EXECUTE FUNCTION sports_management.lock_refereeing();
CREATE FUNCTION sports_management.guard_referee_presentation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.status<>'PENDING' THEN RAISE EXCEPTION 'PRESENTATION_IMMUTABLE'; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'PRESENTATION_IMMUTABLE'; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.status<>'PENDING' OR NEW.status='PENDING' OR (to_jsonb(NEW)-ARRAY['status','version','reviewed_by','reviewed_at','review_reason','review_key','review_hash','approved_person_id','referee_id','approved_identity'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','reviewed_by','reviewed_at','review_reason','review_key','review_hash','approved_person_id','referee_id','approved_identity'])
   THEN RAISE EXCEPTION 'PRESENTATION_IMMUTABLE'; END IF;
  NEW.version:=OLD.version+1;
  IF NEW.status='APPROVED' AND NOT EXISTS(SELECT 1 FROM sports_management.referees r JOIN sports_management.club_season_referees c ON c.referee_id=r.id
    WHERE r.id=NEW.referee_id AND r.person_id=NEW.approved_person_id AND c.season_id=NEW.season_id AND c.club_id=NEW.club_id)
   THEN RAISE EXCEPTION 'PRESENTING_CLUB_FIXED'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM sports_management.seasons WHERE id=NEW.season_id AND status='CLOSED') THEN RAISE EXCEPTION 'CLOSED_CONTEXT'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_referee_presentation BEFORE INSERT OR UPDATE OR DELETE ON sports_management.referee_presentations FOR EACH ROW EXECUTE FUNCTION sports_management.guard_referee_presentation();
CREATE TRIGGER no_truncate_referee_presentation BEFORE TRUNCATE ON sports_management.referee_presentations FOR EACH STATEMENT EXECUTE FUNCTION sports_management.prevent_history_mutation();
CREATE TRIGGER record_audit AFTER INSERT OR UPDATE ON sports_management.referee_presentations FOR EACH ROW EXECUTE FUNCTION sports_management.audit_change();
-- El club de origen no se sustituye durante la misma temporada, tampoco desde
-- la edición general del padrón. Una nueva temporada conserva su propia relación.
CREATE FUNCTION sports_management.keep_presenting_club() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' OR ROW(NEW.referee_id,NEW.season_id,NEW.club_id) IS DISTINCT FROM ROW(OLD.referee_id,OLD.season_id,OLD.club_id) THEN RAISE EXCEPTION 'PRESENTING_CLUB_FIXED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER keep_presenting_club BEFORE UPDATE OR DELETE ON sports_management.club_season_referees FOR EACH ROW EXECUTE FUNCTION sports_management.keep_presenting_club();
REVOKE ALL ON sports_management.referee_presentations FROM PUBLIC;
REVOKE ALL ON FUNCTION sports_management.guard_referee_presentation(),sports_management.keep_presenting_club() FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='auth') THEN ALTER TABLE sports_management.referee_presentations ENABLE ROW LEVEL SECURITY; END IF;
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON sports_management.referee_presentations FROM %I',r); END IF;
 END LOOP;
END $$;
COMMIT;
